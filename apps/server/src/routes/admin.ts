import { timingSafeEqual } from 'node:crypto';

import { ROLES, type Role } from '@challenge/core/domain';
import { RiotApiError, RiotClient } from '@challenge/core/riot';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import {
  deletePlayer,
  findPlayerByRiotId,
  insertPlayer,
  listPlayers,
  setPlayerStatus,
  updatePlayer,
  type PlayerStatus,
} from '../db/players';
import {
  adjustShells,
  deleteChallenge,
  deleteThrow,
  insertChallenge,
  listChallenges,
  pageThrows,
  updateChallenge,
  type ChallengeKind,
} from '../db/shells';
import { linkDiscordUser, listDiscordUsers } from '../db/users';
import type { Scheduler } from '../sync/scheduler';

/** Constant-time compare so the token cannot be guessed by timing the response. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminRoutes(
  db: Db,
  config: ServerConfig,
  scheduler: Scheduler,
) {
  const app = new Hono();

  app.use('*', async (context, next) => {
    const header = context.req.header('authorization') ?? '';
    const provided = header.replace(/^Bearer\s+/i, '');

    if (!config.adminToken || !tokenMatches(provided, config.adminToken)) {
      return context.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  app.get('/players', (context) => {
    const status = context.req.query('status') as PlayerStatus | undefined;
    return context.json({ players: listPlayers(db, status) });
  });

  app.post('/players', async (context) => {
    const body = await context.req.json<{
      displayName?: string;
      gameName?: string;
      tagLine?: string;
      role?: string;
    }>();

    const gameName = (body.gameName ?? '').trim();
    const tagLine = (body.tagLine ?? '').trim().replace(/^#/, '');
    const role = (body.role ?? '').toUpperCase() as Role;

    if (!gameName || !tagLine || !ROLES.includes(role)) {
      return context.json(
        { error: 'gameName, tagLine and a valid role are required.' },
        400,
      );
    }

    if (findPlayerByRiotId(db, gameName, tagLine)) {
      return context.json({ error: 'That Riot ID is already on the roster.' }, 409);
    }

    // Verifying here means a typo is caught while someone is looking at the
    // panel, instead of becoming an empty row on the leaderboard days later.
    const verified = await verifyRiotId(gameName, tagLine);
    if (!verified.ok) {
      return context.json({ error: verified.error }, verified.status);
    }

    const player = insertPlayer(db, {
      displayName: (body.displayName ?? '').trim() || verified.gameName,
      gameName: verified.gameName,
      tagLine: verified.tagLine,
      role,
      status: 'approved',
      puuid: verified.puuid,
    });
    return context.json({ player }, 201);
  });

  app.patch('/players/:id', async (context) => {
    const body = await context.req.json<{
      displayName?: string;
      gameName?: string;
      tagLine?: string;
      role?: string;
    }>();

    if (body.role && !ROLES.includes(body.role.toUpperCase() as Role)) {
      return context.json({ error: 'Invalid role.' }, 400);
    }

    const result = updatePlayer(db, context.req.param('id'), {
      displayName: body.displayName,
      gameName: body.gameName,
      tagLine: body.tagLine,
      role: body.role ? (body.role.toUpperCase() as Role) : undefined,
    });

    if (!result) return context.json({ error: 'No such player' }, 404);

    return context.json({
      player: result.player,
      // Surfaced so the panel can explain why the stats went back to zero.
      statsReset: result.riotIdChanged,
    });
  });

  app.post('/players/:id/approve', (context) => {
    const changed = setPlayerStatus(db, context.req.param('id'), 'approved');
    return changed
      ? context.json({ ok: true })
      : context.json({ error: 'No such player' }, 404);
  });

  app.post('/players/:id/reject', (context) => {
    const changed = setPlayerStatus(db, context.req.param('id'), 'rejected');
    return changed
      ? context.json({ ok: true })
      : context.json({ error: 'No such player' }, 404);
  });

  app.delete('/players/:id', (context) => {
    const changed = deletePlayer(db, context.req.param('id'));
    return changed
      ? context.json({ ok: true })
      : context.json({ error: 'No such player' }, 404);
  });

  app.get('/discord-users', (context) =>
    context.json({ users: listDiscordUsers(db) }),
  );

  /** Links a Discord account to a roster entry, or unlinks it with null. */
  app.post('/discord-users/:discordId/link', async (context) => {
    const body = await context.req
      .json<{ playerId?: string | null }>()
      .catch(() => ({}) as { playerId?: string | null });

    const playerId = body.playerId ?? null;
    if (playerId && !listPlayers(db).some((player) => player.id === playerId)) {
      return context.json({ error: 'No such player' }, 404);
    }

    const ok = linkDiscordUser(db, context.req.param('discordId'), playerId);
    return ok
      ? context.json({ ok: true })
      : context.json({ error: 'No such Discord user' }, 404);
  });

  /**
   * Manual shell adjustment. Earning is automatic, but a challenge run by
   * humans needs a way to correct a mistake or hand one out for something the
   * rules cannot see.
   */
  app.post('/players/:id/shells', async (context) => {
    const body = await context.req
      .json<{ amount?: number; reason?: string }>()
      .catch(() => ({}) as { amount?: number; reason?: string });

    const amount = Math.trunc(Number(body.amount ?? 0));
    if (!Number.isFinite(amount) || amount === 0) {
      return context.json({ error: 'Pass a non-zero amount.' }, 400);
    }

    const playerId = context.req.param('id');
    if (!listPlayers(db).some((player) => player.id === playerId)) {
      return context.json({ error: 'No such player' }, 404);
    }

    const result = adjustShells(db, playerId, amount, body.reason ?? 'Manual adjustment');
    return context.json(result);
  });

  /**
   * Paged, because the history only grows and the panel does not need it all.
   * `total` is what lets the page tell you there is more without fetching it.
   */
  app.get('/throws', (context) => {
    const names = new Map(
      listPlayers(db).map((player) => [player.id, player.displayName]),
    );

    const limit = Math.min(Math.max(Number(context.req.query('limit') ?? 10), 1), 50);
    const offset = Math.max(Number(context.req.query('offset') ?? 0), 0);
    const page = pageThrows(db, limit, offset);

    return context.json({
      total: page.total,
      limit,
      offset,
      throws: page.rows.map((record) => ({
        ...record,
        fromName: record.fromPlayer ? (names.get(record.fromPlayer) ?? null) : null,
        toName: names.get(record.toPlayer) ?? null,
      })),
    });
  });

  /**
   * Undoes a throw entirely.
   *
   * Deleting the row is what gives the shell back: a balance is earned minus
   * thrown, counted from these rows, so removing one restores the spender's
   * count without a compensating ledger entry. The spin history goes with it
   * through the cascade, which is correct — the throw never happened.
   */
  app.delete('/throws/:id', (context) => {
    const ok = deleteThrow(db, context.req.param('id'));
    return ok ? context.json({ ok: true }) : context.json({ error: 'Not found' }, 404);
  });

  app.get('/challenges', (context) =>
    context.json({ challenges: listChallenges(db) }),
  );

  app.post('/challenges', async (context) => {
    const body = await context.req.json<{
      name?: string;
      detail?: string;
      weight?: number;
      kind?: ChallengeKind;
    }>();
    const name = (body.name ?? '').trim();
    if (!name) return context.json({ error: 'A challenge needs a name.' }, 400);

    return context.json(
      {
        challenge: insertChallenge(db, {
          name,
          detail: body.detail,
          weight: body.weight,
          kind: body.kind,
        }),
      },
      201,
    );
  });

  app.patch('/challenges/:id', async (context) => {
    const body = await context.req.json<{
      name?: string;
      detail?: string;
      weight?: number;
      enabled?: boolean;
      kind?: ChallengeKind;
    }>();
    const ok = updateChallenge(db, context.req.param('id'), body);
    return ok ? context.json({ ok: true }) : context.json({ error: 'Not found' }, 404);
  });

  app.delete('/challenges/:id', (context) => {
    const ok = deleteChallenge(db, context.req.param('id'));
    return ok ? context.json({ ok: true }) : context.json({ error: 'Not found' }, 404);
  });

  /** Forces a cycle now instead of waiting for the next tick. */
  app.post('/refresh', async (context) => {
    const report = await scheduler.runCycle();
    return report
      ? context.json({ report })
      : context.json({ error: 'A cycle is already running.' }, 409);
  });

  /**
   * Resolves a Riot ID so the panel can reject typos immediately. In mock mode
   * there is no key to check against, so the input is taken as typed.
   */
  async function verifyRiotId(
    gameName: string,
    tagLine: string,
  ): Promise<
    // `ok` is a literal discriminant so TypeScript narrows the union at the
    // call site; a `null | string` field does not narrow.
    | { ok: true; gameName: string; tagLine: string; puuid: string | null }
    | { ok: false; error: string; status: 404 | 502 }
  > {
    if (config.useMockData) {
      return { ok: true, gameName, tagLine, puuid: null };
    }

    try {
      const client = new RiotClient(config.riotApiKey, config.platform);
      const account = await client.getAccountByRiotId(gameName, tagLine);
      return {
        ok: true,
        gameName: account.gameName,
        tagLine: account.tagLine,
        puuid: account.puuid,
      };
    } catch (error) {
      // Logged in full so the terminal shows the real cause; the browser gets
      // a message that says what to actually do about it.
      console.error('[admin] Riot lookup failed:', error);

      if (error instanceof RiotApiError) {
        if (error.status === 404) {
          return {
            ok: false,
            error: `No account found for ${gameName}#${tagLine} on ${config.platform}. Check the spelling and the tag — the tag is what comes after the # in the client.`,
            status: 404,
          };
        }
        if (error.status === 401 || error.status === 403) {
          return {
            ok: false,
            error:
              'Riot rejected the API key. A development key expires every 24 hours — generate a fresh one at developer.riotgames.com and restart the server.',
            status: 502,
          };
        }
        if (error.status === 429) {
          return {
            ok: false,
            error: 'Rate limit reached. Wait a minute and try again.',
            status: 502,
          };
        }
        return {
          ok: false,
          error: `Riot answered ${error.status}. Check the server logs.`,
          status: 502,
        };
      }

      return {
        ok: false,
        error: 'Could not reach Riot. Check the server logs and your connection.',
        status: 502,
      };
    }
  }

  return app;
}
