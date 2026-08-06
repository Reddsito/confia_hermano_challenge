/**
 * Betting blue shells on somebody else's live game.
 *
 * Like the shell scoring next door, this module is pure: it describes what can
 * be bet on and decides a settled bet from a finished game, with no database
 * and no Riot client in sight. That is what makes every market testable on its
 * own, and it is why resolution lives here rather than in the sync loop.
 */

export const BET_MARKETS = [
  'WIN',
  'KILLS_13',
  'FIRST_BLOOD',
  'DURATION_30',
] as const;

export type BetMarket = (typeof BET_MARKETS)[number];

/**
 * What can be bet on right now.
 *
 * Deliberately narrower than BET_MARKETS. Everything ever offered stays in that
 * list and stays gradable, because wagers already on the table have to settle
 * however the offer changes — withdrawing a market must never strand somebody's
 * stake. This is the offer; that one is the vocabulary.
 */
export const OFFERED_MARKETS: readonly BetMarket[] = ['WIN'];

export function isOffered(market: string): market is BetMarket {
  return (OFFERED_MARKETS as readonly string[]).includes(market);
}

/**
 * Both sides of every market, named from the bettor's point of view. Stored as
 * text on the wager, so a market gaining a third option later cannot silently
 * reinterpret rows already settled.
 */
export const BET_SELECTIONS: Record<BetMarket, readonly [string, string]> = {
  WIN: ['GANA', 'PIERDE'],
  KILLS_13: ['MAS_13', 'MENOS_13'],
  FIRST_BLOOD: ['FIRST_BLOOD_SI', 'FIRST_BLOOD_NO'],
  DURATION_30: ['LARGA_30', 'CORTA_30'],
};

export type BetSelection =
  (typeof BET_SELECTIONS)[BetMarket][number] extends string ? string : never;

export const BET_MARKET_LABEL: Record<BetMarket, string> = {
  WIN: '¿Gana la partida?',
  KILLS_13: '¿Más de 13 asesinatos?',
  FIRST_BLOOD: '¿Saca first blood?',
  DURATION_30: '¿Dura más de 30 minutos?',
};

export const BET_SELECTION_LABEL: Record<string, string> = {
  GANA: 'Gana',
  PIERDE: 'Pierde',
  MAS_13: 'Más de 13',
  MENOS_13: '13 o menos',
  FIRST_BLOOD_SI: 'Sí, la saca',
  FIRST_BLOOD_NO: 'No la saca',
  LARGA_30: 'Más de 30 min',
  CORTA_30: '30 min o menos',
};

/**
 * What one staked shell pays back on top of itself, per selection.
 *
 * Everything is even money except first blood, which the data records for the
 * bet-on player alone rather than their team — that lands about one game in
 * ten. At even money nobody would ever take the yes side and the market would
 * be dead on arrival, so the long shot pays double.
 */
export const BET_PAYOUT: Record<string, number> = {
  GANA: 1,
  PIERDE: 1,
  MAS_13: 1,
  MENOS_13: 1,
  FIRST_BLOOD_SI: 2,
  FIRST_BLOOD_NO: 1,
  LARGA_30: 1,
  CORTA_30: 1,
};

export function isBetMarket(value: string): value is BetMarket {
  return (BET_MARKETS as readonly string[]).includes(value);
}

export function isSelectionOf(market: BetMarket, selection: string): boolean {
  return (BET_SELECTIONS[market] as readonly string[]).includes(selection);
}

/** The lines, kept next to the markets they belong to. */
export const KILL_LINE = 13;
export const DURATION_LINE_MINUTES = 30;

/**
 * How long after a game starts bets are still accepted.
 *
 * Short on purpose. The live view refreshes about once a minute, so this is
 * roughly four usable minutes — enough to get in, not enough to watch the
 * stream and bet on something already decided.
 */
export const BET_WINDOW_SECONDS = 300;

export function bettingOpen(gameLengthSeconds: number): boolean {
  // Champion select reports a negative length; bets are welcome that early.
  return gameLengthSeconds < BET_WINDOW_SECONDS;
}

/** The finished game, reduced to only what settling needs. */
export interface BetOutcome {
  win: boolean;
  kills: number;
  firstBlood: boolean;
  durationMinutes: number;
}

export type BetResult = 'WON' | 'LOST';

/**
 * Decides one wager. Returns null when the selection does not belong to the
 * market, which callers should treat as a void rather than a loss — a bet
 * nobody can grade must not cost anybody a shell.
 */
export function settleBet(
  market: BetMarket,
  selection: string,
  outcome: BetOutcome,
): BetResult | null {
  switch (market) {
    case 'WIN':
      if (selection === 'GANA') return outcome.win ? 'WON' : 'LOST';
      if (selection === 'PIERDE') return outcome.win ? 'LOST' : 'WON';
      return null;

    case 'KILLS_13':
      if (selection === 'MAS_13') {
        return outcome.kills > KILL_LINE ? 'WON' : 'LOST';
      }
      if (selection === 'MENOS_13') {
        return outcome.kills > KILL_LINE ? 'LOST' : 'WON';
      }
      return null;

    case 'FIRST_BLOOD':
      if (selection === 'FIRST_BLOOD_SI') {
        return outcome.firstBlood ? 'WON' : 'LOST';
      }
      if (selection === 'FIRST_BLOOD_NO') {
        return outcome.firstBlood ? 'LOST' : 'WON';
      }
      return null;

    case 'DURATION_30': {
      const long = outcome.durationMinutes > DURATION_LINE_MINUTES;
      if (selection === 'LARGA_30') return long ? 'WON' : 'LOST';
      if (selection === 'CORTA_30') return long ? 'LOST' : 'WON';
      return null;
    }
  }
}

/** What a won wager pays out in total, stake included. */
export function payoutFor(selection: string, stake: number): number {
  return stake + stake * (BET_PAYOUT[selection] ?? 1);
}
