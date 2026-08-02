import { RiotApiError, RiotClient, regionalRouteFor } from '@challenge/core/riot';

import { listPlayers } from '../db/players';
import { bootstrap } from './bootstrap';

const OK = '  ok  ';
const FAIL = ' fail ';

/**
 * Pre-flight against a real Riot key: resolves every approved Riot ID and
 * prints the live rate-limit headers, so a typo in the roster shows up here
 * instead of as a silently missing row on the leaderboard.
 */
const { config, db } = bootstrap();

console.log(`\n${config.tournament.name} — connection check\n`);

if (config.useMockData) {
  console.log('DATA_SOURCE is not "riot" — running in mock mode.');
  console.log('Set DATA_SOURCE=riot and RIOT_API_KEY to check the real API.\n');
  db.close();
  process.exit(0);
}

const route = regionalRouteFor(config.platform);
console.log(`platform: ${config.platform}   regional route: ${route}`);

const players = listPlayers(db, 'approved');

// One raw request so the rate-limit headers can be read off the response. With
// an empty roster we probe a name that will not exist: a 404 still proves the
// key is valid, which is exactly what we want to know before adding anyone.
const probeTarget = players[0] ?? {
  gameName: 'zzz-key-check-zzz',
  tagLine: 'LAN',
};

const probe = await fetch(
  `https://${route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(probeTarget.gameName)}/${encodeURIComponent(probeTarget.tagLine)}`,
  { headers: { 'X-Riot-Token': config.riotApiKey } },
);

if (probe.status === 401 || probe.status === 403) {
  console.error(
    `\n[${FAIL}] Riot rejected the key (${probe.status}). A development key ` +
      'expires every 24h — regenerate it, or apply for a Personal key.\n',
  );
  db.close();
  process.exit(1);
}

console.log('\nrate limits reported by Riot:');
console.log(`  app:    ${probe.headers.get('X-App-Rate-Limit') ?? 'n/a'}`);
console.log(`  used:   ${probe.headers.get('X-App-Rate-Limit-Count') ?? 'n/a'}`);
console.log(`  method: ${probe.headers.get('X-Method-Rate-Limit') ?? 'n/a'}\n`);

if (players.length === 0) {
  console.log(
    `[${OK}] The API key works. Add players at /panel — the roster is empty.\n`,
  );
  db.close();
  process.exit(0);
}

console.log('roster:');
const client = new RiotClient(config.riotApiKey, config.platform);
let failures = 0;

for (const player of players) {
  const label = `${player.gameName}#${player.tagLine}`.padEnd(28);
  try {
    const account = await client.getAccountByRiotId(
      player.gameName,
      player.tagLine,
    );
    const entries = await client.getLeagueEntriesByPuuid(account.puuid);
    const solo = entries.find(
      (entry) => entry.queueType === config.tournament.queue,
    );

    console.log(
      `  [${OK}] ${label} ${
        solo
          ? `${solo.tier} ${solo.rank} · ${solo.leaguePoints} LP · ${solo.wins}W ${solo.losses}L`
          : `no ${config.tournament.queue} games this split`
      }`,
    );
  } catch (error) {
    failures += 1;
    const reason =
      error instanceof RiotApiError && error.status === 404
        ? 'Riot ID not found — check spelling and tag'
        : error instanceof Error
          ? error.message
          : String(error);
    console.log(`  [${FAIL}] ${label} ${reason}`);
  }
}

console.log(`\n${players.length - failures}/${players.length} resolved.`);
if (failures > 0) {
  console.log('Fix or remove the failing players, then run pnpm sync.\n');
  process.exitCode = 1;
} else {
  console.log('Ready. Run: pnpm sync\n');
}

db.close();
