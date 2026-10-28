import {
  CancelExpenseRequestSchema,
  JournalEntriesQuerySchema,
  PartyTypeSchema,
  PostJournalRequestSchema,
  RecordExpenseRequestSchema,
  ReverseJournalRequestSchema,
  SaveAccountRequestSchema,
  UpdateAccountRequestSchema,
  type Account,
  type AccountsResponse,
  type BalanceSheet,
  type CashFlow,
  type Expense,
  type GstSummary,
  type JournalEntriesResponse,
  type JournalEntry,
  type Ledger,
  type PartyLedger,
  type ProfitAndLoss,
  type TrialBalance,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const AccountParams = z.object({ id: z.string().min(1).max(80) });
const IdParams = z.object({ id: z.uuid() });
const PartyParams = z.object({ type: PartyTypeSchema, id: z.string().min(1).max(80) });
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RangeQuery = z.object({ from: DateString, to: DateString });
const OptionalRangeQuery = z.object({ from: DateString.optional(), to: DateString.optional() });
const AsOfQuery = z.object({ asOf: DateString.optional() });
const MAX_RANGE_DAYS = 366;

const VIEW = { permission: ['accounts.view', 'accounts.journal', 'expenses.manage'] } as const;
const JOURNAL = { permission: 'accounts.journal' } as const;
const EXPENSES = { permission: 'expenses.manage' } as const;
const STATEMENTS = { permission: ['reports.financial', 'accounts.view'] } as const;

/** Phase 4 (docs/05 §3): chart of accounts, journals, expenses, ledgers and financial statements. */
export async function accountingRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { accountingService: accounts } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;
  const range = (r: FastifyRequest) => {
    const { from, to } = RangeQuery.parse(r.query);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days < 0 || days >= MAX_RANGE_DAYS) {
      throw new DomainError('VALIDATION_FAILED', `the range must be 1 to ${MAX_RANGE_DAYS} days`);
    }
    return { from, to };
  };

  // ---- chart of accounts ----------------------------------------------------------
  app.get('/accounts', { config: VIEW }, async (request): Promise<AccountsResponse> => ({
    data: accounts.accounts(branchOf(request)),
  }));

  app.post('/accounts', { config: JOURNAL }, async (request, reply): Promise<Account> => {
    const account = accounts.createAccount(
      SaveAccountRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return account;
  });

  app.patch('/accounts/:id', { config: JOURNAL }, async (request): Promise<Account> =>
    accounts.updateAccount(
      AccountParams.parse(request.params).id,
      UpdateAccountRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  // ---- journals ---------------------------------------------------------------------
  app.get(
    '/journal-entries',
    { config: VIEW },
    async (request): Promise<JournalEntriesResponse> => {
      const filter = JournalEntriesQuerySchema.parse(request.query);
      const data = accounts.journalEntries(branchOf(request), filter);
      return { data, nextCursor: data.length === filter.limit ? (data.at(-1)?.id ?? null) : null };
    },
  );

  app.get('/journal-entries/:id', { config: VIEW }, async (request): Promise<JournalEntry> =>
    accounts.entry(branchOf(request), IdParams.parse(request.params).id),
  );

  app.post(
    '/journal-entries',
    { config: JOURNAL },
    async (request, reply): Promise<JournalEntry> => {
      const entry = accounts.postManual(
        PostJournalRequestSchema.parse(request.body),
        commandContext(request),
      );
      reply.status(201);
      return entry;
    },
  );

  /** Answers the reversing entry. */
  app.post(
    '/journal-entries/:id/reverse',
    { config: JOURNAL },
    async (request, reply): Promise<JournalEntry> => {
      const reversal = accounts.reverse(
        IdParams.parse(request.params).id,
        ReverseJournalRequestSchema.parse(request.body),
        commandContext(request),
      );
      reply.status(201);
      return reversal;
    },
  );

  // ---- expenses -----------------------------------------------------------------------
  app.get('/expenses', { config: VIEW }, async (request) => ({
    data: accounts.expenses(branchOf(request), OptionalRangeQuery.parse(request.query)),
  }));

  app.post('/expenses', { config: EXPENSES }, async (request, reply): Promise<Expense> => {
    const expense = accounts.recordExpense(
      RecordExpenseRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return expense;
  });

  app.post('/expenses/:id/cancel', { config: EXPENSES }, async (request): Promise<Expense> =>
    accounts.cancelExpense(
      IdParams.parse(request.params).id,
      CancelExpenseRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  // ---- ledgers --------------------------------------------------------------------------
  app.get('/ledgers/party/:type/:id', { config: VIEW }, async (request): Promise<PartyLedger> => {
    const { type, id } = PartyParams.parse(request.params);
    const { from, to } = range(request);
    return accounts.partyLedger(branchOf(request), type, id, from, to);
  });

  app.get('/ledgers/:id', { config: VIEW }, async (request): Promise<Ledger> => {
    const { from, to } = range(request);
    return accounts.ledger(branchOf(request), AccountParams.parse(request.params).id, from, to);
  });

  // ---- financial statements -------------------------------------------------------------
  app.get(
    '/reports/trial-balance',
    { config: STATEMENTS },
    async (request): Promise<TrialBalance> =>
      accounts.trialBalance(branchOf(request), AsOfQuery.parse(request.query).asOf),
  );

  app.get(
    '/reports/profit-and-loss',
    { config: { permission: 'reports.financial' } },
    async (request): Promise<ProfitAndLoss> => {
      const { from, to } = range(request);
      return accounts.profitAndLoss(branchOf(request), from, to);
    },
  );

  app.get(
    '/reports/balance-sheet',
    { config: { permission: 'reports.financial' } },
    async (request): Promise<BalanceSheet> =>
      accounts.balanceSheet(branchOf(request), AsOfQuery.parse(request.query).asOf),
  );

  app.get(
    '/reports/cash-flow',
    { config: { permission: 'reports.financial' } },
    async (request): Promise<CashFlow> => {
      const { from, to } = range(request);
      return accounts.cashFlow(branchOf(request), from, to);
    },
  );

  app.get(
    '/reports/gst-summary',
    { config: { permission: 'reports.financial' } },
    async (request): Promise<GstSummary> => {
      const { from, to } = range(request);
      return accounts.gstSummary(branchOf(request), from, to);
    },
  );
}
