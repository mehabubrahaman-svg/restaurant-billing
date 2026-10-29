/** A membership tier (Silver, Gold …): reached by lifetime spend and visits. */
export interface MembershipTier {
  readonly id: string;
  readonly name: string;
  /** Lifetime spend needed, in paise. */
  readonly minSpend: number;
  readonly minVisits: number;
  /** Loyalty points earned are multiplied by this (10000 = 1×, 15000 = 1.5×). */
  readonly pointsMultiplierBp: number;
  /** A discount on every bill, in basis points (0 = none). */
  readonly discountBp: number;
  readonly isActive: boolean;
}

/** Lowest first: by spend, then visits. */
export function rankTiers<T extends MembershipTier>(tiers: readonly T[]): T[] {
  return [...tiers].sort(
    (a, b) => a.minSpend - b.minSpend || a.minVisits - b.minVisits || a.name.localeCompare(b.name),
  );
}

/** The highest active tier whose spend and visits the guest has reached, if any. */
export function tierReached<T extends MembershipTier>(
  tiers: readonly T[],
  guest: { readonly lifetimeValue: number; readonly visitCount: number },
): T | null {
  let reached: T | null = null;
  for (const tier of rankTiers(tiers)) {
    if (tier.isActive && guest.lifetimeValue >= tier.minSpend && guest.visitCount >= tier.minVisits)
      reached = tier;
  }
  return reached;
}

/** The next active tier above `current`, and what the guest still needs for it. */
export function nextTier<T extends MembershipTier>(
  tiers: readonly T[],
  current: T | null,
  guest: { readonly lifetimeValue: number; readonly visitCount: number },
): { tier: T; spendNeeded: number; visitsNeeded: number } | null {
  const ranked = rankTiers(tiers).filter((t) => t.isActive);
  const above = current === null ? ranked : ranked.slice(ranked.indexOf(current) + 1);
  const tier = above.find(
    (t) => guest.lifetimeValue < t.minSpend || guest.visitCount < t.minVisits,
  );
  if (!tier) return null;
  return {
    tier,
    spendNeeded: Math.max(0, tier.minSpend - guest.lifetimeValue),
    visitsNeeded: Math.max(0, tier.minVisits - guest.visitCount),
  };
}

/** Points with the tier's multiplier, rounded down. */
export function boostedPoints(
  points: number,
  tier: Pick<MembershipTier, 'pointsMultiplierBp'> | null,
): number {
  if (tier === null || points <= 0) return points;
  return Math.floor((points * tier.pointsMultiplierBp) / 10_000);
}
