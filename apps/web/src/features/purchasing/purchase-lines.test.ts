import { describe, expect, it } from 'vitest';
import { dueLines } from '../../portals/purchase/grn-editor-page';
import {
  eggs,
  makeItem,
  makePurchaseOrder,
  PO_LINE_RICE,
  UNITS,
} from '../../test/purchasing-fixtures';
import {
  defaultUnitId,
  emptyLine,
  liveTotals,
  rowsToBody,
  unitsFor,
  type LineRow,
} from './purchase-lines';

const rice = makeItem();
const row = (patch: Partial<LineRow>): LineRow => ({ ...emptyLine(), ...patch });

describe('purchase lines', () => {
  it('offers only units that measure the item’s base unit, starting with its purchase unit', () => {
    expect(unitsFor(rice, UNITS).map((u) => u.code)).toEqual(['kg', 'g']);
    expect(unitsFor(eggs, UNITS).map((u) => u.code)).toEqual(['tray', 'dozen', 'pc']);
    expect(defaultUnitId(rice, UNITS)).toBe('unit-kg');
    expect(defaultUnitId(makeItem({ purchaseUnitId: null }), UNITS)).toBe('unit-g');
    // A purchase unit of another kind is ignored.
    expect(defaultUnitId(makeItem({ purchaseUnitId: 'unit-dozen' }), UNITS)).toBe('unit-g');
  });

  it('totals as the Hub does: GRN lines on what was accepted', () => {
    const lines = [
      row({
        inventoryItemId: rice.id,
        unitId: 'unit-kg',
        quantity: '25',
        price: '90',
        taxRateBp: 500,
      }),
      row({ inventoryItemId: eggs.id, unitId: 'unit-dozen', quantity: '10', price: '78.50' }),
      row({ quantity: 'abc', price: '1' }),
    ];
    expect(liveTotals(lines, 'PO')).toEqual({
      subtotal: 303_500,
      taxTotal: 11_250,
      grandTotal: 314_750,
    });
    const received = [{ ...lines[1]!, rejected: '1' }];
    expect(liveTotals(received, 'GRN')).toEqual({
      subtotal: 70_650,
      taxTotal: 0,
      grandTotal: 70_650,
    });
    expect(liveTotals(received, 'PO').subtotal).toBe(78_500);
  });

  it('turns rows into request lines, or says what is wrong with each', () => {
    const good = row({
      inventoryItemId: rice.id,
      unitId: 'unit-kg',
      quantity: '2.5',
      price: '90',
      taxRateBp: 500,
      rejected: '0.5',
      batchNo: ' B-1 ',
      expiresOn: '2027-04-30',
    });
    expect(rowsToBody([good], 'GRN', [rice, eggs], UNITS)).toEqual({
      ok: true,
      lines: [
        {
          purchaseOrderLineId: null,
          inventoryItemId: rice.id,
          unitId: 'unit-kg',
          quantityMilli: 2_500,
          rejectedQtyMilli: 500,
          unitPrice: 9_000,
          taxRateBp: 500,
          batchNo: 'B-1',
          expiresOn: '2027-04-30',
        },
      ],
    });
    const wrongUnit = row({
      inventoryItemId: rice.id,
      unitId: 'unit-dozen',
      quantity: '0',
      price: '',
    });
    const tooMuch = { ...good, rejected: '3', expiresOn: '2027-02-30' };
    const result = rowsToBody([wrongUnit, tooMuch], 'GRN', [rice, eggs], UNITS);
    expect(result).toEqual({
      ok: false,
      errors: {
        [wrongUnit.key]: {
          unit: 'purchase.lines.errors.unit',
          quantity: 'purchase.lines.errors.quantity',
          price: 'purchase.lines.errors.price',
        },
        [tooMuch.key]: {
          rejected: 'purchase.lines.errors.rejected',
          expiresOn: 'purchase.lines.errors.expiresOn',
        },
      },
    });
  });

  it('receives against an order only what is still due on each line', () => {
    const rows = dueLines(makePurchaseOrder());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purchaseOrderLineId: PO_LINE_RICE,
      unitId: 'unit-kg',
      quantity: '5',
      price: '90.00',
      taxRateBp: 500,
      rejected: '',
    });
  });
});
