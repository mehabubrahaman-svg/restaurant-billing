import { describe, expect, it } from 'vitest';
import {
  ageDues,
  assertPoTransition,
  daysBetween,
  documentTotals,
  inputTaxKind,
  isReceivable,
  lineAmounts,
  receivedStatus,
  toBaseMilli,
} from './purchase';

describe('purchasing', () => {
  it('prices a line per purchase unit and taxes it, rounding half-even', () => {
    // 25 kg of rice at ₹90/kg, GST 5%
    expect(lineAmounts(25_000, 9_000, 500)).toEqual({
      value: 225_000,
      tax: 11_250,
      total: 236_250,
    });
    // 2.5 dozen eggs at ₹78.50 a dozen: ₹196.25; 5% = ₹9.8125 → ₹9.81
    expect(lineAmounts(2_500, 7_850, 500)).toEqual({ value: 19_625, tax: 981, total: 20_606 });
    expect(documentTotals([lineAmounts(25_000, 9_000, 500), lineAmounts(2_500, 7_850, 0)])).toEqual(
      { subtotal: 244_625, taxTotal: 11_250, grandTotal: 255_875 },
    );
  });

  it('converts purchase units to milli base units', () => {
    expect(toBaseMilli(2_500, 1_000_000)).toBe(2_500_000); // 2.5 kg → g
    expect(toBaseMilli(1_500, 12_000)).toBe(18_000); // 1.5 dozen → 18 pc
    expect(toBaseMilli(750, 1_000)).toBe(750); // 0.75 g
  });

  it('moves a PO from draft to closed, and refuses to skip steps', () => {
    expect(() => assertPoTransition('DRAFT', 'APPROVED')).not.toThrow();
    expect(() => assertPoTransition('APPROVED', 'SENT')).not.toThrow();
    expect(() => assertPoTransition('PARTIALLY_RECEIVED', 'CLOSED')).not.toThrow();
    expect(() => assertPoTransition('DRAFT', 'SENT')).toThrow(/draft purchase order/);
    expect(() => assertPoTransition('PARTIALLY_RECEIVED', 'CANCELLED')).toThrow();
    expect(() => assertPoTransition('CLOSED', 'RECEIVED')).toThrow();
    expect(isReceivable('DRAFT')).toBe(false);
    expect(isReceivable('SENT')).toBe(true);
    expect(
      receivedStatus([
        { orderedMilli: 10_000, receivedMilli: 10_000 },
        { orderedMilli: 5_000, receivedMilli: 2_000 },
      ]),
    ).toBe('PARTIALLY_RECEIVED');
    expect(receivedStatus([{ orderedMilli: 10_000, receivedMilli: 11_000 }])).toBe('RECEIVED');
  });

  it('claims input GST by where the vendor is registered', () => {
    expect(inputTaxKind('19AAACF1234A1Z5', '19')).toBe('CGST_SGST');
    expect(inputTaxKind('20AAACF1234A1Z5', '19')).toBe('IGST');
    expect(inputTaxKind(null, '19')).toBe('NONE');
  });

  it('ages dues by days past due, settling on-account payments against the oldest bills', () => {
    const bills = [
      { dueOn: '2026-10-30', balance: 10_000 }, // not yet due
      { dueOn: '2026-10-10', balance: 20_000 }, // 18 days
      { dueOn: '2026-08-01', balance: 30_000 }, // 88 days
      { dueOn: '2026-06-01', balance: 5_000 }, // 149 days
    ];
    expect(ageDues(bills, 0, '2026-10-28')).toEqual({
      current: 10_000,
      d1to30: 20_000,
      d31to60: 0,
      d61to90: 30_000,
      over90: 5_000,
      due: 65_000,
      advance: 0,
      oldestDueOn: '2026-06-01',
    });
    // ₹150 on account clears the June bill and ₹100 of August's.
    expect(ageDues(bills, 15_000, '2026-10-28')).toMatchObject({
      over90: 0,
      d61to90: 20_000,
      due: 50_000,
      oldestDueOn: '2026-08-01',
    });
    expect(ageDues(bills.slice(0, 1), 12_500, '2026-10-28')).toMatchObject({
      due: 0,
      advance: 2_500,
      oldestDueOn: null,
    });
    expect(daysBetween('2026-10-28', '2026-11-02')).toBe(5);
  });
});
