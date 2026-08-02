import { bootstrap } from './bootstrap';

/**
 * Wipes the roster and every accumulated stat. Meant for the switch from mock
 * data to real data: simulated totals must not be mixed with real ones, and the
 * mock Riot IDs would fail every lookup.
 *
 * Requires --yes, because on a live challenge this destroys weeks of history
 * that Riot cannot serve again beyond the MATCH-V5 window.
 */
const { db, config } = bootstrap();

if (!process.argv.includes('--yes')) {
  console.error('\nThis deletes every player and all collected stats.');
  console.error(`Database: ${config.databasePath}`);
  console.error('\nRe-run with --yes if that is what you want.\n');
  db.close();
  process.exit(1);
}

const before = db
  .prepare('SELECT COUNT(*) AS n FROM players')
  .get() as { n: number };

db.transaction(() => {
  db.prepare('DELETE FROM processed_matches').run();
  db.prepare('DELETE FROM player_state').run();
  db.prepare('DELETE FROM players').run();
  db.prepare('DELETE FROM meta').run();
})();

console.log(`[reset] removed ${before.n} players and all their stats`);
db.close();
