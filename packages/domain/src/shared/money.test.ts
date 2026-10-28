import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money } from './money';
import { Rate } from './rate';
import { DomainError } from './result';

const money = fc.integer({ min: -1_000_000_000_00, max: 1_000_000_000_00 }).map(Money.ofPaise);

describe('Money', () => {
  it('parses rupee strings', () => {
    expect(Money.ofRupees('249.50').paise).toBe(24950);
    expect(Money.ofRupees('249.5').paise).toBe(24950);
    expect(Money.ofRupees('1,00,000').paise).toBe(10_000_000);
    expect(Money.ofRupees('-12.05').paise).toBe(-1205);
    expect(Money.ofRupees('0').paise).toBe(0);
  });

  it.each(['12.345', 'abc', '', '1.2.3', '₹10'])('rejects "%s"', (input) => {
    expect(() => Money.ofRupees(input)).toThrow(DomainError);
  });

  it('rejects non-integer paise', () => {
    expect(() => Money.ofPaise(1.5)).toThrow(DomainError);
  });

  it('formats as a decimal string', () => {
    expect(Money.ofPaise(24950).toDecimalString()).toBe('249.50');
    expect(Money.ofPaise(-1205).toDecimalString()).toBe('-12.05');
    expect(Money.ofPaise(7).toDecimalString()).toBe('0.07');
  });

  it('round-trips through the decimal string', () => {
    fc.assert(fc.property(money, (m) => Money.ofRupees(m.toDecimalString()).equals(m)));
  });

  it('adds associatively and commutatively', () => {
    fc.assert(
      fc.property(money, money, money, (a, b, c) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true);
        expect(a.add(b).subtract(b).equals(a)).toBe(true);
      }),
    );
  });

  describe('percentage (GST on a taxable value)', () => {
    it('computes 2.5% CGST with banker’s rounding', () => {
      // 2.5% of ₹101.00 = ₹2.525 → ₹2.52 (half to even)
      expect(Money.ofRupees('101').percentage(Rate.ofPercent('2.5')).paise).toBe(252);
      // 2.5% of ₹103.00 = ₹2.575 → ₹2.58
      expect(Money.ofRupees('103').percentage(Rate.ofPercent('2.5')).paise).toBe(258);
    });

    it('can use half-up when a state rule requires it', () => {
      expect(Money.ofRupees('101').percentage(Rate.ofPercent('2.5'), 'HALF_UP').paise).toBe(253);
    });

    it('does not overflow on large amounts', () => {
      const big = Money.ofPaise(900_000_000_000_000); // ₹9 lakh crore
      expect(big.percentage(Rate.ofPercent('18')).paise).toBe(162_000_000_000_000);
    });
  });

  describe('extractTaxable (tax-inclusive prices)', () => {
    it('backs out 5% GST from an inclusive ₹105', () => {
      const gross = Money.ofRupees('105');
      const taxable = gross.extractTaxable(Rate.ofPercent('5'));
      expect(taxable.paise).toBe(10000);
      expect(gross.subtract(taxable).paise).toBe(500);
    });

    it('taxable + tax recomputed from taxable is within one paisa of the gross', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100_000_000 }),
          fc.integer({ min: 0, max: 4000 }),
          (paise, bp) => {
            const gross = Money.ofPaise(paise);
            const rate = Rate.ofBasisPoints(bp);
            const taxable = gross.extractTaxable(rate);
            const recomputed = taxable.add(taxable.percentage(rate));
            return Math.abs(recomputed.paise - gross.paise) <= 1;
          },
        ),
      );
    });
  });

  describe('roundTo (cash rounding)', () => {
    it('rounds to the nearest rupee, half up', () => {
      expect(Money.ofRupees('2078.49').roundTo(100).paise).toBe(207800);
      expect(Money.ofRupees('2078.50').roundTo(100).paise).toBe(207900);
      expect(Money.ofRupees('-2078.50').roundTo(100).paise).toBe(-207900);
    });

    it('supports other increments', () => {
      expect(Money.ofRupees('10.26').roundTo(50).paise).toBe(1050);
      expect(Money.ofRupees('10.24').roundTo(50).paise).toBe(1000);
    });

    it('rejects a non-positive increment', () => {
      expect(() => Money.ofPaise(100).roundTo(0)).toThrow(DomainError);
    });
  });

  describe('allocate', () => {
    it('splits ₹100 three ways without losing a paisa', () => {
      const parts = Money.ofRupees('100')
        .allocate([1, 1, 1])
        .map((m) => m.paise);
      expect(parts).toEqual([3334, 3333, 3333]);
    });

    it('splits a discount proportionally to line totals', () => {
      const parts = Money.ofRupees('220')
        .allocate([64000, 8000, 24000])
        .map((m) => m.paise);
      expect(parts).toEqual([14667, 1833, 5500]);
    });

    it('splits evenly when all weights are zero', () => {
      expect(
        Money.ofPaise(5)
          .allocate([0, 0])
          .map((m) => m.paise),
      ).toEqual([3, 2]);
    });

    it('always sums to the original and stays within one paisa of the exact share', () => {
      fc.assert(
        fc.property(
          money,
          fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
          (m, weights) => {
            const parts = m.allocate(weights);
            expect(Money.sum(parts).equals(m)).toBe(true);
            const total = weights.reduce((a, b) => a + b, 0);
            if (total > 0) {
              parts.forEach((p, i) => {
                const exact = (m.paise * weights[i]!) / total;
                expect(Math.abs(p.paise - exact)).toBeLessThan(1);
              });
            }
          },
        ),
      );
    });
  });
});
