import { bootstrap } from './bootstrap';

/**
 * Clears a finished season so the next one starts from zero.
 *
 * Deleting `players` already cascades to everything that hangs off a roster
 * entry — state, matches, LP history, mastery, shells, throws, duels, bets,
 * shields and the tier board. What it does NOT reach is the data held by
 * Discord account instead of by player row, and that is exactly the data that
 * would hand somebody last season's advantage: the coin ledger and the shell
 * grants. Those are listed explicitly below.
 *
 * Two things are deliberately kept:
 *
 * - `discord_users`, so nobody has to sign in again.
 * - `challenges`, which is the wheel's configuration, not season data.
 *
 * `clips` are kept too: the rows point at objects in R2, and deleting the rows
 * here would orphan the bytes with no way left to find them. Their `player_id`
 * is nulled by the cascade, which is all the roster wipe needs.
 *
 * Requires --yes, because on a live challenge this destroys weeks of history
 * that Riot cannot serve again beyond the MATCH-V5 window.
 */
const { db, config } = bootstrap();

/** Wiped on top of whatever the `players` cascade already takes. */
const EXTRA_TABLES = [
  // Held by discord_id, so no cascade reaches them.
  'coin_ledger',
  'shell_grants',
  // Riot responses for accounts that are no longer on the roster.
  'rank_cache',
  'summoner_cache',
  // Sync bookkeeping: the match marker and the cycle cursor.
  'processed_matches',
  'meta',
] as const;

const counted = ['players', ...EXTRA_TABLES] as const;
const before = new Map(
  counted.map((table) => [
    table,
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
  ]),
);

if (!process.argv.includes('--yes')) {
  console.error('\nThis deletes every player and all collected stats.');
  console.error(`Database: ${config.databasePath}`);
  console.error('\nRows that would go:');
  for (const [table, n] of before) console.error(`  ${table.padEnd(18)} ${n}`);
  console.error('\nKept: discord_users, challenges, clips, clip_likes');
  console.error('\nRe-run with --yes if that is what you want.\n');
  db.close();
  process.exit(1);
}

db.transaction(() => {
  // The cascade does the rest, so this has to run with the pragma on — which
  // `openDatabase` already guarantees.
  for (const table of EXTRA_TABLES) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare('DELETE FROM players').run();
})();

for (const [table, n] of before) console.log(`[reset] ${table}: ${n} -> 0`);

// A season wipe frees a large share of the file. VACUUM cannot run inside a
// transaction, so it goes here: without it the pages stay allocated and every
// later backup carries the dead weight.
db.prepare('VACUUM').run();
db.close();
