import type { ChampionUsage, MatchTotals } from '@challenge/core/domain';
import { RiotApiError, type MatchDto, type RiotClient } from '@challenge/core/riot';

import {
  SMITE_SPELL_ID,
  earnedShells,
  opggUrl,
  toLadderPoints,
  totalShells,
  type Rank,
} from '@challenge/core/domain';

import { QUEUE_IDS, type ServerConfig } from '../config';
import type { Db } from '../db/index';
import { insertPlayerMatch, recordRankSample, type PlayerMatchRow } from '../db/matches';
import { awardShells, progressFor } from '../db/shells';
import {
  inGameEmbed,
  matchFinishedEmbed,
  rankChangeEmbed,
} from '../discord/embeds';
import type { DiscordNotifier } from '../discord/notifier';
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
import { MAX_RECENT_RESULTS, computeStreak, toRank } from './helpers';

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
  notifier: DiscordNotifier,
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
        config,
        notifier,
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
  config: ServerConfig,
  notifier: DiscordNotifier,
): Promise<number> {
  const queueType = config.tournament.queue;
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
  const previousRank = existing?.currentRank ?? null;
  const wasInGame = existing?.inGame ?? false;
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

  // LP movement can only be attributed to a single game. With several new
  // matches in one cycle we cannot tell which one earned what, so we say
  // nothing rather than guess.
  const lpDelta =
    fresh.length === 1 && previousRank && currentRank
      ? toLadderPoints(currentRank) - toLadderPoints(previousRank)
      : null;

  for (const matchId of fresh) {
    const match = await client.getMatch(matchId);
    const row = applyMatch(totals, championUsage, match, puuid, player.id, matchId);

    if (row !== null) {
      recentResults = [row.win, ...recentResults].slice(0, MAX_RECENT_RESULTS);
      insertPlayerMatch(db, row);

      // Progress counters are read after the row is stored, so the milestone
      // rules see the game that just crossed the threshold.
      const earned = earnedShells(
        {
          win: row.win,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          durationMinutes: row.durationMinutes,
          pentaKills: row.pentaKills,
          quadraKills: row.quadraKills,
          championId: row.championId,
          usedSmite: row.usedSmite,
        },
        {
          winStreak: Math.max(computeStreak(recentResults), 0),
          ...progressFor(db, player.id),
        },
      );

      if (earned.length > 0) {
        const awarded = awardShells(db, player.id, matchId, earned);
        if (awarded > 0) {
          console.log(
            `[shells] ${player.displayName} +${awarded} (${earned.map((e) => e.rule).join(', ')})`,
          );
        }
      }
      void totalShells;

      notifier.push(
        'match_finished',
        matchFinishedEmbed(player, row, currentRank, lpDelta, {
          tournamentName: config.tournament.name,
          siteUrl: config.siteUrl || undefined,
          opggUrl: opggUrl(config.platform, player.gameName, player.tagLine),
          profileIconId: summoner.profileIconId,
        }),
      );
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

  recordRankSample(db, player.id, currentRank);
  announceRankChange(player, previousRank, currentRank, config, notifier, summoner.profileIconId);

  const inGame = await client.isInGame(puuid).catch(() => false);
  db.prepare('UPDATE player_state SET in_game = ? WHERE player_id = ?').run(
    inGame ? 1 : 0,
    player.id,
  );

  // Only the transition is interesting; re-announcing every cycle while someone
  // sits in a 40-minute game would be spam.
  if (inGame && !wasInGame) {
    notifier.push(
      'in_game',
      inGameEmbed(player, currentRank, {
        tournamentName: config.tournament.name,
        siteUrl: config.siteUrl || undefined,
        opggUrl: opggUrl(config.platform, player.gameName, player.tagLine),
        profileIconId: summoner.profileIconId,
      }),
    );
  }

  return fresh.length;
}

/** Fires only when the tier or the division moved, not on every LP change. */
function announceRankChange(
  player: PlayerRow,
  from: Rank | null,
  to: Rank | null,
  config: ServerConfig,
  notifier: DiscordNotifier,
  profileIconId: number | null,
): void {
  if (!to || !from) return;
  if (from.tier === to.tier && from.division === to.division) return;

  notifier.push(
    'rank_change',
    rankChangeEmbed(
      player,
      from,
      to,
      toLadderPoints(to) > toLadderPoints(from),
      {
        tournamentName: config.tournament.name,
        siteUrl: config.siteUrl || undefined,
        opggUrl: opggUrl(config.platform, player.gameName, player.tagLine),
        profileIconId,
      },
    ),
  );
}

/**
 * Folds one match into the running totals and returns the row to persist, or
 * null when the game should not count.
 */
function applyMatch(
  totals: MatchTotals,
  championUsage: Record<string, ChampionUsage>,
  match: MatchDto,
  puuid: string,
  playerId: string,
  matchId: string,
): PlayerMatchRow | null {
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

  return {
    playerId,
    matchId,
    playedAt: match.info.gameCreation,
    durationMinutes,
    teamId: me.teamId,
    win: me.win,
    championId: me.championId,
    championName: me.championName,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    creepScore: me.totalMinionsKilled + me.neutralMinionsKilled,
    goldEarned: me.goldEarned ?? 0,
    damageToChampions: me.totalDamageDealtToChampions ?? 0,
    damageTaken: me.totalDamageTaken ?? 0,
    visionScore: me.visionScore ?? 0,
    timeDeadSeconds: me.totalTimeSpentDead ?? 0,
    pentaKills: me.pentaKills ?? 0,
    quadraKills: me.quadraKills ?? 0,
    tripleKills: me.tripleKills ?? 0,
    largestSpree: me.largestKillingSpree ?? 0,
    soloKills: me.challenges?.soloKills ?? 0,
    firstBlood: Boolean(me.firstBloodKill),
    surrendered: Boolean(me.gameEndedInSurrender),
    killParticipation: me.challenges?.killParticipation ?? null,
    usedSmite:
      me.summoner1Id === SMITE_SPELL_ID || me.summoner2Id === SMITE_SPELL_ID,
  };
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
