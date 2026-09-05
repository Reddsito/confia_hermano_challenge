import { randomUUID } from 'node:crypto';

import {
  MAX_CHAMPION_REROLLS,
  MAX_HELD_SHELLS,
  SHELLS_TAKEN_FOR_SHELL,
  SHELL_RETRIBUTION_RULE,
  type EarnedShell,
  type RunePage,
  type ShellProgress,
} from '@challenge/core/domain';

import { getMeta, setMeta, type Db } from './index';

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
  };
}

export interface ShellBalance {
  earned: number;
  thrown: number;
  available: number;
}

/**
 * What a roster player is holding.
 *
 * Betting is settled on the Discord account, not the roster entry, so the
 * wagers of whoever is linked to this player are folded in here. Leaving them
 * out would let someone who had staked everything keep earning as though the
 * shells were still in hand.
 *
 * Bets are absent: they pay monedas now, so nothing here can go negative and
 * the floor is zero again.
 */
export function balanceFor(db: Db, playerId: string): ShellBalance {
  const earned = (
    db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS n FROM blue_shells WHERE player_id = ?',
      )
      .get(playerId) as { n: number }
  ).n;

  const linked = db
    .prepare('SELECT discord_id AS discordId FROM discord_users WHERE player_id = ?')
    .get(playerId) as { discordId: string } | undefined;

  // Counted with OR so a throw carrying both columns is still one throw.
  const thrown = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM shell_throws WHERE from_player = ? OR from_discord = ?',
      )
      .get(playerId, linked?.discordId ?? null) as { n: number }
  ).n;

  // Shells bought in the shop by somebody whose account has no roster entry.
  // A linked player's purchases land in blue_shells instead, so they are
  // already in `earned` above.
  const granted = linked
    ? (
        db
          .prepare(
            'SELECT COALESCE(SUM(amount), 0) AS n FROM shell_grants WHERE discord_id = ?',
          )
          .get(linked.discordId) as { n: number }
      ).n
    : 0;

  return {
    earned,
    thrown,
    available: Math.max(0, earned + granted - thrown),
  };
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
export const CHALLENGE_KINDS = [
  'TEXT',
  'RANDOM_CHAMPION',
  'RANDOM_RUNES',
  'RANDOM_BUILD',
] as const;
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
  | { kind: 'RANDOM_RUNES'; page: RunePage }
  | { kind: 'RANDOM_BUILD'; itemIds: number[] };

function parsePayload(raw: string | null): ShellPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShellPayload;
  } catch {
    // A row written by a future version is not worth crashing the panel over.
    return null;
  }
}

/**
 * Shells taken since the last payout.
 *
 * Deliberately not exported and deliberately not shown anywhere: the progress
 * toward the next one is meant to be felt, not tracked. Nothing outside the
 * payout below has any business reading it.
 *
 * Counted as "everything received since the rule shipped, minus the five each
 * payout already consumed" rather than "everything received since the last
 * payout's timestamp". The timestamp version is what this was first written as,
 * and it was wrong: a payout stamps itself with the triggering throw's
 * millisecond, so any throw landing in that same millisecond fell on the wrong
 * side of the boundary and was never counted. Two shells fired at once is not a
 * hypothetical — the tests hit it on the first run.
 *
 * Arithmetic has no boundary to fall on. It is also still fully derived: there
 * is no counter column to forget to reset, and re-reading history can only ever
 * produce the same number.
 */
function shellsTakenToward(db: Db, playerId: string): number {
  // The floor exists because the throw log predates the rule. Without it, the
  // people who have been eating shells all tournament would be paid at once.
  const epoch = Number(getMeta(db, 'shell_retribution_epoch') ?? 0);

  const taken = db
    .prepare(
      `SELECT COUNT(*) AS n FROM shell_throws
       WHERE to_player = ? AND thrown_at > ?`,
    )
    .get(playerId, epoch) as { n: number };

  const paid = db
    .prepare(
      `SELECT COUNT(*) AS n FROM blue_shells
       WHERE player_id = ? AND rule = ?`,
    )
    .get(playerId, SHELL_RETRIBUTION_RULE) as { n: number };

  return taken.n - paid.n * SHELLS_TAKEN_FOR_SHELL;
}

/**
 * Pays the shell owed for eating five of them, if this throw was the fifth.
 *
 * The row goes against a synthetic match id so the ledger's idempotency key
 * still holds for something no game produced — the same trick the shop uses —
 * and carries the triggering throw's timestamp so the history reads in the
 * order it happened.
 */
