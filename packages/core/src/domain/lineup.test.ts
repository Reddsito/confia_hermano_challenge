import { describe, expect, it } from 'vitest';

import { laneOf, orderByLane } from './lineup';

interface Member {
  name: string;
  role?: 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT' | null;
  hasSmite?: boolean;
  hasHeal?: boolean;
  hasTeleport?: boolean;
}

const names = (team: Member[]) => team.map((member) => member.name);

describe('laneOf', () => {
  it('trusts the roster over Smite', () => {
    expect(laneOf({ role: 'MID', hasSmite: true })).toBe('MID');
  });

  it('reads Smite as jungle when the roster says nothing', () => {
    expect(laneOf({ hasSmite: true })).toBe('JUNGLE');
    expect(laneOf({ role: null, hasSmite: true })).toBe('JUNGLE');
  });

  it('reads Heal as bot lane and Teleport as top', () => {
    expect(laneOf({ hasHeal: true })).toBe('ADC');
    expect(laneOf({ hasTeleport: true })).toBe('TOP');
  });

  it('prefers the stronger evidence when a player carries two', () => {
    expect(laneOf({ hasSmite: true, hasTeleport: true })).toBe('JUNGLE');
    expect(laneOf({ hasHeal: true, hasTeleport: true })).toBe('ADC');
    expect(laneOf({ role: 'SUPPORT', hasHeal: true })).toBe('SUPPORT');
  });

  it('admits it does not know', () => {
    expect(laneOf({})).toBeNull();
    expect(laneOf({ hasSmite: false, hasHeal: false })).toBeNull();
  });
});

describe('orderByLane', () => {
  it('seats known roles in lane order', () => {
    const team: Member[] = [
      { name: 'sup', role: 'SUPPORT' },
      { name: 'top', role: 'TOP' },
      { name: 'adc', role: 'ADC' },
      { name: 'jg', role: 'JUNGLE' },
      { name: 'mid', role: 'MID' },
    ];

    expect(names(orderByLane(team))).toEqual(['top', 'jg', 'mid', 'adc', 'sup']);
  });

  it('fills the empty lanes with unknowns in Riot order', () => {
    const team: Member[] = [
      { name: 'a' },
      { name: 'ourAdc', role: 'ADC' },
      { name: 'b' },
      { name: 'theirJungler', hasSmite: true },
      { name: 'c' },
    ];

    // ADC and jungle are claimed; a, b, c drop into top, mid and support.
    expect(names(orderByLane(team))).toEqual([
      'a',
      'theirJungler',
      'b',
      'ourAdc',
      'c',
    ]);
  });

  it('keeps everyone when nothing is known', () => {
    const team: Member[] = [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
      { name: 'd' },
      { name: 'e' },
    ];

    expect(names(orderByLane(team))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not drop the loser of a contested lane', () => {
    const team: Member[] = [
      { name: 'rosterJungler', role: 'JUNGLE' },
      { name: 'alsoSmiting', hasSmite: true },
      { name: 'x' },
      { name: 'y' },
      { name: 'z' },
    ];

    const ordered = orderByLane(team);
    expect(ordered).toHaveLength(5);
    expect(names(ordered)).toContain('alsoSmiting');
    expect(ordered[1]!.name).toBe('rosterJungler');
  });

  it('decides a contested lane by evidence, not by Riot order', () => {
    // The Teleport is listed first, but the roster knows who the top is.
    const team: Member[] = [
      { name: 'randomTp', hasTeleport: true },
      { name: 'rosterTop', role: 'TOP' },
      { name: 'x' },
      { name: 'y' },
      { name: 'z' },
    ];

    const ordered = orderByLane(team);
    expect(ordered[0]!.name).toBe('rosterTop');
    expect(names(ordered)).toContain('randomTp');
    expect(ordered).toHaveLength(5);
  });

  it('seats a whole enemy team from spells alone', () => {
    // What the live tab actually gets: no roster roles on the enemy side.
    const team: Member[] = [
      { name: 'heal', hasHeal: true },
      { name: 'unknownA' },
      { name: 'tp', hasTeleport: true },
      { name: 'smite', hasSmite: true },
      { name: 'unknownB' },
    ];

    // top, jungle and adc are claimed; the two unknowns fill mid and support in
    // the order Riot listed them.
    expect(names(orderByLane(team))).toEqual([
      'tp',
      'smite',
      'unknownA',
      'heal',
      'unknownB',
    ]);
  });

  it('round-trips a team that is not five people', () => {
    const short: Member[] = [{ name: 'a' }, { name: 'b', role: 'SUPPORT' }];
    expect(names(orderByLane(short))).toEqual(['a', 'b']);

    const long: Member[] = [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
      { name: 'd' },
      { name: 'e' },
      { name: 'f' },
    ];
    expect(names(orderByLane(long))).toHaveLength(6);
  });

  it('returns the same objects it was given', () => {
    const member: Member = { name: 'top', role: 'TOP' };
    expect(orderByLane([member])[0]).toBe(member);
  });
});
