import { randomUUID } from 'node:crypto';

import {
  COIN_WALLET_CAP,
  PLAYER_DAILY_EARN_CAP,
  clampGrant,
  dailyEntitlement,
  dayKey,
  daysBetween,
  winEntitlement,
} from '@challenge/core/domain';

import { getMeta, setMeta, type Db } from './index';

/**
 * Where a wallet's income comes from. Kept as a union rather than free text so
 * the audit in the CLI can reason about a ledger row without guessing.
 */
export type CoinSource =
  | 'DAILY'
  | 'WIN'
  | 'BET_STAKE'
  | 'BET_PAYOUT'
  | 'BET_REFUND'
  | 'SHOP_SHELL'
  | 'SHOP_SHIELD'
  | 'ADMIN';

/** Sources that count against the five-a-day income cap. */
const EARNING_SOURCES: CoinSource[] = ['DAILY', 'WIN'];

interface CoinHolder {
  discordId: string;
  playerId: string | null;
  isSpectator: boolean;
  firstSeen: number;
  /** Whether this account earns anything at all. */
  earns: boolean;
}

/**
 * Resolved here rather than imported from bets.ts, which would make the two
 * modules import each other. Betting depends on the wallet; the wallet does not
 * depend on betting.
 */
function coinHolder(db: Db, discordId: string): CoinHolder | null {
  const row = db
    .prepare(
      `SELECT u.discord_id AS discordId, u.player_id AS playerId,
              u.is_spectator AS isSpectator, u.first_seen AS firstSeen,
              p.id AS approvedPlayer
       FROM discord_users u
       LEFT JOIN players p ON p.id = u.player_id AND p.status = 'approved'
       WHERE u.discord_id = ?`,
    )
    .get(discordId) as
    | {
        discordId: string;
        playerId: string | null;
        isSpectator: number;
        firstSeen: number;
        approvedPlayer: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    discordId: row.discordId,
    playerId: row.playerId,
    isSpectator: row.isSpectator === 1,
    firstSeen: row.firstSeen,
    // An account that is neither a spectator nor linked to an approved roster
    // entry has no income. It keeps whatever it already has and can still bet
    // and buy, but nothing accrues.
    earns: row.isSpectator === 1 || row.approvedPlayer !== null,
  };
}

/**
 * The first day monedas can be accrued for.
 *
 * Without this, an account created a month before the currency existed would
 * be handed a month of back pay on its first read and wake up at the ceiling.
 * Set once, on the first accrual after the migration, and never moved.
 */
export function coinsEpoch(db: Db, now = Date.now()): string {
  const stored = getMeta(db, 'coins_epoch');
  if (stored) return stored;

  const epoch = dayKey(now);
  setMeta(db, 'coins_epoch', epoch);
  return epoch;
}

export function coinBalance(db: Db, discordId: string): number {
  return (
    db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS n FROM coin_ledger WHERE discord_id = ?',
      )
      .get(discordId) as { n: number }
  ).n;
}

/** What this account has earned today from the sources the daily cap covers. */
function earnedOn(db: Db, discordId: string, day: string, exclude?: CoinSource): number {
  const sources = EARNING_SOURCES.filter((source) => source !== exclude);
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM coin_ledger
         WHERE discord_id = ? AND day = ?
           AND source IN (${sources.map(() => '?').join(', ')})`,
      )
      .get(discordId, day, ...sources) as { n: number }
  ).n;
}

function insertRow(
  db: Db,
  row: {
    discordId: string;
    source: CoinSource;
    ref: string;
    amount: number;
    day: string;
    detail: string;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO coin_ledger
       (id, discord_id, source, ref, amount, day, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    row.discordId,
    row.source,
    row.ref,
    row.amount,
    row.day,
    row.detail,
    Date.now(),
  );
}

/**
 * Pays every daily grant this account is owed, up to today.
 *
 * Lazy rather than scheduled: there is no cron in this project, and a timer
 * that misses a night would cost somebody a real coin. Called at the top of
 * every read and every write, so income appears the moment anybody looks.
 *
 * Days in the past are settled once and never revisited — the row records what
 * was actually credited, including zero when the wallet was full. Today is
 * different: it tops up, so somebody who sat at the ceiling all morning and
 * then spent fifteen coins on a shell still collects the day.
 */
export function ensureAccrual(db: Db, discordId: string, now = Date.now()): void {
  const holder = coinHolder(db, discordId);
  if (!holder?.earns) return;

  const epoch = coinsEpoch(db, now);
  const today = dayKey(now);

  const lastPaid = (
    db
      .prepare(
        "SELECT MAX(day) AS day FROM coin_ledger WHERE discord_id = ? AND source = 'DAILY'",
      )
      .get(discordId) as { day: string | null }
  ).day;

  // Starting from the last paid day rather than the one after it is what makes
  // the top-up possible when that day is still today.
  const joined = dayKey(holder.firstSeen);
  const start = lastPaid ?? (joined > epoch ? joined : epoch);
  if (start > today) return;

  db.transaction(() => {
    const detail = holder.isSpectator
      ? 'Moneda diaria de espectador'
      : 'Moneda del día';

    for (const day of daysBetween(start, today)) {
      const paid = db
        .prepare(
          `SELECT COUNT(*) AS rows, COALESCE(SUM(amount), 0) AS n FROM coin_ledger
           WHERE discord_id = ? AND source = 'DAILY' AND day = ?`,
        )
        .get(discordId, day) as { rows: number; n: number };

      // A settled past day is final, however it landed.
      if (paid.rows > 0 && day !== today) continue;

      // Measured without the daily rows themselves, so re-running this cannot
      // pay the same day twice through its own contribution to the cap.
      const wanted = dailyEntitlement(
        holder.isSpectator,
        earnedOn(db, discordId, day, 'DAILY'),
      );

      const owed = wanted - paid.n;
      const credit = clampGrant(coinBalance(db, discordId), owed);

      // The first row is written even when it credits nothing: a zero row is
      // what marks the day as settled, so a wallet that was full at midnight is
      // not walked again forever.
      if (paid.rows === 0) {
        insertRow(db, { discordId, source: 'DAILY', ref: day, amount: credit, day, detail });
        continue;
      }

      // Topping up today appends rather than rewriting the row. Editing the
      // original would place these coins, in any chronological replay of the
      // ledger, before the spending that made room for them.
      if (credit > 0) {
        insertRow(db, {
          discordId,
          source: 'DAILY',
          ref: `${day}#${paid.rows}`,
          amount: credit,
          day,
          detail,
        });
      }
    }
  })();
}

