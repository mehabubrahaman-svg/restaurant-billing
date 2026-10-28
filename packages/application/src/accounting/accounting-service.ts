import {
  DomainError,
  signedLine,
  splitGst,
  type AccountType,
  type JournalLine,
} from '@restroos/domain';
import type { BusinessCalendar } from '../ordering/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import type { BranchLookup } from '../purchasing/ports';
import { recordChanged } from '../shared-events';
import { JournalWriter } from './journal-writer';
import type {
  AccountingQueries,
  AccountingRepository,
  AccountRecord,
  AccountView,
  ExpenseView,
  JournalEntryView,
  PartyType,
} from './ports';

export interface AccountingServiceDeps {
  readonly accounting: AccountingRepository;
  readonly queries: AccountingQueries;
  readonly branches: BranchLookup;
  readonly calendar: BusinessCalendar;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * The books (docs/08 Phase 4): the chart of accounts, manual journals and
 * their reversals, expenses, ledgers and the financial statements. Sales,
 * purchases, payments and stock are journaled by the AccountingProjector.
 */
export class AccountingService {
  private readonly journal: JournalWriter;

  constructor(private readonly d: AccountingServiceDeps) {
    this.journal = new JournalWriter({
      accounting: d.accounting,
      branches: d.branches,
      ids: d.ids,
    });
  }

  // ---- chart of accounts ------------------------------------------------------------
  accounts(branchId: string): AccountView[] {
    return this.d.queries.accounts(branchId);
  }

  createAccount(
    input: { code: string; name: string; type: AccountType; parentId: string | null },
    ctx: CommandContext,
  ): AccountView {
    return this.write(ctx, (scope, now) => {
      if (this.d.accounting.accountByCode(input.code))
        throw new DomainError('ACCOUNT_CODE_TAKEN', `account ${input.code} already exists`);
      this.assertParent(input.parentId, input.type, null);
      const record: AccountRecord = {
        ...input,
        id: this.d.ids.next(),
        systemTag: null,
        isActive: true,
        version: 1,
      };
      this.d.accounting.insertAccount(record, now);
      scope.recordEvents([
        recordChanged(
          'AccountCreated',
          'Account',
          record.id,
          1,
          { code: record.code, type: record.type },
          now,
        ),
      ]);
      scope.audit({
        action: 'accounts.account.create',
        entityType: 'Account',
        entityId: record.id,
        after: record,
      });
      return this.account(ctx.branchId, record.id);
    });
  }

  updateAccount(
    id: string,
    patch: {
      version: number;
      name?: string | undefined;
      type?: AccountType | undefined;
      parentId?: string | null | undefined;
      isActive?: boolean | undefined;
    },
    ctx: CommandContext,
  ): AccountView {
    return this.write(ctx, (scope, now) => {
      const current = this.d.accounting.account(id);
      if (!current) throw new DomainError('NOT_FOUND', 'account not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this account changed; reload and try again');
      const next: AccountRecord = {
        ...current,
        name: patch.name ?? current.name,
        type: patch.type ?? current.type,
        parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
        isActive: patch.isActive ?? current.isActive,
        version: current.version + 1,
      };
      if (current.systemTag !== null && (!next.isActive || next.type !== current.type)) {
        throw new DomainError(
          'SYSTEM_ACCOUNT',
          'automatic postings use this account; it keeps its type and stays active',
        );
      }
      if (next.type !== current.type && this.d.accounting.hasPostings(id))
        throw new DomainError('VALIDATION_FAILED', 'an account with postings keeps its type');
      this.assertParent(next.parentId, next.type, id);
      this.d.accounting.updateAccount(next, now);
      scope.recordEvents([
        recordChanged(
          'AccountChanged',
          'Account',
          id,
          next.version,
          { name: next.name, isActive: next.isActive },
          now,
        ),
      ]);
      scope.audit({
        action: 'accounts.account.update',
        entityType: 'Account',
        entityId: id,
        before: current,
        after: next,
      });
      return this.account(ctx.branchId, id);
    });
  }

  // ---- journals -------------------------------------------------------------------------
  journalEntries(branchId: string, filter: Parameters<AccountingQueries['journal']>[1]) {
    return this.d.queries.journal(branchId, filter);
  }

  entry(branchId: string, id: string): JournalEntryView {
    const view = this.d.queries.entry(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'journal entry not found');
    return view;
  }

