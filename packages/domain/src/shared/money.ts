import type { Rate } from './rate';
import { invariant } from './result';
import { divideRounded, toSafeNumber, type RoundingMode } from './rounding';

const BP_SCALE = 10_000n;

/**
 * An amount of Indian Rupees as an integer number of paise. Immutable.
 * Arithmetic that can exceed 2^53 is done in bigint and checked on the way out.
 */
export class Money {
  private constructor(readonly paise: number) {}

  static readonly ZERO = new Money(0);

  static ofPaise(paise: number): Money {
    invariant(
      Number.isSafeInteger(paise),
      'MONEY_INVALID',
      `paise must be a safe integer: ${paise}`,
    );
    return new Money(paise);
  }

  /** Parses "249.5", "249.50", "-12" or "1,00,000.00". At most two decimals. */
  static ofRupees(rupees: string): Money {
    const cleaned = rupees.trim().replaceAll(',', '');
    const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
    invariant(match !== null, 'MONEY_INVALID', `invalid rupee amount: "${rupees}"`);
    const paise = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
    return Money.ofPaise(toSafeNumber(match[1] ? -paise : paise, 'amount'));
  }

  add(other: Money): Money {
    return Money.ofPaise(this.paise + other.paise);
  }

  subtract(other: Money): Money {
    return Money.ofPaise(this.paise - other.paise);
  }

  multiply(factor: number): Money {
    invariant(
      Number.isSafeInteger(factor),
      'MONEY_INVALID',
      `factor must be an integer: ${factor}`,
    );
    return Money.ofPaise(toSafeNumber(BigInt(this.paise) * BigInt(factor), 'amount'));
  }

  negate(): Money {
    return Money.ofPaise(-this.paise);
  }

  /** `this × rate`, e.g. the GST on a taxable value. Banker's rounding by default. */
  percentage(rate: Rate, mode: RoundingMode = 'HALF_EVEN'): Money {
    const value = divideRounded(BigInt(this.paise) * BigInt(rate.basisPoints), BP_SCALE, mode);
    return Money.ofPaise(toSafeNumber(value, 'amount'));
  }

  /**
   * Treats `this` as a tax-inclusive amount and returns the taxable value:
   * gross × 10000 / (10000 + rate). The tax is then `gross − taxable`, so the
   * two always add back up to the gross exactly.
   */
  extractTaxable(totalRate: Rate, mode: RoundingMode = 'HALF_EVEN'): Money {
    const value = divideRounded(
      BigInt(this.paise) * BP_SCALE,
      BP_SCALE + BigInt(totalRate.basisPoints),
      mode,
    );
    return Money.ofPaise(toSafeNumber(value, 'amount'));
  }

  /** Rounds to a multiple of `incrementPaise` (cash rounding: 100 = nearest rupee). */
  roundTo(incrementPaise: number, mode: RoundingMode = 'HALF_UP'): Money {
    invariant(
      Number.isSafeInteger(incrementPaise) && incrementPaise > 0,
      'MONEY_INVALID',
      `rounding increment must be a positive integer: ${incrementPaise}`,
    );
    const units = divideRounded(BigInt(this.paise), BigInt(incrementPaise), mode);
    return Money.ofPaise(toSafeNumber(units * BigInt(incrementPaise), 'amount'));
  }

  /**
   * Splits this amount in proportion to `weights` without losing a paisa:
   * the parts always sum to the original. Leftover paise go to the parts with
   * the largest remainders (ties: earliest first). Used to spread a bill-level
   * discount across lines before computing line tax.
   */
  allocate(weights: readonly number[]): Money[] {
    invariant(weights.length > 0, 'MONEY_INVALID', 'allocate needs at least one weight');
    invariant(
      weights.every((w) => Number.isSafeInteger(w) && w >= 0),
      'MONEY_INVALID',
      'weights must be non-negative integers',
    );
    const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
    if (total === 0n) {
      // Nothing to weigh by: split evenly.
      return this.allocate(weights.map(() => 1));
    }
    const amount = BigInt(this.paise);
    const sign = amount < 0n ? -1n : 1n;
    const absolute = amount * sign;
    const parts = weights.map((w) => (absolute * BigInt(w)) / total);
    const remainders = weights.map((w, i) => ({ i, r: (absolute * BigInt(w)) % total }));
    let leftover = absolute - parts.reduce((s, p) => s + p, 0n);
    remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
    for (const { i } of remainders) {
      if (leftover === 0n) break;
      parts[i]! += 1n;
      leftover -= 1n;
    }
    return parts.map((p) => Money.ofPaise(toSafeNumber(p * sign, 'amount')));
  }

  isZero(): boolean {
    return this.paise === 0;
  }

  isNegative(): boolean {
    return this.paise < 0;
  }

  compare(other: Money): -1 | 0 | 1 {
    return this.paise < other.paise ? -1 : this.paise > other.paise ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }

  /** "249.50", "-12.05". Display formatting (₹, grouping, locale digits) is the UI's job. */
  toDecimalString(): string {
    const sign = this.paise < 0 ? '-' : '';
    const abs = Math.abs(this.paise);
    return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }

  static sum(amounts: Iterable<Money>): Money {
    let total = Money.ZERO;
    for (const a of amounts) total = total.add(a);
    return total;
  }
}
