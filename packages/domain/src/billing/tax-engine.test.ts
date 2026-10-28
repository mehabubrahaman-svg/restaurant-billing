import { describe, expect, it } from 'vitest';
import { computeBill, type BillInput, type BillLineInput, type TaxGroupSpec } from './tax-engine';

const gst = (rateBp: number, isInclusive = false): TaxGroupSpec => ({
  id: `gst${rateBp}${isInclusive ? 'i' : ''}`,
  taxType: 'GST',
  isInclusive,
  invoiceSeries: 'INV',
  components: [
    { code: 'CGST', rateBp: rateBp / 2, appliesTo: 'INTRA_STATE' },
    { code: 'SGST', rateBp: rateBp / 2, appliesTo: 'INTRA_STATE' },
    { code: 'IGST', rateBp, appliesTo: 'INTER_STATE' },
  ],
});
const liquorVat: TaxGroupSpec = {
  id: 'vat20',
  taxType: 'VAT',
  isInclusive: false,
  invoiceSeries: 'LIQ',
  components: [
    { code: 'VAT', rateBp: 2000, appliesTo: 'ALWAYS' },
    { code: 'SURCHARGE', rateBp: 100, appliesTo: 'ALWAYS' },
  ],
};
const line = (
  description: string,
  unitPrice: number,
  quantity: number,
  taxGroup: TaxGroupSpec | null = gst(500),
): BillLineInput => ({
  orderItemId: description,
  description,
  hsnSacCode: '996331',
  quantity,
  unitPrice,
  taxGroup,
});
const base: BillInput = {
  lines: [line('Chicken Biryani (Full) + Raita', 36000, 2), line('Butter Naan', 6000, 4)],
  charges: [],
  discounts: [],
  supply: 'INTRA_STATE',
  gstPaidByOperator: false,
  cashRounding: 100,
  separateLiquor: true,
};
const serviceCharge = {
  chargeRuleId: 'sc',
  name: 'Service charge',
  kind: 'PERCENT' as const,
  value: 500,
  taxGroup: gst(500),
};
const pct = (bp: number) => ({
  kind: 'PERCENT' as const,
  value: bp,
  valueIsPercent: true,
  cap: null,
  couponCode: null,
  reason: 'Regular',
});