function payRetribution(
  db: Db,
  playerId: string,
  throwId: string,
  at: number,
): void {
  const taken = shellsTakenToward(db, playerId);
  if (taken < SHELLS_TAKEN_FOR_SHELL) return;

  // Capped, not queued, like every other way of earning: at the ceiling the
  // payout is written for zero rather than skipped. The row is what resets the
  // count, so writing it regardless stops a full arsenal from banking
  // retribution and cashing it all the moment a slot opens.
  const headroom = MAX_HELD_SHELLS - balanceFor(db, playerId).available;
  const amount = headroom > 0 ? 1 : 0;

  db.prepare(
    `INSERT INTO blue_shells
       (id, player_id, match_id, rule, amount, detail, earned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    playerId,
    `throw:${throwId}`,
    SHELL_RETRIBUTION_RULE,
    amount,
    amount > 0
      ? `${taken} conchas recibidas`
      : `${taken} conchas recibidas, con el arsenal lleno`,
    at,
  );
}

/**
 * Records one fired shell.
 *
 * `fromDiscord` exists because spectators fire too and have no roster entry to
 * be the source of. For a linked player both are written: the player id is what
 * the site displays, the Discord id is what the balance is counted against, and
 * the balance query joins them with OR so the row is still a single throw.
 */
export function recordThrow(
  db: Db,
  fromPlayer: string | null,
  toPlayer: string,
  challenge: ChallengeRow,
  payload: ShellPayload | null = null,
  fromDiscord: string | null = null,
): ThrowRow {
  const id = randomUUID();
  const thrownAt = Date.now();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO shell_throws
         (id, from_player, to_player, challenge_id, challenge_name, thrown_at, completed_at, payload, from_discord)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      id,
      fromPlayer,
      toPlayer,
      challenge.id,
      challenge.name,
      thrownAt,
      payload ? JSON.stringify(payload) : null,
      fromDiscord,
    );

    // The opening spin is a roll like any other, so it goes in the history too.
    // Without it the log would start at the first reroll and read as though the
    // original result had never happened.
    if (payload) recordRoll(db, id, payload, '');

    // Settled here, in the same transaction as the throw that triggers it, so a
    // shell can never land without its count moving.
    payRetribution(db, toPlayer, id, thrownAt);
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

export interface ThrowerStanding {
  /** Set when a roster player fired it. */
  playerId: string | null;
  /** Set when the thrower has a Discord account, roster entry or not. */
  discordId: string | null;
  /** The Discord username, for a thrower with no roster entry. */
  username: string | null;
  thrown: number;
}

export interface TargetStanding {
  playerId: string;
  hits: number;
  pending: number;
}

export interface ThrowStandings {
  throwers: ThrowerStanding[];
  targets: TargetStanding[];
}

/**
 * Who throws the most and who catches the most, counted in SQL over the whole
 * throw log.
 *
 * Aggregated here rather than tallied in the browser for a reason worth
 * remembering: the feed the page already had is capped at the newest fifty
 * throws, so a ranking built from it silently became a ranking of the last few
 * days. A leaderboard has to see every row or it is not one.
 *
 * Throwers are grouped by roster id where there is one and by Discord id
 * otherwise, because the same person's throws are not stored uniformly — a
 * linked player's rows carry both columns, and older rows carry only
 * `from_player`. Grouping on the pair would split one person in two.
 */
export function throwStandings(db: Db): ThrowStandings {
  const throwers = db
    .prepare(
      `SELECT MAX(t.from_player) AS playerId,
              MAX(t.from_discord) AS discordId,
              MAX(u.username)     AS username,
              COUNT(*)            AS thrown
       FROM shell_throws t
       LEFT JOIN discord_users u ON u.discord_id = t.from_discord
       WHERE t.from_player IS NOT NULL OR t.from_discord IS NOT NULL
       GROUP BY COALESCE(t.from_player, 'discord:' || t.from_discord)
       ORDER BY thrown DESC`,
    )
    .all() as ThrowerStanding[];

  const targets = db
    .prepare(
      `SELECT to_player AS playerId,
              COUNT(*)  AS hits,
              SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) AS pending
       FROM shell_throws
       GROUP BY to_player
       ORDER BY hits DESC, pending DESC`,
    )
    .all() as TargetStanding[];

  return { throwers, targets };
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
/**
 * Everything this player fired.
 *
 * Matched on `from_player` alone, unlike `balanceFor`, which also counts throws
 * carrying only a Discord id. That is not an oversight: a throw with no
 * `from_player` was fired by somebody with no roster entry, so it can never
 * belong to the player being asked about here.
 */
export function throwsBy(db: Db, playerId: string): ThrowRow[] {
  const rows = db
    .prepare(
      `SELECT id, from_player AS fromPlayer, to_player AS toPlayer,
              challenge_id AS challengeId, challenge_name AS challengeName,
              thrown_at AS thrownAt, completed_at AS completedAt, payload
       FROM shell_throws WHERE from_player = ? ORDER BY thrown_at DESC`,
    )
    .all(playerId) as RawThrow[];
  return rows.map(toThrow);
}

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

  if (!existing.has('RANDOM_BUILD')) {
    insertChallenge(db, {
      name: 'Build aleatoria',
      detail: 'Seis objetos sorteados. Terminá la partida con ellos',
      weight: 3,
      kind: 'RANDOM_BUILD',
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
       -- A shell a shield ate never landed: it is not the last challenge
       -- taken, and it does not start a cooldown either.
       WHERE t.blocked_at IS NULL
         AND t.thrown_at = (
           SELECT MAX(latest.thrown_at)
           FROM shell_throws latest
           WHERE latest.to_player = t.to_player
             AND latest.blocked_at IS NULL
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

/**
 * Whether new shells can be thrown. Kept in `meta` rather than a constant so
 * the panel can close and reopen throwing without a deploy. Absent means
 * closed: a fresh database should not start firing on its own.
 */
const THROWS_ENABLED_KEY = 'shells.throwsEnabled';

export function throwsEnabled(db: Db): boolean {
  return getMeta(db, THROWS_ENABLED_KEY) === 'true';
}

export function setThrowsEnabled(db: Db, enabled: boolean): void {
  setMeta(db, THROWS_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * When this player was last hit, or null if they never have been.
 *
 * Read off the throw log rather than kept as a column: the log is already the
 * record of what happened, and a second copy of the same fact is a second
 * thing that can be wrong.
 */
export function lastThrowAgainst(db: Db, playerId: string): number | null {
  const row = db
    .prepare(
      `SELECT thrown_at AS thrownAt FROM shell_throws
       WHERE to_player = ? AND blocked_at IS NULL
       ORDER BY thrown_at DESC LIMIT 1`,
    )
    .get(playerId) as { thrownAt: number } | undefined;
  return row?.thrownAt ?? null;
}

export interface ShieldRow {
  id: string;
  boughtAt: number;
}

/** Shields this player is still holding, oldest first — the oldest is spent first. */
export function liveShields(db: Db, playerId: string): ShieldRow[] {
  return db
    .prepare(
      `SELECT id, bought_at AS boughtAt FROM shell_shields
       WHERE player_id = ? AND consumed_at IS NULL
       ORDER BY bought_at ASC`,
    )
    .all(playerId) as ShieldRow[];
}

export function grantShield(db: Db, playerId: string, id: string): void {
  db.prepare(
    `INSERT INTO shell_shields (id, player_id, bought_at, consumed_at, throw_id)
     VALUES (?, ?, ?, NULL, NULL)`,
  ).run(id, playerId, Date.now());
}

/**
 * Spends the oldest live shield on a throw. Returns false when there was none,
 * which is the caller's signal that the shell lands for real.
 */
export function consumeShield(
  db: Db,
  playerId: string,
  throwId: string,
): boolean {
  const shield = liveShields(db, playerId)[0];
  if (!shield) return false;

  db.prepare(
    `UPDATE shell_shields SET consumed_at = ?, throw_id = ? WHERE id = ?`,
  ).run(Date.now(), throwId, shield.id);
  return true;
}

/**
 * Writes a throw that a shield stopped.
 *
 * Kept apart from `recordThrow` because almost nothing about it is the same: no
 * challenge is owed, so it is closed the moment it is written, and it must not
 * pay retribution — a shell that never landed cannot be one of the five that
 * earns the target a shell back.
 */
export function recordBlockedThrow(
  db: Db,
  fromPlayer: string | null,
  fromDiscord: string | null,
  toPlayer: string,
): string {
  const id = randomUUID();
  const now = Date.now();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO shell_throws
         (id, from_player, to_player, challenge_id, challenge_name, thrown_at,
          completed_at, payload, from_discord, blocked_at)
       VALUES (?, ?, ?, NULL, 'Bloqueada por un escudo', ?, ?, NULL, ?, ?)`,
    ).run(id, fromPlayer, toPlayer, now, now, fromDiscord, now);

    consumeShield(db, toPlayer, id);
  })();

  return id;
}

/** Live shield counts for the whole roster, in one query. */
export function shieldCounts(db: Db): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT player_id AS playerId, COUNT(*) AS n FROM shell_shields
       WHERE consumed_at IS NULL GROUP BY player_id`,
    )
    .all() as Array<{ playerId: string; n: number }>;
  return new Map(rows.map((row) => [row.playerId, row.n]));
}
