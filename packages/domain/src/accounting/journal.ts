import { DomainError } from '../shared/result';
import { divideRounded, toSafeNumber } from '../shared/rounding';

/** Double-entry rules (docs/03 §4.4). Amounts are paise. */
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface JournalLine {
  readonly accountId: string;
  readonly debit: number;
  readonly credit: number;
  readonly partyType: 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE' | null;
  readonly partyId: string | null;
  readonly memo: string | null;
}

/** Assets and expenses grow with debits; liabilities, equity and income with credits. */
export function isDebitNormal(type: AccountType): boolean {
  return type === 'ASSET' || type === 'EXPENSE';
}

/** A balance on the account's normal side: what an asset holds, what a liability owes. */
export function normalBalance(type: AccountType, debit: number, credit: number): number {
  return isDebitNormal(type) ? debit - credit : credit - debit;
}

/**
 * An entry is postable when every line has exactly one positive side and the
 * debits equal the credits. Lines that net to nothing are dropped first.
 */
export function balancedLines(lines: readonly JournalLine[]): JournalLine[] {
  const kept = lines.filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of kept) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit))
      throw new DomainError('VALIDATION_FAILED', 'amounts are whole paise');
    if (l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0)) {
      throw new DomainError('VALIDATION_FAILED', 'each line is either a debit or a credit');
    }
  }
  const debit = kept.reduce((s, l) => s + l.debit, 0);
  const credit = kept.reduce((s, l) => s + l.credit, 0);
  if (kept.length < 2 || debit === 0)
    throw new DomainError('VALIDATION_FAILED', 'an entry needs a debit and a credit');
  if (debit !== credit) {
    throw new DomainError(
      'JOURNAL_UNBALANCED',
      `debits (${debit} paise) and credits (${credit} paise) must be equal`,
    );
  }
  return kept;
}

/** A signed amount as a line: positive debits the account, negative credits it. */
export function signedLine(
  accountId: string,
  amount: number,
  party: Pick<JournalLine, 'partyType' | 'partyId'> = { partyType: null, partyId: null },
  memo: string | null = null,
): JournalLine {
  return {
    accountId,
    debit: Math.max(0, amount),
    credit: Math.max(0, -amount),
    ...party,
    memo,
  };
}

/** The entry that undoes another: every debit becomes a credit and the other way round. */
export function reversedLines(lines: readonly JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** Intra-state GST splits evenly into CGST and SGST; an odd paisa goes to SGST. */
export function splitGst(tax: number): { cgst: number; sgst: number } {
  const cgst = toSafeNumber(divideRounded(BigInt(tax), 2n, 'DOWN'), 'CGST');
  return { cgst, sgst: tax - cgst };
}
