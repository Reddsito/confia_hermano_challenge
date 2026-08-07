import { Hono } from 'hono';

import type { Db } from '../db/index';
import { recentMatches } from '../db/matches';
import { listPlayers } from '../db/players';
import {
  balanceFor,
  listShells,
  throwsAgainst,
  throwsBy,
} from '../db/shells';

/** Enough to scroll through without paging, short enough to stay one request. */
const MATCH_LIMIT = 50;

/**
 * Everything the player detail modal shows beyond the standings row it was
 * opened from.
 *
 * Public and unauthenticated, like the standings themselves: this is a
 * scoreboard among friends, and a signed-out visitor already sees every number
 * the tournament is scored on. Nothing here is private to the player — the
 * shell history in particular is the whole point of the feature, since half of
 * it is other people's business by definition.
 *
 * Served as one response rather than three endpoints because the modal opens
 * on all of it at once. Three round trips to fill three tabs would only make
 * the first paint wait for the slowest of them.
 */
export function playerRoutes(db: Db) {
  const app = new Hono();

  app.get('/:id/detail', (context) => {
    const playerId = context.req.param('id');

    const roster = listPlayers(db, 'approved');
    const player = roster.find((candidate) => candidate.id === playerId);
    if (!player) {
      return context.json({ error: 'Ese jugador no existe.' }, 404);
    }

    const names = new Map(
      roster.map((candidate) => [candidate.id, candidate.displayName]),
    );

    return context.json({
      matches: recentMatches(db, playerId, MATCH_LIMIT),
      shells: {
        balance: balanceFor(db, playerId),
        earned: listShells(db, playerId),
        thrown: throwsBy(db, playerId).map((record) => ({
          ...record,
          // The target always has a roster entry — a shell can only be fired at
          // somebody who plays — so this name is never null in practice.
          toName: names.get(record.toPlayer) ?? null,
        })),
        received: throwsAgainst(db, playerId).map((record) => ({
          ...record,
          // The thrower can be a spectator, who has no roster entry and so no
          // name to show here.
          fromName: record.fromPlayer
            ? (names.get(record.fromPlayer) ?? null)
            : null,
        })),
      },
    });
  });

  return app;
}
