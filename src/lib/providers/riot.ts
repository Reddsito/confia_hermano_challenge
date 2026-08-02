import { QUEUE_IDS, type TournamentConfig } from '../domain/config';
import type {
  Division,
  PlayerEntry,
  Rank,
  Snapshot,
  Tier,
} from '../domain/types';
import { DIVISIONS, TIERS } from '../domain/types';
import { RiotClient, type MatchDto } from '../riot/client';
import { isPlatformId } from '../riot/routing';
import {
  computeStreak,
  emptyPlayerState,
  topChampions,
  type PlayerState,
  type WorkerState,
} from './state';

const MAX_RECENT_RESULTS = 20;
const MAX_TRACKED_MATCH_IDS = 400;
const MATCH_PAGE_SIZE = 20;

export interface FetchResult {
  snapshot: Snapshot;
  state: WorkerState;
}

/**
 * Pulls fresh data for every configured player and folds it into the running
 * state. Only matches not seen before are downloaded, which keeps a 2-minute
 * refresh cycle well inside a Personal key's budget.
 */
export async function fetchFromRiot(
  config: TournamentConfig,
  previous: WorkerState,
  apiKey: string,
): Promise<FetchResult> {
  if (!isPlatformId(config.platform)) {
    throw new Error(`Unsupported platform "${config.platform}"`);
  }

  const client = new RiotClient(apiKey, config.platform);
  const queueId = QUEUE_IDS[config.queue] ?? QUEUE_IDS.RANKED_SOLO_5x5!;
  const startTimeSeconds = Math.floor(Date.parse(config.startsAt) / 1000);

  const state: WorkerState = { ...previous, players: { ...previous.players } };
  const entries: PlayerEntry[] = [];

  // Sequential on purpose: the limiter already paces calls, and serial work
  // makes a partial failure affect one player instead of the whole batch.
  for (const player of config.players) {
    try {
      const account = await client.getAccountByRiotId(
        player.gameName,
        player.tagLine,
      );

      const previousPlayer = state.players[player.id];
      const playerState =
        previousPlayer?.puuid === account.puuid
          ? // `totals` is copied, not shared: applyMatch mutates it in place,
            // and a half-finished run must not corrupt the previous state.
            { ...previousPlayer, totals: { ...previousPlayer.totals } }
          : emptyPlayerState(account.puuid);

      // Registered before ingesting so that partial progress is still written
      // out if a later request for this player fails.
      state.players[player.id] = playerState;

      const [summoner, leagueEntries] = await Promise.all([
        client.getSummonerByPuuid(account.puuid),
        client.getLeagueEntriesByPuuid(account.puuid),
      ]);

      const soloEntry = leagueEntries.find(
        (entry) => entry.queueType === config.queue,
      );
      const rank = soloEntry ? toRank(soloEntry) : null;
      if (!playerState.startRank) {
        playerState.startRank = rank;
      }

      await ingestNewMatches(
        client,
        playerState,
        account.puuid,
        queueId,
        startTimeSeconds,
      );

      entries.push({
        id: player.id,
        displayName: player.displayName,
        gameName: account.gameName,
        tagLine: account.tagLine,
        role: player.role,
        puuid: account.puuid,
        profileIconId: summoner.profileIconId,
        summonerLevel: summoner.summonerLevel,
        rank,
        startRank: playerState.startRank,
        totals: playerState.totals,
        topChampions: topChampions(playerState.championUsage),
        streak: computeStreak(playerState.recentResults),
        recentResults: playerState.recentResults,
        previousPosition: playerState.lastPosition ?? null,
        inGame: await client.isInGame(account.puuid).catch(() => false),
        error: null,
      });
    } catch (error) {
      // One unreachable player must not take the whole leaderboard down.
      const cached = state.players[player.id];
      entries.push({
        id: player.id,
        displayName: player.displayName,
        gameName: player.gameName,
        tagLine: player.tagLine,
        role: player.role,
        puuid: cached?.puuid ?? null,
        profileIconId: null,
        summonerLevel: null,
        rank: null,
        startRank: cached?.startRank ?? null,
        totals: cached?.totals ?? emptyPlayerState('').totals,
        topChampions: cached ? topChampions(cached.championUsage) : [],
        streak: cached ? computeStreak(cached.recentResults) : 0,
        recentResults: cached?.recentResults ?? [],
        previousPosition: cached?.lastPosition ?? null,
        inGame: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const generatedAt = new Date();
  const nextUpdateAt = new Date(
    generatedAt.getTime() + config.refreshIntervalMinutes * 60_000,
  );

  return {
    snapshot: {
      version: 1,
      generatedAt: generatedAt.toISOString(),
      nextUpdateAt: nextUpdateAt.toISOString(),
      source: 'riot',
      tournament: toMeta(config),
      players: entries,
    },
    state,
  };
}

async function ingestNewMatches(
  client: RiotClient,
  playerState: PlayerState,
  puuid: string,
  queueId: number,
  startTimeSeconds: number,
): Promise<void> {
  const known = new Set(playerState.processedMatchIds);
  const matchIds = await client.getMatchIds(puuid, {
    queue: queueId,
    startTime: startTimeSeconds,
    count: MATCH_PAGE_SIZE,
  });

  const fresh = matchIds.filter((id) => !known.has(id));
  if (fresh.length === 0) return;

  // Riot returns newest first; walk oldest first so recentResults stays ordered.
  // Each match is marked processed as soon as it is folded in: if a later
  // request fails, the ones already counted are never counted twice.
  for (const matchId of [...fresh].reverse()) {
    const match = await client.getMatch(matchId);
    applyMatch(playerState, match, puuid);
    playerState.processedMatchIds = [
      matchId,
      ...playerState.processedMatchIds,
    ].slice(0, MAX_TRACKED_MATCH_IDS);
  }
}

function applyMatch(
  playerState: PlayerState,
  match: MatchDto,
  puuid: string,
): void {
  const me = match.info.participants.find(
    (participant) => participant.puuid === puuid,
  );
  if (!me) return;

  // Remakes are not real games and would distort win rate.
  const durationMinutes = match.info.gameDuration / 60;
  if (durationMinutes < 5) return;

  const totals = playerState.totals;
  totals.games += 1;
  totals.wins += me.win ? 1 : 0;
  totals.losses += me.win ? 0 : 1;
  totals.kills += me.kills;
  totals.deaths += me.deaths;
  totals.assists += me.assists;
  totals.minutesPlayed += durationMinutes;
  totals.creepScore += me.totalMinionsKilled + me.neutralMinionsKilled;

  const key = String(me.championId);
  const usage = playerState.championUsage[key] ?? {
    championId: me.championId,
    championName: me.championName,
    games: 0,
    wins: 0,
  };
  usage.games += 1;
  usage.wins += me.win ? 1 : 0;
  playerState.championUsage[key] = usage;

  playerState.recentResults = [me.win, ...playerState.recentResults].slice(
    0,
    MAX_RECENT_RESULTS,
  );
}

function toRank(entry: {
  tier: string;
  rank: string;
  leaguePoints: number;
}): Rank | null {
  const tier = entry.tier?.toUpperCase() as Tier;
  if (!TIERS.includes(tier)) return null;

  const division = entry.rank?.toUpperCase() as Division;
  return {
    tier,
    division: DIVISIONS.includes(division) ? division : null,
    leaguePoints: entry.leaguePoints ?? 0,
  };
}

export function toMeta(config: TournamentConfig): Snapshot['tournament'] {
  return {
    name: config.name,
    edition: config.edition,
    subtitle: config.subtitle,
    platform: config.platform,
    queue: config.queue,
    startsAt: config.startsAt,
    endsAt: config.endsAt,
    refreshIntervalMinutes: config.refreshIntervalMinutes,
  };
}