  /** A manual journal: opening balances, owner's capital, a transfer from the till to the bank. */
  postManual(
    input: {
      entryDate: string;
      narration: string;
      lines: {
        accountId: string;
        debit: number;
        credit: number;
        partyType: PartyType | null;
        partyId: string | null;
        memo: string | null;
      }[];
    },
    ctx: CommandContext,
  ): JournalEntryView {
    return this.write(ctx, (scope, now) => {
      this.assertNotFuture(ctx.branchId, input.entryDate);
      for (const l of input.lines) {
        this.activeAccount(l.accountId);
        if ((l.partyType === null) !== (l.partyId === null))
          throw new DomainError('VALIDATION_FAILED', 'give both the party type and the party');
      }
      const id = this.journal.post(
        {
          branchId: ctx.branchId,
          entryDate: input.entryDate,
          sourceType: 'MANUAL',
          sourceId: null,
          narration: input.narration,
          createdBy: ctx.actorId,
        },
        input.lines,
        now,
      );
      const view = this.entry(ctx.branchId, id);
      scope.recordEvents([
        recordChanged(
          'JournalPosted',
          'JournalEntry',
          id,
          1,
          { entryNo: view.entryNo, total: view.total },
          now,
        ),
      ]);
      scope.audit({
        action: 'accounts.journal.post',
        entityType: 'JournalEntry',
        entityId: id,
        after: { entryNo: view.entryNo, entryDate: view.entryDate, lines: input.lines },
      });
      return view;
    });
  }

  /** Undoes a manual journal with its mirror image. Documents are corrected at the source instead. */
  reverse(
    id: string,
    input: { reason: string; entryDate?: string | undefined },
    ctx: CommandContext,
  ): JournalEntryView {
    return this.write(ctx, (scope, now) => {
      const original = this.d.accounting.entry(ctx.branchId, id);
      if (!original) throw new DomainError('NOT_FOUND', 'journal entry not found');
      if (original.sourceType !== 'MANUAL') {
        throw new DomainError(
          'VALIDATION_FAILED',
          'only manual journals are reversed here; cancel or refund the bill, GRN or expense instead',
        );
      }
      const entryDate = input.entryDate ?? this.today(ctx.branchId);
      this.assertNotFuture(ctx.branchId, entryDate);
      const reversalId = this.journal.reverse(
        id,
        {
          branchId: ctx.branchId,
          entryDate,
          narration: `Reversal: ${input.reason}`,
          createdBy: ctx.actorId,
        },
        now,
      );
      scope.recordEvents([
        recordChanged('JournalReversed', 'JournalEntry', id, 2, { reversalId }, now),
      ]);
      scope.audit({
        action: 'accounts.journal.reverse',
        entityType: 'JournalEntry',
        entityId: id,
        after: { reversalId },
        reason: input.reason,
      });
      return this.entry(ctx.branchId, reversalId);
    });
  }

  // ---- expenses ---------------------------------------------------------------------------
  expenses(branchId: string, filter: { from?: string | undefined; to?: string | undefined }) {
    return this.d.queries.expenses(branchId, filter);
  }

  /** Rent, wages, gas: the expense (less claimable GST) against cash or the bank. */
  recordExpense(
    input: {
      expenseAccountId: string;
      paidFromAccountId: string;
      amount: number;
      taxAmount: number;
      description: string;
      reference: string | null;
      expenseDate?: string | undefined;
    },
    ctx: CommandContext,
  ): ExpenseView {
    return this.write(ctx, (scope, now) => {
      const expenseDate = input.expenseDate ?? this.today(ctx.branchId);
      this.assertNotFuture(ctx.branchId, expenseDate);
      if (this.activeAccount(input.expenseAccountId).type !== 'EXPENSE')
        throw new DomainError('VALIDATION_FAILED', 'book an expense to an expense account');
      if (this.activeAccount(input.paidFromAccountId).type !== 'ASSET')
        throw new DomainError(
          'VALIDATION_FAILED',
          'an expense is paid from cash or a bank account',
        );
      if (input.taxAmount >= input.amount)
        throw new DomainError('VALIDATION_FAILED', 'the GST must be less than the amount');
      const id = this.d.ids.next();
      this.d.accounting.insertExpense(
        { ...input, id, branchId: ctx.branchId, expenseDate, isCancelled: false, version: 1 },
        ctx.actorId!,
        now,
      );
      const { cgst, sgst } = splitGst(input.taxAmount);
      const lines: JournalLine[] = [
        signedLine(input.expenseAccountId, input.amount - input.taxAmount),
        signedLine(this.journal.account('INPUT_CGST'), cgst),
        signedLine(this.journal.account('INPUT_SGST'), sgst),
        signedLine(input.paidFromAccountId, -input.amount),
      ];
      this.journal.post(
        {
          branchId: ctx.branchId,
          entryDate: expenseDate,
          sourceType: 'EXPENSE',
          sourceId: id,
          narration: input.description,
          createdBy: ctx.actorId,
        },
        lines,
        now,
      );
      const summary = { amount: input.amount, taxAmount: input.taxAmount, expenseDate };
      scope.recordEvents([recordChanged('ExpenseRecorded', 'Expense', id, 1, summary, now)]);
      scope.audit({
        action: 'accounts.expense.create',
        entityType: 'Expense',
        entityId: id,
        after: { ...input, expenseDate },
      });
      return this.expense(ctx.branchId, id);
    });
  }

