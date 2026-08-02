import type { ChampionUsage, MatchTotals } from '@challenge/core/domain';
import {
  RiotApiError,
  type ActiveGameDto,
  type MatchDto,
  type RiotClient,
} from '@challenge/core/riot';

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
import {
  insertPlayerMatch,
  recordRankSample,
  setActiveGame,
  type PlayerMatchRow,
} from '../db/matches';
import { awardShells, fulfillOldestThrow, progressFor } from '../db/shells';
import {
  challengeServedEmbed,
  inGameEmbed,
  matchFinishedEmbed,
  rankChangeEmbed,
  type LiveTeams,
} from '../discord/embeds';
import { championNames } from '../riot/champions';
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
  const queues = config.ingestQueues;
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
        queues,
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
  queues: number[],
  startTimeSeconds: number,
  config: ServerConfig,
  notifier: DiscordNotifier,
): Promise<number> {
  const queueId = queues[0]!;
  const queueType = config.tournament.queue;

  let puuid = player.puuid ?? (await resolvePuuid(db, client, player));

  let summoner;
  let entries;
  try {
    [summoner, entries] = await Promise.all([
      client.getSummonerByPuuid(puuid),
      client.getLeagueEntriesByPuuid(puuid),
    ]);
  } catch (error) {
    // Riot encrypts PUUIDs per API key, and a development key is replaced every
    // 24 hours — after which every cached PUUID is rejected with a 400. Rather
    // than failing daily, drop the stale value and resolve it again.
    if (!(error instanceof RiotApiError) || error.status !== 400) throw error;

    console.warn(
      `[sync] cached PUUID rejected for ${player.displayName}, re-resolving`,
    );
    puuid = await resolvePuuid(db, client, player);
    [summoner, entries] = await Promise.all([
      client.getSummonerByPuuid(puuid),
      client.getLeagueEntriesByPuuid(puuid),
    ]);
  }

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

  // With a single queue, Riot filters for us. With several, the filter has to
  // be dropped and applied locally — the endpoint takes only one queue id.
  const matchIds = await client.getMatchIds(puuid, {
    ...(queues.length === 1 ? { queue: queueId } : {}),
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
    const row = applyMatch(
      totals,
      championUsage,
      match,
      puuid,
      player.id,
      matchId,
      queues,
    );

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

      const served = fulfillOldestThrow(db, player.id, matchId, row.playedAt);
      if (served) {
        notifier.push(
          'challenge_served',
          challengeServedEmbed(player.displayName, served.challengeName, row.win, {
            tournamentName: config.tournament.name,
            siteUrl: config.siteUrl || undefined,
            opggUrl: opggUrl(config.platform, player.gameName, player.tagLine),
            profileIconId: summoner.profileIconId,
          }),
        );
      }

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

  const activeGame = await client.getActiveGame(puuid).catch(() => null);
  const inGame = activeGame !== null;
  db.prepare('UPDATE player_state SET in_game = ? WHERE player_id = ?').run(
    inGame ? 1 : 0,
    player.id,
  );

  setActiveGame(
    db,
    player.id,
    activeGame
      ? {
          gameId: activeGame.gameId,
          queueId: activeGame.gameQueueConfigId,
          gameLength: activeGame.gameLength,
          participants: activeGame.participants.map((participant) => ({
            puuid: participant.puuid,
            championId: participant.championId,
            teamId: participant.teamId,
            riotId: participant.riotId ?? participant.summonerName ?? null,
          })),
        }
      : null,
  );

  // Only the transition is interesting; re-announcing every cycle while someone
  // sits in a 40-minute game would be spam.
  // Customs and ARAMs are visible to the spectator API but mean nothing to the
  // challenge, so they stay out of the channel.
  if (activeGame && !wasInGame && queues.includes(activeGame.gameQueueConfigId)) {
    notifier.push(
      'in_game',
      inGameEmbed(
        player,
        currentRank,
        {
          tournamentName: config.tournament.name,
          siteUrl: config.siteUrl || undefined,
          opggUrl: opggUrl(config.platform, player.gameName, player.tagLine),
          profileIconId: summoner.profileIconId,
        },
        await describeTeams(activeGame, puuid),
      ),
    );
  }

  return fresh.length;
}

/** Resolves a Riot ID to a PUUID and caches it on the player row. */
async function resolvePuuid(
  db: Db,
  client: RiotClient,
  player: PlayerRow,
): Promise<string> {
  const account = await client.getAccountByRiotId(
    player.gameName,
    player.tagLine,
  );
  setPlayerPuuid(db, player.id, account.puuid);
  return account.puuid;
}

/**
 * Turns the live game into two champion lists, the tracked player's own pick
 * marked. Names come from Data Dragon, which needs no key and is cached, so
 * this costs nothing against the Riot rate limit.
 */
async function describeTeams(
  game: ActiveGameDto,
  puuid: string,
): Promise<LiveTeams | null> {
  const me = game.participants.find(
    (participant) => participant.puuid === puuid,
  );
  if (!me) return null;

  const names = await championNames();
  const label = (participant: (typeof game.participants)[number]) => {
    const champion = names.get(participant.championId) ?? `#${participant.championId}`;
    return participant.puuid === puuid ? `**${champion}**` : champion;
  };

  return {
    allies: game.participants
      .filter((participant) => participant.teamId === me.teamId)
      .map(label),
    enemies: game.participants
      .filter((participant) => participant.teamId !== me.teamId)
      .map(label),
  };
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
  allowedQueues: number[],
): PlayerMatchRow | null {
  // Which queues count is a rule of the challenge, so it is enforced against
  // each match's own queueId rather than trusted from a query parameter.
  if (!allowedQueues.includes(match.info.queueId)) {
    return null;
  }

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
    queueId: match.info.queueId,
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
