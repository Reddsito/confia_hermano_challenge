import { MAX_HELD_SHELLS, opggUrl } from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { getPlayerState, listPlayers } from '../db/players';
import {
  applyReroll,
  balanceFor,
  getThrow,
  listChallenges,
  listRolls,
  listShells,
  listThrows,
  recordThrow,
  rollCount,
  spinChallenge,
  throwsAgainst,
} from '../db/shells';
import { MAX_CHAMPION_REROLLS, rollChampion } from '@challenge/core/domain';
import { championPoolFor, rollFor } from '../shells/spin';
import { describePayload } from '../shells/describe';
import { runeTrees } from '../riot/runes';
import { championIndex } from '../riot/champions';
import { shellThrowEmbed } from '../discord/embeds';
import { DiscordNotifier } from '../discord/notifier';
import { mentionFor } from '../db/users';
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
        kind: challenge.kind,
        // Derived, never stored: editing one weight must not silently rewrite
        // everyone else's number.
        chance: challenge.weight / total,
      })),
    });
  });

  /**
   * The rune trees, proxied so the browser can label and illustrate a rolled
   * page without every visitor hitting Data Dragon themselves. Already cached
   * for a day server-side.
   */
  app.get('/runes', async (context) => context.json({ trees: await runeTrees() }));

  /** Champion id, name and icon, for drawing whatever a shell rolled. */
  app.get('/champions', async (context) =>
    context.json({ champions: await championIndex() }),
  );

  /**
   * The pool a champion roll would spin over for this player, so the reel can
   * be filled with real candidates instead of a random blur.
   */
  app.get('/pool/:playerId', async (context) => {
    const championIds = await championPoolFor(
      db,
      config,
      context.req.param('playerId'),
    );
    return context.json({ championIds });
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
    // Admins may fire at themselves. It is the only way to try the wheel end to
    // end without making someone else owe a game, and it still costs a shell —
    // testing must not be able to mint one.
    if (targetId === user.playerId && !user.isAdmin) {
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

    // Rolled before the throw is written so the result and the row are stored
    // together: a shell that has landed must never be missing its champion.
    const payload = await rollFor(db, config, challenge.kind, targetId);
    const record = recordThrow(db, user.playerId, targetId, challenge, payload);

    // Announced after the throw is committed, so a Discord outage cannot make a
    // spent shell vanish.
    const notifier = new DiscordNotifier(config.discord);
    if (notifier.enabled) {
      const state = getPlayerState(db, target.id);
      // Mentioning the target only works from the message body, so it rides
      // alongside the embed rather than inside it.
      const mention = mentionFor(db, target.id);

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
          await describePayload(payload),
        ),
        mention ? `${mention} te cayó una Blue Shell` : undefined,
      );
      await notifier.flush();
    }

    return context.json({
      throw: record,
      challenge,
      // Only a champion can be re-spun. A rune page is available to everyone,
      // so there is no "I don't have it" to appeal with.
      rerollsLeft:
        payload?.kind === 'RANDOM_CHAMPION' ? MAX_CHAMPION_REROLLS : 0,
      remaining: balanceFor(db, user.playerId).available,
    });
  });

  /**
   * Rolls a result and throws it away. Admin only.
   *
   * The point is to see what a champion roll or a rune page actually looks like
   * without spending a shell or making anybody owe a game — nothing here is
   * written, so it can be run as many times as it takes to check the rendering.
   */
  app.post('/preview', async (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user?.isAdmin) {
      return context.json({ error: 'Admins only.' }, 403);
    }

    const body = await context.req
      .json<{ targetId?: string; kind?: string }>()
      .catch(() => ({}) as { targetId?: string; kind?: string });

    const targetId = String(body.targetId ?? user.playerId ?? '');
    if (!targetId) return context.json({ error: 'Pick a target.' }, 400);

    const kind = body.kind === 'RANDOM_RUNES' ? 'RANDOM_RUNES' : 'RANDOM_CHAMPION';
    const payload = await rollFor(db, config, kind, targetId);

    return context.json({ payload });
  });

  /**
   * Everything fired at the signed-in player, with the full spin history of
   * each one. This is the "what do I owe" view.
   */
  app.get('/received', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user?.playerId) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const names = new Map(
      listPlayers(db, 'approved').map((player) => [player.id, player.displayName]),
    );

    return context.json({
      throws: throwsAgainst(db, user.playerId).map((record) => ({
        ...record,
        fromName: record.fromPlayer ? (names.get(record.fromPlayer) ?? null) : null,
        rolls: listRolls(db, record.id),
      })),
    });
  });

  /**
   * Re-spins a champion the target says they do not own.
   *
   * Only the thrower may do this. The person who was hit rerolling their own
   * punishment would just be picking it, and the cap would be decoration.
   */
  app.post('/throw/:id/reroll', async (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user?.playerId) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const record = getThrow(db, context.req.param('id'));
    if (!record) return context.json({ error: 'No such throw.' }, 404);

    if (record.fromPlayer !== user.playerId) {
      return context.json(
        { error: 'Only whoever fired this shell can re-spin it.' },
        403,
      );
    }

    if (record.payload?.kind !== 'RANDOM_CHAMPION') {
      return context.json(
        { error: 'This challenge has nothing to re-spin.' },
        409,
      );
    }

    const used = rollCount(db, record.id);
    if (used > MAX_CHAMPION_REROLLS) {
      return context.json({ error: 'No re-spins left.', rerollsLeft: 0 }, 409);
    }

    const body = await context.req
      .json<{ reason?: string }>()
      .catch(() => ({}) as { reason?: string });

    // Re-spun against the pool minus the current result, so a reroll always
    // changes something — landing on the same champion would silently burn one.
    const current = record.payload.championId;
    const pool = (await championPoolFor(db, config, record.toPlayer)).filter(
      (championId) => championId !== current,
    );
    const championId = rollChampion(pool);
    if (championId === null) {
      return context.json({ error: 'Nothing left in the pool to roll.' }, 409);
    }

    const applied = applyReroll(
      db,
      record.id,
      { kind: 'RANDOM_CHAMPION', championId },
      String(body.reason ?? '').slice(0, 200),
    );
    if (!applied) {
      return context.json({ error: 'No re-spins left.', rerollsLeft: 0 }, 409);
    }

    return context.json({
      championId,
      rerollsLeft: MAX_CHAMPION_REROLLS - (rollCount(db, record.id) - 1),
      rolls: listRolls(db, record.id),
    });
  });

  return app;
}
