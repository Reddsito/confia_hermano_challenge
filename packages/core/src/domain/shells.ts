/**
 * Blue shells: small rewards earned by doing something notable in a game, and
 * spent by firing them at another participant.
 *
 * This module is deliberately pure. It takes a description of one finished game
 * plus the running counters that span several games, and returns what was
 * earned. No database, no Riot client — which is what makes every rule testable
 * on its own.
 */

export const SHELL_RULES = [
  'PENTAKILL',
  'QUADRAKILL',
  'KILLS_20',
  'ASSISTS_30',
  'WIN_STREAK_6',
  'PERFECT_KDA_20',
  'LONG_WIN_40',
  'FIVE_CHAMPION_WINS',
] as const;

export type ShellRule = (typeof SHELL_RULES)[number];

export const SHELL_RULE_LABEL: Record<ShellRule, string> = {
  PENTAKILL: 'Pentakill',
  QUADRAKILL: 'Cuádruple',
  KILLS_20: '20 asesinatos en una partida',
  ASSISTS_30: '25 asistencias en una partida',
  WIN_STREAK_6: '6 victorias seguidas',
  PERFECT_KDA_20: 'KDA perfecto arriba de 20',
  LONG_WIN_40: 'Ganar una partida de 40 minutos',
  FIVE_CHAMPION_WINS: '5 victorias seguidas con 5 campeones distintos',
};

/**
 * What one occurrence of each rule pays. Pentakills are the only rule worth
 * more than a single shell. Kept next to the labels so the UI can advertise
 * the payout without restating a number the scoring already owns.
 */
export const SHELL_RULE_AWARD: Record<ShellRule, number> = {
  PENTAKILL: 2,
  QUADRAKILL: 1,
  KILLS_20: 1,
  ASSISTS_30: 1,
  WIN_STREAK_6: 1,
  PERFECT_KDA_20: 1,
  LONG_WIN_40: 1,
  FIVE_CHAMPION_WINS: 1,
};

/**
 * Nobody can sit on more than this many unspent shells, however they got them.
 * Earning is capped, not queued: at the cap, further achievements pay nothing
 * and the shop refuses to sell, so the cap is what stops a good week from being
 * banked instead of played.
 *
 * One ceiling for everybody. There used to be a second, higher one that only
 * bet winnings could reach — bets pay monedas now, so the slot above has no
 * source and the two numbers collapse back into one.
 */
export const MAX_HELD_SHELLS = 3;

/**
 * A shell bought in the shop rather than earned.
 *
 * Not a member of SHELL_RULES: it is not something a game can satisfy, and
 * putting it there would have earnedShells ranking it against real
 * achievements. It shares the ledger so a bought shell can be thrown and
 * stolen exactly like an earned one.
 */
export const SHELL_SHOP_RULE = 'SHOP_PURCHASE';

/**
 * A shell earned by being on the receiving end of enough of them.
 *
 * Not a member of SHELL_RULES for the same reason the shop rule is not: no
 * finished game can satisfy it. It is settled the moment the fifth shell lands,
 * which is why it lives outside `earnedShells` entirely — the pure module only
 * ever sees one game plus counters, and "how many were thrown at me" is neither.
 *
 * It replaces a rule that paid a shell every five wins carrying Smite. That one
 * asked for nothing notable: it counted lifetime wins with a summoner spell, so
 * a jungler collected on schedule just by playing, while every other rule wants
 * a pentakill or a streak. This one at least costs somebody five shells.
 */
export const SHELL_RETRIBUTION_RULE = 'FIVE_SHELLS_TAKEN';

export const SHELL_RETRIBUTION_LABEL = 'Te cayeron 5 conchas';

/**
 * A one-time credit that closed the shell debts left by the betting era.
 *
 * Back when wagers were paid in shells, a lost bet could push a balance below
 * zero, and `balanceFor` clamps the display at zero. The effect was silent and
 * corrosive: those players kept earning shells that went to paying down a debt
 * nobody had ever been shown, so the arsenal read 0 while the ledger announced
 * a shell had just been earned.
 *
 * The debts were settled by treating the over-thrown shells as legitimately
 * spent — they were fired, the challenges were served, clawing them back would
 * punish people for a bug — and re-crediting only what the debt had swallowed
 * since. Nothing here can happen again: bets pay monedas, and the throw route
 * refuses to fire on an empty arsenal, so a balance has no way back below zero.
 */
export const SHELL_DEBT_REPAIR_RULE = 'DEBT_REPAIR';

/** Shells you have to eat before the sixth one is yours to throw. */
export const SHELLS_TAKEN_FOR_SHELL = 5;

export interface ShellGame {
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  durationMinutes: number;
  pentaKills: number;
  quadraKills: number;
  championId: number;
}

/** Counters that only make sense across several games. */
export interface ShellProgress {
  /** Consecutive wins, including this game. */
  winStreak: number;
  /**
   * Distinct champions among the last five games, counted only when those five
   * were all wins. Zero otherwise, so the rule below cannot fire off a run that
   * was broken by a loss.
   */
  streakChampions: number;
}

