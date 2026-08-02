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

  // One row per player per match. Aggregates alone cannot answer "who did we
  // play against", "what happened on the 31st" or "how long were you dead" —
  // those need the individual games kept around.
  `
  CREATE TABLE player_matches (
    player_id        TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    match_id         TEXT NOT NULL,
    played_at        INTEGER NOT NULL,
    duration_minutes REAL NOT NULL,
    team_id          INTEGER NOT NULL,
    win              INTEGER NOT NULL,
    champion_id      INTEGER NOT NULL,
    champion_name    TEXT NOT NULL,
    kills            INTEGER NOT NULL,
    deaths           INTEGER NOT NULL,
    assists          INTEGER NOT NULL,
    creep_score      INTEGER NOT NULL,
    gold_earned      INTEGER NOT NULL,
    damage_to_champions INTEGER NOT NULL,
    damage_taken     INTEGER NOT NULL,
    vision_score     INTEGER NOT NULL,
    time_dead_seconds INTEGER NOT NULL,
    penta_kills      INTEGER NOT NULL,
    quadra_kills     INTEGER NOT NULL,
    triple_kills     INTEGER NOT NULL,
    largest_spree    INTEGER NOT NULL,
    solo_kills       INTEGER NOT NULL,
    first_blood      INTEGER NOT NULL,
    surrendered      INTEGER NOT NULL,
    kill_participation REAL,
    PRIMARY KEY (player_id, match_id)
  );

  CREATE INDEX idx_player_matches_match ON player_matches (match_id);
  CREATE INDEX idx_player_matches_played ON player_matches (played_at);

  -- Sampled once per cycle, and only when the rank actually moved. That keeps
  -- the table small enough to chart directly and makes "best day" a group-by.
  CREATE TABLE lp_history (
    player_id     TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    recorded_at   INTEGER NOT NULL,
    ladder_points INTEGER NOT NULL,
    tier          TEXT NOT NULL,
    division      TEXT,
    league_points INTEGER NOT NULL,
    PRIMARY KEY (player_id, recorded_at)
  );

  CREATE INDEX idx_lp_history_player ON lp_history (player_id, recorded_at);
  `,

  `
  -- One row per shell earned. Kept as individual rows rather than a counter so
  -- the panel can show what each shell was for, and so awarding is idempotent:
  -- the unique key stops a re-processed match from paying twice.
  CREATE TABLE blue_shells (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    match_id   TEXT NOT NULL,
    rule       TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    detail     TEXT NOT NULL,
    earned_at  INTEGER NOT NULL,
    UNIQUE (player_id, match_id, rule)
  );

  CREATE INDEX idx_blue_shells_player ON blue_shells (player_id);

  -- The wheel: what can land on someone when a shell is fired at them.
  CREATE TABLE challenges (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    detail   TEXT NOT NULL DEFAULT '',
    -- Relative weight, not a percentage. Percentages are derived so editing one
    -- entry never forces the others to be rebalanced by hand.
    weight   INTEGER NOT NULL DEFAULT 1,
    enabled  INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE shell_throws (
    id           TEXT PRIMARY KEY,
    from_player  TEXT REFERENCES players (id) ON DELETE SET NULL,
    to_player    TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    challenge_id TEXT REFERENCES challenges (id) ON DELETE SET NULL,
    challenge_name TEXT NOT NULL,
    thrown_at    INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX idx_shell_throws_to ON shell_throws (to_player);

  -- Discord identities, so a logged-in user can be matched to a roster entry.
  CREATE TABLE discord_users (
    discord_id   TEXT PRIMARY KEY,
    username     TEXT NOT NULL,
    avatar       TEXT,
    player_id    TEXT REFERENCES players (id) ON DELETE SET NULL,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL
  );
  `,

  // Added after player_matches already existed, so it has to be an ALTER.
  // Needed to count wins carrying Smite without re-reading every match.
  `ALTER TABLE player_matches ADD COLUMN used_smite INTEGER NOT NULL DEFAULT 0;`,

  // Which game actually paid off a challenge. Nullable while it is still owed.
  `ALTER TABLE shell_throws ADD COLUMN fulfilled_match_id TEXT;`,

  // Recorded so "only ranked solo counts" can be checked against the data
  // rather than trusted because of a query parameter.
  `ALTER TABLE player_matches ADD COLUMN queue_id INTEGER NOT NULL DEFAULT 0;`,
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
