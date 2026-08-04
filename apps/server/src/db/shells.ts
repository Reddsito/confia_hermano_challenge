import { randomUUID } from 'node:crypto';

import {
  MAX_CHAMPION_REROLLS,
  MAX_HELD_SHELLS,
  type EarnedShell,
  type RunePage,
  type ShellProgress,
} from '@challenge/core/domain';

import type { Db } from './index';

export interface ShellRow {
  id: string;
  playerId: string;
  matchId: string;
  rule: string;
  amount: number;
  detail: string;
  earnedAt: number;
}

/**
 * Awards the shells earned in one match.
 *
 * The unique key on (player, match, rule) is what makes this safe to call more
 * than once for the same game: a re-processed match inserts nothing rather than
 * paying out twice.
 */
export function awardShells(
  db: Db,
  playerId: string,
  matchId: string,
  earned: EarnedShell[],
): number {
  if (earned.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO blue_shells
       (id, player_id, match_id, rule, amount, detail, earned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let awarded = 0;

  db.transaction(() => {
    // Headroom is recomputed inside the transaction so two rules in the same
    // match cannot both spend the last slot.
    let headroom = MAX_HELD_SHELLS - balanceFor(db, playerId).available;
    if (headroom <= 0) return;

    for (const shell of earned) {
      if (headroom <= 0) break;

      // A pentakill is worth two, but it only pays what still fits.
      const amount = Math.min(shell.amount, headroom);
      const result = insert.run(
        randomUUID(),
        playerId,
        matchId,
        shell.rule,
        amount,
        shell.detail,
        Date.now(),
      );

      if (result.changes > 0) {
        awarded += amount;
        headroom -= amount;
      }
    }
  })();

  return awarded;
}

/** Counters that span games, read after the current match has been stored. */
export function progressFor(db: Db, playerId: string): Omit<ShellProgress, 'winStreak'> {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN win = 1 AND used_smite = 1 THEN 1 ELSE 0 END), 0) AS smiteWins
       FROM player_matches WHERE player_id = ?`,
    )
    .get(playerId) as { smiteWins: number };

  // The last five games, newest first. Counted here rather than in SQL because
  // the count only means anything if all five were wins, and that condition is
  // clearer as a check on the rows than as a CASE inside the aggregate.
  const recent = db
    .prepare(
      `SELECT win, champion_id AS championId
       FROM player_matches WHERE player_id = ?
       ORDER BY played_at DESC LIMIT 5`,
    )
    .all(playerId) as Array<{ win: number; championId: number }>;

  const allWins = recent.length === 5 && recent.every((game) => game.win === 1);

  return {
    streakChampions: allWins
      ? new Set(recent.map((game) => game.championId)).size
      : 0,
    smiteWins: row.smiteWins,
  };
}

export interface ShellBalance {
  earned: number;
  thrown: number;
  available: number;
}

export function balanceFor(db: Db, playerId: string): ShellBalance {
  const earned = (
    db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS n FROM blue_shells WHERE player_id = ?',
      )
      .get(playerId) as { n: number }
  ).n;

  const thrown = (
    db
      .prepare('SELECT COUNT(*) AS n FROM shell_throws WHERE from_player = ?')
      .get(playerId) as { n: number }
  ).n;

  return { earned, thrown, available: Math.max(earned - thrown, 0) };
}

export function listShells(db: Db, playerId: string): ShellRow[] {
  return db
    .prepare(
      `SELECT id, player_id AS playerId, match_id AS matchId, rule, amount,
              detail, earned_at AS earnedAt
       FROM blue_shells WHERE player_id = ? ORDER BY earned_at DESC`,
    )
    .all(playerId) as ShellRow[];
}

/**
 * What a challenge does when it lands. TEXT is the plain kind — the name is the
 * whole punishment. The others make the server roll something at throw time.
 */
export const CHALLENGE_KINDS = ['TEXT', 'RANDOM_CHAMPION', 'RANDOM_RUNES'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

function toKind(raw: string): ChallengeKind {
  return (CHALLENGE_KINDS as readonly string[]).includes(raw)
    ? (raw as ChallengeKind)
    : 'TEXT';
}

export interface ChallengeRow {
  id: string;
  name: string;
  detail: string;
  weight: number;
  enabled: boolean;
  kind: ChallengeKind;
  createdAt: number;
}

interface RawChallenge {
  id: string;
  name: string;
  detail: string;
  weight: number;
  enabled: number;
  kind: string;
  created_at: number;
}

function toChallenge(row: RawChallenge): ChallengeRow {
  return {
    id: row.id,
    name: row.name,
    detail: row.detail,
    weight: row.weight,
    enabled: row.enabled === 1,
    kind: toKind(row.kind),
    createdAt: row.created_at,
  };
}

export function listChallenges(db: Db, onlyEnabled = false): ChallengeRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM challenges ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY created_at ASC`,
    )
    .all() as RawChallenge[];
  return rows.map(toChallenge);
}

