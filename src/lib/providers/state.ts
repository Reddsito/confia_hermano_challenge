import type { ChampionUsage, MatchTotals, Rank } from '../domain/types';

export const STATE_VERSION = 1;

export interface PlayerState {
  puuid: string;
  /** Match ids already folded into `totals`, newest first. */
  processedMatchIds: string[];
  totals: MatchTotals;
  championUsage: Record<string, ChampionUsage>;
  /** Most recent results first; true = win. Capped to keep the file small. */
  recentResults: boolean[];
  /** Captured the first time we ever see the player, then never touched. */
  startRank: Rank | null;
  /**
   * Only written by the mock provider, which has no real ladder to read from
   * and therefore has to carry the simulated rank forward itself.
   */
  simulatedRank?: Rank | null;
  /** Standing in the previous cycle, written back after the ranking is built. */
  lastPosition?: number | null;
}

export interface WorkerState {
  version: number;
  players: Record<string, PlayerState>;
}

export function emptyTotals(): MatchTotals {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    minutesPlayed: 0,
    creepScore: 0,
  };
}

export function emptyPlayerState(puuid: string): PlayerState {
  return {
    puuid,
    processedMatchIds: [],
    totals: emptyTotals(),
    championUsage: {},
    recentResults: [],
    startRank: null,
  };
}

export function emptyState(): WorkerState {
  return { version: STATE_VERSION, players: {} };
}

/** Discards state written by an older, incompatible worker. */
export function migrateState(raw: unknown): WorkerState {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as WorkerState).version !== STATE_VERSION
  ) {
    return emptyState();
  }
  return raw as WorkerState;
}

/** Longest run of identical results at the head. Positive wins, negative losses. */
export function computeStreak(recentResults: boolean[]): number {
  if (recentResults.length === 0) return 0;
  const first = recentResults[0]!;
  let run = 0;
  for (const result of recentResults) {
    if (result !== first) break;
    run += 1;
  }
  return first ? run : -run;
}

export function topChampions(
  usage: Record<string, ChampionUsage>,
  limit = 3,
): ChampionUsage[] {
  return Object.values(usage)
    .sort((a, b) => b.games - a.games || b.wins - a.wins)
    .slice(0, limit);
}