export interface CoinWallet {
  coins: number;
  cap: number;
  isSpectator: boolean;
  /** Earned today from the daily grant and wins, against the daily cap. */
  earnedToday: number;
  dailyCap: number;
}

export function coinWallet(db: Db, discordId: string, now = Date.now()): CoinWallet {
  ensureAccrual(db, discordId, now);
  const holder = coinHolder(db, discordId);

  return {
    coins: coinBalance(db, discordId),
    cap: COIN_WALLET_CAP,
    isSpectator: holder?.isSpectator ?? false,
    earnedToday: earnedOn(db, discordId, dayKey(now)),
    dailyCap: PLAYER_DAILY_EARN_CAP,
  };
}

/**
 * Credits a wallet, trimmed to what it can hold, and returns what actually
 * landed. Zero is a legitimate answer: at the ceiling, income stops.
 *
 * `bypassCap` is how a spectator's winnings and everybody's refunds get past
 * fifteen. A refund is not income — a full wallet must not confiscate a stake
 * it is handing back.
 */
export function creditCoins(
  db: Db,
  discordId: string,
  grant: {
    source: CoinSource;
    ref: string;
    amount: number;
    detail?: string;
    bypassCap?: boolean;
    now?: number;
  },
): number {
  const now = grant.now ?? Date.now();
  ensureAccrual(db, discordId, now);

  let credited = 0;

  db.transaction(() => {
    const already = db
      .prepare(
        'SELECT 1 FROM coin_ledger WHERE discord_id = ? AND source = ? AND ref = ?',
      )
      .get(discordId, grant.source, grant.ref);
    if (already) return;

    credited = clampGrant(coinBalance(db, discordId), grant.amount, grant.bypassCap);

    insertRow(db, {
      discordId,
      source: grant.source,
      ref: grant.ref,
      amount: credited,
      day: dayKey(now),
      detail: grant.detail ?? '',
    });
  })();

  return credited;
}

/**
 * Takes coins out of a wallet, or refuses. Never leaves a negative balance:
 * there is no debt in this economy, which is the whole reason betting was
 * moved off shells.
 */
export function debitCoins(
  db: Db,
  discordId: string,
  charge: { source: CoinSource; ref: string; amount: number; detail?: string; now?: number },
): boolean {
  const now = charge.now ?? Date.now();
  ensureAccrual(db, discordId, now);

  let ok = false;

  db.transaction(() => {
    if (coinBalance(db, discordId) < charge.amount) return;

    insertRow(db, {
      discordId,
      source: charge.source,
      ref: charge.ref,
      amount: -charge.amount,
      day: dayKey(now),
      detail: charge.detail ?? '',
    });
    ok = true;
  })();

  return ok;
}

/**
 * Pays the coin a won match is worth, to whoever owns that roster entry.
 *
 * Granted at ingest and never backfilled. A pass that walked player_matches
 * would pay the same match to a second Discord account if somebody relinked,
 * because the idempotency key is scoped by account, not by match.
 */
