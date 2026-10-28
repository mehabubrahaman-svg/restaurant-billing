import { describe, expect, it } from 'vitest';
import { creditNoteForAmount, creditNoteForLines } from './credit-note';
import type { InvoiceState } from './invoice';
import { computeBill, type TaxGroupSpec } from './tax-engine';

const gst5: TaxGroupSpec = {
  id: 'gst5',
  taxType: 'GST',
  isInclusive: false,
  invoiceSeries: 'INV',
  components: [
    { code: 'CGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
    { code: 'SGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
  ],
};

function issued(): InvoiceState['bill'] {
  const [bill] = computeBill({
    lines: [
      {
        orderItemId: 'a',
        description: 'Biryani',
        hsnSacCode: null,
        quantity: 2,
        unitPrice: 36000,
        taxGroup: gst5,
      },
      {
        orderItemId: 'b',
        description: 'Naan',
        hsnSacCode: null,
        quantity: 3,
        unitPrice: 6000,
        taxGroup: gst5,
      },
    ],
    charges: [
      { chargeRuleId: 'sc', name: 'Service charge', kind: 'PERCENT', value: 500, taxGroup: gst5 },
    ],
    discounts: [],
    supply: 'INTRA_STATE',
    gstPaidByOperator: false,
    cashRounding: 100,
    separateLiquor: false,
  });
  const { series: _s, ...rest } = bill!;
  return {
    ...rest,
    lines: rest.lines.map((l, i) => ({ ...l, id: `L${i + 1}`, originalLineId: null })),
  };
}

describe('credit notes', () => {
  it('refunds part of a line with its tax, without the service charge', () => {
    const cn = creditNoteForLines(issued(), [{ lineId: 'L2', quantity: 1 }], new Map(), false);
    expect(cn.lines).toEqual([
      expect.objectContaining({
        originalLineId: 'L2',
        quantity: 1,
        taxableValue: 6000,
        taxAmount: 300,
        lineTotal: 6300,
      }),
    ]);
    expect(cn).toMatchObject({ chargesTotal: 0, roundOff: 0, grandTotal: 6300 });
    expect(cn.taxes.map((t) => t.taxAmount)).toEqual([150, 150]);
  });

  it('refunding everything left returns exactly what was billed', () => {
    const bill = issued();
    const first = creditNoteForLines(bill, [{ lineId: 'L2', quantity: 1 }], new Map(), false);
    const rest = creditNoteForLines(
      bill,
      [
        { lineId: 'L1', quantity: 2 },
        { lineId: 'L2', quantity: 2 },
      ],
      new Map([['L2', 1]]),
      false,
    );
    expect(first.grandTotal + rest.grandTotal).toBe(bill.grandTotal);
    expect(() =>
      creditNoteForLines(bill, [{ lineId: 'L2', quantity: 3 }], new Map([['L2', 1]]), false),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('spreads a flat goodwill refund over the bill and reverses tax in proportion', () => {
    const bill = issued();
    const cn = creditNoteForAmount(bill, 10000, bill.grandTotal);
    expect(cn.grandTotal).toBe(10000);
    expect(cn.taxableTotal + cn.taxTotal).toBe(10000);
    // ₹100 / 1.05 ≈ ₹4.76 of tax overall; rounded per line and component (as on the invoice), 4.74.
    expect(cn.taxTotal).toBe(474);
    expect(() => creditNoteForAmount(bill, bill.grandTotal + 1, bill.grandTotal)).toThrow();
  });
});
