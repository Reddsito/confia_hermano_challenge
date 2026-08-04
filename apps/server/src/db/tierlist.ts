import { randomUUID } from 'node:crypto';

import type { Db } from './index';

export interface Placement {
  playerId: string;
  tierKey: string;
  position: number;
  updatedBy: string | null;
  updatedAt: number;
}

export function listPlacements(db: Db): Placement[] {
  return db
    .prepare(
      `SELECT player_id AS playerId, tier_key AS tierKey, position,
              updated_by AS updatedBy, updated_at AS updatedAt
       FROM tier_placements
       ORDER BY position ASC`,
    )
    .all() as Placement[];
}

/**
 * Puts a player in a bracket, or takes them off the board when tierKey is null.
 *
 * The move is logged in the same transaction as the placement: a board that
 * changed without a matching log line would be exactly the unattributable edit
 * the log exists to prevent.
 *
 * Returns false when nothing actually changed, so re-dropping a player in the
 * bracket they already occupy does not fill the log with noise.
 */
export function placePlayer(
  db: Db,
  playerId: string,
  tierKey: string | null,
  movedBy: string | null,
): boolean {
  let changed = false;

  db.transaction(() => {
    const current = db
      .prepare('SELECT tier_key AS tierKey FROM tier_placements WHERE player_id = ?')
      .get(playerId) as { tierKey: string } | undefined;

    const from = current?.tierKey ?? null;
    if (from === tierKey) return;

    if (tierKey === null) {
      db.prepare('DELETE FROM tier_placements WHERE player_id = ?').run(playerId);
    } else {
      // Appended to the end of the target row: dropping someone in should not
      // displace whoever is already there.
      const next = (
        db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tier_placements WHERE tier_key = ?',
          )
          .get(tierKey) as { n: number }
      ).n;

      db.prepare(
        `INSERT INTO tier_placements (player_id, tier_key, position, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (player_id) DO UPDATE SET
           tier_key = excluded.tier_key,
           position = excluded.position,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).run(playerId, tierKey, next, movedBy, Date.now());
    }

    db.prepare(
      `INSERT INTO tier_moves (id, player_id, from_tier, to_tier, moved_by, moved_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), playerId, from, tierKey, movedBy, Date.now());

    changed = true;
  })();

  return changed;
}

export interface TierMove {
  id: string;
  playerId: string;
  fromTier: string | null;
  toTier: string | null;
  movedBy: string | null;
  movedAt: number;
}

export function listMoves(db: Db, limit = 60): TierMove[] {
  return db
    .prepare(
      `SELECT id, player_id AS playerId, from_tier AS fromTier, to_tier AS toTier,
              moved_by AS movedBy, moved_at AS movedAt
       FROM tier_moves ORDER BY moved_at DESC LIMIT ?`,
    )
    .all(limit) as TierMove[];
}
