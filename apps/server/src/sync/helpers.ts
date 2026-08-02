import {
  DIVISIONS,
  TIERS,
  type ChampionUsage,
  type Division,
  type Rank,
  type Tier,
} from '@challenge/core/domain';

export const MAX_RECENT_RESULTS = 20;

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

/** Normalises a LEAGUE-V4 entry into the domain Rank, or null if unrecognised. */
export function toRank(entry: {
  tier?: string;
  rank?: string;
  leaguePoints?: number;
}): Rank | null {
  const tier = entry.tier?.toUpperCase() as Tier | undefined;
  if (!tier || !TIERS.includes(tier)) return null;

  const division = entry.rank?.toUpperCase() as Division | undefined;
  return {
    tier,
    division: division && DIVISIONS.includes(division) ? division : null,
    leaguePoints: entry.leaguePoints ?? 0,
  };
}
