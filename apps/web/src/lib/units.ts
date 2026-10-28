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

/** Devanagari (०-९) and Bengali (০-৯) digits → 0-9, for amounts typed on Indic keyboards. */
export function toLatinDigits(input: string): string {
  return input.replace(/[\u0966-\u096F\u09E6-\u09EF]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= 0x09e6 ? 0x09e6 : 0x0966));
  });
}

/**
 * "49.50" / "1,000" / "₹ 249.5" / "২৪৯.৫০" → paise, or null. Negative amounts
 * are rejected. Pure string parsing (Money.ofRupees): no floats.
 */
export function rupeesToPaise(input: string): number | null {
  try {
    const money = Money.ofRupees(toLatinDigits(input.trim()).replace(/^₹\s*/, ''));
    return money.isNegative() ? null : money.paise;
  } catch {
    return null;
  }
}

/** 4950 → "49.50". */
export function paiseToRupees(paise: number): string {
  return Money.ofPaise(paise).toDecimalString();
}
