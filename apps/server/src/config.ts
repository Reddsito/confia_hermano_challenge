import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TournamentMeta } from '@challenge/core/domain';

import {
  ALL_EVENTS,
  parseEvents,
  type DiscordConfig,
  type DiscordEvent,
} from './discord/notifier';
import { isPlatformId, type PlatformId } from '@challenge/core/riot';
import type { R2Config } from './storage/r2';

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
  /**
   * Null unless every R2 variable is set. The clips section reads this to stay
   * hidden rather than offering an upload that cannot succeed.
   */
  r2: R2Config | null;
  platform: PlatformId;
  /**
   * Queue ids whose matches are ingested. Defaults to the challenge queue
   * alone. Widen it to test with customs or normals — everything counts once
   * ingested, stats and blue shells alike, so put it back afterwards.
   */
  ingestQueues: number[];
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
    r2: r2Config(),
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
          webhookByEvent: perEventWebhooks(),
          events: parseEvents(env('DISCORD_EVENTS')),
          username: env('DISCORD_USERNAME', file.name),
          avatarUrl: env('DISCORD_AVATAR_URL') || undefined,
        }
      : null,
    platform,
    ingestQueues: parseQueues(
      env('INGEST_QUEUES'),
      QUEUE_IDS[file.queue ?? 'RANKED_SOLO_5x5'] ?? 420,
    ),
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

/**
 * All five variables or nothing: a partially configured bucket would fail at
 * upload time, per user, instead of at boot.
 */
function r2Config(): R2Config | null {
  const config = {
    accountId: env('R2_ACCOUNT_ID'),
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    bucket: env('R2_BUCKET'),
    publicUrl: env('R2_PUBLIC_URL'),
  };

  return Object.values(config).every(Boolean) ? config : null;
}

/**
 * Reads DISCORD_WEBHOOK_<EVENT> for each event, e.g. DISCORD_WEBHOOK_IN_GAME.
 * Anything left unset falls back to the shared webhook.
 */
function perEventWebhooks(): Partial<Record<DiscordEvent, string>> {
  const map: Partial<Record<DiscordEvent, string>> = {};

  for (const event of ALL_EVENTS) {
    const url = env(`DISCORD_WEBHOOK_${event.toUpperCase()}`);
    if (url) map[event] = url;
  }

  return map;
}

function parseQueues(raw: string, fallback: number): number[] {
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    // Empty entries must be dropped before Number(): Number('') is 0, which is
    // a real queue id (custom games), so an unset variable would silently
    // become "only count customs" instead of falling back.
    .filter((value) => value.length > 0)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0);

  return parsed.length > 0 ? parsed : [fallback];
}

export const QUEUE_IDS: Record<string, number> = {
  RANKED_SOLO_5x5: 420,
  RANKED_FLEX_SR: 440,
};