  cancelExpense(
    id: string,
    input: { version: number; reason: string },
    ctx: CommandContext,
  ): ExpenseView {
    return this.write(ctx, (scope, now) => {
      const expense = this.d.accounting.expense(ctx.branchId, id);
      if (!expense) throw new DomainError('NOT_FOUND', 'expense not found');
      if (expense.isCancelled)
        throw new DomainError('INVALID_STATE_TRANSITION', 'this expense is already cancelled');
      if (expense.version !== input.version)
        throw new DomainError('VERSION_CONFLICT', 'this expense changed; reload and try again');
      this.d.accounting.cancelExpense(id, input.version, input.reason, ctx.actorId, now);
      const original = this.d.accounting.originalEntry('EXPENSE', id);
      if (original) {
        this.journal.reverse(
          original.id,
          {
            branchId: ctx.branchId,
            entryDate: this.today(ctx.branchId),
            narration: `Expense cancelled: ${input.reason}`,
            createdBy: ctx.actorId,
          },
          now,
        );
      }
      scope.recordEvents([
        recordChanged(
          'ExpenseCancelled',
          'Expense',
          id,
          expense.version + 1,
          { reason: input.reason },
          now,
        ),
      ]);
      scope.audit({
        action: 'accounts.expense.cancel',
        entityType: 'Expense',
        entityId: id,
        reason: input.reason,
      });
      return this.expense(ctx.branchId, id);
    });
  }

  // ---- ledgers and statements ------------------------------------------------------------
  ledger(branchId: string, accountId: string, from: string, to: string) {
    const view = this.d.queries.ledger(branchId, accountId, from, to);
    if (!view) throw new DomainError('NOT_FOUND', 'account not found');
    return view;
  }

  partyLedger(branchId: string, partyType: PartyType, partyId: string, from: string, to: string) {
    const view = this.d.queries.partyLedger(branchId, partyType, partyId, from, to);
    if (!view) throw new DomainError('NOT_FOUND', 'no such customer or vendor');
    return view;
  }

  trialBalance(branchId: string, asOf: string | undefined) {
    return this.d.queries.trialBalance(branchId, asOf ?? this.today(branchId));
  }

  profitAndLoss(branchId: string, from: string, to: string) {
    return this.d.queries.profitAndLoss(branchId, from, to);
  }

  balanceSheet(branchId: string, asOf: string | undefined) {
    return this.d.queries.balanceSheet(branchId, asOf ?? this.today(branchId));
  }

  cashFlow(branchId: string, from: string, to: string) {
    return this.d.queries.cashFlow(branchId, from, to);
  }

  gstSummary(branchId: string, from: string, to: string) {
    return this.d.queries.gstSummary(branchId, from, to);
  }

  // ---- helpers ----------------------------------------------------------------------------
  private write<T>(ctx: CommandContext, work: (scope: TransactionScope, now: Date) => T): T {
    return this.d.unitOfWork.run(ctx, (scope) => work(scope, this.d.clock.now()));
  }

  private today(branchId: string): string {
    return this.d.calendar.businessDate(branchId, this.d.clock.now());
  }

  private assertNotFuture(branchId: string, date: string): void {
    if (date > this.today(branchId))
      throw new DomainError('VALIDATION_FAILED', 'an entry can’t be dated in the future');
  }

  private account(branchId: string, id: string): AccountView {
    const view = this.d.queries.account(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'account not found');
    return view;
  }

  private expense(branchId: string, id: string): ExpenseView {
    const view = this.d.queries.expense(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'expense not found');
    return view;
  }

  private activeAccount(id: string): AccountRecord {
    const account = this.d.accounting.account(id);
    if (!account) throw new DomainError('NOT_FOUND', 'account not found');
    if (!account.isActive) throw new DomainError('VALIDATION_FAILED', `${account.name} is retired`);
    return account;
  }

  /** A parent is an account of the same type, and not the account itself. */
  private assertParent(parentId: string | null, type: AccountType, selfId: string | null): void {
    if (parentId === null) return;
    const parent = this.d.accounting.account(parentId);
    if (!parent) throw new DomainError('NOT_FOUND', 'parent account not found');
    if (parent.id === selfId || parent.type !== type)
      throw new DomainError(
        'VALIDATION_FAILED',
        'the parent must be another account of the same type',
      );
  }
}