export function insertChallenge(
  db: Db,
  input: { name: string; detail?: string; weight?: number; kind?: ChallengeKind },
): ChallengeRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO challenges (id, name, detail, weight, enabled, kind, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    input.name,
    input.detail ?? '',
    Math.max(input.weight ?? 1, 1),
    input.kind ?? 'TEXT',
    Date.now(),
  );

  return listChallenges(db).find((challenge) => challenge.id === id)!;
}

export function updateChallenge(
  db: Db,
  id: string,
  input: {
    name?: string;
    detail?: string;
    weight?: number;
    enabled?: boolean;
    kind?: ChallengeKind;
  },
): boolean {
  const current = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as
    | RawChallenge
    | undefined;
  if (!current) return false;

  db.prepare(
    'UPDATE challenges SET name = ?, detail = ?, weight = ?, enabled = ?, kind = ? WHERE id = ?',
  ).run(
    input.name?.trim() || current.name,
    input.detail ?? current.detail,
    input.weight !== undefined ? Math.max(input.weight, 1) : current.weight,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    input.kind ?? current.kind,
    id,
  );
  return true;
}

export function deleteChallenge(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM challenges WHERE id = ?').run(id).changes > 0;
}

/**
 * Weighted pick over the enabled challenges.
 *
 * Weights are relative, not percentages, so adding a new challenge never forces
 * the others to be re-balanced by hand — the displayed percentage is derived
 * from the total.
 */
export function spinChallenge(db: Db): ChallengeRow | null {
  const pool = listChallenges(db, true);
  if (pool.length === 0) return null;

  const total = pool.reduce((sum, challenge) => sum + challenge.weight, 0);
  let ticket = Math.random() * total;

  for (const challenge of pool) {
    ticket -= challenge.weight;
    if (ticket <= 0) return challenge;
  }

  return pool[pool.length - 1]!;
}

export interface ThrowRow {
  id: string;
  fromPlayer: string | null;
  toPlayer: string;
  challengeId: string | null;
  challengeName: string;
  thrownAt: number;
  completedAt: number | null;
  /** What the challenge rolled, if its kind rolls anything. */
  payload: ShellPayload | null;
}

interface RawThrow extends Omit<ThrowRow, 'payload'> {
  payload: string | null;
}

function toThrow(row: RawThrow): ThrowRow {
  return { ...row, payload: parsePayload(row.payload) };
}

/**
 * Stored as JSON rather than as columns because the shapes have nothing in
 * common: a champion roll is one number, a rune page is five fields. Columns
 * would mean most of them null on most rows.
 */
export type ShellPayload =
  | { kind: 'RANDOM_CHAMPION'; championId: number }
  | { kind: 'RANDOM_RUNES'; page: RunePage };

function parsePayload(raw: string | null): ShellPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShellPayload;
  } catch {
    // A row written by a future version is not worth crashing the panel over.
    return null;
  }
}

export function recordThrow(
  db: Db,
  fromPlayer: string | null,
  toPlayer: string,
  challenge: ChallengeRow,
  payload: ShellPayload | null = null,
): ThrowRow {
  const id = randomUUID();
  const thrownAt = Date.now();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO shell_throws
         (id, from_player, to_player, challenge_id, challenge_name, thrown_at, completed_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      fromPlayer,
      toPlayer,
      challenge.id,
      challenge.name,
      thrownAt,
      payload ? JSON.stringify(payload) : null,
    );

    // The opening spin is a roll like any other, so it goes in the history too.
    // Without it the log would start at the first reroll and read as though the
    // original result had never happened.
    if (payload) recordRoll(db, id, payload, '');
  })();

  return {
    id,
    fromPlayer,
    toPlayer,
    challengeId: challenge.id,
    challengeName: challenge.name,
    thrownAt,
    completedAt: null,
    payload,
  };
}

