import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bootstrap, ROOT } from './bootstrap';
import { findPlayerByRiotId, insertPlayer } from '../db/players';
import type { TournamentFile } from '../config';

/** Imports the roster from tournament.config.json. Safe to re-run. */
const { db } = bootstrap();
const file = JSON.parse(
  readFileSync(resolve(ROOT, 'tournament.config.json'), 'utf8'),
) as TournamentFile;

let added = 0;
let skipped = 0;

for (const player of file.players ?? []) {
  if (findPlayerByRiotId(db, player.gameName, player.tagLine)) {
    skipped += 1;
    continue;
  }
  insertPlayer(db, {
    displayName: player.displayName,
    gameName: player.gameName,
    tagLine: player.tagLine,
    role: player.role,
    status: 'approved',
  });
  added += 1;
}

console.log(`[seed] ${added} added, ${skipped} already present`);
db.close();
