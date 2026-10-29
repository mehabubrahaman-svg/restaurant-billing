import type { JournalEntry, JournalSourceType } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  ChevronRight,
  cn,
  Field,
  Input,
  Plus,
  Select,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Undo2,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import {
  invalidateAccounting,
  useAccounts,
  useAccountsErrorMessage,
  useJournal,
  type JournalQuery,
} from '../../features/accounting/accounting-queries';
import { isCalendarDay } from '../../features/accounting/calendar-day';
import { AdminHeader } from '../../features/admin/admin-layout';
import { usePermission } from '../../features/auth/permissions';
import { useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { useErrorMessage } from '../../lib/errors';
import { localIsoDate } from '../pos/bills-page';
import { useMoney } from '../purchase/purchase-ui';
import { AccountOptions, SOURCE_TYPES, SourceBadge } from './accounts-ui';
import { ReasonDialog } from './reason-dialog';

/** /accounts/journal?from=&to=&source=&account=: the day book, newest first. */
export function JournalPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const canPost = usePermission('accounts.journal');
  const [params, setParams] = useSearchParams();
  const source = params.get('source') ?? '';
  const query: JournalQuery = {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    sourceType: SOURCE_TYPES.includes(source as JournalSourceType)
      ? (source as JournalSourceType)
      : '',
    accountId: params.get('account') ?? '',
  };
  const day = (d: string) => d === '' || isCalendarDay(d);
  const rangeOk =
    day(query.from) &&
    day(query.to) &&
    (query.from === '' || query.to === '' || query.from <= query.to);
  const journal = useJournal(query, rangeOk);
  const accounts = useAccounts();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const entries = journal.data?.pages.flatMap((p) => p.data) ?? [];
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('accounts.journal.title')}
        description={t('accounts.journal.description')}
        actions={
          canPost ? (
            <Button asChild>
              <Link to="/accounts/journal/new">
                <Plus aria-hidden="true" />
                {t('accounts.journal.manual')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label={t('accounts.range.from')}
          error={rangeOk ? undefined : t('accounts.journal.rangeError')}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={query.from}
              max={localIsoDate()}
              onChange={(e) => update('from', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('accounts.range.to')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={query.to}
              max={localIsoDate()}
              onChange={(e) => update('to', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('accounts.journal.source')}>
          {(p) => (
            <Select
              {...p}
              value={query.sourceType}
              onChange={(e) => update('source', e.target.value)}
            >
              <option value="">{t('accounts.journal.allSources')}</option>
              {SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`accounts.sources.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('accounts.journal.account')}>
          {(p) => (
            <Select
              {...p}
              value={query.accountId}
              onChange={(e) => update('account', e.target.value)}
            >
              <option value="">{t('accounts.journal.allAccounts')}</option>
              <AccountOptions accounts={accounts.data?.data ?? []} />
            </Select>
          )}
        </Field>
      </div>
      {journal.isError ? (
        <Alert tone="danger" role="alert">
          <p>{errorMessage(journal.error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void journal.refetch()}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      ) : journal.isPending && rangeOk ? (
        <Spinner label={t('common.loading')} className="py-6" />
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground">{t('accounts.journal.empty')}</p>
      ) : (
        <>
          <ol
            className="flex flex-col divide-y rounded-xl border bg-surface"
            aria-label={t('accounts.journal.caption', { count: entries.length })}
          >
            {entries.map((e) => (
              <EntryItem
                key={e.id}
                entry={e}
                expanded={expanded.has(e.id)}
                onToggle={() => toggle(e.id)}
                canReverse={
                  canPost &&
                  e.sourceType === 'MANUAL' &&
                  e.reversedById === null &&
                  e.reversalOfId === null
                }
                onReverse={() => setReversing(e)}
              />
            ))}
          </ol>
          {journal.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={journal.isFetchingNextPage}
              onClick={() => void journal.fetchNextPage()}
            >
              {journal.isFetchingNextPage ? t('common.loading') : t('accounts.journal.older')}
            </Button>
          )}
        </>
      )}
      {reversing !== null && <ReverseDialog entry={reversing} onClose={() => setReversing(null)} />}
    </div>
  );
}

/** One day-book entry; opens to its debit and credit lines. */
function EntryItem({
  entry: e,
  expanded,
  onToggle,
  canReverse,
  onReverse,
}: {
  entry: JournalEntry;
  expanded: boolean;
  onToggle: () => void;
  canReverse: boolean;
  onReverse: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  const panel = `entry-${e.id}`;
  const debit = e.lines.reduce((s, l) => s + l.debit, 0);
  const credit = e.lines.reduce((s, l) => s + l.credit, 0);
  // Debits first, then the credits, as a journal is written (the Hub keeps posting order).
  const lines = [...e.lines.filter((l) => l.debit > 0), ...e.lines.filter((l) => l.debit === 0)];
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panel}
        onClick={onToggle}
        className="flex min-h-touch w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-start hover:bg-muted/50"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-5 shrink-0 transition-transform rtl:rotate-180',
            expanded && 'rotate-90 rtl:rotate-90',
          )}
        />
        <span className="w-24 shrink-0 text-sm whitespace-nowrap">{day(e.entryDate)}</span>
        <SourceBadge type={e.sourceType} />
        <span className="min-w-0 flex-1 basis-48">
          <span className="block font-medium break-words">{e.narration ?? e.entryNo}</span>
          <span className="block text-xs break-all text-muted-foreground">
            {[e.entryNo, e.sourceNo].filter((s) => s !== null).join(' · ')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {e.reversedById !== null && (
            <Badge variant="warning">{t('accounts.journal.reversed')}</Badge>
          )}
          {e.reversalOfId !== null && (
            <Badge variant="neutral">{t('accounts.journal.reversal')}</Badge>
          )}
          {e.createdByName === null ? (
            <Badge variant="outline">{t('accounts.journal.system')}</Badge>
          ) : (
            <span className="text-muted-foreground">{e.createdByName}</span>
          )}
        </span>
        <span className="ms-auto font-semibold whitespace-nowrap tabular-nums">
          {money(e.total)}
        </span>
      </button>
      {expanded && (
        <div id={panel} className="flex flex-col gap-3 border-t bg-background/50 p-3">
          <Table>
            <caption className="sr-only">
              {t('accounts.journal.linesOf', { number: e.entryNo })}
            </caption>
            <THead>
              <Tr>
                <Th>{t('accounts.journal.account')}</Th>
                <Th>{t('accounts.journal.party')}</Th>
                <Th className="text-end">{t('accounts.debit')}</Th>
                <Th className="text-end">{t('accounts.credit')}</Th>
              </Tr>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <Tr key={i}>
                  <Td>
                    <Link
                      to={`/accounts/ledgers?account=${encodeURIComponent(l.accountId)}&from=${e.entryDate.slice(0, 8)}01&to=${e.entryDate}`}
                      className={cn(
                        'break-words text-primary underline-offset-2 hover:underline',
                        l.credit > 0 && 'ps-6',
                      )}
                    >
                      {t('accounts.accountLabel', { code: l.accountCode, name: l.accountName })}
                    </Link>
                    {l.memo !== null && (
                      <span className="block text-xs text-muted-foreground">{l.memo}</span>
                    )}
                  </Td>
                  <Td className="break-words">
                    {l.partyType !== null && l.partyId !== null && l.partyType !== 'EMPLOYEE' ? (
                      <Link
                        to={`/accounts/ledgers?party=${l.partyType}&id=${encodeURIComponent(l.partyId)}&from=${e.entryDate.slice(0, 8)}01&to=${e.entryDate}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {l.partyName ?? l.partyId}
                      </Link>
                    ) : (
                      (l.partyName ?? '')
                    )}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {l.debit === 0 ? '' : money(l.debit)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {l.credit === 0 ? '' : money(l.credit)}
                  </Td>
                </Tr>
              ))}
            </TBody>
            <tfoot className="border-t-2 bg-muted font-semibold">
              <Tr>
                <Th scope="row" colSpan={2}>
                  {t('accounts.total')}
                </Th>
                <Td className="text-end whitespace-nowrap tabular-nums">{money(debit)}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">{money(credit)}</Td>
              </Tr>
            </tfoot>
          </Table>
          <p className="text-xs text-muted-foreground">
            {e.createdByName === null
              ? t('accounts.journal.postedBySystem')
              : t('accounts.journal.postedBy', { name: e.createdByName })}
          </p>
          {canReverse && (
            <Button variant="outline" size="sm" className="self-start" onClick={onReverse}>
              <Undo2 aria-hidden="true" />
              {t('accounts.journal.reverse')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Undoes a manual journal with its mirror image, dated today unless another day is given. */
function ReverseDialog({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useAccountsErrorMessage();
  const today = localIsoDate();
  const [date, setDate] = useState(today);
  const reverse = useMutation({
    mutationFn: (reason: string) =>
      api.accounting.reverse(entry.id, reason, date === '' || date === today ? undefined : date),
    onSuccess: (reversal) => {
      void invalidateAccounting(queryClient);
      toast(
        t('accounts.journal.reversedDone', { number: entry.entryNo, reversal: reversal.entryNo }),
      );
      onClose();
    },
  });
  return (
    <ReasonDialog
      title={t('accounts.journal.reverseTitle', { number: entry.entryNo })}
      description={t('accounts.journal.reverseBody')}
      confirmLabel={t('accounts.journal.reverse')}
      busy={reverse.isPending}
      error={reverse.isError ? errorMessage(reverse.error) : null}
      onConfirm={(reason) => reverse.mutate(reason)}
      onClose={onClose}
    >
      <Field label={t('accounts.journal.reverseDate')} hint={t('accounts.journal.reverseDateHint')}>
        {(p) => (
          <Input
            {...p}
            type="date"
            value={date}
            min={entry.entryDate}
            max={today}
            onChange={(ev) => setDate(ev.target.value)}
          />
        )}
      </Field>
    </ReasonDialog>
  );
}
