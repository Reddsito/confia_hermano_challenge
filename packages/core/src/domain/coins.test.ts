import { describe, expect, it } from 'vitest';

import {
  COIN_WALLET_CAP,
  MAX_ACCRUAL_DAYS,
  SHELL_PRICE_COINS,
  SPECTATOR_DAILY_GRANT,
  canAfford,
  canBuyShell,
  clampGrant,
  dailyEntitlement,
  dayKey,
  dayStartMs,
  daysBetween,
  winEntitlement,
} from './coins';

describe('dayKey', () => {
  // The boundary is the whole reason this function exists: Panama is five
  // hours behind UTC, so a game finished at 11pm belongs to that day and not
  // to the next one the way a naive UTC read would have it.
  it('puts 04:59 UTC on the previous Panama day', () => {
    expect(dayKey(Date.parse('2026-08-06T04:59:00.000Z'))).toBe('2026-08-05');
  });

  it('rolls over at 05:00 UTC', () => {
    expect(dayKey(Date.parse('2026-08-06T05:00:00.000Z'))).toBe('2026-08-06');
  });

  it('round-trips through dayStartMs', () => {
    expect(dayKey(dayStartMs('2026-08-06'))).toBe('2026-08-06');
  });
});

describe('daysBetween', () => {
  it('is inclusive at both ends', () => {
    expect(daysBetween('2026-08-04', '2026-08-06')).toEqual([
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
    ]);
  });

  it('returns the single day when both ends match', () => {
    expect(daysBetween('2026-08-06', '2026-08-06')).toEqual(['2026-08-06']);
  });

  // A bad clock or a mis-set epoch must not be able to mint a year of income.
  it('refuses to walk further than the accrual guard', () => {
    expect(daysBetween('2020-01-01', '2026-08-06')).toHaveLength(MAX_ACCRUAL_DAYS);
  });
});

describe('dailyEntitlement', () => {
  it('pays a player their daily coin with room left', () => {
    expect(dailyEntitlement(false, 0)).toBe(1);
    expect(dailyEntitlement(false, 4)).toBe(1);
  });

  // Daily and wins share one cap, so five wins means showing up pays nothing.
  it('pays nothing once the daily cap is reached', () => {
    expect(dailyEntitlement(false, 5)).toBe(0);
    expect(dailyEntitlement(false, 9)).toBe(0);
  });

  it('pays spectators a flat rate regardless of the cap', () => {
    expect(dailyEntitlement(true, 0)).toBe(SPECTATOR_DAILY_GRANT);
    expect(dailyEntitlement(true, 99)).toBe(SPECTATOR_DAILY_GRANT);
  });
});

describe('winEntitlement', () => {
  it('pays for a win under the cap', () => {
    expect(winEntitlement(4)).toBe(1);
  });

  it('pays nothing at the cap', () => {
    expect(winEntitlement(5)).toBe(0);
  });
});

describe('clampGrant', () => {
  it('trims a grant to the headroom left', () => {
    expect(clampGrant(14, 3)).toBe(1);
  });

  it('pays nothing at the ceiling', () => {
    expect(clampGrant(COIN_WALLET_CAP, 3)).toBe(0);
  });

  // Spectator winnings and everybody's refunds are the only things allowed
  // past the ceiling.
  it('ignores the ceiling when bypassed', () => {
    expect(clampGrant(14, 3, true)).toBe(3);
    expect(clampGrant(20, 2, true)).toBe(2);
  });

  it('never returns a negative credit', () => {
    expect(clampGrant(20, 3)).toBe(0);
  });
});

describe('canAfford', () => {
  // There is no debt in this economy — the whole reason betting moved off
  // shells — so an empty wallet cannot stake anything.
  it('refuses an empty wallet', () => {
    expect(canAfford(0, 1)).toBe(false);
  });

  it('allows a stake it can cover', () => {
    expect(canAfford(1, 1)).toBe(true);
    expect(canAfford(2, 2)).toBe(true);
  });

  it('refuses a stake above the maximum even when affordable', () => {
    expect(canAfford(15, 3)).toBe(false);
  });

  it('refuses a fractional stake', () => {
    expect(canAfford(15, 1.5)).toBe(false);
  });
});

describe('canBuyShell', () => {
  it('refuses one coin short', () => {
    const check = canBuyShell(SHELL_PRICE_COINS - 1, 0, 3);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('1');
  });

  it('sells at exactly the price', () => {
    expect(canBuyShell(SHELL_PRICE_COINS, 0, 3).ok).toBe(true);
  });

  // Buying past the hold cap would take fifteen coins for a shell that cannot
  // be held, which is why the check happens before the wallet is charged.
  it('refuses when the shell rack is full', () => {
    expect(canBuyShell(SHELL_PRICE_COINS, 3, 3).ok).toBe(false);
  });
});
