import { randomUUID } from 'node:crypto';

import {
  MIN_SHELLS,
  payoutFor,
  settleBet,
  shellCeiling,
  SPECTATOR_START_SHELLS,
  type BetMarket,
  type BetOutcome,
} from '@challenge/core/domain';

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

/**
 * What betting has done to a balance, in one number.
 *
 * The stake leaves the moment a bet is placed, which is what stops one shell
 * being ridden on four games at once — so an OPEN wager already counts against
 * you. A void returns the stake by subtracting nothing and paying nothing,
 * which nets to zero without a special case anywhere else.
 */
export function betDelta(db: Db, discordId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(payout), 0) AS paid,
              COALESCE(SUM(CASE WHEN status != 'VOID' THEN stake ELSE 0 END), 0) AS staked
       FROM bets WHERE discord_id = ?`,
    )
    .get(discordId) as { paid: number; staked: number };

  return row.paid - row.staked;
}

export interface HolderBalance {
  available: number;
  /** The most this holder can hold: 4 for players, 10 for spectators. */
  ceiling: number;
  /** Negative when in debt, so the UI can paint that many slots red. */
  debt: number;
  isSpectator: boolean;
}

/**
 * The full picture for one account: achievements, the spectator's opening
 * stake, every wager, and every shell already fired.
 *
 * Not clamped at zero any more. Betting uncovered is allowed down to
 * MIN_SHELLS, and a balance that silently floored at zero would have quietly
 * forgiven every debt the moment it was incurred.
 */
export function balanceForHolder(db: Db, discordId: string): HolderBalance {
  const holder = holderFor(db, discordId);
  if (!holder) {
    return { available: 0, ceiling: 0, debt: 0, isSpectator: false };
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

  // Counted with OR rather than two queries so a row carrying both columns is
  // still one throw, not two.
  const thrown = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM shell_throws WHERE from_player = ? OR from_discord = ?',
      )
      .get(holder.playerId, discordId) as { n: number }
  ).n;

  const seed = holder.isSpectator ? SPECTATOR_START_SHELLS : 0;
  const raw = earned + seed + betDelta(db, discordId) - thrown;
  const available = Math.max(raw, MIN_SHELLS);

  return {
    available,
    ceiling: shellCeiling(holder.isSpectator),
    debt: available < 0 ? -available : 0,
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

  return getBet(db, id)!;
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
        continue;
      }

      if (result === 'LOST') {
        db.prepare(
          `UPDATE bets SET status = 'LOST', payout = 0, match_id = ?,
                           settled_at = ? WHERE id = ?`,
        ).run(matchId, Date.now(), bet.id);
        continue;
      }

      // The stake always comes back; the winnings only fill what fits. At the
      // ceiling that means a win pays nothing extra, which is the deal for
      // betting while full.
      const holder = holderFor(db, bet.discordId);
      const ceiling = shellCeiling(holder?.isSpectator ?? false);
      const balanceWithoutStake = balanceForHolder(db, bet.discordId).available;

      const full = payoutFor(bet.selection, bet.stake);
      const headroom = ceiling - (balanceWithoutStake + bet.stake);
      const winnings = Math.max(0, Math.min(full - bet.stake, headroom));

      db.prepare(
        `UPDATE bets SET status = 'WON', payout = ?, match_id = ?,
                         settled_at = ? WHERE id = ?`,
      ).run(bet.stake + winnings, matchId, Date.now(), bet.id);

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
  const result = db
    .prepare(
      `UPDATE bets SET status = 'VOID', payout = 0, settled_at = ?
       WHERE status = 'OPEN' AND placed_at < ?`,
    )
    .run(Date.now(), Date.now() - olderThanMs);

  return result.changes;
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
