import { Money, Rate } from '@restroos/domain';

/**
 * "5" / "2.5" / "12.75" → basis points (500 / 250 / 1275), or null if not a
 * percentage with at most two decimals. Pure string parsing: no floats.
 */
export function percentToBp(input: string): number | null {
  try {
    return Rate.ofPercent(input.trim()).basisPoints;
  } catch {
    return null;
  }
}

/** 250 → "2.5". */
export function bpToPercent(bp: number): string {
  return Rate.ofBasisPoints(bp).toPercentString();
}

/** "49.50" / "1,000" → paise, or null. Negative amounts are rejected. */
export function rupeesToPaise(input: string): number | null {
  try {
    const money = Money.ofRupees(input.trim());
    return money.isNegative() ? null : money.paise;
  } catch {
    return null;
  }
}

/** 4950 → "49.50". */
export function paiseToRupees(paise: number): string {
  return Money.ofPaise(paise).toDecimalString();
}
