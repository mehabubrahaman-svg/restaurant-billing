import type { Invoice } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Banknote,
  Bike,
  BookUser,
  Button,
  cn,
  CreditCard,
  Field,
  Input,
  SegmentedControl,
  Smartphone,
  Wallet,
  X,
  type LucideIcon,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { withApproval } from '../../features/approval/with-approval';
import { usePermission } from '../../features/auth/permissions';
import { setInvoice, useCurrentShift } from '../../features/billing/billing-queries';
import {
  allocatePayments,
  checkPad,
  HAS_TERMINAL,
  newEntry,
  quickCash,
  type EntryProblem,
  type PaymentEntry,
  type Tender,
} from '../../features/billing/payments';
import { requestOpenShift } from '../../features/billing/shift-prompt';
import { lastTerminal, rememberTerminal } from '../../features/billing/terminal-memory';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { paiseToRupees } from '../../lib/units';
import { Kbd, SETTLE_KEY } from './shortcut-bar';

export const TENDER_LOOK: Readonly<Record<Tender, { icon: LucideIcon; key?: string }>> = {
  CASH: { icon: Banknote, key: 'F8' },
  CARD: { icon: CreditCard, key: 'F6' },
  UPI: { icon: Smartphone, key: 'F7' },
  WALLET: { icon: Wallet },
  CREDIT: { icon: BookUser },
  AGGREGATOR: { icon: Bike },
};

export interface PaymentPadHandle {
  addTender(method: Tender): void;
  submit(): void;
  /** Drops the entries; false when there were none. */
  clear(): boolean;
}

/**
 * The payment pad (wireframes §7, right): tender buttons, split entries with
 * the slip details for card/UPI, quick cash and change, then "Record payment".
 * Takes the unpaid invoices of one order; with INV + LIQ they can be paid
 * together or one at a time.
 */
