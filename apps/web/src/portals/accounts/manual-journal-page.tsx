import type { Account } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Button,
  Card,
  CircleAlert,
  CircleCheck,
  cn,
  Field,
  Input,
  Plus,
  Select,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { UnsavedChangesDialog } from '../../components/unsaved-changes-dialog';
import {
  invalidateAccounting,
  useAccounts,
  useAccountsErrorMessage,
} from '../../features/accounting/accounting-queries';
import { isCalendarDay } from '../../features/accounting/calendar-day';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { PriceField } from '../../features/menu/price-field';
import { toast } from '../../features/toast/toast-store';
import { rupeesToPaise } from '../../lib/units';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import { localIsoDate } from '../pos/bills-page';
import { useMoney } from '../purchase/purchase-ui';
import { AccountOptions } from './accounts-ui';

const MAX_LINES = 50;

/** One line of a manual journal, as typed. */
export interface JournalRow {
  readonly key: string;
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly memo: string;
}

let counter = 0;
function newRow(): JournalRow {
  counter += 1;
  return { key: `jl-${counter}`, accountId: '', debit: '', credit: '', memo: '' };
}

/** A typed amount: '' is zero, anything unreadable null. */
function amountOf(text: string): number | null {
  return text.trim() === '' ? 0 : rupeesToPaise(text);
}

/**
 * Debit and credit totals of the rows that are filled in, and whether the
 * entry can be posted: every line one-sided, at least two lines, debits = credits.
 */
export function journalTotals(rows: readonly JournalRow[]) {
  let debit = 0;
  let credit = 0;
  let lines = 0;
  let readable = true;
  for (const r of rows) {
    const d = amountOf(r.debit);
    const c = amountOf(r.credit);
    if (d === null || c === null || (d > 0 && c > 0) || (r.accountId === '' && d + c > 0)) {
      readable = false;
      continue;
    }
    if (d + c === 0) continue;
    debit += d;
    credit += c;
    lines += 1;
  }
  return {
    debit,
    credit,
    lines,
    balanced: readable && lines >= 2 && debit > 0 && debit === credit,
  };
}

/** /accounts/journal/new: a manual journal (opening balances, capital, transfers, corrections). */
export function ManualJournalPage() {
  const accounts = useAccounts();
  return <QueryState query={accounts}>{({ data }) => <JournalForm accounts={data} />}</QueryState>;
}

