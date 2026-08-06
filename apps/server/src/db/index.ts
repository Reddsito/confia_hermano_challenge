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

  // The live game as last seen by the sync cycle. Stored so the site can show
  // it without spending a fresh SPECTATOR-V5 call per visitor.
  `ALTER TABLE player_state ADD COLUMN active_game TEXT;`,

  // One row per settled duel. The primary key is what makes stealing
  // idempotent: a match re-examined on a later cycle cannot pay out twice.
  `
  CREATE TABLE shell_steals (
    match_id   TEXT NOT NULL,
    winner_id  TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    loser_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    taken      INTEGER NOT NULL,
    kept       INTEGER NOT NULL,
    settled_at INTEGER NOT NULL,
    PRIMARY KEY (match_id, winner_id, loser_id)
  );
  `,

  // The win streak the shell rules read. recent_results cannot serve here: it
  // is capped for the form graph and ships to every browser, so a streak taken
  // from it silently froze at that cap and stopped paying past it. This column
  // is a plain counter with no ceiling.
  //
  // Seeded from recent_results, which is exact for any streak still inside the
  // cap — that is every streak on record when this shipped.
  `
  ALTER TABLE player_state ADD COLUMN win_streak INTEGER NOT NULL DEFAULT 0;

  -- Counts the leading run of "true" in the stored JSON, stopping at the first
  -- "false". Done as string work because it must run inside the migration, and
  -- "false" never contains "true" so the count cannot drift.
  UPDATE player_state SET win_streak = (
    length(
      CASE WHEN instr(recent_results, 'false') > 0
           THEN substr(recent_results, 1, instr(recent_results, 'false') - 1)
           ELSE recent_results END
    ) - length(
      replace(
        CASE WHEN instr(recent_results, 'false') > 0
             THEN substr(recent_results, 1, instr(recent_results, 'false') - 1)
             ELSE recent_results END,
        'true', ''
      )
    )
  ) / 4;
  `,

  // Ranks of people in a live game who are not on the roster. LEAGUE-V4 has to
  // be asked per player and a live game has ten of them, so asking every sync
  // cycle would spend the whole rate limit on strangers. Nobody's rank moves
  // mid-game, so one lookup per puuid is cached and reused.
  `
  CREATE TABLE rank_cache (
    puuid      TEXT PRIMARY KEY,
    tier       TEXT,
    division   TEXT,
    lp         INTEGER,
    fetched_at INTEGER NOT NULL
  );
  `,

  // Challenges stopped being pure text: some of them roll something when they
  // land. The kind decides what gets rolled, and defaults to TEXT so every
  // challenge written before this migration keeps behaving exactly as it did.
  //
  // The roll itself lives on the throw rather than on the challenge: the same
  // "random champion" entry lands on different people and must produce a
  // different champion each time.
  `
  ALTER TABLE challenges ADD COLUMN kind TEXT NOT NULL DEFAULT 'TEXT';

  ALTER TABLE shell_throws ADD COLUMN payload TEXT;

  -- One row per spin, including the first. Rerolls are capped, and a cap is
  -- only enforceable if the spins are counted rather than overwritten — and
  -- keeping them all is what makes "he said he didn't own it" auditable
  -- instead of a claim someone makes after the fact.
  CREATE TABLE shell_throw_rolls (
    id        TEXT PRIMARY KEY,
    throw_id  TEXT NOT NULL REFERENCES shell_throws (id) ON DELETE CASCADE,
    payload   TEXT NOT NULL,
    reason    TEXT NOT NULL DEFAULT '',
    rolled_at INTEGER NOT NULL
  );

  CREATE INDEX idx_shell_throw_rolls_throw ON shell_throw_rolls (throw_id);

  -- Mastery points per player, cached. CHAMPION-MASTERY-V4 is one call per
  -- player and the pool only has to be fresh enough to spin against, so it is
  -- refreshed on demand rather than every sync cycle.
  CREATE TABLE champion_mastery (
    player_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    champion_id INTEGER NOT NULL,
    points      INTEGER NOT NULL,
    fetched_at  INTEGER NOT NULL,
    PRIMARY KEY (player_id, champion_id)
  );
  `,

  // The shared tier list: one board everyone edits, predicting where each
  // player finishes. One row per placed player, so a player can only be in one
  // bracket at a time by construction rather than by cleaning up duplicates.
  //
  // Anyone missing from this table is simply unplaced and shows in the tray.
  `
  CREATE TABLE tier_placements (
    player_id  TEXT PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    tier_key   TEXT NOT NULL,
    -- Order within the row, so a bracket can be sorted by conviction.
    position   INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT REFERENCES players (id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  );

  -- Every move, kept forever. A shared board with no attribution is an edit
  -- war; with one, it self-regulates, and that is the whole reason this table
  -- exists rather than the placements simply being overwritten in silence.
  CREATE TABLE tier_moves (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    from_tier  TEXT,
    to_tier    TEXT,
    moved_by   TEXT REFERENCES players (id) ON DELETE SET NULL,
    moved_at   INTEGER NOT NULL
  );

  CREATE INDEX idx_tier_moves_at ON tier_moves (moved_at DESC);
  `,

  // Clips uploaded by viewers and stored in R2. The row is the record; the
  // object is just bytes, so `object_key` is what ties one to the other and a
  // delete has to remove both.
  //
  // Rows are written only after the browser's upload to R2 succeeds. An
  // abandoned upload therefore leaves an orphan object and no row, which costs
  // storage but never shows a broken player to anyone.
  `
  CREATE TABLE clips (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    -- Who uploaded it. Kept by Discord id rather than player id because people
    -- who are not on the roster can still upload.
    discord_id   TEXT NOT NULL REFERENCES discord_users (discord_id) ON DELETE CASCADE,
    -- Optional: the roster player the clip is about, for filtering later.
    player_id    TEXT REFERENCES players (id) ON DELETE SET NULL,
    object_key   TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    -- Seconds, read off the video element by the uploader's browser. Null when
    -- the browser could not determine it; never trusted for anything but display.
    duration     REAL,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX idx_clips_created ON clips (created_at DESC);

  -- One like per person per clip, enforced by the primary key rather than by
  -- checking before insert, so a double-tap cannot race itself into two rows.
  CREATE TABLE clip_likes (
    clip_id    TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL REFERENCES discord_users (discord_id) ON DELETE CASCADE,
    liked_at   INTEGER NOT NULL,
    PRIMARY KEY (clip_id, discord_id)
  );
  `,

  // Betting shells on other people's games.
  //
  // Spectators are a flag on the Discord account, not a row in players: they
  // have no Riot ID, so a players row would need a null puuid and would then
  // have to be excluded by hand from the ranking, the podium, the filters, the
  // tier list and every sync pass. A flag is excluded from all of that by
  // construction, because those queries read players and never look here.
  `
  ALTER TABLE discord_users ADD COLUMN is_spectator INTEGER NOT NULL DEFAULT 0;

  -- Spectators fire shells too, and they have no players row to be the source.
  -- Existing rows keep from_player and leave this null, so nothing about the
  -- throws already recorded changes meaning.
  ALTER TABLE shell_throws ADD COLUMN from_discord TEXT;

  -- One row per wager. The stake leaves the balance the moment it is placed,
  -- which is what stops the same shell being bet on four games at once.
  --
  -- Held by discord_id rather than player_id because spectators bet and have
  -- no player row, and because betting is something an account does, not
  -- something a roster entry does.
  CREATE TABLE bets (
    id          TEXT PRIMARY KEY,
    discord_id  TEXT NOT NULL REFERENCES discord_users (discord_id) ON DELETE CASCADE,
    -- Whose game is being bet on. Always a real roster player.
    player_id   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    -- The live game this was placed on, so a second bet on the same game by
    -- the same person in the same market can be rejected.
    game_id     TEXT NOT NULL,
    market      TEXT NOT NULL,
    selection   TEXT NOT NULL,
    stake       INTEGER NOT NULL,
    -- OPEN until the game is ingested, then WON, LOST or VOID. A void returns
    -- the stake: a wager nobody can grade must not cost anybody a shell.
    status      TEXT NOT NULL DEFAULT 'OPEN',
    -- Total returned on a win, stake included. Zero on a loss.
    payout      INTEGER NOT NULL DEFAULT 0,
    -- Filled in when the game is graded, for the audit trail.
    match_id    TEXT,
    placed_at   INTEGER NOT NULL,
    settled_at  INTEGER,
    -- One bet per person, per game, per market. Two sides of the same question
    -- would just be handing yourself a shell back.
    UNIQUE (discord_id, game_id, market)
  );

  CREATE INDEX idx_bets_open ON bets (status, player_id);
  CREATE INDEX idx_bets_holder ON bets (discord_id);
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
