import { describe, expect, it } from 'vitest';
import { CHICKEN, G, ITEMS, makeFullRecipe, RICE, UNITS } from '../../test/inventory-fixtures';
import { itemsById } from './inventory-queries';
import { knownUnits } from './quantity';
import { draftToLines, emptyRow, estimate, recipeToDraft } from './recipe-form';

const units = knownUnits(UNITS);

describe('recipe form', () => {
  it('estimates a portion the way the Hub costs it', () => {
    // 250 g rice at ₹86.67/kg + 200 g chicken with 10% trim at ₹243.33/kg = ₹75.20, 23.5% of ₹320.
    const draft = recipeToDraft(makeFullRecipe(), units);
    expect(draft.rows.map((r) => [r.qty.text, r.qty.unitId, r.trim])).toEqual([
      ['250', 'unit-g', ''],
      ['200', 'unit-g', '10'],
    ]);
    expect(estimate(draft, itemsById(ITEMS), units, 32_000)).toEqual({
      costPerPortion: 7_520,
      foodCostBp: 2_350,
    });
  });

  it('turns rows into ingredient lines in milli base units, whatever unit they were typed in', () => {
    const draft = recipeToDraft(makeFullRecipe(), units);
    const rows = [
      { ...draft.rows[0]!, qty: { text: '0.25', unitId: 'unit-kg' } },
      draft.rows[1]!,
      emptyRow(),
    ];
    expect(draftToLines({ yieldPortions: '1', rows }, units)).toEqual({
      ok: true,
      yieldPortions: 1,
      lines: [
        { inventoryItemId: RICE, qtyMilli: 250 * G, wastageBp: 0 },
        { inventoryItemId: CHICKEN, qtyMilli: 200 * G, wastageBp: 1_000 },
      ],
    });
  });

  it('refuses a repeated ingredient, junk quantities and a bad yield', () => {
    const draft = recipeToDraft(makeFullRecipe(), units);
    const [rice, chicken] = draft.rows;
    const result = draftToLines(
      {
        yieldPortions: '0',
        rows: [rice!, { ...chicken!, trim: '120.5.1' }, { ...rice!, key: 'again' }],
      },
      units,
    );
    expect(result).toEqual({
      ok: false,
      errors: { yieldPortions: true, rows: { [chicken!.key]: ['trim'], again: ['duplicate'] } },
    });
    expect(draftToLines({ yieldPortions: '1', rows: [emptyRow()] }, units)).toMatchObject({
      ok: false,
      errors: { empty: true },
    });
  });
});
