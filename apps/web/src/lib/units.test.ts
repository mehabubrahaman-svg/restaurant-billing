import { describe, expect, it } from 'vitest';
import { bpToPercent, paiseToRupees, percentToBp, rupeesToPaise } from './units';

describe('percent ↔ basis points', () => {
  it('parses without floats', () => {
    expect(percentToBp('5')).toBe(500);
    expect(percentToBp(' 2.5 ')).toBe(250);
    expect(percentToBp('12.75')).toBe(1275);
    expect(percentToBp('0.1')).toBe(10);
  });

  it('rejects junk and over-precise values', () => {
    for (const bad of ['', 'abc', '2.555', '-5', '5%', '1e2']) expect(percentToBp(bad)).toBeNull();
  });

  it('formats back', () => {
    expect(bpToPercent(500)).toBe('5');
    expect(bpToPercent(250)).toBe('2.5');
    expect(bpToPercent(1275)).toBe('12.75');
  });
});

describe('rupees ↔ paise', () => {
  it('round-trips', () => {
    expect(rupeesToPaise('49.5')).toBe(4950);
    expect(rupeesToPaise('1,000')).toBe(100000);
    expect(paiseToRupees(4950)).toBe('49.50');
  });

  it('accepts a rupee sign and Indic digits', () => {
    expect(rupeesToPaise('₹ 249.50')).toBe(24950);
    expect(rupeesToPaise('₹1,00,000')).toBe(10_000_000);
    expect(rupeesToPaise('२४९.५०')).toBe(24950);
    expect(rupeesToPaise('৩২০')).toBe(32000);
  });

  it('rejects negatives and junk', () => {
    expect(rupeesToPaise('-1')).toBeNull();
    expect(rupeesToPaise('1.234')).toBeNull();
    expect(rupeesToPaise('')).toBeNull();
  });
});