export interface EarnedShell {
  rule: ShellRule;
  /** Pentakills are worth two; everything else is worth one. */
  amount: number;
  /** Human-readable detail, e.g. "24 kills". */
  detail: string;
}

const KILL_THRESHOLD = 20;
/**
 * Raised from 20. Support and jungle were clearing it most games, which made a
 * rule that is supposed to mark a standout game read as a participation prize.
 * The rule id still says 30 — it is written into every row already awarded, so
 * renaming it would cost a migration to buy nothing.
 */
const ASSIST_THRESHOLD = 25;
const STREAK_THRESHOLD = 6;
const PERFECT_KDA_THRESHOLD = 20;
const LONG_GAME_MINUTES = 40;
const MILESTONE_STEP = 5;

/**
 * What one finished game pays: at most one rule, however many it satisfied.
 *
 * A single game can easily clear several rules at once — a flawless win that
 * also lands on the sixth of a streak clears two — and paying for each would
 * let one good game fill the whole arsenal. The rarest rule wins, ranked by
 * position in SHELL_RULES, so the game is remembered for its best moment.
 *
 * The milestone rule (5 champions) is awarded on the game that crosses the
 * threshold, which is why it needs the post-game counters rather than the game
 * alone.
 */
export function earnedShells(
  game: ShellGame,
  progress: ShellProgress,
): EarnedShell[] {
  const earned: EarnedShell[] = [];

  if (game.pentaKills > 0) {
    earned.push({
      rule: 'PENTAKILL',
      amount: SHELL_RULE_AWARD.PENTAKILL * game.pentaKills,
      detail: game.pentaKills > 1 ? `${game.pentaKills} pentakills` : 'Pentakill',
    });
  }

  // A pentakill also increments the quadrakill counter, so only award the
  // quadra when there were more quadras than pentas.
  const standaloneQuadras = game.quadraKills - game.pentaKills;
  if (standaloneQuadras > 0) {
    earned.push({
      rule: 'QUADRAKILL',
      amount: standaloneQuadras,
      detail:
        standaloneQuadras > 1
          ? `${standaloneQuadras} cuádruples`
          : 'Cuádruple',
    });
  }

  if (game.kills >= KILL_THRESHOLD) {
    earned.push({ rule: 'KILLS_20', amount: 1, detail: `${game.kills} asesinatos` });
  }

  if (game.assists >= ASSIST_THRESHOLD) {
    earned.push({
      rule: 'ASSISTS_30',
      amount: 1,
      detail: `${game.assists} asistencias`,
    });
  }

  // Fires on the 6th win and again every 6 after that, so a long run keeps
  // paying instead of rewarding only the first six.
  if (
    game.win &&
    progress.winStreak >= STREAK_THRESHOLD &&
    progress.winStreak % STREAK_THRESHOLD === 0
  ) {
    earned.push({
      rule: 'WIN_STREAK_6',
      amount: 1,
      detail: `${progress.winStreak} victorias seguidas`,
    });
  }

  // "Perfect" means untouched: zero deaths, not merely a high ratio.
  if (game.deaths === 0 && game.kills + game.assists > PERFECT_KDA_THRESHOLD) {
    earned.push({
      rule: 'PERFECT_KDA_20',
      amount: 1,
      detail: `${game.kills}/0/${game.assists} sin morir`,
    });
  }

  if (game.win && game.durationMinutes >= LONG_GAME_MINUTES) {
    earned.push({
      rule: 'LONG_WIN_40',
      amount: 1,
      detail: `Ganada a los ${Math.round(game.durationMinutes)} minutos`,
    });
  }

  // Five wins in a row, each on a different champion. The streak is what makes
  // this hard: scattered wins across a whole tournament used to pay, which any
  // one-trick cleared eventually just by playing enough.
  //
  // Gated on the streak length as well as the champion count so a long run pays
  // once every five wins rather than on every game after the fifth.
  if (
    game.win &&
    progress.winStreak >= MILESTONE_STEP &&
    progress.winStreak % MILESTONE_STEP === 0 &&
    progress.streakChampions === MILESTONE_STEP
  ) {
    earned.push({
      rule: 'FIVE_CHAMPION_WINS',
      amount: 1,
      detail: '5 victorias seguidas con 5 campeones distintos',
    });
  }

  // Sorted rather than trusted to arrive in order: the checks above happen to
  // run in SHELL_RULES order today, and reordering them for any reason must not
  // quietly change which rule a game pays.
  return earned
    .sort((a, b) => SHELL_RULES.indexOf(a.rule) - SHELL_RULES.indexOf(b.rule))
    .slice(0, 1);
}

export function totalShells(earned: EarnedShell[]): number {
  return earned.reduce((sum, shell) => sum + shell.amount, 0);
}
