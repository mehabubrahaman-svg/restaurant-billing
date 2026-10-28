import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Quantity } from './quantity';
import { DomainError } from './result';

describe('Quantity', () => {
  it('parses base-unit amounts into milli-units', () => {
    expect(Quantity.of('200', 'g').milli).toBe(200_000);
    expect(Quantity.of('1.5', 'pc').milli).toBe(1_500);
    expect(Quantity.of('0.125', 'ml').milli).toBe(125);
  });

  it('formats without trailing zeros', () => {
    expect(Quantity.of('200', 'g').toString()).toBe('200 g');
    expect(Quantity.of('1.50', 'pc').toString()).toBe('1.5 pc');
    expect(Quantity.ofMilli(-125, 'ml').toString()).toBe('-0.125 ml');
  });

  it('refuses to mix units', () => {
    expect(() => Quantity.of('1', 'g').add(Quantity.of('1', 'ml'))).toThrow(DomainError);
  });

  it('scales a recipe: 150 g chicken per 1 portion × 3 portions', () => {
    expect(Quantity.of('150', 'g').scale(3, 1).toString()).toBe('450 g');
  });

  it('scales a batch recipe: 1 kg rice yields 5 portions, sold 2', () => {
    expect(Quantity.of('1000', 'g').scale(2, 5).toString()).toBe('400 g');
  });

  it('subtracting what was added returns the original', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.integer({ min: -1e12, max: 1e12 }),
        (a, b) => {
          const qa = Quantity.ofMilli(a, 'g');
          const qb = Quantity.ofMilli(b, 'g');
          return qa.add(qb).subtract(qb).equals(qa);
        },
      ),
    );
  });
});
