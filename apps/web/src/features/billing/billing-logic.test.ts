import { describe, expect, it } from 'vitest';
import { exceedsLimit, NO_OPTIONS, toBillRequest } from './bill-options';
import { countedTotal, denominationRecord, EMPTY_COUNT } from './denominations';
import { allocatePayments, checkPad, newEntry, quickCash } from './payments';

describe('bill options', () => {
  it('builds the request, leaving empty parts out', () => {
    expect(toBillRequest(NO_OPTIONS)).toEqual({ removeChargeRuleIds: [] });
    expect(
      toBillRequest({
        ...NO_OPTIONS,
        discount: { kind: 'PERCENT', value: 1500, reason: ' Regular ' },
        couponCode: 'WELCOME10',
        customer: { name: '', phone: '', taxId: '19aabcu9603r1zm' },
        removeChargeRuleIds: ['b', 'a'],
      }),
    ).toEqual({
      discount: { kind: 'PERCENT', value: 1500, reason: 'Regular' },
      couponCode: 'WELCOME10',
      customer: { taxId: '19AABCU9603R1ZM' },
      removeChargeRuleIds: ['a', 'b'],
    });
  });

  it('compares discounts with the limit in integers', () => {
    expect(exceedsLimit({ kind: 'PERCENT', value: 1000, reason: '' }, 88000, 1000)).toBe(false);
    expect(exceedsLimit({ kind: 'PERCENT', value: 1001, reason: '' }, 88000, 1000)).toBe(true);
    // ₹88 of ₹880 is exactly 10%; ₹88.01 is over.
    expect(exceedsLimit({ kind: 'FIXED', value: 8800, reason: '' }, 88000, 1000)).toBe(false);
    expect(exceedsLimit({ kind: 'FIXED', value: 8801, reason: '' }, 88000, 1000)).toBe(true);
  });
});

describe('payment pad', () => {
  const entry = (method: Parameters<typeof newEntry>[0], amount: string, extra = {}) => ({
    ...newEntry(method, 0),
    amount,
    ...extra,
  });

  it('adds up a split, works out change and refuses more than is owed', () => {
    const check = checkPad(
      [entry('CARD', '1000', { reference: '4F7K21' }), entry('CASH', '1078', { tendered: '2000' })],
      2_07_800,
      { hasCustomerName: false },
    );
    expect(check).toMatchObject({ total: 2_07_800, remaining: 0, change: 92_200, ok: true });
    const over = checkPad([entry('CASH', '2100')], 2_07_800, { hasCustomerName: false });
    expect(over).toMatchObject({ overpaid: true, ok: false });
  });

  it('needs the slip reference for card and UPI, and a named customer for credit', () => {
    const check = checkPad([entry('UPI', '10'), entry('CREDIT', '10')], 5000, {
      hasCustomerName: false,
    });
    expect(check.entries.map((e) => e.problems)).toEqual([['reference'], ['creditNeedsCustomer']]);
  });

  it('settles a delivery-app order to the channel, against its order number', () => {
    const prefilled = newEntry('AGGREGATOR', 13200, '', 'SWG-7734512');
    expect(prefilled).toMatchObject({ amount: '132.00', reference: 'SWG-7734512' });
    expect(checkPad([prefilled], 13200, { hasCustomerName: false }).ok).toBe(true);
    const blank = checkPad([entry('AGGREGATOR', '132')], 13200, { hasCustomerName: false });
    expect(blank.entries[0]!.problems).toEqual(['reference']);
    const [body] = allocatePayments(checkPad([prefilled], 13200, { hasCustomerName: false }), [
      { id: 'inv', balance: 13200 },
    ]).get('inv')!;
    expect(body).toEqual({ method: 'AGGREGATOR', amount: 13200, reference: 'SWG-7734512' });
  });

  it('spreads payments over INV + LIQ, with the cash change on the last part', () => {
    const check = checkPad(
      [
        entry('CARD', '500', { reference: 'RRN1', terminalLabel: 'HDFC-1' }),
        entry('CASH', '774', { tendered: '2000' }),
      ],
      1_27_400,
      { hasCustomerName: false },
    );
    const plan = allocatePayments(check, [
      { id: 'inv', balance: 23_400 },
      { id: 'liq', balance: 1_04_000 },
    ]);
    expect(plan.get('inv')).toEqual([
      { method: 'CARD', amount: 23_400, reference: 'RRN1', terminalLabel: 'HDFC-1' },
    ]);
    expect(plan.get('liq')).toEqual([
      { method: 'CARD', amount: 26_600, reference: 'RRN1', terminalLabel: 'HDFC-1' },
      { method: 'CASH', amount: 77_400, tendered: 2_00_000 },
    ]);
  });

  it('offers exact, then the next ₹100, ₹500 and ₹2,000', () => {
    expect(quickCash(18_000)).toEqual([18_000, 20_000, 50_000, 2_00_000]);
    expect(quickCash(2_07_800)).toEqual([2_07_800, 2_10_000, 2_50_000, 4_00_000]);
    expect(quickCash(50_000)).toEqual([50_000, 2_00_000]);
  });
});

describe('cash count', () => {
  it('totals notes and coins in paise and keeps the record in rupees', () => {
    const count = { notes: { ...EMPTY_COUNT.notes, 500: 3, 20: 2 }, coins: 1_700 };
    expect(countedTotal(count)).toBe(1_55_700);
    expect(denominationRecord(count)).toEqual({ '500': 3, '20': 2, '1': 17 });
  });
});
