import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROLES, type Role, type TournamentMeta } from '@challenge/core/domain';
import { isPlatformId, type PlatformId } from '@challenge/core/riot';

export interface ServerConfig {
  port: number;
  databasePath: string;
  /** Empty in mock mode. Never sent to a client. */
  riotApiKey: string;
  useMockData: boolean;
  /** Bearer token for /api/admin/*. Required unless running in mock mode. */
  adminToken: string;
  /** Exact origins allowed to call the API. '*' allows any. */
  allowedOrigins: string[];
  /** New signups land as 'pending' unless this is true. */
  autoApproveSignups: boolean;
  /** Cap on Riot lookups triggered by the public signup form, per day. */
  signupLookupsPerDay: number;
  platform: PlatformId;
  tournament: TournamentMeta;
}

export interface TournamentFile extends TournamentMeta {
  players?: Array<{
    id?: string;
    displayName: string;
    gameName: string;
    tagLine: string;
    role: Role;
  }>;
}

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(env(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(root: string): ServerConfig {
  const file = JSON.parse(
    readFileSync(resolve(root, 'tournament.config.json'), 'utf8'),
  ) as TournamentFile;

  const platform = env('PLATFORM', file.platform);
  if (!isPlatformId(platform)) {
    throw new Error(
      `Unsupported platform "${platform}". Set PLATFORM or fix tournament.config.json.`,
    );
  }

  const useMockData = env('DATA_SOURCE', 'mock') !== 'riot';
  const riotApiKey = env('RIOT_API_KEY');
  if (!useMockData && !riotApiKey) {
    throw new Error('DATA_SOURCE=riot requires RIOT_API_KEY.');
  }

  const adminToken = env('ADMIN_TOKEN');
  if (!useMockData && !adminToken) {
    throw new Error(
      'ADMIN_TOKEN is required outside mock mode, otherwise the admin API is open to anyone.',
    );
  }

  for (const player of file.players ?? []) {
    if (!ROLES.includes(player.role)) {
      throw new Error(
        `Seed player "${player.displayName}" has invalid role "${player.role}".`,
      );
    }
  }

  return {
    port: envInt('PORT', 8787),
    databasePath: env('DATABASE_PATH', resolve(root, 'data/challenge.db')),
    riotApiKey,
    useMockData,
    adminToken,
    allowedOrigins: env('ALLOWED_ORIGINS', '*')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    autoApproveSignups: env('AUTO_APPROVE_SIGNUPS') === 'true',
    signupLookupsPerDay: envInt('SIGNUP_LOOKUPS_PER_DAY', 200),
    platform,
    tournament: {
      name: file.name,
      edition: file.edition ?? '',
      subtitle: file.subtitle ?? '',
      platform,
      queue: file.queue ?? 'RANKED_SOLO_5x5',
      startsAt: file.startsAt,
      endsAt: file.endsAt,
      refreshIntervalMinutes: envInt(
        'REFRESH_INTERVAL_MINUTES',
        file.refreshIntervalMinutes ?? 2,
      ),
    },
  };
}

export const QUEUE_IDS: Record<string, number> = {
  RANKED_SOLO_5x5: 420,
  RANKED_FLEX_SR: 440,
};
