import { timingSafeEqual } from 'node:crypto';

import { ROLES, type Role } from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import {
  deletePlayer,
  insertPlayer,
  listPlayers,
  setPlayerStatus,
  type PlayerStatus,
} from '../db/players';
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

    const player = insertPlayer(db, {
      displayName: (body.displayName ?? '').trim() || gameName,
      gameName,
      tagLine,
      role,
      status: 'approved',
    });
    return context.json({ player }, 201);
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

  /** Forces a cycle now instead of waiting for the next tick. */
  app.post('/refresh', async (context) => {
    const report = await scheduler.runCycle();
    return report
      ? context.json({ report })
      : context.json({ error: 'A cycle is already running.' }, 409);
  });

  return app;
}
