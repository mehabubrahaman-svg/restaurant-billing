import { describe, expect, it } from 'vitest';
import {
  balancedLines,
  isDebitNormal,
  normalBalance,
  reversedLines,
  signedLine,
  splitGst,
  type JournalLine,
} from './journal';

const line = (accountId: string, debit: number, credit: number): JournalLine => ({
  accountId,
  debit,
  credit,
  partyType: null,
  partyId: null,
  memo: null,
});

describe('journal rules', () => {
  it('posts only balanced entries with one side per line', () => {
    // ₹1,008 bill: receivable ₹1,008 = sales ₹960 + CGST ₹24 + SGST ₹24
    const bill = [
      line('ar', 100_800, 0),
      line('sales', 0, 96_000),
      line('cgst', 0, 2_400),
      line('sgst', 0, 2_400),
      line('round', 0, 0),
    ];
    expect(balancedLines(bill)).toHaveLength(4);
    expect(() => balancedLines([line('a', 100, 0), line('b', 0, 99)])).toThrow(/must be equal/);
    expect(() => balancedLines([line('a', 100, 100), line('b', 0, 0)])).toThrow(/either a debit/);
    expect(() => balancedLines([line('a', -100, 0), line('b', 0, -100)])).toThrow(/either a debit/);
    expect(() => balancedLines([line('a', 0, 0), line('b', 0, 0)])).toThrow(/needs a debit/);
  });

  it('reads balances on the account’s normal side', () => {
    expect(isDebitNormal('ASSET')).toBe(true);
    expect(isDebitNormal('INCOME')).toBe(false);
    expect(normalBalance('ASSET', 5_000, 2_000)).toBe(3_000);
    expect(normalBalance('LIABILITY', 5_000, 2_000)).toBe(-3_000);
  });

  it('reverses entries and turns signed amounts into lines', () => {
    expect(reversedLines([line('a', 100, 0), line('b', 0, 100)])).toEqual([
      line('a', 0, 100),
      line('b', 100, 0),
    ]);
    expect(signedLine('round', -40)).toEqual(line('round', 0, 40));
    expect(signedLine('round', 40)).toEqual(line('round', 40, 0));
  });

  it('splits GST into CGST and SGST, the odd paisa to SGST', () => {
    expect(splitGst(4_800)).toEqual({ cgst: 2_400, sgst: 2_400 });
    expect(splitGst(981)).toEqual({ cgst: 490, sgst: 491 });
    expect(splitGst(0)).toEqual({ cgst: 0, sgst: 0 });
  });
});
