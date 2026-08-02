import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/**
 * Every migration is applied once, in order, inside a transaction. The version
 * lives in SQLite's own `user_version`, so no bookkeeping table is needed.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id            TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    game_name     TEXT NOT NULL,
    tag_line      TEXT NOT NULL,
    role          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    puuid         TEXT,
    created_at    TEXT NOT NULL,
    UNIQUE (game_name, tag_line)
  );

  CREATE INDEX idx_players_status ON players (status);

  CREATE TABLE player_state (
    player_id       TEXT PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    puuid           TEXT NOT NULL,
    totals          TEXT NOT NULL,
    champion_usage  TEXT NOT NULL DEFAULT '{}',
    recent_results  TEXT NOT NULL DEFAULT '[]',
    start_rank      TEXT,
    current_rank    TEXT,
    profile_icon_id INTEGER,
    summoner_level  INTEGER,
    in_game         INTEGER NOT NULL DEFAULT 0,
    last_position   INTEGER,
    last_error      TEXT,
    updated_at      TEXT
  );

  -- One row per counted match. This is what makes ingestion idempotent: the
  -- primary key rejects a replay, so a crash mid-cycle can never double-count.
  CREATE TABLE processed_matches (
    player_id  TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    match_id   TEXT NOT NULL,
    counted_at TEXT NOT NULL,
    PRIMARY KEY (player_id, match_id)
  );

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  // WAL keeps the sync cycle's writes from blocking API reads.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const statement = MIGRATIONS[version]!;
    db.transaction(() => {
      db.exec(statement);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ' +
      'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
