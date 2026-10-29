import type { JournalSourceType } from '@restroos/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api, type LedgerPartyType } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';

/** Day-book filters; empty strings mean "any". */
export interface JournalQuery {
  readonly from: string;
  readonly to: string;
  readonly sourceType: JournalSourceType | '';
  readonly accountId: string;
}

/** Entries per day-book page. */
export const JOURNAL_PAGE = 50;

export const ACCOUNTING_KEYS = {
  all: ['accounting'],
  accounts: ['accounting', 'accounts'],
  journal: (q: JournalQuery) => ['accounting', 'journal', q] as const,
  expenses: (from: string, to: string) => ['accounting', 'expenses', from, to] as const,
  ledger: (accountId: string, from: string, to: string) =>
    ['accounting', 'ledger', accountId, from, to] as const,
  partyLedger: (type: LedgerPartyType, id: string, from: string, to: string) =>
    ['accounting', 'party-ledger', type, id, from, to] as const,
  trialBalance: (asOf: string) => ['accounting', 'trial-balance', asOf] as const,
  profitAndLoss: (from: string, to: string) => ['accounting', 'profit-and-loss', from, to] as const,
  balanceSheet: (asOf: string) => ['accounting', 'balance-sheet', asOf] as const,
  cashFlow: (from: string, to: string) => ['accounting', 'cash-flow', from, to] as const,
  gst: (from: string, to: string) => ['accounting', 'gst', from, to] as const,
} as const;

/** After a journal, an expense or an account changes: every book and statement is refetched. */
export function invalidateAccounting(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: ACCOUNTING_KEYS.all });
}

export const useAccounts = () =>
  useQuery({ queryKey: ACCOUNTING_KEYS.accounts, queryFn: api.accounting.accounts });

/** The day book, newest first, a page at a time. */
export function useJournal(q: JournalQuery, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ACCOUNTING_KEYS.journal(q),
    queryFn: ({ pageParam }) =>
      api.accounting.journal({
        ...(q.from === '' ? {} : { from: q.from }),
        ...(q.to === '' ? {} : { to: q.to }),
        ...(q.sourceType === '' ? {} : { sourceType: q.sourceType }),
        ...(q.accountId === '' ? {} : { accountId: q.accountId }),
        ...(pageParam === null ? {} : { before: pageParam }),
        limit: JOURNAL_PAGE,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export const useExpenses = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.expenses(from, to),
    queryFn: () => api.accounting.expenses(from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useLedger = (accountId: string, from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.ledger(accountId, from, to),
    queryFn: () => api.accounting.ledger(accountId, from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

export const usePartyLedger = (
  type: LedgerPartyType,
  id: string,
  from: string,
  to: string,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.partyLedger(type, id, from, to),
    queryFn: () => api.accounting.partyLedger(type, id, from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useTrialBalance = (asOf: string) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.trialBalance(asOf),
    queryFn: () => api.accounting.trialBalance(asOf),
    placeholderData: keepPreviousData,
  });

export const useProfitAndLoss = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.profitAndLoss(from, to),
    queryFn: () => api.accounting.profitAndLoss(from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useBalanceSheet = (asOf: string) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.balanceSheet(asOf),
    queryFn: () => api.accounting.balanceSheet(asOf),
    placeholderData: keepPreviousData,
  });

export const useCashFlow = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.cashFlow(from, to),
    queryFn: () => api.accounting.cashFlow(from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useGstSummary = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ACCOUNTING_KEYS.gst(from, to),
    queryFn: () => api.accounting.gstSummary(from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

/** useErrorMessage, in accounts words (an expense that was already cancelled). */
export function useAccountsErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  return useCallback(
    (error: unknown) =>
      isApiError(error, 'INVALID_STATE_TRANSITION')
        ? t('accounts.errors.invalidState')
        : errorMessage(error),
    [t, errorMessage],
  );
}
