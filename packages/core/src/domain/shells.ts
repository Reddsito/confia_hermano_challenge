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
  'FIVE_SMITE_WINS',
] as const;

export type ShellRule = (typeof SHELL_RULES)[number];

export const SHELL_RULE_LABEL: Record<ShellRule, string> = {
  PENTAKILL: 'Pentakill',
  QUADRAKILL: 'Cuádruple',
  KILLS_20: '20 asesinatos en una partida',
  ASSISTS_30: '30 asistencias en una partida',
  WIN_STREAK_6: '6 victorias seguidas',
  PERFECT_KDA_20: 'KDA perfecto arriba de 20',
  LONG_WIN_40: 'Ganar una partida de 40 minutos',
  FIVE_CHAMPION_WINS: '5 victorias con 5 campeones distintos',
  FIVE_SMITE_WINS: '5 victorias llevando Castigo',
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
  FIVE_SMITE_WINS: 1,
};

/**
 * Nobody can sit on more than this many unspent shells. Earning is capped, not
 * queued: at the cap, further achievements pay nothing until one is fired, so
 * the cap is what stops a good week from being banked instead of played.
 */
export const MAX_HELD_SHELLS = 3;

/** Riot's summoner spell id for Smite. */
export const SMITE_SPELL_ID = 11;

export interface ShellGame {
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  durationMinutes: number;
  pentaKills: number;
  quadraKills: number;
  championId: number;
  usedSmite: boolean;
}

/** Counters that only make sense across several games. */
export interface ShellProgress {
  /** Consecutive wins, including this game. */
  winStreak: number;
  /** Distinct champions the player has at least one win with, after this game. */
  distinctChampionWins: number;
  /** Total wins carrying Smite, after this game. */
  smiteWins: number;
}

export interface EarnedShell {
  rule: ShellRule;
  /** Pentakills are worth two; everything else is worth one. */
  amount: number;
  /** Human-readable detail, e.g. "24 kills". */
  detail: string;
}

const KILL_THRESHOLD = 20;
const ASSIST_THRESHOLD = 30;
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
 * The milestone rules (5 champions, 5 smite wins) are awarded on the game that
 * crosses the threshold, which is why they need the post-game counters rather
 * than the game alone.
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

  if (
    game.win &&
    progress.distinctChampionWins > 0 &&
    progress.distinctChampionWins % MILESTONE_STEP === 0
  ) {
    earned.push({
      rule: 'FIVE_CHAMPION_WINS',
      amount: 1,
      detail: `Ganó con ${progress.distinctChampionWins} campeones distintos`,
    });
  }

  if (
    game.win &&
    game.usedSmite &&
    progress.smiteWins > 0 &&
    progress.smiteWins % MILESTONE_STEP === 0
  ) {
    earned.push({
      rule: 'FIVE_SMITE_WINS',
      amount: 1,
      detail: `${progress.smiteWins} victorias con Castigo`,
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
