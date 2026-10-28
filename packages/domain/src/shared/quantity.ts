import { invariant } from './result';
import { divideRounded, toSafeNumber, type RoundingMode } from './rounding';

/** Base units that inventory is counted in. Purchase units (kg, l, dozen) convert into these. */
export type BaseUnit = 'g' | 'ml' | 'pc';

const MILLI = 1000n;

/**
 * A stock quantity as integer milli-units of a base unit:
 * 200 g = 200_000 (g), 1.5 pc = 1_500 (pc). Immutable.
 */
export class Quantity {
  private constructor(
    readonly milli: number,
    readonly unit: BaseUnit,
  ) {}

  static ofMilli(milli: number, unit: BaseUnit): Quantity {
    invariant(
      Number.isSafeInteger(milli),
      'QUANTITY_INVALID',
      `milli must be a safe integer: ${milli}`,
    );
    return new Quantity(milli, unit);
  }

  static zero(unit: BaseUnit): Quantity {
    return new Quantity(0, unit);
  }

  /** Parses "200", "0.5" or "1.125" base units (at most three decimals). */
  static of(value: string, unit: BaseUnit): Quantity {
    const match = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    invariant(match !== null, 'QUANTITY_INVALID', `invalid quantity: "${value}"`);
    const milli = BigInt(match[2]!) * MILLI + BigInt((match[3] ?? '').padEnd(3, '0') || '0');
    return Quantity.ofMilli(toSafeNumber(match[1] ? -milli : milli, 'quantity'), unit);
  }

  add(other: Quantity): Quantity {
    this.assertSameUnit(other);
    return Quantity.ofMilli(this.milli + other.milli, this.unit);
  }

  subtract(other: Quantity): Quantity {
    this.assertSameUnit(other);
    return Quantity.ofMilli(this.milli - other.milli, this.unit);
  }

  negate(): Quantity {
    return Quantity.ofMilli(-this.milli, this.unit);
  }

  /**
   * `this × numerator ÷ denominator`, rounded. Used for recipe scaling:
   * ingredient per batch × portions sold ÷ portions per batch.
   */
  scale(numerator: number, denominator: number, mode: RoundingMode = 'HALF_EVEN'): Quantity {
    invariant(
      Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0,
      'QUANTITY_INVALID',
      `invalid scale ${numerator}/${denominator}`,
    );
    const value = divideRounded(BigInt(this.milli) * BigInt(numerator), BigInt(denominator), mode);
    return Quantity.ofMilli(toSafeNumber(value, 'quantity'), this.unit);
  }

  isNegative(): boolean {
    return this.milli < 0;
  }

  compare(other: Quantity): -1 | 0 | 1 {
    this.assertSameUnit(other);
    return this.milli < other.milli ? -1 : this.milli > other.milli ? 1 : 0;
  }

  equals(other: Quantity): boolean {
    return this.unit === other.unit && this.milli === other.milli;
  }

  /** "200 g", "1.5 pc". */
  toString(): string {
    const sign = this.milli < 0 ? '-' : '';
    const abs = Math.abs(this.milli);
    const fraction = String(abs % 1000)
      .padStart(3, '0')
      .replace(/0+$/, '');
    return `${sign}${Math.trunc(abs / 1000)}${fraction ? `.${fraction}` : ''} ${this.unit}`;
  }

  private assertSameUnit(other: Quantity): void {
    invariant(
      this.unit === other.unit,
      'QUANTITY_UNIT_MISMATCH',
      `cannot combine ${this.unit} with ${other.unit}`,
    );
  }
}
