import { describe, expect, it } from 'vitest';
import { boostedPoints, nextTier, tierReached, type MembershipTier } from './membership';

const tier = (
  id: string,
  minSpend: number,
  minVisits: number,
  more: Partial<MembershipTier> = {},
): MembershipTier => ({
  id,
  name: id,
  minSpend,
  minVisits,
  pointsMultiplierBp: 10_000,
  discountBp: 0,
  isActive: true,
  ...more,
});
const silver = tier('Silver', 5_000_00, 0);
const gold = tier('Gold', 20_000_00, 10, { pointsMultiplierBp: 15_000 });
const platinum = tier('Platinum', 50_000_00, 20, { isActive: false });
const tiers = [gold, platinum, silver];

describe('membership tiers', () => {
  it('gives the highest active tier whose spend and visits are both reached', () => {
    expect(tierReached(tiers, { lifetimeValue: 4_999_99, visitCount: 50 })).toBeNull();
    expect(tierReached(tiers, { lifetimeValue: 25_000_00, visitCount: 9 })).toBe(silver);
    expect(tierReached(tiers, { lifetimeValue: 25_000_00, visitCount: 10 })).toBe(gold);
    // Platinum is switched off.
    expect(tierReached(tiers, { lifetimeValue: 90_000_00, visitCount: 90 })).toBe(gold);
  });

  it('says what the next tier still needs', () => {
    expect(nextTier(tiers, null, { lifetimeValue: 1_000_00, visitCount: 1 })).toEqual({
      tier: silver,
      spendNeeded: 4_000_00,
      visitsNeeded: 0,
    });
    expect(nextTier(tiers, silver, { lifetimeValue: 25_000_00, visitCount: 7 })).toEqual({
      tier: gold,
      spendNeeded: 0,
      visitsNeeded: 3,
    });
    expect(nextTier(tiers, gold, { lifetimeValue: 25_000_00, visitCount: 12 })).toBeNull();
  });

  it('multiplies points, rounding down', () => {
    expect(boostedPoints(5, gold)).toBe(7);
    expect(boostedPoints(5, null)).toBe(5);
    expect(boostedPoints(0, gold)).toBe(0);
  });
});