export function PaymentPad({
  invoices,
  channel = null,
  onRecorded,
  ref,
}: {
  invoices: readonly Invoice[];
  /** A delivery-app order: it is settled to the channel, with the channel's order number. */
  channel?: { name: string; orderId: string | null } | null;
  /** After the Hub recorded the payments: change to hand back, in paise. */
  onRecorded: (result: { change: number; invoices: Invoice[] }) => void;
  ref?: Ref<PaymentPadHandle>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const shift = useCurrentShift();
  const canCredit = usePermission('billing.credit_sale');
  const [target, setTarget] = useState<string>('ALL');
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [attempted, setAttempted] = useState(false);
  const keys = useRef(new Map<string, string>());
  const money = (paise: number) => format.money(Money.ofPaise(paise));

  const targets = useMemo(
    () => (target === 'ALL' ? invoices : invoices.filter((i) => i.id === target)),
    [invoices, target],
  );
  const due = targets.reduce((sum, i) => sum + i.balance, 0);
  const hasCustomerName = targets.every((i) => (i.customerName ?? '').trim() !== '');
  const check = checkPad(entries, due, { hasCustomerName });
  const tenders: Tender[] = [
    ...(channel === null ? [] : ['AGGREGATOR' as const]),
    'CASH',
    'CARD',
    'UPI',
    'WALLET',
    ...(canCredit ? ['CREDIT' as const] : []),
  ];
  const knownTerminals = useMemo(
    () => [
      ...new Set((shift.data?.tenders ?? []).map((x) => x.terminalLabel).filter((l) => l !== '')),
    ],
    [shift.data],
  );

  const record = useMutation({
    mutationFn: async () => {
      const plan = allocatePayments(check, targets);
      const results: Invoice[] = [];
      for (const [invoiceId, payments] of plan) {
        const id = `${invoiceId}:${JSON.stringify(payments)}`;
        let key = keys.current.get(id);
        if (key === undefined) {
          key = newIdempotencyKey();
          keys.current.set(id, key);
        }
        const idempotencyKey = key;
        const pay = () =>
          withApproval((approverToken) =>
            api.billing.pay(invoiceId, payments, {
              idempotencyKey,
              ...(approverToken === undefined ? {} : { approverToken }),
            }),
          );
        let invoice: Invoice;
        try {
          invoice = await pay();
        } catch (error) {
          // Cash needs an open shift on this counter: open one, then try once more.
          if (!isApiError(error, 'SHIFT_NOT_OPEN') || !(await requestOpenShift())) throw error;
          invoice = await pay();
        }
        setInvoice(queryClient, invoice);
        results.push(invoice);
      }
      return results;
    },
    onSuccess: (results) => {
      for (const e of entries) {
        if (HAS_TERMINAL.has(e.method)) rememberTerminal(e.method, e.terminalLabel);
      }
      const change = check.change;
      keys.current.clear();
      setEntries([]);
      setAttempted(false);
      onRecorded({ change, invoices: results });
    },
  });

  function addTender(method: Tender) {
    if (record.isPending) return;
    const remaining = Math.max(0, check.remaining);
    const reference = method === 'AGGREGATOR' ? (channel?.orderId ?? '') : '';
    setEntries((list) => [...list, newEntry(method, remaining, lastTerminal(method), reference)]);
    // The Hub refuses cash without an open shift: ask for one now, not at the end.
    if (method === 'CASH' && shift.data === null) void requestOpenShift();
  }

  function submit() {
    setAttempted(true);
    if (check.ok && !record.isPending) record.mutate();
  }

  useImperativeHandle(ref, () => ({
    addTender,
    submit,
    clear: () => {
      if (entries.length === 0) return false;
      setEntries([]);
      return true;
    },
  }));

  const update = (key: string, patch: Partial<PaymentEntry>) =>
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  return (
    <section aria-labelledby="pay-title" className="flex flex-col gap-3">
      <h3 id="pay-title" className="text-lg font-semibold">
        {t('pos.pay.title')}
      </h3>
      {invoices.length > 1 && (
        <SegmentedControl<string>
          aria-label={t('pos.pay.target')}
          size="sm"
          className="flex-wrap"
          value={target}
          onValueChange={(v) => {
            setTarget(v);
            setEntries([]);
          }}
          options={[
            {
              value: 'ALL',
              label: t('pos.pay.together', {
                amount: money(invoices.reduce((s, i) => s + i.balance, 0)),
              }),
            },
            ...invoices.map((i) => ({
              value: i.id,
              label: t('pos.pay.only', {
                series: t(`pos.bill.series.${i.series}`),
                amount: money(i.balance),
              }),
            })),
          ]}
        />
      )}
      <dl className="sticky -top-3 z-10 -mx-1 grid grid-cols-3 gap-2 bg-surface px-1 py-1 text-center md:-top-4">
        <Figure label={t('pos.pay.due')} value={money(due)} />
        <Figure label={t('pos.pay.entered')} value={money(check.total)} />
        <Figure
          label={check.overpaid ? t('pos.pay.over') : t('pos.pay.remaining')}
          value={money(Math.abs(check.remaining))}
          tone={check.overpaid ? 'danger' : check.remaining === 0 ? 'ok' : undefined}
        />
      </dl>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('pos.pay.tenders')}>
        {tenders.map((method) => {
          const look = TENDER_LOOK[method];
          const Icon = look.icon;
          return (
            <Button
              key={method}
              variant="outline"
              className="flex-col gap-1 px-2 py-2"
              disabled={record.isPending || (check.remaining <= 0 && entries.length > 0)}
              onClick={() => addTender(method)}
              aria-keyshortcuts={look.key}
            >
              <Icon aria-hidden="true" />
              <span>
                {method === 'AGGREGATOR' && channel !== null
                  ? channel.name
                  : t(`pos.tenders.${method}`)}
              </span>
              {look.key !== undefined && <Kbd>{look.key}</Kbd>}
            </Button>
          );
        })}
      </div>
      {entries.length === 0 && <p className="text-sm text-muted-foreground">{t('pos.pay.pick')}</p>}
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <datalist id="pos-terminals">
          {knownTerminals.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        <ol className="flex flex-col gap-3">
          {check.entries.map((c, index) => (
            <EntryCard
              key={c.entry.key}
              index={index}
              entry={c.entry}
              amount={c.amount}
              tendered={c.tendered}
              problems={c.problems}
              showErrors={attempted}
              onChange={(patch) => update(c.entry.key, patch)}
              onRemove={() => setEntries((list) => list.filter((e) => e.key !== c.entry.key))}
            />
          ))}
        </ol>
        {check.overpaid && (
          <Alert tone="danger" role="alert">
            {t('errors.overpayment')}
          </Alert>
        )}
        {record.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(record.error)}
          </Alert>
        )}
        {check.change > 0 && (
          <p className="rounded-lg bg-state-available-soft p-3 text-center text-lg font-semibold">
            {t('pos.pay.changeDue', { amount: money(check.change) })}
          </p>
        )}
        {entries.length > 0 && (
          <Button
            type="submit"
            size="lg"
            disabled={!check.ok || record.isPending}
            aria-keyshortcuts="F9"
          >
            {record.isPending
              ? t('common.saving')
              : t('pos.pay.record', { amount: money(check.total) })}
            <Kbd inverted>{SETTLE_KEY}</Kbd>
          </Button>
        )}
      </form>
    </section>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'ok' | undefined;
}) {
  return (
    <div className="flex flex-col rounded-lg bg-muted px-2 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'font-semibold tabular-nums',
          tone === 'danger' && 'text-state-danger-fg',
          tone === 'ok' && 'text-state-available-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const PROBLEM_KEYS: Readonly<Record<EntryProblem, string>> = {
  amount: 'validation.amount',
  tendered: 'pos.pay.tenderedShort',
  reference: 'pos.pay.referenceRequired',
  cardLast4: 'pos.pay.last4Invalid',
  creditNeedsCustomer: 'pos.pay.creditNeedsCustomer',
};

function EntryCard({
  index,
  entry,
  amount,
  tendered,
  problems,
  showErrors,
  onChange,
  onRemove,
}: {
  index: number;
  entry: PaymentEntry;
  amount: number | null;
  tendered: number | null;
  problems: readonly EntryProblem[];
  showErrors: boolean;
  onChange: (patch: Partial<PaymentEntry>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const Icon = TENDER_LOOK[entry.method].icon;
  const method = t(`pos.tenders.${entry.method}`);
  const show = (p: EntryProblem) =>
    problems.includes(p) ? t(PROBLEM_KEYS[p] as 'validation.amount') : undefined;
  // Touched fields only: an empty reference is not an error until something was typed elsewhere.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = (f: string) => setTouched((s) => new Set(s).add(f));
  const shown = (f: string, p: EntryProblem) =>
    showErrors || touched.has(f) ? show(p) : undefined;

  return (
    <li className="flex flex-col gap-3 rounded-xl border p-3" data-method={entry.method}>
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 font-semibold">
          {t('pos.pay.entryTitle', { index: index + 1, method })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('pos.pay.removeEntry', { index: index + 1, method })}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('pos.pay.amount')} error={shown('amount', 'amount')}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              autoComplete="off"
              value={entry.amount}
              autoFocus={entry.method === 'WALLET' || entry.method === 'CREDIT'}
              onBlur={() => touch('amount')}
              onChange={(e) => onChange({ amount: e.target.value })}
            />
          )}
        </Field>
        {entry.method === 'CASH' && (
          <Field label={t('pos.pay.tendered')} error={shown('tendered', 'tendered')}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                placeholder={amount === null ? '' : paiseToRupees(amount)}
                value={entry.tendered}
                autoFocus
                onBlur={() => touch('tendered')}
                onChange={(e) => onChange({ tendered: e.target.value })}
              />
            )}
          </Field>
        )}
        {HAS_TERMINAL.has(entry.method) && (
          <Field
            label={entry.method === 'WALLET' ? t('pos.pay.walletApp') : t('pos.pay.terminal')}
            hint={t('pos.pay.terminalHint')}
          >
            {(p) => (
              <Input
                {...p}
                list="pos-terminals"
                autoComplete="off"
                maxLength={40}
                value={entry.terminalLabel}
                onChange={(e) => onChange({ terminalLabel: e.target.value })}
              />
            )}
          </Field>
        )}
        {(entry.method === 'CARD' ||
          entry.method === 'UPI' ||
          entry.method === 'WALLET' ||
          entry.method === 'AGGREGATOR') && (
          <Field
            label={
              entry.method === 'CARD'
                ? t('pos.pay.approvalCode')
                : entry.method === 'UPI'
                  ? t('pos.pay.rrn')
                  : entry.method === 'AGGREGATOR'
                    ? t('pos.delivery.externalId')
                    : t('pos.pay.walletRef')
            }
            error={shown('reference', 'reference')}
            required={entry.method !== 'WALLET'}
          >
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={40}
                value={entry.reference}
                autoFocus={entry.method !== 'WALLET'}
                onBlur={() => touch('reference')}
                onChange={(e) => onChange({ reference: e.target.value })}
              />
            )}
          </Field>
        )}
        {entry.method === 'CARD' && (
          <Field label={t('pos.pay.last4')} error={shown('cardLast4', 'cardLast4')}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={entry.cardLast4}
                onBlur={() => touch('cardLast4')}
                onChange={(e) => onChange({ cardLast4: e.target.value.replace(/\D/g, '') })}
              />
            )}
          </Field>
        )}
      </div>
      {(entry.method === 'CARD' || entry.method === 'UPI') && amount !== null && (
        <p className="text-sm text-muted-foreground">
          {t('pos.pay.terminalStep', { amount: money(amount) })}
        </p>
      )}
      {entry.method === 'CASH' && amount !== null && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('pos.pay.quickCash')}
        >
          {quickCash(amount).map((value) => (
            <Button
              key={value}
              size="sm"
              variant="outline"
              aria-pressed={tendered === value && entry.tendered !== ''}
              onClick={() => onChange({ tendered: paiseToRupees(value) })}
            >
              {value === amount ? t('pos.pay.exact') : money(value)}
            </Button>
          ))}
          {tendered !== null && tendered > amount && (
            <span className="ms-auto font-semibold text-state-available-fg">
              {t('pos.pay.change', { amount: money(tendered - amount) })}
            </span>
          )}
        </div>
      )}
      {problems.includes('creditNeedsCustomer') && (
        <Alert tone="warning">{t('pos.pay.creditNeedsCustomer')}</Alert>
      )}
    </li>
  );
}
