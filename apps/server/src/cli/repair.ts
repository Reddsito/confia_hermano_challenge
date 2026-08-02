import { bootstrap } from './bootstrap';

/**
 * Forgets matches that were marked as processed but never actually counted.
 *
 * An earlier version marked a match seen even when it could not be read, so a
 * cycle running with a stale PUUID silently discarded real games. Clearing
 * those markers lets the next cycle pick them up again.
 *
 * Safe to re-run: matches that did land in player_matches are left alone.
 */
const { db } = bootstrap();

const orphaned = db
  .prepare(
    `SELECT COUNT(*) AS n FROM processed_matches p
     WHERE NOT EXISTS (
       SELECT 1 FROM player_matches m
       WHERE m.player_id = p.player_id AND m.match_id = p.match_id
     )`,
  )
  .get() as { n: number };

db.prepare(
  `DELETE FROM processed_matches
   WHERE NOT EXISTS (
     SELECT 1 FROM player_matches m
     WHERE m.player_id = processed_matches.player_id
       AND m.match_id = processed_matches.match_id
   )`,
).run();

console.log(`[repair] ${orphaned.n} matches released for re-processing`);
console.log('[repair] they will be picked up on the next cycle\n');
db.close();
