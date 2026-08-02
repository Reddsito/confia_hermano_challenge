import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, type ServerConfig } from '../config';
import { openDatabase, type Db } from '../db/index';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Shared entry point for the one-shot CLIs, so they behave like the server. */
export function bootstrap(): { config: ServerConfig; db: Db } {
  try {
    process.loadEnvFile(resolve(ROOT, '.env'));
  } catch {
    // No .env — fall back to real env vars and defaults.
  }

  const config = loadConfig(ROOT);
  return { config, db: openDatabase(config.databasePath) };
}
