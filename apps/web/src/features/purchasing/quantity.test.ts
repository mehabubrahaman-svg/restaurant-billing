import { describe, expect, it } from 'vitest';
import { milliToQuantity, quantityToMilli } from './quantity';

describe('quantity ↔ milli-units', () => {
  it('parses without floats', () => {
    expect(quantityToMilli('2.5')).toBe(2_500);
    expect(quantityToMilli(' 25 ')).toBe(25_000);
    expect(quantityToMilli('0.125')).toBe(125);
    expect(quantityToMilli('1,000')).toBe(1_000_000);
    expect(quantityToMilli('0')).toBe(0);
    // 0.1 + 0.2 style float drift can't happen: 0.3 is exactly 300.
    expect(quantityToMilli('0.3')).toBe(300);
  });

  it('accepts Devanagari and Bengali digits', () => {
    expect(quantityToMilli('२.५')).toBe(2_500);
    expect(quantityToMilli('১২')).toBe(12_000);
  });

  it('rejects junk, negatives and more than three decimals', () => {
    for (const bad of ['', 'abc', '-1', '1.2345', '1e3', '2,5.0.1', '.5', '5.'])
      expect(quantityToMilli(bad), bad).toBeNull();
  });

  it('formats back', () => {
    expect(milliToQuantity(2_500)).toBe('2.5');
    expect(milliToQuantity(25_000)).toBe('25');
    expect(milliToQuantity(125)).toBe('0.125');
    expect(milliToQuantity(0)).toBe('0');
    expect(milliToQuantity(-1_500)).toBe('-1.5');
    expect(quantityToMilli(milliToQuantity(9_999_999))).toBe(9_999_999);
  });
});
