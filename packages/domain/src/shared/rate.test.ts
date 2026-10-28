import { describe, expect, it } from 'vitest';
import { Rate } from './rate';
import { DomainError } from './result';

describe('Rate', () => {
  it.each([
    ['5', 500],
    ['2.5', 250],
    ['12.75', 1275],
    ['0', 0],
    ['18.00', 1800],
  ])('parses %s%% as %i bp', (input, bp) => {
    expect(Rate.ofPercent(input).basisPoints).toBe(bp);
  });

  it.each(['-1', '2.555', 'x', ''])('rejects "%s"', (input) => {
    expect(() => Rate.ofPercent(input)).toThrow(DomainError);
  });

  it('formats back to a percentage', () => {
    expect(Rate.ofBasisPoints(250).toPercentString()).toBe('2.5');
    expect(Rate.ofBasisPoints(1205).toPercentString()).toBe('12.05');
    expect(Rate.ofBasisPoints(1800).toPercentString()).toBe('18');
  });

  it('adds CGST and SGST', () => {
    expect(Rate.ofPercent('2.5').add(Rate.ofPercent('2.5')).equals(Rate.ofPercent('5'))).toBe(true);
  });
});
