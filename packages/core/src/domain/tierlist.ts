/**
 * The shared tier list: where the group thinks everyone will finish.
 *
 * The tiers are real ladder brackets, not S/A/B letters, which is what makes
 * the board settleable — when the challenge ends there is an actual rank to
 * check every placement against.
 *
 * Ordered from the top of the ladder down. The order in this array is the order
 * the rows are drawn, so it is the single place to change the board's shape.
 */
import type { Tier } from './types';

export interface TierBracket {
  /** Stable key. Stored on placements, so renaming a label never moves anyone. */
  key: string;
  tier: Tier;
  label: string;
  /** Inclusive lower bound in LP within the tier, for the row's caption. */
  minLp: number;
  /** Exclusive upper bound, or null for "and up". */
  maxLp: number | null;
}

export const TIER_BRACKETS: readonly TierBracket[] = [
  { key: 'CHALLENGER_3000', tier: 'CHALLENGER', label: 'Challenger', minLp: 3000, maxLp: null },
  { key: 'CHALLENGER_2300', tier: 'CHALLENGER', label: 'Challenger', minLp: 2300, maxLp: 3000 },
  { key: 'GRANDMASTER_2000', tier: 'GRANDMASTER', label: 'Grandmaster', minLp: 2000, maxLp: 2300 },
  { key: 'GRANDMASTER_1600', tier: 'GRANDMASTER', label: 'Grandmaster', minLp: 1600, maxLp: 2000 },
  { key: 'MASTER_1000', tier: 'MASTER', label: 'Master', minLp: 1000, maxLp: 1600 },
  { key: 'MASTER_500', tier: 'MASTER', label: 'Master', minLp: 500, maxLp: 1000 },
  { key: 'MASTER_0', tier: 'MASTER', label: 'Master', minLp: 0, maxLp: 500 },
  { key: 'DIAMOND', tier: 'DIAMOND', label: 'Diamante', minLp: 0, maxLp: null },
  { key: 'EMERALD', tier: 'EMERALD', label: 'Esmeralda', minLp: 0, maxLp: null },
  { key: 'PLATINUM', tier: 'PLATINUM', label: 'Platino', minLp: 0, maxLp: null },
  { key: 'GOLD', tier: 'GOLD', label: 'Oro', minLp: 0, maxLp: null },
  { key: 'SILVER', tier: 'SILVER', label: 'Plata', minLp: 0, maxLp: null },
  { key: 'BRONZE', tier: 'BRONZE', label: 'Bronce', minLp: 0, maxLp: null },
  { key: 'IRON', tier: 'IRON', label: 'Hierro', minLp: 0, maxLp: null },
];

const BY_KEY = new Map(TIER_BRACKETS.map((bracket) => [bracket.key, bracket]));

export function bracketFor(key: string): TierBracket | null {
  return BY_KEY.get(key) ?? null;
}

export function isTierKey(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * The LP caption for a row, e.g. "2300 – 3000 LP". Only the Master-and-above
 * brackets are split by LP; below that a whole tier is one row, so it has no
 * range worth printing.
 */
export function bracketRange(bracket: TierBracket): string | null {
  const split = bracket.tier === 'MASTER' || bracket.tier === 'GRANDMASTER' || bracket.tier === 'CHALLENGER';
  if (!split) return null;
  return bracket.maxLp === null
    ? `${bracket.minLp}+ LP`
    : `${bracket.minLp} – ${bracket.maxLp} LP`;
}

/**
 * Which bracket a real rank falls into, so a finished challenge can be checked
 * against what the board predicted.
 *
 * Returns null for an unranked player. Below Master the LP is ignored: those
 * tiers are one row each, so any LP inside them lands on the same bracket.
 */
export function bracketForRank(tier: Tier, leaguePoints: number): TierBracket | null {
  const candidates = TIER_BRACKETS.filter((bracket) => bracket.tier === tier);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Ordered top-down, so the first whose floor the player clears is theirs.
  return (
    candidates.find((bracket) => leaguePoints >= bracket.minLp) ??
    candidates[candidates.length - 1]!
  );
}
