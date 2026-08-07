import { randomUUID } from 'node:crypto';

import {
  MAX_HELD_SHELLS,
  payoutFor,
  settleBet,
  type BetMarket,
  type BetOutcome,
} from '@challenge/core/domain';

import { creditCoins, debitCoins } from './coins';
import type { Db } from './index';

export interface Holder {
  discordId: string;
  /** Null for spectators, who have no roster entry by design. */
  playerId: string | null;
  isSpectator: boolean;
  username: string;
}

export function holderFor(db: Db, discordId: string): Holder | null {
  const row = db
    .prepare(
      `SELECT discord_id AS discordId, player_id AS playerId,
              is_spectator AS isSpectator, username
       FROM discord_users WHERE discord_id = ?`,
    )
    .get(discordId) as
    | { discordId: string; playerId: string | null; isSpectator: number; username: string }
    | undefined;

  if (!row) return null;
  return { ...row, isSpectator: row.isSpectator === 1 };
}

export interface HolderBalance {
  available: number;
  /** The most this holder can hold. One number for everybody now. */
  ceiling: number;
  isSpectator: boolean;
}

/**
 * The shells one account is holding: what it earned, what it was granted or
 * bought, minus what it already fired.
 *
 * Bets are absent from this sum on purpose. They pay monedas now, so the debt
 * this function used to be able to report has nowhere to come from — which is
 * also why it is floored at zero again.
 */
export function balanceForHolder(db: Db, discordId: string): HolderBalance {
  const holder = holderFor(db, discordId);
  if (!holder) {
    return { available: 0, ceiling: 0, isSpectator: false };
  }

  const earned = holder.playerId
    ? (
        db
          .prepare(
            'SELECT COALESCE(SUM(amount), 0) AS n FROM blue_shells WHERE player_id = ?',
          )
          .get(holder.playerId) as { n: number }
      ).n
    : 0;

  // Where a spectator's shells live: they have no players row, so blue_shells
  // cannot hold them.
  const granted = (
    db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS n FROM shell_grants WHERE discord_id = ?',
      )
      .get(discordId) as { n: number }
  ).n;

  // Counted with OR rather than two queries so a row carrying both columns is
  // still one throw, not two.
  const thrown = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM shell_throws WHERE from_player = ? OR from_discord = ?',
      )
      .get(holder.playerId, discordId) as { n: number }
  ).n;

  return {
    available: Math.max(0, earned + granted - thrown),
    ceiling: MAX_HELD_SHELLS,
    isSpectator: holder.isSpectator,
  };
}

export interface BetRow {
  id: string;
  discordId: string;
  playerId: string;
  gameId: string;
  market: BetMarket;
  selection: string;
  stake: number;
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  payout: number;
  matchId: string | null;
  placedAt: number;
  settledAt: number | null;
}

