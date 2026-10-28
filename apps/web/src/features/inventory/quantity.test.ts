import type { Unit } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import {
  costUnitOf,
  knownUnits,
  parseQuantity,
  percentText,
  preferredUnit,
  quantityParts,
  quantityText,
  receiptUnitPrice,
  unitPrice,
  unitsFor,
} from './quantity';

const KG = 1_000_000;
const UNITS: Unit[] = [
  { id: 'unit-kg', code: 'kg', name: 'Kilogram', baseCode: 'g', toBaseMilli: KG },
  { id: 'unit-g', code: 'g', name: 'Gram', baseCode: 'g', toBaseMilli: 1000 },
  { id: 'unit-pc', code: 'pc', name: 'Piece', baseCode: 'pc', toBaseMilli: 1000 },
  { id: 'unit-dozen', code: 'dozen', name: 'Dozen', baseCode: 'pc', toBaseMilli: 12_000 },
];

describe('parseQuantity', () => {
  it('converts a typed amount in a unit to milli base units without floats', () => {
    expect(parseQuantity('2.5', KG)).toBe(2_500_000);
    expect(parseQuantity('0.125', KG)).toBe(125_000);
    expect(parseQuantity('.5', KG)).toBe(500_000);
    expect(parseQuantity('950', 1000)).toBe(950_000);
    expect(parseQuantity('1.5', 12_000)).toBe(18_000);
    expect(parseQuantity('1,250', 1000)).toBe(1_250_000);
    // 0.1 + 0.2 is not 0.30000000000000004 here.
    expect(parseQuantity('0.3', KG)).toBe(300_000);
  });

  it('reads Indic digits', () => {
    expect(parseQuantity('२.५', KG)).toBe(2_500_000);
    expect(parseQuantity('৩০', 1000)).toBe(30_000);
  });

  it('takes a sign only when asked to', () => {
    expect(parseQuantity('-1.5', KG)).toBeNull();
    expect(parseQuantity('-1.5', KG, { signed: true })).toBe(-1_500_000);
    expect(parseQuantity('−200', 1000, { signed: true })).toBe(-200_000);
    expect(parseQuantity('+2', 1000, { signed: true })).toBe(2000);
  });

  it('rejects junk, over-precise and oversized values', () => {
    for (const bad of ['', 'abc', '1.2345', '1e3', '2 kg', '1.2.3', '-', '.']) {
      expect(parseQuantity(bad, KG)).toBeNull();
    }
    expect(parseQuantity('10000', KG)).toBe(10_000_000_000);
    expect(parseQuantity('10000.001', KG)).toBeNull();
  });
});

describe('quantityText', () => {
  it('writes a quantity back in a unit, exactly', () => {
    expect(quantityText(2_500_000, KG)).toBe('2.5');
    expect(quantityText(-100_000, 1000)).toBe('-100');
    expect(quantityText(18_000, 12_000)).toBe('1.5');
    expect(quantityText(0, KG)).toBe('0');
  });

  it('says when a unit cannot hold it exactly', () => {
    expect(quantityText(1000, 12_000)).toBeNull();
    expect(quantityText(1, KG)).toBeNull();
  });
});

describe('quantityParts', () => {
  it('shows large weights and volumes in kg and l, small ones in g and ml', () => {
    expect(quantityParts(28_350_000, 'g')).toEqual({ value: '28.35', unit: 'kg' });
    expect(quantityParts(950_000, 'g')).toEqual({ value: '950', unit: 'g' });
    expect(quantityParts(1_000_000, 'ml')).toEqual({ value: '1', unit: 'l' });
    expect(quantityParts(-1_500_000, 'g')).toEqual({ value: '-1.5', unit: 'kg' });
    expect(quantityParts(2_500, 'g')).toEqual({ value: '2.5', unit: 'g' });
  });

  it('keeps pieces in pieces and rounds big weights to the gram', () => {
    expect(quantityParts(36_000_000, 'pc')).toEqual({ value: '36000', unit: 'pc' });
    expect(quantityParts(1_500, 'pc')).toEqual({ value: '1.5', unit: 'pc' });
    expect(quantityParts(28_350_500, 'g')).toEqual({ value: '28.35', unit: 'kg' });
    expect(quantityParts(28_351_500, 'g')).toEqual({ value: '28.352', unit: 'kg' });
  });
});

describe('units', () => {
  it('offers the units of the same kind, smallest first, with the purchase unit preferred', () => {
    expect(unitsFor('g', UNITS).map((u) => u.code)).toEqual(['g', 'kg']);
    expect(unitsFor('ml', UNITS).map((u) => u.id)).toEqual(['unit-ml']);
    expect(preferredUnit({ baseUnit: 'g', purchaseUnitId: 'unit-kg' }, UNITS).code).toBe('kg');
    expect(preferredUnit({ baseUnit: 'pc', purchaseUnitId: null }, UNITS).code).toBe('pc');
    // A purchase unit of another kind is ignored.
    expect(preferredUnit({ baseUnit: 'pc', purchaseUnitId: 'unit-kg' }, UNITS).code).toBe('pc');
  });

  it('always knows the three base units', () => {
    expect(knownUnits([]).map((u) => u.id)).toEqual(['unit-g', 'unit-ml', 'unit-pc']);
    expect(knownUnits(UNITS).map((u) => u.id)).toEqual([...UNITS.map((u) => u.id), 'unit-ml']);
  });

  it('prices per kg, per litre or per piece', () => {
    expect(costUnitOf('g')).toEqual({ unit: 'kg', toBaseMilli: KG });
    expect(costUnitOf('pc')).toEqual({ unit: 'pc', toBaseMilli: 1000 });
    // ₹86.67 a kg is 8_667 paise per 1000 g; eggs at ₹6 each are 600_000 per 1000 pieces.
    expect(unitPrice(8_667, KG)).toBe(8_667);
    expect(unitPrice(600_000, 1000)).toBe(600);
    expect(unitPrice(600_000, 12_000)).toBe(7_200);
  });

  it('writes basis points as a signed percentage', () => {
    expect(percentText(667)).toBe('6.67');
    expect(percentText(-250)).toBe('-2.5');
    expect(percentText(10_000)).toBe('100');
    expect(percentText(5)).toBe('0.05');
    expect(percentText(0)).toBe('0');
  });

  it('works out what a receipt line costs per unit', () => {
    // ₹250 for 2.5 kg = ₹100 a kg; ₹100 for 30 eggs = ₹3.33 each.
    expect(receiptUnitPrice(25_000, 2_500_000, KG)).toBe(10_000);
    expect(receiptUnitPrice(10_000, 30_000, 1000)).toBe(333);
  });
});