describe('computeBill', () => {
  it('taxes each line at 2.5% CGST + 2.5% SGST and totals them (hand-computed)', () => {
    const [bill] = computeBill(base);
    expect(bill!.lines.map((l) => [l.taxableValue, l.taxAmount, l.lineTotal, l.taxRateBp])).toEqual(
      [
        [72000, 3600, 75600, 500],
        [24000, 1200, 25200, 500],
      ],
    );
    expect(bill!.taxes).toEqual([
      { code: 'CGST', rateBp: 250, taxableValue: 96000, taxAmount: 2400 },
      { code: 'SGST', rateBp: 250, taxableValue: 96000, taxAmount: 2400 },
    ]);
    expect(bill).toMatchObject({
      subtotal: 96000,
      taxTotal: 4800,
      roundOff: 0,
      grandTotal: 100800,
    });
  });

  it('spreads a 10% discount over the lines before tax and rounds to the rupee', () => {
    const [bill] = computeBill({ ...base, discounts: [pct(1000)] });
    expect(bill!.lines.map((l) => [l.discount, l.taxableValue, l.taxAmount])).toEqual([
      [7200, 64800, 3240],
      [2400, 21600, 1080],
    ]);
    // 864.00 + 43.20 = 907.20 → 907.00
    expect(bill).toMatchObject({
      discountTotal: 9600,
      taxableTotal: 86400,
      taxTotal: 4320,
      roundOff: -20,
      grandTotal: 90700,
    });
    expect(bill!.discounts).toEqual([
      { kind: 'PERCENT', value: 1000, amount: 9600, couponCode: null, reason: 'Regular' },
    ]);
  });

  it('adds a taxed service charge on the value after discount', () => {
    const [bill] = computeBill({ ...base, discounts: [pct(1000)], charges: [serviceCharge] });
    // 5% of 864.00 = 43.20, GST on it 2.16; 864 + 43.20 + 43.20 + 2.16 = 952.56 → 953
    expect(bill!.charges).toEqual([
      expect.objectContaining({ name: 'Service charge', amount: 4320, taxAmount: 216 }),
    ]);
    expect(bill!.taxes[0]).toEqual({
      code: 'CGST',
      rateBp: 250,
      taxableValue: 90720,
      taxAmount: 2268,
    });
    expect(bill).toMatchObject({
      chargesTotal: 4320,
      taxableTotal: 90720,
      taxTotal: 4536,
      roundOff: 44,
      grandTotal: 95300,
    });
  });

  it('puts liquor on its own VAT invoice when the branch bills it separately', () => {
    const input = {
      ...base,
      lines: [...base.lines, line('Whisky 60 ml', 35000, 2, liquorVat)],
      charges: [serviceCharge],
    };
    const [food, liquor] = computeBill(input);
    expect(food!.series).toBe('INV');
    expect(food!.charges).toHaveLength(1); // service charge stays on the food bill
    expect(liquor).toMatchObject({
      series: 'LIQ',
      subtotal: 70000,
      taxTotal: 14700,
      grandTotal: 84700,
      charges: [],
    });
    expect(liquor!.taxes).toEqual([
      { code: 'VAT', rateBp: 2000, taxableValue: 70000, taxAmount: 14000 },
      { code: 'SURCHARGE', rateBp: 100, taxableValue: 70000, taxAmount: 700 },
    ]);

    const [single, ...none] = computeBill({ ...input, separateLiquor: false });
    expect(none).toHaveLength(0);
    expect(single!.taxes.map((t) => t.code)).toEqual(['CGST', 'SGST', 'VAT', 'SURCHARGE']);
  });

  it('extracts tax from inclusive prices; the components always add back to the price', () => {
    const [even] = computeBill({ ...base, lines: [line('Thali', 10500, 1, gst(500, true))] });
    expect(even!.lines[0]).toMatchObject({ taxableValue: 10000, taxAmount: 500, lineTotal: 10500 });
    const [odd] = computeBill({
      ...base,
      cashRounding: 1,
      lines: [line('Combo', 9900, 1, gst(500, true))],
    });
    // 99.00 / 1.05 = 94.2857 → 94.29; CGST 2.36 + SGST 2.35 = 4.71
    expect(odd!.lines[0]!.taxes.map((t) => t.amount)).toEqual([236, 235]);
    expect(odd).toMatchObject({ taxableTotal: 9429, taxTotal: 471, grandTotal: 9900 });
  });

  it('charges IGST for inter-state supply and no GST when the aggregator pays it', () => {
    const [inter] = computeBill({ ...base, supply: 'INTER_STATE' });
    expect(inter!.taxes).toEqual([
      { code: 'IGST', rateBp: 500, taxableValue: 96000, taxAmount: 4800 },
    ]);
    const [swiggy] = computeBill({ ...base, gstPaidByOperator: true });
    expect(swiggy).toMatchObject({ taxTotal: 0, grandTotal: 96000, taxes: [] });
  });

  it('caps a coupon, stacks it after a discount, and makes a complimentary bill zero', () => {
    const coupon = {
      kind: 'COUPON' as const,
      value: 2000,
      valueIsPercent: true,
      cap: 10000,
      couponCode: 'WELCOME20',
      reason: null,
    };
    const [bill] = computeBill({ ...base, discounts: [pct(1000), coupon] });
    // 10% of 960 = 96; 20% of the remaining 864 = 172.80, capped at 100
    expect(bill!.discounts.map((d) => d.amount)).toEqual([9600, 10000]);
    expect(bill!.discountTotal).toBe(19600);

    const comp = {
      kind: 'COMPLIMENTARY' as const,
      value: 0,
      valueIsPercent: false,
      cap: null,
      couponCode: null,
      reason: 'Owner guest',
    };
    const [free] = computeBill({ ...base, charges: [serviceCharge], discounts: [comp] });
    expect(free).toMatchObject({
      discountTotal: 96000,
      taxTotal: 0,
      chargesTotal: 0,
      grandTotal: 0,
    });
  });

  it('never loses a paisa when spreading a discount', () => {
    const [bill] = computeBill({
      ...base,
      cashRounding: 1,
      lines: [line('A', 10000, 1), line('B', 10000, 1), line('C', 10000, 1)],
      discounts: [
        {
          kind: 'FIXED',
          value: 100,
          valueIsPercent: false,
          cap: null,
          couponCode: null,
          reason: null,
        },
      ],
    });
    expect(bill!.lines.map((l) => l.discount)).toEqual([34, 33, 33]);
    expect(bill!.discountTotal).toBe(100);
  });
});
