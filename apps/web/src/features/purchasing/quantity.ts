import { toLatinDigits } from '../../lib/units';

/** Purchase documents allow up to 10 000 units on one line (contracts `QuantityMilli`). */
export const MAX_LINE_MILLI = 10_000_000;

/**
 * "2.5" / "1,000" / "০.২৫" → milli-units (2_500 / 1_000_000 / 250), or null if
 * not a non-negative number with at most three decimals. Pure string parsing:
 * no floats. 2.5 kg is 2_500 milli-units of the kg unit on a PO or GRN line.
 */
export function quantityToMilli(input: string): number | null {
  const clean = toLatinDigits(input.trim()).replaceAll(',', '');
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(clean);
  if (match === null) return null;
  const whole = BigInt(match[1]!);
  const milli = whole * 1000n + BigInt((match[2] ?? '').padEnd(3, '0') || '0');
  return milli > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(milli);
}

/** 2_500 → "2.5", 1_000_000 → "1000": the editable text for a quantity. */
export function milliToQuantity(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const fraction = String(abs % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${Math.trunc(abs / 1000)}${fraction === '' ? '' : `.${fraction}`}`;
}
