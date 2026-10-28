import { describe, expect, it } from 'vitest';
import {
  allocateFefo,
  consumptionFor,
  costPerBase,
  stockLevel,
  stockValue,
  weightedAverageCost,
} from './stock';

describe('stock arithmetic', () => {
  it('values stock in paise from milli-units and a cost per 1000 base units', () => {
    // 2.5 kg of rice at ₹80/kg = ₹200
    expect(stockValue(2_500_000, 8_000)).toBe(20_000);
    // 7 eggs at ₹6 each (₹6000 per 1000 pc) = ₹42
    expect(stockValue(7_000, 600_000)).toBe(4_200);
    // A 25 kg bag for ₹2,000 costs ₹80/kg
    expect(costPerBase(200_000, 25_000_000)).toBe(8_000);
  });

  it('averages the cost over what is on hand, ignoring negative stock', () => {
    // 10 kg at ₹80 + 10 kg at ₹100 = ₹90/kg
    expect(weightedAverageCost(10_000_000, 8_000, 10_000_000, 10_000)).toBe(9_000);
    // Sold 2 kg before any was received: the new receipt sets the cost.
    expect(weightedAverageCost(-2_000_000, 8_000, 5_000_000, 10_000)).toBe(10_000);
  });

  it('scales a recipe to portions sold, with trim loss and add-ons', () => {
    // A batch of 4 biryani portions: 1 kg chicken (10% trim), 600 g rice
    const recipe = {
      yieldPortions: 4,
      lines: [
        { inventoryItemId: 'chicken', qtyMilli: 1_000_000, wastageBp: 1_000 },
        { inventoryItemId: 'rice', qtyMilli: 600_000, wastageBp: 0 },
      ],
    };
    // 2 portions, each with 2 × raita (100 g curd each)
    const raita = { quantity: 2, lines: [{ inventoryItemId: 'curd', qtyMilli: 100_000 }] };
    expect(consumptionFor(2, recipe, [raita])).toEqual([
      { inventoryItemId: 'chicken', qtyMilli: 550_000 }, // 1000 g × 1.1 × 2 / 4
      { inventoryItemId: 'rice', qtyMilli: 300_000 },
      { inventoryItemId: 'curd', qtyMilli: 400_000 },
    ]);
    // An add-on that uses an ingredient the dish also uses is summed.
    const extraRice = { quantity: 1, lines: [{ inventoryItemId: 'rice', qtyMilli: 50_000 }] };
    expect(
      consumptionFor(1, recipe, [extraRice]).find((l) => l.inventoryItemId === 'rice'),
    ).toEqual({
      inventoryItemId: 'rice',
      qtyMilli: 200_000,
    });
    // No recipe: nothing is taken.
    expect(consumptionFor(3, null)).toEqual([]);
  });

  it('takes the batch that expires first, and lets stock go short rather than block a sale', () => {
    const batches = [
      { id: 'b-late', expiresOn: '2026-11-05', remainingMilli: 5_000, createdAt: '2026-10-20' },
      { id: 'b-undated', expiresOn: null, remainingMilli: 9_000, createdAt: '2026-10-01' },
      { id: 'b-soon', expiresOn: '2026-10-30', remainingMilli: 3_000, createdAt: '2026-10-25' },
    ];
    expect(allocateFefo(batches, 6_000)).toEqual({
      takes: [
        { batchId: 'b-soon', qtyMilli: 3_000 },
        { batchId: 'b-late', qtyMilli: 3_000 },
      ],
      unbatched: 0,
    });
    expect(allocateFefo(batches, 20_000).unbatched).toBe(3_000);
  });

  it('flags out, low and over stock', () => {
    expect(stockLevel(0, 1_000, null)).toBe('OUT');
    expect(stockLevel(-5, 0, null)).toBe('OUT');
    expect(stockLevel(1_000, 1_000, 10_000)).toBe('LOW');
    expect(stockLevel(5_000, 1_000, 10_000)).toBe('OK');
    expect(stockLevel(12_000, 1_000, 10_000)).toBe('OVER');
  });
});