export function listThrows(db: Db, limit = 50): ThrowRow[] {
  const rows = db
    .prepare(
      `SELECT id, from_player AS fromPlayer, to_player AS toPlayer,
              challenge_id AS challengeId, challenge_name AS challengeName,
              thrown_at AS thrownAt, completed_at AS completedAt, payload
       FROM shell_throws ORDER BY thrown_at DESC LIMIT ?`,
    )
    .all(limit) as RawThrow[];
  return rows.map(toThrow);
}

/** One page of the throw history, newest first, plus how many there are. */
export function pageThrows(
  db: Db,
  limit: number,
  offset: number,
): { rows: ThrowRow[]; total: number } {
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM shell_throws').get() as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT id, from_player AS fromPlayer, to_player AS toPlayer,
              challenge_id AS challengeId, challenge_name AS challengeName,
              thrown_at AS thrownAt, completed_at AS completedAt, payload
       FROM shell_throws ORDER BY thrown_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as RawThrow[];

  return { rows: rows.map(toThrow), total };
}

export function getThrow(db: Db, id: string): ThrowRow | null {
  const row = db
    .prepare(
      `SELECT id, from_player AS fromPlayer, to_player AS toPlayer,
              challenge_id AS challengeId, challenge_name AS challengeName,
              thrown_at AS thrownAt, completed_at AS completedAt, payload
       FROM shell_throws WHERE id = ?`,
    )
    .get(id) as RawThrow | undefined;
  return row ? toThrow(row) : null;
}

/** Everything fired at one player, newest first, with each spin it went through. */
export function throwsAgainst(db: Db, playerId: string): ThrowRow[] {
  const rows = db
    .prepare(
      `SELECT id, from_player AS fromPlayer, to_player AS toPlayer,
              challenge_id AS challengeId, challenge_name AS challengeName,
              thrown_at AS thrownAt, completed_at AS completedAt, payload
       FROM shell_throws WHERE to_player = ? ORDER BY thrown_at DESC`,
    )
    .all(playerId) as RawThrow[];
  return rows.map(toThrow);
}

export interface RollRow {
  id: string;
  throwId: string;
  payload: ShellPayload | null;
  reason: string;
  rolledAt: number;
}