function JournalForm({ accounts }: { accounts: readonly Account[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useAccountsErrorMessage();
  const money = useMoney();
  const today = localIsoDate();
  const [date, setDate] = useState(today);
  const [narration, setNarration] = useState('');
  const [rows, setRows] = useState<JournalRow[]>(() => [newRow(), newRow()]);
  const [errors, setErrors] = useState<Partial<Record<'date' | 'narration', string>>>({});
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const key = useRef<{ body: string; key: string } | null>(null);
  const totals = journalTotals(rows);
  const difference = totals.debit - totals.credit;
  const dirty = useMemo(
    () =>
      narration !== '' || rows.some((r) => r.accountId !== '' || r.debit !== '' || r.credit !== ''),
    [narration, rows],
  );
  const { blocker, release } = useUnsavedGuard(dirty);
  const update = (rowKey: string, patch: Partial<JournalRow>) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)));

  const post = useMutation({
    mutationFn: async () => {
      const found: typeof errors = {};
      const lineErrors: Record<string, string> = {};
      if (!isCalendarDay(date) || date > today) found.date = t('accounts.journal.form.dateError');
      if (narration.trim().length < 3) found.narration = t('accounts.journal.form.narrationError');
      const lines: { accountId: string; debit: number; credit: number; memo: string | null }[] = [];
      for (const r of rows) {
        const debit = amountOf(r.debit);
        const credit = amountOf(r.credit);
        if (debit === null || credit === null) {
          lineErrors[r.key] = t('validation.amount');
          continue;
        }
        if (debit === 0 && credit === 0 && r.accountId === '') continue;
        if (r.accountId === '') lineErrors[r.key] = t('accounts.journal.form.accountError');
        else if (debit > 0 === credit > 0) lineErrors[r.key] = t('accounts.journal.form.sideError');
        else
          lines.push({
            accountId: r.accountId,
            debit,
            credit,
            memo: r.memo.trim() === '' ? null : r.memo.trim(),
          });
      }
      setErrors(found);
      setRowErrors(lineErrors);
      if (Object.keys(found).length > 0 || Object.keys(lineErrors).length > 0) return null;
      const body = { entryDate: date, narration: narration.trim(), lines };
      const text = JSON.stringify(body);
      if (key.current?.body !== text) key.current = { body: text, key: newIdempotencyKey() };
      return api.accounting.postJournal(body, { idempotencyKey: key.current.key });
    },
    onSuccess: (entry) => {
      if (entry === null) return;
      void invalidateAccounting(queryClient);
      toast(t('accounts.journal.form.posted', { number: entry.entryNo }));
      release();
      void navigate('/accounts/journal');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/accounts/journal"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('accounts.journal.back')}
      </Link>
      <AdminHeader
        title={t('accounts.journal.form.title')}
        description={t('accounts.journal.form.description')}
      />
      {post.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(post.error)}
        </Alert>
      )}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (totals.balanced) post.mutate();
        }}
      >
        <Card className="grid gap-4 p-4 md:grid-cols-[12rem_1fr] md:p-5">
          <Field label={t('accounts.journal.form.date')} required error={errors.date}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('accounts.journal.form.narration')}
            hint={t('accounts.journal.form.narrationHint')}
            required
            error={errors.narration}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={300}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
              />
            )}
          </Field>
        </Card>
        <section aria-labelledby="journal-lines" className="flex flex-col gap-3">
          <h2 id="journal-lines" className="text-lg font-semibold">
            {t('accounts.journal.form.lines')}
          </h2>
          <ol className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <li
                key={r.key}
                aria-label={t('accounts.journal.form.lineN', { n: i + 1 })}
                className="grid items-start gap-3 rounded-xl border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_9rem_9rem_minmax(0,1fr)_auto]"
              >
                <Field
                  label={t('accounts.journal.account')}
                  error={rowErrors[r.key]}
                  className="sm:col-span-2 lg:col-span-1"
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={r.accountId}
                      onChange={(e) => update(r.key, { accountId: e.target.value })}
                    >
                      <option value="" disabled>
                        {t('accounts.journal.form.chooseAccount')}
                      </option>
                      <AccountOptions accounts={accounts} />
                    </Select>
                  )}
                </Field>
                <PriceField
                  label={t('accounts.debit')}
                  value={r.debit}
                  onChange={(debit) => update(r.key, { debit })}
                />
                <PriceField
                  label={t('accounts.credit')}
                  value={r.credit}
                  onChange={(credit) => update(r.key, { credit })}
                />
                <Field label={t('accounts.journal.form.memo')}>
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={200}
                      value={r.memo}
                      onChange={(e) => update(r.key, { memo: e.target.value })}
                    />
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  disabled={rows.length <= 2}
                  aria-label={t('accounts.journal.form.removeLine', { n: i + 1 })}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  <Trash aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            className="self-start"
            disabled={rows.length >= MAX_LINES}
            onClick={() => setRows((rs) => [...rs, newRow()])}
          >
            <Plus aria-hidden="true" />
            {t('accounts.journal.form.addLine')}
          </Button>
        </section>
        <Card
          className={cn(
            'flex flex-wrap items-center gap-x-6 gap-y-2 p-4',
            totals.balanced ? 'border-state-available' : 'border-state-danger',
          )}
        >
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-live="polite">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('accounts.journal.form.totalDebit')}</dt>
              <dd className="font-semibold tabular-nums">{money(totals.debit)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('accounts.journal.form.totalCredit')}</dt>
              <dd className="font-semibold tabular-nums">{money(totals.credit)}</dd>
            </div>
          </dl>
          <p
            role="status"
            className={cn(
              'flex items-center gap-2 text-sm font-semibold',
              totals.balanced ? 'text-state-available-fg' : 'text-state-danger-fg',
            )}
          >
            {totals.balanced ? (
              <CircleCheck aria-hidden="true" className="size-5" />
            ) : (
              <CircleAlert aria-hidden="true" className="size-5" />
            )}
            {totals.balanced
              ? t('accounts.journal.form.balanced')
              : difference === 0
                ? t('accounts.journal.form.incomplete')
                : difference > 0
                  ? t('accounts.journal.form.debitsOver', { amount: money(difference) })
                  : t('accounts.journal.form.creditsOver', { amount: money(-difference) })}
          </p>
          <Button type="submit" className="ms-auto" disabled={!totals.balanced || post.isPending}>
            {post.isPending ? t('common.saving') : t('accounts.journal.form.post')}
          </Button>
        </Card>
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
