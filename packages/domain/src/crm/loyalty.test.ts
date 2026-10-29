import { describe, expect, it } from 'vitest';
import { pointsEarned, pointsToRedeem, redeemableAmount, type LoyaltyProgram } from './loyalty';

const program: LoyaltyProgram = { enabled: true, earnPer100: 5, pointValue: 100, minRedeem: 50 };

describe('loyalty points', () => {
  it('earns per whole ₹100 paid, and nothing when the program is off', () => {
    expect(pointsEarned(1_250_00, program)).toBe(60);
    expect(pointsEarned(99_99, program)).toBe(0);
    expect(pointsEarned(199_99, program)).toBe(5);
    expect(pointsEarned(1_250_00, { ...program, enabled: false })).toBe(0);
    expect(pointsEarned(-500_00, program)).toBe(0);
  });

  it('spends whole points, at least the minimum, within the balance', () => {
    expect(pointsToRedeem(75_00, 120, program)).toBe(75);
    expect(() => pointsToRedeem(75_50, 120, program)).toThrow(/steps of 100 paise/);
    expect(() => pointsToRedeem(40_00, 120, program)).toThrow(/at least 50/);
    expect(() => pointsToRedeem(150_00, 120, program)).toThrow(
      expect.objectContaining({ code: 'LOYALTY_INSUFFICIENT' }),
    );
    expect(() => pointsToRedeem(75_00, 120, { ...program, enabled: false })).toThrow(
      expect.objectContaining({ code: 'LOYALTY_DISABLED' }),
    );
  });

  it('offers the most the balance covers, but nothing below the minimum', () => {
    expect(redeemableAmount(1_000_00, 120, program)).toBe(120_00);
    expect(redeemableAmount(80_50, 120, program)).toBe(80_00);
    expect(redeemableAmount(40_00, 120, program)).toBe(0);
    expect(redeemableAmount(1_000_00, 30, program)).toBe(0);
    expect(redeemableAmount(1_000_00, 120, { ...program, enabled: false })).toBe(0);
  });
});