export function recordRoll(
  db: Db,
  throwId: string,
  payload: ShellPayload,
  reason: string,
): void {
  db.prepare(
    `INSERT INTO shell_throw_rolls (id, throw_id, payload, reason, rolled_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), throwId, JSON.stringify(payload), reason, Date.now());
}

export function listRolls(db: Db, throwId: string): RollRow[] {
  const rows = db
    .prepare(
      `SELECT id, throw_id AS throwId, payload, reason, rolled_at AS rolledAt
       FROM shell_throw_rolls WHERE throw_id = ? ORDER BY rolled_at ASC`,
    )
    .all(throwId) as Array<Omit<RollRow, 'payload'> & { payload: string }>;

  return rows.map((row) => ({ ...row, payload: parsePayload(row.payload) }));
}

/** Spins already used, counting the original. Rerolls left is this minus one. */
export function rollCount(db: Db, throwId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM shell_throw_rolls WHERE throw_id = ?')
      .get(throwId) as { n: number }
  ).n;
}

/**
 * Replaces the current roll, keeping the old one in the history.
 *
 * Returns false when the reroll budget is spent, checked inside the transaction
 * so two clicks landing together cannot both spend the last one.
 */
export function applyReroll(
  db: Db,
  throwId: string,
  payload: ShellPayload,
  reason: string,
): boolean {
  let applied = false;

  db.transaction(() => {
    if (rollCount(db, throwId) > MAX_CHAMPION_REROLLS) return;

    db.prepare('UPDATE shell_throws SET payload = ? WHERE id = ?').run(
      JSON.stringify(payload),
      throwId,
    );
    recordRoll(db, throwId, payload, reason);
    applied = true;
  })();

  return applied;
}

/**
 * Removes a throw and, through the cascade, every spin it went through.
 *
 * The shell comes back on its own: `balanceFor` counts thrown rows, so there is
 * nothing to credit back by hand.
 */
export function deleteThrow(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM shell_throws WHERE id = ?').run(id).changes > 0;
}

export function completeThrow(db: Db, id: string): boolean {
  return (
    db
      .prepare('UPDATE shell_throws SET completed_at = ? WHERE id = ? AND completed_at IS NULL')
      .run(Date.now(), id).changes > 0
  );
}

/**
 * The rolling challenges, added if they are not on the wheel yet.
 *
 * Separate from the seed because the seed only runs on an empty table: a
 * tournament already under way has challenges, so it would never see these.
 * Matched by kind rather than by name so renaming one in the panel does not
 * cause a duplicate to reappear on the next boot.
 */
export function ensureRollingChallenges(db: Db): void {
  const existing = new Set(listChallenges(db).map((challenge) => challenge.kind));

  if (!existing.has('RANDOM_CHAMPION')) {
    insertChallenge(db, {
      name: 'Campeón aleatorio',
      detail: 'Sorteado entre los campeones en los que tenés maestría',
      weight: 3,
      kind: 'RANDOM_CHAMPION',
    });
  }

  if (!existing.has('RANDOM_RUNES')) {
    insertChallenge(db, {
      name: 'Runas aleatorias',
      detail: 'Página completa sorteada, tal cual sale',
      weight: 3,
      kind: 'RANDOM_RUNES',
    });
  }
}

/** Seeded on first boot so the wheel is never empty when someone fires. */
export function seedDefaultChallenges(db: Db): void {
  if (listChallenges(db).length > 0) return;

  const defaults: Array<{ name: string; detail: string; weight: number }> = [
    { name: 'Juega la próxima partida con Yuumi', detail: 'Sin importar el rol', weight: 3 },
    { name: 'Regala el primer kill', detail: 'A propósito, en los primeros 5 minutos', weight: 3 },
    { name: 'Próxima partida sin comprar botas', detail: '', weight: 2 },
    { name: 'Juega de support la próxima', detail: 'Aunque no sea tu rol', weight: 3 },
    { name: 'Compra solo objetos de tanque', detail: 'La partida entera', weight: 2 },
    { name: 'Sin usar el chat toda la partida', detail: 'Ni pings de retirada', weight: 3 },
    { name: 'Hechizos invertidos', detail: 'Flash en D, lo otro en F', weight: 2 },
    { name: 'Zafaste', detail: 'No te toca nada esta vez', weight: 1 },
  ];

  for (const challenge of defaults) insertChallenge(db, challenge);
}

/**
 * Hands out or takes back shells outside the rules.
 *
 * Positive amounts still respect the holding cap; negative amounts are recorded
 * as a correction row rather than deleting history, so the ledger stays
 * readable — you can always see why a balance changed.
 */
export function adjustShells(
  db: Db,
  playerId: string,
  amount: number,
  reason: string,
): ShellBalance {
  const before = balanceFor(db, playerId);

  const capped =
    amount > 0
      ? Math.min(amount, MAX_HELD_SHELLS - before.available)
      : Math.max(amount, -before.available);

  if (capped !== 0) {
    db.prepare(
      `INSERT INTO blue_shells
         (id, player_id, match_id, rule, amount, detail, earned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      playerId,
      `manual-${Date.now()}`,
      'MANUAL',
      capped,
      reason,
      Date.now(),
    );
  }

  return balanceFor(db, playerId);
}

export interface LastHitRow {
  challengeName: string;
  fromName: string | null;
  at: number;
}

/** The most recent shell that landed on each player, keyed by player id. */
export function lastHits(db: Db): Map<string, LastHitRow> {
  const rows = db
    .prepare(
      `SELECT t.to_player      AS toPlayer,
              t.challenge_name AS challengeName,
              p.display_name   AS fromName,
              t.thrown_at      AS at
       FROM shell_throws t
       LEFT JOIN players p ON p.id = t.from_player
       -- "inner" cannot be an alias: SQL reserves it for INNER JOIN.
       WHERE t.thrown_at = (
         SELECT MAX(latest.thrown_at)
         FROM shell_throws latest
         WHERE latest.to_player = t.to_player
       )`,
    )
    .all() as Array<LastHitRow & { toPlayer: string }>;

  return new Map(
    rows.map((row) => [
      row.toPlayer,
      { challengeName: row.challengeName, fromName: row.fromName, at: row.at },
    ]),
  );
}

export interface PendingThrow {
  id: string;
  toPlayer: string;
  challengeName: string;
  fromName: string | null;
  thrownAt: number;
}

/** Challenges a player still owes, oldest first. */
export function pendingThrows(db: Db, playerId: string): PendingThrow[] {
  return db
    .prepare(
      `SELECT t.id, t.to_player AS toPlayer, t.challenge_name AS challengeName,
              p.display_name AS fromName, t.thrown_at AS thrownAt
       FROM shell_throws t
       LEFT JOIN players p ON p.id = t.from_player
       WHERE t.to_player = ? AND t.fulfilled_match_id IS NULL
       ORDER BY t.thrown_at ASC`,
    )
    .all(playerId) as PendingThrow[];
}