export function placeBet(
  db: Db,
  bet: {
    discordId: string;
    playerId: string;
    gameId: string;
    market: BetMarket;
    selection: string;
    stake: number;
  },
): BetRow {
  const id = randomUUID();

  db.transaction(() => {
    // The stake leaves the wallet the moment the bet is placed, which is what
    // stops the same coin being ridden on four games at once. The route has
    // already checked the balance; this is the guard against a double submit
    // slipping two bets through on one coin.
    const paid = debitCoins(db, bet.discordId, {
      source: 'BET_STAKE',
      ref: id,
      amount: bet.stake,
      detail: 'Apuesta',
    });
    if (!paid) throw new Error('INSUFFICIENT_COINS');

    db.prepare(
      `INSERT INTO bets (id, discord_id, player_id, game_id, market, selection,
                         stake, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      bet.discordId,
      bet.playerId,
      bet.gameId,
      bet.market,
      bet.selection,
      bet.stake,
      Date.now(),
    );
  })();

  return getBet(db, id)!;
}

/**
 * Hands a stake back. Bypasses the wallet ceiling on purpose: a refund is not
 * income, and a full wallet must not swallow a stake it is returning.
 */
function refundStake(db: Db, bet: { id: string; discordId: string; stake: number }): void {
  creditCoins(db, bet.discordId, {
    source: 'BET_REFUND',
    ref: bet.id,
    amount: bet.stake,
    detail: 'Apuesta anulada',
    bypassCap: true,
  });
}

export function getBet(db: Db, id: string): BetRow | null {
  return (
    (db
      .prepare(
        `SELECT id, discord_id AS discordId, player_id AS playerId,
                game_id AS gameId, market, selection, stake, status, payout,
                match_id AS matchId, placed_at AS placedAt,
                settled_at AS settledAt
         FROM bets WHERE id = ?`,
      )
      .get(id) as BetRow | undefined) ?? null
  );
}

/** Everything still riding, for the live view and for the settling pass. */
export function openBets(db: Db, discordId?: string): BetRow[] {
  const sql =
    `SELECT id, discord_id AS discordId, player_id AS playerId,
            game_id AS gameId, market, selection, stake, status, payout,
            match_id AS matchId, placed_at AS placedAt, settled_at AS settledAt
     FROM bets WHERE status = 'OPEN'` +
    (discordId ? ' AND discord_id = ?' : '');

  return (discordId
    ? db.prepare(sql).all(discordId)
    : db.prepare(sql).all()) as BetRow[];
}

/** How much of this account's balance is currently tied up in open wagers. */
export function stakedNow(db: Db, discordId: string): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(stake), 0) AS n FROM bets WHERE discord_id = ? AND status = 'OPEN'",
      )
      .get(discordId) as { n: number }
  ).n;
}

/**
 * Grades every open wager on a player's finished game.
 *
 * Called once the match is stored, so it reads the same row the rest of the
 * site reads rather than trusting anything passed in from the sync loop.
 * Anything it cannot grade is voided, never lost.
 */
export function settleBetsForMatch(
  db: Db,
  playerId: string,
  matchId: string,
  outcome: BetOutcome,
): { settled: number; won: number } {
  // The live game id and the match id are the same number on Riot's side, but
  // the live endpoint hands it back as a bare id while matches carry the
  // platform prefix. Match on the suffix so both spellings meet.
  const open = db
    .prepare(
      `SELECT id, discord_id AS discordId, game_id AS gameId, market, selection,
              stake
       FROM bets
       WHERE status = 'OPEN' AND player_id = ?`,
    )
    .all(playerId) as Array<{
    id: string;
    discordId: string;
    gameId: string;
    market: BetMarket;
    selection: string;
    stake: number;
  }>;

  const suffix = matchId.includes('_') ? matchId.split('_')[1]! : matchId;
  const mine = open.filter((bet) => bet.gameId === suffix || bet.gameId === matchId);
  if (mine.length === 0) return { settled: 0, won: 0 };

  let won = 0;

  db.transaction(() => {
    for (const bet of mine) {
      const result = settleBet(bet.market, bet.selection, outcome);

      if (result === null) {
        db.prepare(
          `UPDATE bets SET status = 'VOID', payout = 0, match_id = ?,
                           settled_at = ? WHERE id = ?`,
        ).run(matchId, Date.now(), bet.id);
        refundStake(db, bet);
        continue;
      }

      if (result === 'LOST') {
        db.prepare(
          `UPDATE bets SET status = 'LOST', payout = 0, match_id = ?,
                           settled_at = ? WHERE id = ?`,
        ).run(matchId, Date.now(), bet.id);
        continue;
      }

      // Stake and winnings come back together, trimmed to what the wallet can
      // hold. A player at the ceiling collects nothing extra — that is the deal
      // for betting while full, and the reason to spend before you wager.
      // A spectator's winnings are the one thing in this economy allowed past
      // fifteen, because they have no other way to get there.
      const holder = holderFor(db, bet.discordId);
      const credited = creditCoins(db, bet.discordId, {
        source: 'BET_PAYOUT',
        ref: bet.id,
        amount: payoutFor(bet.selection, bet.stake),
        detail: 'Apuesta ganada',
        bypassCap: holder?.isSpectator ?? false,
      });

      // payout records what actually landed rather than what was owed, so the
      // standings' net is the truth about somebody's wallet.
      db.prepare(
        `UPDATE bets SET status = 'WON', payout = ?, match_id = ?,
                         settled_at = ? WHERE id = ?`,
      ).run(credited, matchId, Date.now(), bet.id);

      won += 1;
    }
  })();

  return { settled: mine.length, won };
}

/**
 * Voids wagers whose game never produced a match row.
 *
 * A dodge, a remake or a game that simply never lands in the ingest would
 * otherwise leave a stake locked forever, which reads to the bettor as a shell
 * that vanished.
 */
export function voidStaleBets(db: Db, olderThanMs: number): number {
  // Walked row by row rather than voided in bulk, because the refund is now an
  // explicit ledger entry. It used to be implicit — the old balance derivation
  // simply stopped counting a voided stake — and a bulk UPDATE here would
  // quietly keep everybody's coins.
  const stale = db
    .prepare(
      `SELECT id, discord_id AS discordId, stake FROM bets
       WHERE status = 'OPEN' AND placed_at < ?`,
    )
    .all(Date.now() - olderThanMs) as Array<{
    id: string;
    discordId: string;
    stake: number;
  }>;

  if (stale.length === 0) return 0;

  db.transaction(() => {
    for (const bet of stale) {
      db.prepare(
        "UPDATE bets SET status = 'VOID', payout = 0, settled_at = ? WHERE id = ?",
      ).run(Date.now(), bet.id);
      refundStake(db, bet);
    }
  })();

  return stale.length;
}

export interface LiveWager {
  id: string;
  gameId: string;
  playerId: string;
  discordId: string;
  username: string;
  /** The bettor's own roster entry, if they have one. Null for spectators. */
  bettorPlayerId: string | null;
  isSpectator: boolean;
  market: BetMarket;
  selection: string;
  stake: number;
  placedAt: number;
}

/**
 * Every wager still riding, with a name attached.
 *
 * Public on purpose: the whole appeal of betting on your friends is that they
 * can see what you bet against them. Nothing here exposes a balance — only what
 * was put on the table.
 */
export function liveWagers(db: Db): LiveWager[] {
  return db
    .prepare(
      `SELECT b.id, b.game_id AS gameId, b.player_id AS playerId,
              b.discord_id AS discordId, u.username,
              u.player_id AS bettorPlayerId, u.is_spectator AS isSpectator,
              b.market, b.selection, b.stake, b.placed_at AS placedAt
       FROM bets b
       JOIN discord_users u ON u.discord_id = b.discord_id
       WHERE b.status = 'OPEN'
       ORDER BY b.placed_at ASC`,
    )
    .all()
    .map((row) => {
      const wager = row as Omit<LiveWager, 'isSpectator'> & {
        isSpectator: number;
      };
      return { ...wager, isSpectator: wager.isSpectator === 1 };
    });
}

export interface BetStanding {
  discordId: string;
  username: string;
  playerId: string | null;
  isSpectator: boolean;
  bets: number;
  won: number;
  lost: number;
  /** Shells gained minus shells lost. Negative is a losing streak, not a bug. */
  net: number;
}

/**
 * The betting ladder: who is up and who is down.
 *
 * Voids are excluded from every count — a returned stake is not a bet anybody
 * won or lost, and counting it would flatter whoever got dodged on.
 */
export function betStandings(db: Db): BetStanding[] {
  return db
    .prepare(
      `SELECT u.discord_id AS discordId, u.username, u.player_id AS playerId,
              u.is_spectator AS isSpectator,
              COUNT(*) AS bets,
              COALESCE(SUM(CASE WHEN b.status = 'WON' THEN 1 ELSE 0 END), 0) AS won,
              COALESCE(SUM(CASE WHEN b.status = 'LOST' THEN 1 ELSE 0 END), 0) AS lost,
              COALESCE(SUM(b.payout - b.stake), 0) AS net
       FROM bets b
       JOIN discord_users u ON u.discord_id = b.discord_id
       WHERE b.status IN ('WON', 'LOST')
       GROUP BY b.discord_id
       ORDER BY net DESC, won DESC`,
    )
    .all()
    .map((row) => {
      const standing = row as Omit<BetStanding, 'isSpectator'> & {
        isSpectator: number;
      };
      return { ...standing, isSpectator: standing.isSpectator === 1 };
    });
}
