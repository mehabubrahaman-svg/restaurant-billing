import {
  balancedLines,
  BusinessDate,
  DomainError,
  reversedLines,
  type JournalLine,
} from '@restroos/domain';
import type { IdGenerator } from '../ports/id-generator';
import type { BranchLookup } from '../purchasing/ports';
import type { AccountingRepository, JournalSourceType, SystemAccount } from './ports';

/**
 * Posts journal entries: checks they balance, numbers them per branch and
 * financial year ("KOL1/JV/2026-27/000042") and writes them. Callers hold a
 * UnitOfWork transaction. Entries are never edited; `reverse` undoes one.
 */
export class JournalWriter {
  constructor(
    private readonly d: {
      accounting: AccountingRepository;
      branches: BranchLookup;
      ids: IdGenerator;
    },
  ) {}

  /** The id of a system account (cash, receivables, output CGST …). */
  account(tag: SystemAccount): string {
    const account = this.d.accounting.accountByTag(tag);
    if (!account) throw new DomainError('NOT_FOUND', `the chart of accounts has no ${tag} account`);
    return account.id;
  }

  post(
    entry: {
      branchId: string;
      entryDate: string;
      sourceType: JournalSourceType;
      sourceId: string | null;
      narration: string | null;
      reversalOfId?: string | null;
      createdBy: string | null;
    },
    lines: readonly JournalLine[],
    at: Date,
  ): string {
    const kept = balancedLines(lines);
    const branch = this.d.branches.branch(entry.branchId);
    if (!branch) throw new DomainError('NOT_FOUND', 'branch not found');
    const id = this.d.ids.next();
    this.d.accounting.insertEntry(
      {
        ...entry,
        id,
        reversalOfId: entry.reversalOfId ?? null,
        entryNo: this.d.accounting.nextEntryNo(
          entry.branchId,
          BusinessDate.parse(entry.entryDate).fiscalYear(),
          branch.code,
        ),
      },
      kept,
      at,
    );
    return id;
  }

  /** Posts the mirror image of an entry, dated `entryDate`. */
  reverse(
    entryId: string,
    input: { branchId: string; entryDate: string; narration: string; createdBy: string | null },
    at: Date,
  ): string {
    const original = this.d.accounting.entry(input.branchId, entryId);
    if (!original) throw new DomainError('NOT_FOUND', 'journal entry not found');
    if (original.reversalOfId !== null || this.d.accounting.reversalOf(entryId) !== undefined)
      throw new DomainError('ALREADY_REVERSED', 'this entry was already reversed');
    return this.post(
      {
        branchId: input.branchId,
        entryDate: input.entryDate,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        narration: input.narration,
        reversalOfId: entryId,
        createdBy: input.createdBy,
      },
      reversedLines(original.lines),
      at,
    );
  }
}