/**
 * Marks the oldest outstanding challenge as served by this match.
 *
 * The rule is a timestamp comparison, and it is exactly why no "was he in a
 * game?" flag is needed: a match already under way when the shell landed has a
 * `gameCreation` earlier than `thrown_at`, so it cannot settle anything. The
 * first game started *after* being hit is the one that counts.
 *
 * One match clears one challenge, so ten incoming shells cost ten games.
 */
export function fulfillOldestThrow(
  db: Db,
  playerId: string,
  matchId: string,
  playedAt: number,
): PendingThrow | null {
  const next = db
    .prepare(
      `SELECT t.id, t.to_player AS toPlayer, t.challenge_name AS challengeName,
              p.display_name AS fromName, t.thrown_at AS thrownAt
       FROM shell_throws t
       LEFT JOIN players p ON p.id = t.from_player
       WHERE t.to_player = ?
         AND t.fulfilled_match_id IS NULL
         AND t.thrown_at < ?
       ORDER BY t.thrown_at ASC
       LIMIT 1`,
    )
    .get(playerId, playedAt) as PendingThrow | undefined;

  if (!next) return null;

  db.prepare(
    'UPDATE shell_throws SET fulfilled_match_id = ?, completed_at = ? WHERE id = ?',
  ).run(matchId, Date.now(), next.id);

  return next;
}

export interface Steal {
  matchId: string;
  winnerId: string;
  loserId: string;
  /** True when the loser actually had a shell to lose. */
  taken: boolean;
  /** False when the winner was already at the cap, so the shell is destroyed. */
  kept: boolean;
}

/**
 * Settles every duel between tracked players that has not been settled yet.
 *
 * Beating another participant takes their shell. If the winner is already at
 * the cap the shell is not gained — it is simply destroyed, which is what makes
 * winning worth something even when you are full.
 *
 * Run after a cycle rather than during ingestion: both sides of a duel are
 * fetched independently, so the second player's row may not exist yet while the
 * first is being processed.
 */
export function resolveSteals(db: Db): Steal[] {
  const duels = db
    .prepare(
      `SELECT w.match_id AS matchId,
              w.player_id AS winnerId,
              l.player_id AS loserId
       FROM player_matches w
       JOIN player_matches l
         ON w.match_id = l.match_id
        AND w.team_id <> l.team_id
       WHERE w.win = 1 AND l.win = 0
         AND NOT EXISTS (
           SELECT 1 FROM shell_steals s
           WHERE s.match_id = w.match_id
             AND s.winner_id = w.player_id
             AND s.loser_id = l.player_id
         )`,
    )
    .all() as Array<{ matchId: string; winnerId: string; loserId: string }>;

  const settled: Steal[] = [];

  for (const duel of duels) {
    const loserHas = balanceFor(db, duel.loserId).available > 0;
    const winnerHasRoom =
      balanceFor(db, duel.winnerId).available < MAX_HELD_SHELLS;
    const kept = loserHas && winnerHasRoom;

    db.transaction(() => {
      if (loserHas) {
        db.prepare(
          `INSERT INTO blue_shells
             (id, player_id, match_id, rule, amount, detail, earned_at)
           VALUES (?, ?, ?, 'STOLEN_FROM', -1, ?, ?)`,
        ).run(
          randomUUID(),
          duel.loserId,
          duel.matchId,
          'Lost a duel against another participant',
          Date.now(),
        );
      }

      if (kept) {
        db.prepare(
          `INSERT INTO blue_shells
             (id, player_id, match_id, rule, amount, detail, earned_at)
           VALUES (?, ?, ?, 'STOLEN', 1, ?, ?)`,
        ).run(
          randomUUID(),
          duel.winnerId,
          duel.matchId,
          'Taken from a beaten participant',
          Date.now(),
        );
      }

      // Recorded even when nothing changed hands, so the duel is not
      // re-examined on every cycle for the rest of the challenge.
      db.prepare(
        `INSERT OR IGNORE INTO shell_steals
           (match_id, winner_id, loser_id, taken, kept, settled_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        duel.matchId,
        duel.winnerId,
        duel.loserId,
        loserHas ? 1 : 0,
        kept ? 1 : 0,
        Date.now(),
      );
    })();

    if (loserHas) {
      settled.push({ ...duel, taken: true, kept });
    }
  }

  return settled;
}
