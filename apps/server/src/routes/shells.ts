import { MAX_HELD_SHELLS, opggUrl } from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { getPlayerState, listPlayers } from '../db/players';
import {
  balanceFor,
  listChallenges,
  listShells,
  listThrows,
  recordThrow,
  spinChallenge,
} from '../db/shells';
import { shellThrowEmbed } from '../discord/embeds';
import { DiscordNotifier } from '../discord/notifier';
import { currentUser } from './auth';

export function shellRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  /** Public: the wheel, so everyone can see the odds before firing. */
  app.get('/challenges', (context) => {
    const all = listChallenges(db, true);
    const total = all.reduce((sum, challenge) => sum + challenge.weight, 0) || 1;

    return context.json({
      challenges: all.map((challenge) => ({
        id: challenge.id,
        name: challenge.name,
        detail: challenge.detail,
        weight: challenge.weight,
        // Derived, never stored: editing one weight must not silently rewrite
        // everyone else's number.
        chance: challenge.weight / total,
      })),
    });
  });

  app.get('/', (context) => {
    const players = listPlayers(db, 'approved');
    return context.json({
      max: MAX_HELD_SHELLS,
      players: players.map((player) => ({
        playerId: player.id,
        ...balanceFor(db, player.id),
        shells: listShells(db, player.id),
      })),
      throws: listThrows(db),
    });
  });

  app.post('/throw', async (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }
    if (!user.playerId) {
      return context.json(
        {
          error:
            'Your Discord account is not linked to a player yet. Ask an admin to link it from the panel.',
        },
        403,
      );
    }

    const body = await context.req
      .json<{ targetId?: string }>()
      .catch(() => ({}) as { targetId?: string });
    const targetId = String(body.targetId ?? '');
    if (!targetId) return context.json({ error: 'Pick someone to hit.' }, 400);
    if (targetId === user.playerId) {
      return context.json({ error: 'You cannot fire at yourself.' }, 400);
    }

    const target = listPlayers(db, 'approved').find(
      (player) => player.id === targetId,
    );
    if (!target) return context.json({ error: 'No such player.' }, 404);

    const balance = balanceFor(db, user.playerId);
    if (balance.available <= 0) {
      return context.json({ error: 'You have no blue shells.' }, 409);
    }

    const challenge = spinChallenge(db);
    if (!challenge) {
      return context.json(
        { error: 'The wheel is empty. Add challenges in the panel first.' },
        409,
      );
    }

    const thrower = listPlayers(db, 'approved').find(
      (player) => player.id === user.playerId,
    );
    const record = recordThrow(db, user.playerId, targetId, challenge);

    // Announced after the throw is committed, so a Discord outage cannot make a
    // spent shell vanish.
    const notifier = new DiscordNotifier(config.discord);
    if (notifier.enabled) {
      const state = getPlayerState(db, target.id);
      notifier.push(
        'shell_thrown',
        shellThrowEmbed(
          thrower?.displayName ?? user.username,
          target.displayName,
          challenge.name,
          challenge.detail,
          {
            tournamentName: config.tournament.name,
            siteUrl: config.siteUrl || undefined,
            opggUrl: opggUrl(config.platform, target.gameName, target.tagLine),
            profileIconId: state?.profileIconId ?? null,
          },
        ),
      );
      await notifier.flush();
    }

    return context.json({
      throw: record,
      challenge,
      remaining: balanceFor(db, user.playerId).available,
    });
  });

  return app;
}
