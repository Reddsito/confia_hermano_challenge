import { isTierKey } from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { listPlayers } from '../db/players';
import { listMoves, listPlacements, placePlayer } from '../db/tierlist';
import { currentUser } from './auth';

export function tierListRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  /** Public: the board reads for anyone, signed in or not. */
  app.get('/', (context) => {
    const names = new Map(
      listPlayers(db, 'approved').map((player) => [player.id, player.displayName]),
    );

    return context.json({
      placements: listPlacements(db),
      moves: listMoves(db).map((move) => ({
        ...move,
        playerName: names.get(move.playerId) ?? null,
        movedByName: move.movedBy ? (names.get(move.movedBy) ?? null) : null,
      })),
    });
  });

  /**
   * Moves a player, or takes them off the board with a null tier.
   *
   * Anyone signed in and linked to a roster entry may move anyone, including
   * themselves. The board is deliberately unlocked — the log, not a permission
   * check, is what keeps it honest.
   */
  app.put('/placements/:playerId', async (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user?.playerId) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const playerId = context.req.param('playerId');
    if (!listPlayers(db, 'approved').some((player) => player.id === playerId)) {
      return context.json({ error: 'No such player.' }, 404);
    }

    const body = await context.req
      .json<{ tierKey?: string | null }>()
      .catch(() => ({}) as { tierKey?: string | null });

    const tierKey = body.tierKey ?? null;
    if (tierKey !== null && !isTierKey(tierKey)) {
      return context.json({ error: 'No such tier.' }, 400);
    }

    placePlayer(db, playerId, tierKey, user.playerId);
    return context.json({ ok: true });
  });

  return app;
}
