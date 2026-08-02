import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTournamentConfig } from '../src/lib/domain/config';
import { RiotApiError, RiotClient } from '../src/lib/riot/client';
import { isPlatformId, regionalRouteFor } from '../src/lib/riot/routing';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'tournament.config.json');

try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // No .env — the checks below will say so plainly.
}

const OK = '  ok  ';
const FAIL = ' fail ';

/**
 * Pre-flight for a real Riot key. Resolves every configured Riot ID and reports
 * the live rate-limit headers, so a typo in the roster shows up here instead of
 * as a silently missing row on the leaderboard.
 */
async function main(): Promise<void> {
  const config = parseTournamentConfig(
    JSON.parse(await readFile(CONFIG_PATH, 'utf8')),
  );

  console.log(`\n${config.name} — connection check\n`);

  const apiKey = process.env.RIOT_API_KEY ?? '';
  if (!apiKey) {
    console.error(`[${FAIL}] RIOT_API_KEY is not set.`);
    console.error('        Run: cp env.example .env, then paste your key.\n');
    process.exitCode = 1;
    return;
  }
  if (!apiKey.startsWith('RGAPI-')) {
    console.warn(
      `[${FAIL}] RIOT_API_KEY does not look like a Riot key (expected RGAPI-…).\n`,
    );
  }

  if (!isPlatformId(config.platform)) {
    console.error(`[${FAIL}] platform "${config.platform}" is not supported.\n`);
    process.exitCode = 1;
    return;
  }

  const route = regionalRouteFor(config.platform);
  console.log(`platform: ${config.platform}   regional route: ${route}`);
  console.log(`source:   DATA_SOURCE=${process.env.DATA_SOURCE ?? 'mock'}\n`);

  // One raw request so the rate-limit headers can be read off the response.
  const first = config.players[0]!;
  const probeUrl =
    `https://${route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(first.gameName)}/${encodeURIComponent(first.tagLine)}`;

  const probe = await fetch(probeUrl, { headers: { 'X-Riot-Token': apiKey } });

  if (probe.status === 401 || probe.status === 403) {
    console.error(
      `[${FAIL}] Riot rejected the key (${probe.status}). A development key ` +
        'expires every 24h — regenerate it, or apply for a Personal key.\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log('rate limits reported by Riot:');
  console.log(`  app:    ${probe.headers.get('X-App-Rate-Limit') ?? 'n/a'}`);
  console.log(`  used:   ${probe.headers.get('X-App-Rate-Limit-Count') ?? 'n/a'}`);
  console.log(`  method: ${probe.headers.get('X-Method-Rate-Limit') ?? 'n/a'}\n`);

  console.log('roster:');
  const client = new RiotClient(apiKey, config.platform);
  let failures = 0;

  for (const player of config.players) {
    const label = `${player.gameName}#${player.tagLine}`.padEnd(28);
    try {
      const account = await client.getAccountByRiotId(
        player.gameName,
        player.tagLine,
      );
      const entries = await client.getLeagueEntriesByPuuid(account.puuid);
      const solo = entries.find((entry) => entry.queueType === config.queue);

      const rank = solo
        ? `${solo.tier} ${solo.rank} · ${solo.leaguePoints} LP · ${solo.wins}W ${solo.losses}L`
        : `no ${config.queue} games this split`;

      console.log(`  [${OK}] ${label} ${rank}`);
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

  console.log(
    `\n${config.players.length - failures}/${config.players.length} resolved.`,
  );

  if (failures > 0) {
    console.log('Fix the failing Riot IDs in tournament.config.json.\n');
    process.exitCode = 1;
  } else {
    console.log('Ready. Set DATA_SOURCE=riot and run: pnpm refresh\n');
  }
}

main().catch((error) => {
  console.error('[doctor] fatal:', error);
  process.exitCode = 1;
});
