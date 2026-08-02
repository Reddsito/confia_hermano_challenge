import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTournamentConfig } from '../src/lib/domain/config';
import { buildRanking } from '../src/lib/domain/ranking';
import { generateMockSnapshot } from '../src/lib/providers/mock';
import { fetchFromRiot } from '../src/lib/providers/riot';
import { emptyState, migrateState } from '../src/lib/providers/state';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'tournament.config.json');
const STATE_PATH = resolve(ROOT, 'data/state.json');
const SNAPSHOT_PATH = resolve(ROOT, 'public/data/snapshot.json');

loadEnvFile();

async function runOnce(): Promise<void> {
  const config = parseTournamentConfig(
    JSON.parse(await readFile(CONFIG_PATH, 'utf8')),
  );
  const previousState = migrateState(await readJsonOrNull(STATE_PATH));

  const source = process.env.DATA_SOURCE === 'riot' ? 'riot' : 'mock';
  const started = Date.now();

  const { snapshot, state } =
    source === 'riot'
      ? await fetchFromRiot(config, previousState, process.env.RIOT_API_KEY ?? '')
      : generateMockSnapshot(config, previousState);

  // Record where everyone finished this cycle so the next one can show
  // movement arrows. Done here because position is a property of the whole
  // field, not of any single player.
  for (const player of buildRanking(snapshot)) {
    const playerState = state.players[player.id];
    if (playerState) playerState.lastPosition = player.position;
  }

  await mkdir(dirname(STATE_PATH), { recursive: true });
  await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));

  const failed = snapshot.players.filter((player) => player.error);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `[refresh] source=${source} players=${snapshot.players.length} failed=${failed.length} in ${elapsed}s`,
  );
  for (const player of failed) {
    console.warn(`  ! ${player.displayName}: ${player.error}`);
  }
}

async function main(): Promise<void> {
  const watch = process.argv.includes('--watch');

  await runOnce();
  if (!watch) return;

  const config = parseTournamentConfig(
    JSON.parse(await readFile(CONFIG_PATH, 'utf8')),
  );
  const intervalMs = config.refreshIntervalMinutes * 60_000;
  console.log(
    `[refresh] watching, next run every ${config.refreshIntervalMinutes} min`,
  );

  setInterval(() => {
    runOnce().catch((error) => console.error('[refresh] failed:', error));
  }, intervalMs);
}

async function readJsonOrNull(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return emptyState();
  }
}

function loadEnvFile(): void {
  try {
    process.loadEnvFile(resolve(ROOT, '.env'));
  } catch {
    // No .env yet — mock mode needs no configuration.
  }
}

main().catch((error) => {
  console.error('[refresh] fatal:', error);
  process.exitCode = 1;
});
