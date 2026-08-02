import type { Role, TournamentMeta } from './types';
import { ROLES } from './types';

/**
 * Fixed values for the mock provider. Useful for pinning a demo roster so the
 * simulated leaderboard shows a known shape instead of drifting every refresh.
 * Ignored entirely when DATA_SOURCE=riot.
 */
export interface MockOverride {
  wins: number;
  losses: number;
  /** Absolute ladder points; see toLadderPoints in domain/ranking.ts. */
  ladderPoints: number;
  startLadderPoints?: number;
}

export interface PlayerConfig {
  id: string;
  displayName: string;
  gameName: string;
  tagLine: string;
  role: Role;
  mock?: MockOverride;
}

export interface TournamentConfig extends TournamentMeta {
  players: PlayerConfig[];
}

/** Fails loudly at startup instead of producing a half-broken snapshot. */
export function parseTournamentConfig(raw: unknown): TournamentConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('tournament.config.json must contain an object');
  }
  const config = raw as Partial<TournamentConfig>;

  const required = ['name', 'platform', 'startsAt', 'endsAt'] as const;
  for (const key of required) {
    if (!config[key]) {
      throw new Error(`tournament.config.json is missing "${key}"`);
    }
  }

  if (!Array.isArray(config.players) || config.players.length === 0) {
    throw new Error('tournament.config.json needs at least one player');
  }

  const seen = new Set<string>();
  for (const player of config.players) {
    if (!player.id || !player.gameName || !player.tagLine) {
      throw new Error(
        `Player entry is missing id, gameName or tagLine: ${JSON.stringify(player)}`,
      );
    }
    if (seen.has(player.id)) {
      throw new Error(`Duplicate player id "${player.id}"`);
    }
    seen.add(player.id);

    if (!ROLES.includes(player.role)) {
      throw new Error(
        `Player "${player.id}" has invalid role "${player.role}". Expected one of ${ROLES.join(', ')}`,
      );
    }
  }

  if (Number.isNaN(Date.parse(config.startsAt!))) {
    throw new Error('startsAt must be an ISO date string');
  }
  if (Number.isNaN(Date.parse(config.endsAt!))) {
    throw new Error('endsAt must be an ISO date string');
  }

  return {
    name: config.name!,
    edition: config.edition ?? '',
    subtitle: config.subtitle ?? '',
    platform: config.platform!,
    queue: config.queue ?? 'RANKED_SOLO_5x5',
    startsAt: config.startsAt!,
    endsAt: config.endsAt!,
    refreshIntervalMinutes: config.refreshIntervalMinutes ?? 2,
    players: config.players,
  };
}

export const QUEUE_IDS: Record<string, number> = {
  RANKED_SOLO_5x5: 420,
  RANKED_FLEX_SR: 440,
};
