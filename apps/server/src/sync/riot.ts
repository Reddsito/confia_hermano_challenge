import type { ChampionUsage, MatchTotals } from '@challenge/core/domain';
import {
  RiotApiError,
  SMITE_SPELL_ID,
  type ActiveGameDto,
  type MatchDto,
  type RiotClient,
} from '@challenge/core/riot';

import {
  earnedShells,
  opggUrl,
  toLadderPoints,
  totalShells,
  type Rank,
} from '@challenge/core/domain';

import { QUEUE_IDS, type ServerConfig } from '../config';
import type { Db } from '../db/index';
import {
  cacheRank,
  insertPlayerMatch,
  recordRankSample,
  setActiveGame,
  staleRankPuuids,
  type PlayerMatchRow,
} from '../db/matches';
import { awardShells, fulfillOldestThrow, progressFor } from '../db/shells';
import { settleBetsForMatch } from '../db/bets';
import { grantWinCoin } from '../db/coins';
import { mentionFor } from '../db/users';
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
 * The instant a player's games start counting, in seconds — what Riot's match
 * list wants.
 *
 * Whichever came later: the tournament opening, or the player signing up. The
 * tournament date alone would credit somebody who registers halfway through with
 * everything they had already played since the start, which is a different
 * challenge from the one everyone else is running.
 */
export function countFrom(
  tournamentStart: number,
  player: { createdAt: string },
): number {
  const joined = Date.parse(player.createdAt);
  // A roster row with an unreadable date falls back to the tournament window
  // rather than to 1970, which would ingest a player's whole career.
  const from = Number.isNaN(joined) ? tournamentStart : Math.max(tournamentStart, joined);
  return Math.floor(from / 1000);
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
  const tournamentStart = Date.parse(config.tournament.startsAt);

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
        countFrom(tournamentStart, player),
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

/**
 * How long a cached rank is trusted. Nobody's rank moves during a game, and a
 * tier shown a few hours late is still the right tier — whereas asking on every
 * cycle would spend ten requests a minute per live game on people who are not
 * even in the challenge.
 */
const RANK_CACHE_MS = 6 * 60 * 60 * 1000;

/**
 * Ranks for everyone in a live game, roster or not, so the live board can show
 * what it is worth. Failures are swallowed per player: a missing tier costs a
 * line of text, and must never take down the sync cycle around it.
 */
async function cacheParticipantRanks(
  db: Db,
  client: RiotClient,
  game: ActiveGameDto,
  queueType: string,
): Promise<void> {
  const missing = staleRankPuuids(
    db,
    game.participants.map((participant) => participant.puuid),
    RANK_CACHE_MS,
  );

  for (const puuid of missing) {
    try {
      const entries = await client.getLeagueEntriesByPuuid(puuid);
      const solo = entries.find((entry) => entry.queueType === queueType);
      // Unranked is cached too, otherwise every cycle would retry the same
      // players forever for an answer that is not going to change today.
      cacheRank(db, puuid, {
        tier: solo?.tier ?? null,
        division: solo?.rank ?? null,
        lp: solo?.leaguePoints ?? null,
      });
    } catch {
      // Leave it uncached so a later cycle can try again.
    }
  }
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
  // Kept alongside recentResults rather than derived from it: that array is
  // trimmed for the form graph, so a streak read off it stops growing at the
  // trim point and the streak rule quietly stops paying.
  let winStreak = existing?.winStreak ?? 0;

  // Seed the state row before ingesting so the start rank is captured even if a
  // later request for this player fails.
  upsertPlayerState(db, {
    playerId: player.id,
    puuid,
    totals,
    championUsage,
    recentResults,
    winStreak,
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
    const outcome = applyMatch(
      totals,
      championUsage,
      match,
      puuid,
      player.id,
      matchId,
      queues,
    );

    // Left unmarked so a later cycle can retry it.
    if (outcome.kind === 'unknown') {
      console.warn(`[sync] could not read ${matchId} for ${player.displayName}`);
      continue;
    }

    const row = outcome.kind === 'counted' ? outcome.row : null;

    if (row !== null) {
      recentResults = [row.win, ...recentResults].slice(0, MAX_RECENT_RESULTS);
      winStreak = row.win ? winStreak + 1 : 0;
      insertPlayerMatch(db, row);

      // The coin for winning lands before any wager is paid, so it is the
      // player's own result that gets first call on the wallet's headroom
      // rather than a bet they happened to place on somebody else.
      if (row.win) {
        const coins = grantWinCoin(db, player.id, matchId);
        if (coins > 0) {
          console.log(`[coins] ${player.displayName}: +${coins} por victoria`);
        }
      }

      const graded = settleBetsForMatch(db, player.id, matchId, {
        win: row.win,
        kills: row.kills,
        firstBlood: row.firstBlood,
        durationMinutes: row.durationMinutes,
      });
      if (graded.settled > 0) {
        console.log(
          `[bets] ${player.displayName}: ${graded.settled} settled, ${graded.won} won`,
        );
      }

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
        },
        {
          winStreak,
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
          mentionFor(db, player.id)
            ? `${mentionFor(db, player.id)} cumpliste tu reto`
            : undefined,
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
        winStreak,
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
          startedAt: activeGame.gameStartTime || null,
          bans: (activeGame.bannedChampions ?? [])
            // -1 is Riot's marker for a skipped ban; it has no champion.
            .filter((ban) => ban.championId > 0)
            .map((ban) => ({ championId: ban.championId, teamId: ban.teamId })),
          participants: activeGame.participants.map((participant) => ({
            puuid: participant.puuid,
            championId: participant.championId,
            teamId: participant.teamId,
            riotId: participant.riotId ?? participant.summonerName ?? null,
            spellIds: [participant.spell1Id ?? 0, participant.spell2Id ?? 0],
            perkStyle: participant.perks?.perkStyle ?? null,
            perkSubStyle: participant.perks?.perkSubStyle ?? null,
          })),
        }
      : null,
  );

  if (activeGame && queues.includes(activeGame.gameQueueConfigId)) {
    await cacheParticipantRanks(db, client, activeGame, queueType);
  }

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
 * The outcome of examining one match.
 *
 * "skip" and "unknown" look the same from the outside but must be treated
 * differently: a remake or a wrong queue will never count and can be marked
 * processed forever, whereas failing to find the player in the payload is a
 * transient problem — marking it would discard the game permanently.
 */
type MatchOutcome =
  | { kind: 'counted'; row: PlayerMatchRow }
  | { kind: 'skip' }
  | { kind: 'unknown' };

/**
 * Folds one match into the running totals and returns the row to persist.
 */
function applyMatch(
  totals: MatchTotals,
  championUsage: Record<string, ChampionUsage>,
  match: MatchDto,
  puuid: string,
  playerId: string,
  matchId: string,
  allowedQueues: number[],
): MatchOutcome {
  // Which queues count is a rule of the challenge, so it is enforced against
  // each match's own queueId rather than trusted from a query parameter.
  if (!allowedQueues.includes(match.info.queueId)) {
    return { kind: 'skip' };
  }

  const me = match.info.participants.find(
    (participant) => participant.puuid === puuid,
  );
  // The player should always be in their own match. Not finding them means the
  // PUUID does not belong to this key, so the game is left for a later cycle.
  if (!me) return { kind: 'unknown' };

  // Remakes are not real games and would distort win rate.
  const durationMinutes = match.info.gameDuration / 60;
  if (durationMinutes < 5) return { kind: 'skip' };

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

  const counted: PlayerMatchRow = {
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

  return { kind: 'counted', row: counted };
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
      winStreak: 0,
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
