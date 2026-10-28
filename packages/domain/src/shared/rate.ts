import { invariant } from './result';

/** A percentage stored as integer basis points: 5% = 500, 2.5% = 250. */
export class Rate {
  private constructor(readonly basisPoints: number) {}

  static ofBasisPoints(basisPoints: number): Rate {
    invariant(Number.isSafeInteger(basisPoints), 'RATE_INVALID', `not an integer: ${basisPoints}`);
    invariant(basisPoints >= 0, 'RATE_NEGATIVE', `rate must not be negative: ${basisPoints}`);
    return new Rate(basisPoints);
  }

  /** Parses "5", "2.5" or "12.75" (at most two decimals). */
  static ofPercent(percent: string): Rate {
    const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(percent.trim());
    invariant(match !== null, 'RATE_INVALID', `invalid percentage: "${percent}"`);
    const whole = Number(match[1]);
    const fraction = Number((match[2] ?? '').padEnd(2, '0'));
    return Rate.ofBasisPoints(whole * 100 + fraction);
  }

  static readonly ZERO = new Rate(0);

  add(other: Rate): Rate {
    return new Rate(this.basisPoints + other.basisPoints);
  }

  isZero(): boolean {
    return this.basisPoints === 0;
  }

  equals(other: Rate): boolean {
    return this.basisPoints === other.basisPoints;
  }

  toPercentString(): string {
    const whole = Math.trunc(this.basisPoints / 100);
    const fraction = this.basisPoints % 100;
    return fraction === 0
      ? `${whole}`
      : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
  }
}
