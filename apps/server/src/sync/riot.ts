import type { ChampionUsage, MatchTotals } from '@challenge/core/domain';
import { RiotApiError, type MatchDto, type RiotClient } from '@challenge/core/riot';

import { QUEUE_IDS, type ServerConfig } from '../config';
import type { Db } from '../db/index';
import {
  emptyTotals,
  getPlayerState,
  isMatchProcessed,
  listPlayers,
  markMatchProcessed,
  setPlayerPuuid,
  upsertPlayerState,
  type PlayerRow,
} from '../db/players';
import { MAX_RECENT_RESULTS, toRank } from './helpers';

const MATCH_PAGE_SIZE = 20;

export interface CycleReport {
  players: number;
  updated: number;
  failed: number;
  newMatches: number;
  durationMs: number;
}

/**
 * One refresh cycle. Runs players sequentially: the rate limiter already paces
 * requests, and serial work means a single unreachable player degrades one row
 * instead of aborting the whole batch.
 */
export async function runRiotCycle(
  db: Db,
  client: RiotClient,
  config: ServerConfig,
): Promise<CycleReport> {
  const started = Date.now();
  const players = listPlayers(db, 'approved');
  const queueId = QUEUE_IDS[config.tournament.queue] ?? 420;
  const startTimeSeconds = Math.floor(
    Date.parse(config.tournament.startsAt) / 1000,
  );

  let updated = 0;
  let failed = 0;
  let newMatches = 0;

  for (const player of players) {
    try {
      newMatches += await syncPlayer(
        db,
        client,
        player,
        queueId,
        startTimeSeconds,
        config.tournament.queue,
      );
      updated += 1;
    } catch (error) {
      failed += 1;
      recordFailure(db, player, error);
    }
  }

  return {
    players: players.length,
    updated,
    failed,
    newMatches,
    durationMs: Date.now() - started,
  };
}

async function syncPlayer(
  db: Db,
  client: RiotClient,
  player: PlayerRow,
  queueId: number,
  startTimeSeconds: number,
  queueType: string,
): Promise<number> {
  // The PUUID is stable, so it is resolved once and cached on the player row.
  let puuid = player.puuid;
  if (!puuid) {
    const account = await client.getAccountByRiotId(
      player.gameName,
      player.tagLine,
    );
    puuid = account.puuid;
    setPlayerPuuid(db, player.id, puuid);
  }

  const [summoner, entries] = await Promise.all([
    client.getSummonerByPuuid(puuid),
    client.getLeagueEntriesByPuuid(puuid),
  ]);

  const solo = entries.find((entry) => entry.queueType === queueType);
  const currentRank = solo ? toRank(solo) : null;

  const existing = getPlayerState(db, player.id);
  const totals: MatchTotals = existing
    ? { ...existing.totals }
    : emptyTotals();
  const championUsage: Record<string, ChampionUsage> = {
    ...(existing?.championUsage ?? {}),
  };
  let recentResults = [...(existing?.recentResults ?? [])];

  // Seed the state row before ingesting so the start rank is captured even if a
  // later request for this player fails.
  upsertPlayerState(db, {
    playerId: player.id,
    puuid,
    totals,
    championUsage,
    recentResults,
    startRank: existing?.startRank ?? currentRank,
    currentRank,
    profileIconId: summoner.profileIconId,
    summonerLevel: summoner.summonerLevel,
    inGame: existing?.inGame ?? false,
    lastPosition: existing?.lastPosition ?? null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  });

  const matchIds = await client.getMatchIds(puuid, {
    queue: queueId,
    startTime: startTimeSeconds,
    count: MATCH_PAGE_SIZE,
  });

  // Riot returns newest first; walk oldest first so recentResults stays ordered.
  const fresh = matchIds
    .filter((id) => !isMatchProcessed(db, player.id, id))
    .reverse();

  for (const matchId of fresh) {
    const match = await client.getMatch(matchId);
    const outcome = applyMatch(totals, championUsage, match, puuid);

    if (outcome !== null) {
      recentResults = [outcome, ...recentResults].slice(0, MAX_RECENT_RESULTS);
    }

    // The counters and the "already counted" marker move together, so a crash
    // between them cannot produce a double count on the next cycle.
    db.transaction(() => {
      markMatchProcessed(db, player.id, matchId);
      upsertPlayerState(db, {
        playerId: player.id,
        puuid,
        totals,
        championUsage,
        recentResults,
        startRank: existing?.startRank ?? currentRank,
        currentRank,
        profileIconId: summoner.profileIconId,
        summonerLevel: summoner.summonerLevel,
        inGame: existing?.inGame ?? false,
        lastPosition: existing?.lastPosition ?? null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
    })();
  }

  const inGame = await client.isInGame(puuid).catch(() => false);
  db.prepare('UPDATE player_state SET in_game = ? WHERE player_id = ?').run(
    inGame ? 1 : 0,
    player.id,
  );

  return fresh.length;
}

/** Folds one match into the running totals. Returns the result, or null if skipped. */
function applyMatch(
  totals: MatchTotals,
  championUsage: Record<string, ChampionUsage>,
  match: MatchDto,
  puuid: string,
): boolean | null {
  const me = match.info.participants.find(
    (participant) => participant.puuid === puuid,
  );
  if (!me) return null;

  // Remakes are not real games and would distort win rate.
  const durationMinutes = match.info.gameDuration / 60;
  if (durationMinutes < 5) return null;

  totals.games += 1;
  totals.wins += me.win ? 1 : 0;
  totals.losses += me.win ? 0 : 1;
  totals.kills += me.kills;
  totals.deaths += me.deaths;
  totals.assists += me.assists;
  totals.minutesPlayed += durationMinutes;
  totals.creepScore += me.totalMinionsKilled + me.neutralMinionsKilled;

  const key = String(me.championId);
  const usage = championUsage[key] ?? {
    championId: me.championId,
    championName: me.championName,
    games: 0,
    wins: 0,
  };
  championUsage[key] = {
    ...usage,
    games: usage.games + 1,
    wins: usage.wins + (me.win ? 1 : 0),
  };

  return me.win;
}

function recordFailure(db: Db, player: PlayerRow, error: unknown): void {
  const message =
    error instanceof RiotApiError && error.status === 404
      ? 'Riot ID not found'
      : error instanceof Error
        ? error.message
        : String(error);

  const existing = getPlayerState(db, player.id);
  if (!existing) {
    // Nothing accumulated yet — remember the failure so the API can surface it.
    upsertPlayerState(db, {
      playerId: player.id,
      puuid: player.puuid ?? '',
      totals: emptyTotals(),
      championUsage: {},
      recentResults: [],
      startRank: null,
      currentRank: null,
      profileIconId: null,
      summonerLevel: null,
      inGame: false,
      lastPosition: null,
      lastError: message,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  db.prepare(
    'UPDATE player_state SET last_error = ?, updated_at = ? WHERE player_id = ?',
  ).run(message, new Date().toISOString(), player.id);
}
