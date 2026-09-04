/**
 * Monedas: the betting currency.
 *
 * Shells used to be both the chip and the prize, which is why betting needed
 * debt, two different ceilings on the same number, and a spectator seed that
 * existed only inside a calculation. Splitting them means shells go back to
 * being something you earn or buy and then spend, and monedas carry every rule
 * about income, ceilings and stakes.
 *
 * Pure on purpose, like shells.ts and bets.ts: no database, no clock beyond
 * what is passed in. Every cap decision lives here so it can be tested without
 * standing up a wallet.
 */

/**
 * Panama runs on UTC-5 the whole year with no daylight saving, so the day
 * boundary is a constant rather than a timezone lookup. Everyone in the
 * tournament is on this clock; "today" means today in Panama, not in UTC.
 */
export const DAY_OFFSET_HOURS = -5;

/** The most anybody's wallet holds. */
export const COIN_WALLET_CAP = 15;

/** Paid once a day just for being in the tournament. */
export const PLAYER_DAILY_GRANT = 1;

/** Paid per match won. */
export const PLAYER_WIN_GRANT = 1;

/**
 * The ceiling on daily and win income combined.
 *
 * Five means the daily coin plus four wins: enough that a full day of playing
 * is rewarded, capped so that a marathon session cannot mint a shell in an
 * afternoon.
 */
export const PLAYER_DAILY_EARN_CAP = 5;

/**
 * Spectators do not play, so they cannot earn from wins. They get a flat daily
 * income instead, and betting is the only way for them to do better.
 */
export const SPECTATOR_DAILY_GRANT = 3;

/** What a blue shell costs in the shop. */
export const SHELL_PRICE_COINS = 15;

/**
 * A shield costs less than the shell it stops, on purpose.
 *
 * Defence that costs more than offence never gets bought, and a shop that only
 * sells attacks turns the challenge into a race to save fifteen coins first.
 * Ten is roughly two days for somebody playing, so it still hurts.
 */
export const SHIELD_PRICE_COINS = 10;

/** How many shields one player may hold at once. */
export const MAX_HELD_SHIELDS = 2;

export const MIN_STAKE = 1;

/** Nobody stakes more than this on one game, whatever they are holding. */
export const MAX_STAKE = 2;

/**
 * The Panama calendar day a moment falls on, as YYYY-MM-DD.
 *
 * Shifting the timestamp by the offset and then reading the UTC date is exact
 * because the offset never changes — there is no hour that belongs to two days
 * and none that belongs to neither.
 */
export function dayKey(atMs: number): string {
  return new Date(atMs + DAY_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** The instant a Panama day begins, in epoch milliseconds. */
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - DAY_OFFSET_HOURS * 3_600_000;
}

/**
 * Guards the accrual walk. A tournament runs a month; anything asking for more
 * days than this is a bad clock or a bad epoch, and the answer is to pay less
 * rather than to mint a year of income.
 */
export const MAX_ACCRUAL_DAYS = 90;

/** Every day from `from` to `to`, inclusive, oldest first. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = dayStartMs(to);

  for (
    let at = dayStartMs(from);
    at <= end && days.length < MAX_ACCRUAL_DAYS;
    at += 86_400_000
  ) {
    days.push(dayKey(at));
  }

  return days;
}

/**
 * The daily grant somebody is owed, before the wallet ceiling is applied.
 *
 * A player's daily coin competes with their wins for the same daily cap, so
 * somebody who already banked five from wins gets nothing for showing up —
 * the cap is on income, not on any one source.
 */
export function dailyEntitlement(isSpectator: boolean, earnedToday: number): number {
  if (isSpectator) return SPECTATOR_DAILY_GRANT;
  return Math.max(0, Math.min(PLAYER_DAILY_GRANT, PLAYER_DAILY_EARN_CAP - earnedToday));
}

/** What a win pays, before the wallet ceiling is applied. */
export function winEntitlement(earnedToday: number): number {
  return Math.max(0, Math.min(PLAYER_WIN_GRANT, PLAYER_DAILY_EARN_CAP - earnedToday));
}

/**
 * Trims a grant to what the wallet can still hold.
 *
 * `bypassCap` is the whole player/spectator asymmetry in one argument. Nothing
 * a player does bypasses: at fifteen coins every source simply stops, winnings
 * and voided stakes included. Only a spectator bypasses, and only through a
 * bet, which is the one way any wallet goes past the cap at all.
 */
export function clampGrant(balance: number, wanted: number, bypassCap = false): number {
  if (bypassCap) return Math.max(0, wanted);
  return Math.max(0, Math.min(wanted, COIN_WALLET_CAP - balance));
}

/**
 * Whether a stake can be covered. There is no debt anywhere in this economy:
 * you bet what you have or you do not bet.
 */
export function canAfford(balance: number, stake: number): boolean {
  if (!Number.isInteger(stake)) return false;
  if (stake < MIN_STAKE || stake > MAX_STAKE) return false;
  return balance >= stake;
}

export type ShopCheck = { ok: true } | { ok: false; reason: string };

/** Whether a shell purchase can go through, with the reason it cannot. */
export function canBuyShell(
  coins: number,
  heldShells: number,
  shellCap: number,
): ShopCheck {
  if (coins < SHELL_PRICE_COINS) {
    return { ok: false, reason: `Te faltan ${SHELL_PRICE_COINS - coins} monedas.` };
  }
  if (heldShells >= shellCap) {
    return {
      ok: false,
      reason: `Ya tenés ${shellCap} conchas. Tirá una antes de comprar otra.`,
    };
  }
  return { ok: true };
}

/**
 * Whether this account can buy a shield right now.
 *
 * Mirrors `canBuyShell` rather than sharing it: the two have different prices,
 * different ceilings and different refusals to explain, and folding them into
 * one function parameterised by three things would be harder to read than
 * either.
 */
export function canBuyShield(
  coins: number,
  heldShields: number,
  max: number = MAX_HELD_SHIELDS,
): { ok: true } | { ok: false; reason: string } {
  if (heldShields >= max) {
    return {
      ok: false,
      reason:
        max === 1
          ? 'Ya tenés un escudo puesto.'
          : `Ya tenés ${max} escudos puestos.`,
    };
  }
  if (coins < SHIELD_PRICE_COINS) {
    return {
      ok: false,
      reason: `Te faltan ${SHIELD_PRICE_COINS - coins} monedas.`,
    };
  }
  return { ok: true };
}
