import type { Rank, Tier } from './types';

/**
 * Borrowed from the game's own ladder rather than invented, so a row's colour
 * means something. Shared by the site and by the Discord embeds, which is why
 * it lives in core instead of in the frontend.
 */
export const TIER_COLOR: Record<Tier, string> = {
  IRON: '#7c7480',
  BRONZE: '#b0714c',
  SILVER: '#9fb0c0',
  GOLD: '#e0b955',
  PLATINUM: '#4fd3c4',
  EMERALD: '#34c26a',
  DIAMOND: '#6aa6f5',
  MASTER: '#b45ce8',
  GRANDMASTER: '#e0455f',
  CHALLENGER: '#f2d75e',
};

export function tierColorHex(rank: Rank | null): string {
  return rank ? TIER_COLOR[rank.tier] : '#5f6a78';
}

/** Discord embeds take the colour as a decimal integer, not a hex string. */
export function tierColorInt(rank: Rank | null): number {
  return Number.parseInt(tierColorHex(rank).slice(1), 16);
}
