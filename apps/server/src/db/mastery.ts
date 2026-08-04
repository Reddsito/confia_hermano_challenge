import type { ChampionMasteryDto } from '@challenge/core/riot';

import type { Db } from './index';

/**
 * How long a cached mastery pool is trusted. Mastery only grows, and a champion
 * played once a week ago is as valid a punishment as one played today, so this
 * is generous on purpose: the pool exists to be spun against, not to be current.
 */
export const MASTERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function saveMastery(
  db: Db,
  playerId: string,
  entries: ChampionMasteryDto[],
): void {
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO champion_mastery (player_id, champion_id, points, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (player_id, champion_id)
     DO UPDATE SET points = excluded.points, fetched_at = excluded.fetched_at`,
  );

  db.transaction(() => {
    for (const entry of entries) {
      insert.run(playerId, entry.championId, entry.championPoints, now);
    }
  })();
}

export interface MasteryPool {
  championIds: number[];
  fetchedAt: number | null;
}

/**
 * The champions this player has any mastery on, most-played first.
 *
 * Order is for display only — the spin itself is uniform, so a one-trick's main
 * is exactly as likely as the champion they touched once and never again.
 */
export function masteryPool(db: Db, playerId: string): MasteryPool {
  const rows = db
    .prepare(
      `SELECT champion_id AS championId, fetched_at AS fetchedAt
       FROM champion_mastery
       WHERE player_id = ? AND points > 0
       ORDER BY points DESC`,
    )
    .all(playerId) as Array<{ championId: number; fetchedAt: number }>;

  return {
    championIds: rows.map((row) => row.championId),
    fetchedAt: rows[0]?.fetchedAt ?? null,
  };
}

export function masteryIsStale(pool: MasteryPool): boolean {
  return pool.fetchedAt === null || Date.now() - pool.fetchedAt > MASTERY_TTL_MS;
}
