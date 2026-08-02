import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TournamentMeta } from '@challenge/core/domain';

import { parseEvents, type DiscordConfig } from './discord/notifier';
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
  /** Null when DISCORD_WEBHOOK_URL is unset — notifications are optional. */
  discord: DiscordConfig | null;
  /** Public site URL, used for links inside Discord messages. */
  siteUrl: string;
  /** Null unless a Discord application is configured for login. */
  discordOAuth: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } | null;
  /** Signs login sessions. Falls back to ADMIN_TOKEN so it is never empty. */
  sessionSecret: string;
  platform: PlatformId;
  tournament: TournamentMeta;
}

export type TournamentFile = TournamentMeta;

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
    siteUrl: env('SITE_URL'),
    sessionSecret: env('SESSION_SECRET') || adminToken || 'insecure-dev-secret',
    discordOAuth:
      env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET')
        ? {
            clientId: env('DISCORD_CLIENT_ID'),
            clientSecret: env('DISCORD_CLIENT_SECRET'),
            redirectUri:
              env('DISCORD_REDIRECT_URI') ||
              `http://localhost:${envInt('PORT', 8787)}/api/auth/discord/callback`,
          }
        : null,
    discord: env('DISCORD_WEBHOOK_URL')
      ? {
          webhookUrl: env('DISCORD_WEBHOOK_URL'),
          events: parseEvents(env('DISCORD_EVENTS')),
          username: env('DISCORD_USERNAME', file.name),
          avatarUrl: env('DISCORD_AVATAR_URL') || undefined,
        }
      : null,
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
