import { ROLES, type Role } from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { findPlayerByRiotId, insertPlayer, listPlayers } from '../db/players';
import { verifyRiotId } from '../riot/verify';
import { DiscordNotifier } from '../discord/notifier';

/**
 * Public roster signup.
 *
 * Everything lands as `pending`, never `approved`: an open endpoint that could
 * put a name straight onto the leaderboard would be an open endpoint that
 * anyone can spam onto the leaderboard. The panel already has approve and
 * reject, so this only fills the queue those buttons drain.
 */
export function signupRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  app.post('/', async (context) => {
    const body = await context.req
      .json<{
        displayName?: string;
        gameName?: string;
        tagLine?: string;
        role?: string;
      }>()
      .catch(() => ({}) as Record<string, string>);

    const gameName = (body.gameName ?? '').trim();
    // People paste the tag with the # still attached, every time.
    const tagLine = (body.tagLine ?? '').trim().replace(/^#/, '');
    const role = (body.role ?? '').toUpperCase() as Role;

    if (!gameName || !tagLine) {
      return context.json({ error: 'Falta el Riot ID.' }, 400);
    }
    if (!ROLES.includes(role)) {
      return context.json({ error: 'Elegí un rol.' }, 400);
    }

    // Checked against every status, not just approved: someone who already
    // signed up and is waiting must not be told the form worked twice, and
    // someone previously rejected must not be able to re-queue themselves.
    if (findPlayerByRiotId(db, gameName, tagLine)) {
      return context.json(
        { error: 'Ese Riot ID ya está inscrito o en revisión.' },
        409,
      );
    }

    const verified = await verifyRiotId(config, gameName, tagLine);
    if (!verified.ok) {
      return context.json({ error: verified.error }, verified.status);
    }

    const player = insertPlayer(db, {
      displayName: (body.displayName ?? '').trim() || verified.gameName,
      gameName: verified.gameName,
      tagLine: verified.tagLine,
      role,
      status: 'pending',
      puuid: verified.puuid,
    });

    const waiting = listPlayers(db, 'pending').length;

    // Nobody watches the panel all day; without this a signup sits unseen. Sent
    // on its own notifier rather than the scheduler's, because a signup happens
    // outside the sync cycle and must not wait for the next flush.
    const notifier = new DiscordNotifier(config.discord);
    notifier.push('signup', {
      title: 'Nueva inscripción',
      description:
        `**${player.displayName}** (${player.gameName}#${player.tagLine}) — ${role}\n` +
        `${waiting} esperando aprobación.`,
      url: config.siteUrl ? `${config.siteUrl}/panel` : undefined,
    });
    // Deliberately not awaited: a Discord outage must not fail a signup that
    // already landed in the database.
    void notifier.flush().catch(() => undefined);

    return context.json({ ok: true, status: 'pending' }, 201);
  });

  return app;
}
