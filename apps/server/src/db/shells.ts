import { randomUUID } from 'node:crypto';

import { MAX_HELD_SHELLS, type EarnedShell, type ShellProgress } from '@challenge/core/domain';

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
      `SELECT
         COUNT(DISTINCT CASE WHEN win = 1 THEN champion_id END) AS champions,
         COALESCE(SUM(CASE WHEN win = 1 AND used_smite = 1 THEN 1 ELSE 0 END), 0) AS smiteWins
       FROM player_matches WHERE player_id = ?`,
    )
    .get(playerId) as { champions: number; smiteWins: number };

  return {
    distinctChampionWins: row.champions,
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

export interface ChallengeRow {
  id: string;
  name: string;
  detail: string;
  weight: number;
  enabled: boolean;
  createdAt: number;
}

interface RawChallenge {
  id: string;
  name: string;
  detail: string;
  weight: number;
  enabled: number;
  created_at: number;
}

function toChallenge(row: RawChallenge): ChallengeRow {
  return {
    id: row.id,
    name: row.name,
    detail: row.detail,
    weight: row.weight,
    enabled: row.enabled === 1,
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
  input: { name: string; detail?: string; weight?: number },
): ChallengeRow {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO challenges (id, name, detail, weight, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  ).run(id, input.name, input.detail ?? '', Math.max(input.weight ?? 1, 1), Date.now());

  return listChallenges(db).find((challenge) => challenge.id === id)!;
}

export function updateChallenge(
  db: Db,
  id: string,
  input: { name?: string; detail?: string; weight?: number; enabled?: boolean },
): boolean {
  const current = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as
    | RawChallenge
    | undefined;
  if (!current) return false;

  db.prepare(
    'UPDATE challenges SET name = ?, detail = ?, weight = ?, enabled = ? WHERE id = ?',
  ).run(
    input.name?.trim() || current.name,
    input.detail ?? current.detail,
    input.weight !== undefined ? Math.max(input.weight, 1) : current.weight,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
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
}

export function recordThrow(
  db: Db,
  fromPlayer: string | null,
  toPlayer: string,
  challenge: ChallengeRow,
): ThrowRow {
  const id = randomUUID();
  const thrownAt = Date.now();

  db.prepare(
    `INSERT INTO shell_throws
       (id, from_player, to_player, challenge_id, challenge_name, thrown_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(id, fromPlayer, toPlayer, challenge.id, challenge.name, thrownAt);

  return {
    id,
    fromPlayer,
    toPlayer,
    challengeId: challenge.id,
    challengeName: challenge.name,
    thrownAt,
    completedAt: null,
  };
}

export function listThrows(db: Db, limit = 50): ThrowRow[] {
  return db
    .prepare(
      `SELECT id, from_player AS fromPlayer, to_player AS toPlayer,
              challenge_id AS challengeId, challenge_name AS challengeName,
              thrown_at AS thrownAt, completed_at AS completedAt
       FROM shell_throws ORDER BY thrown_at DESC LIMIT ?`,
    )
    .all(limit) as ThrowRow[];
}

export function completeThrow(db: Db, id: string): boolean {
  return (
    db
      .prepare('UPDATE shell_throws SET completed_at = ? WHERE id = ? AND completed_at IS NULL')
      .run(Date.now(), id).changes > 0
  );
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
