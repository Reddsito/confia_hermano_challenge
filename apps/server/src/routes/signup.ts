import { ROLES, type Role } from '@challenge/core/domain';
import { RiotApiError, RiotClient } from '@challenge/core/riot';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { findPlayerByRiotId, insertPlayer } from '../db/players';

interface SignupBody {
  gameName?: unknown;
  tagLine?: unknown;
  role?: unknown;
  displayName?: unknown;
}

/**
 * This endpoint spends Riot rate limit on behalf of anonymous callers, so it is
 * capped twice: a short per-IP window stops one person hammering it, and a
 * daily total protects the key even if the first cap is spread across many IPs.
 */
class SignupGuard {
  private readonly perIp = new Map<string, number[]>();
  private day = new Date().toDateString();
  private today = 0;

  constructor(
    private readonly perIpLimit = 5,
    private readonly perIpWindowMs = 10 * 60_000,
    private readonly dailyLimit = 200,
  ) {}

  check(ip: string): { ok: true } | { ok: false; reason: string } {
    const today = new Date().toDateString();
    if (today !== this.day) {
      this.day = today;
      this.today = 0;
    }

    if (this.today >= this.dailyLimit) {
      return {
        ok: false,
        reason: 'Sign-ups are closed for today. Try again tomorrow.',
      };
    }

    const now = Date.now();
    const hits = (this.perIp.get(ip) ?? []).filter(
      (at) => now - at < this.perIpWindowMs,
    );
    if (hits.length >= this.perIpLimit) {
      return { ok: false, reason: 'Too many attempts. Wait a few minutes.' };
    }

    hits.push(now);
    this.perIp.set(ip, hits);
    this.today += 1;
    return { ok: true };
  }
}

export function signupRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();
  const guard = new SignupGuard(5, 10 * 60_000, config.signupLookupsPerDay);
  // In mock mode there is no real key to validate against, so sign-ups are
  // accepted as typed. A placeholder key in .env must not turn every sign-up
  // into a failed Riot lookup.
  const client = config.useMockData
    ? null
    : new RiotClient(config.riotApiKey, config.platform);

  app.post('/', async (context) => {
    const ip =
      context.req.header('cf-connecting-ip') ??
      context.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';

    const allowed = guard.check(ip);
    if (!allowed.ok) {
      return context.json({ error: allowed.reason }, 429);
    }

    let body: SignupBody;
    try {
      body = await context.req.json<SignupBody>();
    } catch {
      return context.json({ error: 'Expected a JSON body.' }, 400);
    }

    const gameName = String(body.gameName ?? '').trim();
    const tagLine = String(body.tagLine ?? '')
      .trim()
      .replace(/^#/, '');
    const role = String(body.role ?? '').toUpperCase() as Role;
    const displayName = String(body.displayName ?? '').trim() || gameName;

    if (!gameName || !tagLine) {
      return context.json(
        { error: 'Enter your Riot ID, both the name and the tag.' },
        400,
      );
    }
    if (gameName.length > 32 || tagLine.length > 8 || displayName.length > 32) {
      return context.json({ error: 'That Riot ID is too long.' }, 400);
    }
    if (!ROLES.includes(role)) {
      return context.json(
        { error: `Pick a role: ${ROLES.join(', ').toLowerCase()}.` },
        400,
      );
    }

    if (findPlayerByRiotId(db, gameName, tagLine)) {
      return context.json({ error: 'That Riot ID is already signed up.' }, 409);
    }

    // Verifying against Riot here means a typo is caught at sign-up instead of
    // becoming an empty row on the leaderboard days later.
    let puuid: string | null = null;
    let resolvedName = gameName;
    let resolvedTag = tagLine;

    if (client) {
      try {
        const account = await client.getAccountByRiotId(gameName, tagLine);
        puuid = account.puuid;
        resolvedName = account.gameName;
        resolvedTag = account.tagLine;
      } catch (error) {
        if (error instanceof RiotApiError && error.status === 404) {
          return context.json(
            {
              error: `No account found for ${gameName}#${tagLine} on ${config.platform}. Check the spelling and the tag.`,
            },
            404,
          );
        }
        return context.json(
          { error: 'Riot did not answer. Try again in a minute.' },
          502,
        );
      }
    }

    const status = config.autoApproveSignups ? 'approved' : 'pending';
    const player = insertPlayer(db, {
      displayName,
      gameName: resolvedName,
      tagLine: resolvedTag,
      role,
      status,
      puuid,
    });

    return context.json(
      {
        id: player.id,
        status,
        message:
          status === 'approved'
            ? 'You are in. Your stats appear after the next update.'
            : 'Request received. It shows up once an admin approves it.',
      },
      201,
    );
  });

  return app;
}