export function grantWinCoin(
  db: Db,
  playerId: string,
  matchId: string,
  now = Date.now(),
): number {
  const row = db
    .prepare('SELECT discord_id AS discordId FROM discord_users WHERE player_id = ?')
    .get(playerId) as { discordId: string } | undefined;
  if (!row) return 0;

  const holder = coinHolder(db, row.discordId);
  if (!holder?.earns || holder.isSpectator) return 0;

  ensureAccrual(db, row.discordId, now);

  const wanted = winEntitlement(earnedOn(db, row.discordId, dayKey(now)));
  if (wanted <= 0) {
    // Still recorded, so the ledger shows the win was seen and the cap is why
    // it paid nothing, rather than looking like a match that was missed.
    creditCoins(db, row.discordId, {
      source: 'WIN',
      ref: matchId,
      amount: 0,
      detail: 'Victoria (tope diario alcanzado)',
      now,
    });
    return 0;
  }

  return creditCoins(db, row.discordId, {
    source: 'WIN',
    ref: matchId,
    amount: wanted,
    detail: 'Victoria',
    now,
  });
}

export interface CoinLedgerRow {
  source: CoinSource;
  amount: number;
  day: string;
  detail: string;
  createdAt: number;
}

/** Recent movements, for the wallet's own history panel. */
export function listCoinLedger(db: Db, discordId: string, limit = 30): CoinLedgerRow[] {
  return db
    .prepare(
      `SELECT source, amount, day, detail, created_at AS createdAt
       FROM coin_ledger WHERE discord_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(discordId, limit) as CoinLedgerRow[];
}

/**
 * Replays every ledger and reports anything the rules say cannot happen.
 *
 * The ledger is authoritative — clamps are applied on write and never
 * recomputed — so a bug in a clamp is permanent rather than self-correcting on
 * the next read. This is the check that would catch one.
 */
export function auditCoinLedger(db: Db): string[] {
  const problems: string[] = [];

  const accounts = db
    .prepare(
      `SELECT DISTINCT l.discord_id AS discordId, u.username, u.is_spectator AS isSpectator
       FROM coin_ledger l JOIN discord_users u ON u.discord_id = l.discord_id`,
    )
    .all() as Array<{ discordId: string; username: string; isSpectator: number }>;

  for (const account of accounts) {
    const rows = db
      .prepare(
        `SELECT source, amount, day FROM coin_ledger
         WHERE discord_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(account.discordId) as Array<{ source: CoinSource; amount: number; day: string }>;

    let running = 0;
    for (const row of rows) {
      running += row.amount;

      if (running < 0) {
        problems.push(`${account.username}: el balance quedó en ${running} tras un ${row.source}`);
        break;
      }

      // A spectator's wallet is the only one allowed past the ceiling, and only
      // through a bet. Nothing a player can do puts them over fifteen.
      const mayExceed =
        account.isSpectator === 1 &&
        (row.source === 'BET_PAYOUT' || row.source === 'BET_REFUND');
      if (running > COIN_WALLET_CAP && !mayExceed) {
        problems.push(
          `${account.username}: ${running} monedas tras un ${row.source}, por encima de ${COIN_WALLET_CAP}`,
        );
        break;
      }
    }

    if (account.isSpectator === 1) continue;

    const overpaidDays = db
      .prepare(
        `SELECT day, SUM(amount) AS n FROM coin_ledger
         WHERE discord_id = ? AND source IN ('DAILY', 'WIN')
         GROUP BY day HAVING n > ?`,
      )
      .all(account.discordId, PLAYER_DAILY_EARN_CAP) as Array<{ day: string; n: number }>;

    for (const day of overpaidDays) {
      problems.push(`${account.username}: ganó ${day.n} el ${day.day}, tope ${PLAYER_DAILY_EARN_CAP}`);
    }
  }

  // Every stake must have been resolved exactly once, or still be riding.
  const orphans = db
    .prepare(
      `SELECT b.id FROM bets b
       WHERE b.status != 'OPEN'
         AND EXISTS (SELECT 1 FROM coin_ledger WHERE source = 'BET_STAKE' AND ref = b.id)
         AND b.status != 'LOST'
         AND NOT EXISTS (
           SELECT 1 FROM coin_ledger
           WHERE ref = b.id AND source IN ('BET_PAYOUT', 'BET_REFUND')
         )`,
    )
    .all() as Array<{ id: string }>;

  for (const bet of orphans) {
    problems.push(`apuesta ${bet.id}: cerrada sin pago ni reembolso`);
  }

  return problems;
}

/** Every account that earns, for the per-cycle accrual sweep. */
export function earningAccounts(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT u.discord_id AS discordId
         FROM discord_users u
         LEFT JOIN players p ON p.id = u.player_id AND p.status = 'approved'
         WHERE u.is_spectator = 1 OR p.id IS NOT NULL`,
      )
      .all() as Array<{ discordId: string }>
  ).map((row) => row.discordId);
}
