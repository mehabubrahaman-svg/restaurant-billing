import { DomainError } from '../shared/result';

/** A branch's loyalty program (settings loyalty.*). */
export interface LoyaltyProgram {
  readonly enabled: boolean;
  /** Points earned per ₹100 paid (whole rupees only; 1 = 1 point per ₹100). */
  readonly earnPer100: number;
  /** What one point is worth when spent, in paise. */
  readonly pointValue: number;
  /** The fewest points a guest may spend at once. */
  readonly minRedeem: number;
}

/** Points for a paid amount: whole ₹100s only, so ₹199 earns as ₹100. */
export function pointsEarned(paidPaise: number, program: LoyaltyProgram): number {
  if (!program.enabled || paidPaise <= 0) return 0;
  return Math.floor(paidPaise / 10_000) * program.earnPer100;
}

/**
 * The points a loyalty payment of `amount` paise uses. The amount must be a
 * whole number of points, at least the minimum, and within the balance.
 */
export function pointsToRedeem(amount: number, balance: number, program: LoyaltyProgram): number {
  if (!program.enabled) throw new DomainError('LOYALTY_DISABLED', 'loyalty points are off');
  if (amount <= 0 || amount % program.pointValue !== 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `points are spent in steps of ${program.pointValue} paise`,
    );
  }
  const points = amount / program.pointValue;
  if (points < program.minRedeem) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `at least ${program.minRedeem} points are spent at a time`,
    );
  }
  if (points > balance) {
    throw new DomainError('LOYALTY_INSUFFICIENT', `the guest has ${balance} points`);
  }
  return points;
}

/** The most a guest can pay with points towards `due` paise. 0 when below the minimum. */
export function redeemableAmount(due: number, balance: number, program: LoyaltyProgram): number {
  if (!program.enabled || program.pointValue <= 0) return 0;
  const points = Math.min(balance, Math.floor(due / program.pointValue));
  return points >= program.minRedeem ? points * program.pointValue : 0;
}
