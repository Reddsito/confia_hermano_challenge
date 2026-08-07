import { describe, expect, it } from 'vitest';

import { earnedShells, type ShellGame, type ShellProgress } from './shells';

/** A forgettable game: nothing in it satisfies any rule on its own. */
const dullGame: ShellGame = {
  win: true,
  kills: 3,
  deaths: 4,
  assists: 5,
  durationMinutes: 28,
  pentaKills: 0,
  quadraKills: 0,
  championId: 43,
};

const noProgress: ShellProgress = { winStreak: 1, streakChampions: 0 };

const rulesFor = (game: Partial<ShellGame>, progress?: Partial<ShellProgress>) =>
  earnedShells({ ...dullGame, ...game }, { ...noProgress, ...progress }).map(
    (shell) => shell.rule,
  );

describe('the assist rule', () => {
  it('pays at exactly 25', () => {
    expect(rulesFor({ assists: 25 })).toEqual(['ASSISTS_30']);
  });

  it('does not pay at 24', () => {
    expect(rulesFor({ assists: 24 })).toEqual([]);
  });

  it('no longer pays at 20, which used to be the bar', () => {
    expect(rulesFor({ assists: 20 })).toEqual([]);
  });

  it('pays on a loss too — the assists happened either way', () => {
    expect(rulesFor({ assists: 30, win: false })).toEqual(['ASSISTS_30']);
  });
});

describe('earnedShells', () => {
  it('pays nothing for an unremarkable game', () => {
    expect(rulesFor({})).toEqual([]);
  });

  it('pays only the rarest rule when a game satisfies several', () => {
    // 25 assists and a pentakill in one game. Pentakill ranks first in
    // SHELL_RULES, so it is the one the game is remembered for.
    expect(rulesFor({ assists: 25, pentaKills: 1 })).toEqual(['PENTAKILL']);
  });

  it('is worth two shells for a pentakill and one for everything else', () => {
    const [penta] = earnedShells({ ...dullGame, pentaKills: 1 }, noProgress);
    const [assists] = earnedShells({ ...dullGame, assists: 25 }, noProgress);

    expect(penta?.amount).toBe(2);
    expect(assists?.amount).toBe(1);
  });

  it('says how many assists it paid for', () => {
    const [shell] = earnedShells({ ...dullGame, assists: 31 }, noProgress);
    expect(shell?.detail).toBe('31 asistencias');
  });
});
