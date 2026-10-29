import type { Account, Expense } from '@restroos/contracts';
import { splitGst } from '@restroos/domain';
import {
  Alert,
  Badge,
  Ban,
  Button,
  Dialog,
  Field,
  Input,
  Plus,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { newIdempotencyKey } from '../../api/client';
import { api, type ExpenseBody } from '../../api/endpoints';
import {
  invalidateAccounting,
  useAccounts,
  useAccountsErrorMessage,
  useExpenses,
} from '../../features/accounting/accounting-queries';
import { isCalendarDay } from '../../features/accounting/calendar-day';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { PriceField } from '../../features/menu/price-field';
import { useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { rupeesToPaise } from '../../lib/units';
import { localIsoDate } from '../pos/bills-page';
import { useMoney } from '../purchase/purchase-ui';
import { chartOrder, payingAccounts, useAccountLabel } from './accounts-ui';
import { DateRangeFields, useReportParams } from './date-range';
import { ReasonDialog } from './reason-dialog';

/** /accounts/expenses?from=&to=: rent, wages, electricity… paid from cash or the bank. */
export function ExpensesPage() {
  const { t } = useTranslation();
  const money = useMoney();
  const canManage = usePermission('expenses.manage');
  const { from, to, valid, update } = useReportParams();
  const expenses = useExpenses(from, to, valid);
  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState<Expense | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('accounts.expenses.title')}
        description={t('accounts.expenses.intro')}
        actions={
          canManage ? (
            <Button onClick={() => setRecording(true)}>
              <Plus aria-hidden="true" />
              {t('accounts.expenses.record')}
            </Button>
          ) : undefined
        }
      />
      <DateRangeFields from={from} to={to} onChange={(r) => update(r)} />
      {valid && (
        <QueryState query={expenses}>
          {({ data }) =>
            data.length === 0 ? (
              <p className="text-muted-foreground">{t('accounts.expenses.empty')}</p>
            ) : (
              <>
                <ExpenseTable
                  expenses={data}
                  canManage={canManage}
                  onCancel={(e) => setCancelling(e)}
                />
                <p className="text-end text-sm">
                  {t('accounts.expenses.total', {
                    amount: money(
                      data.filter((e) => e.status === 'POSTED').reduce((s, e) => s + e.amount, 0),
                    ),
                  })}
                </p>
              </>
            )
          }
        </QueryState>
      )}
      {recording && <ExpenseDialog onClose={() => setRecording(false)} />}
      {cancelling !== null && (
        <CancelExpenseDialog expense={cancelling} onClose={() => setCancelling(null)} />
      )}
    </div>
  );
}

function ExpenseTable({
  expenses,
  canManage,
  onCancel,
}: {
  expenses: readonly Expense[];
  canManage: boolean;
  onCancel: (expense: Expense) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  return (
    <Table>
      <caption className="sr-only">
        {t('accounts.expenses.caption', { count: expenses.length })}
      </caption>
      <THead>
        <Tr>
          <Th>{t('accounts.expenses.date')}</Th>
          <Th>{t('accounts.expenses.expense')}</Th>
          <Th>{t('accounts.expenses.paidFrom')}</Th>
          <Th className="text-end">{t('accounts.expenses.amount')}</Th>
          <Th className="text-end">{t('accounts.expenses.gst')}</Th>
          <Th>{t('accounts.expenses.status')}</Th>
          {canManage && (
            <Th>
              <span className="sr-only">{t('purchase.actions')}</span>
            </Th>
          )}
        </Tr>
      </THead>
      <TBody>
        {expenses.map((e) => (
          <Tr key={e.id} className={e.status === 'CANCELLED' ? 'text-muted-foreground' : undefined}>
            <Td className="whitespace-nowrap">
              {day(e.expenseDate)}
              {e.createdByName !== null && (
                <span className="block text-xs text-muted-foreground">{e.createdByName}</span>
              )}
            </Td>
            <Td>
              <span className="block font-medium break-words">{e.description}</span>
              <span className="block text-xs break-words text-muted-foreground">
                {[e.expenseAccountName, e.reference].filter((s) => s !== null).join(' · ')}
              </span>
              {e.cancelReason !== null && (
                <span className="block text-xs break-words">
                  {t('accounts.expenses.cancelledBecause', { reason: e.cancelReason })}
                </span>
              )}
            </Td>
            <Td className="break-words">{e.paidFromAccountName}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">{money(e.amount)}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {e.taxAmount === 0 ? '' : money(e.taxAmount)}
            </Td>
            <Td>
              <Badge variant={e.status === 'POSTED' ? 'success' : 'danger'}>
                {t(`accounts.expenses.statuses.${e.status}`)}
              </Badge>
            </Td>
            {canManage && (
              <Td className="text-end">
                {e.status === 'POSTED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={t('accounts.expenses.cancelNamed', { description: e.description })}
                    onClick={() => onCancel(e)}
                  >
                    <Ban aria-hidden="true" />
                    {t('accounts.expenses.cancel')}
                  </Button>
                )}
              </Td>
            )}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

type ExpenseErrors = Partial<
  Record<'account' | 'paidFrom' | 'amount' | 'tax' | 'description' | 'date', string>
>;

/** Records an expense: the account it is booked to, where it was paid from, amount and GST. */
function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  if (accounts.data !== undefined)
    return <ExpenseForm accounts={accounts.data.data} onClose={onClose} />;
  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={t('common.close')}
      title={t('accounts.expenses.record')}
    >
      <QueryState query={accounts}>{() => null}</QueryState>
    </Dialog>
  );
}

function ExpenseForm({ accounts, onClose }: { accounts: readonly Account[]; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useAccountsErrorMessage();
  const money = useMoney();
  const label = useAccountLabel();
  const today = localIsoDate();
  const expenseAccounts = chartOrder(accounts.filter((a) => a.type === 'EXPENSE' && a.isActive));
  const paying = payingAccounts(accounts);
  const [accountId, setAccountId] = useState('');
  const [paidFrom, setPaidFrom] = useState(paying[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState<ExpenseErrors>({});
  const key = useRef<{ body: string; key: string } | null>(null);
  const paise = rupeesToPaise(amount);
  const taxPaise = tax.trim() === '' ? 0 : rupeesToPaise(tax);
  const split =
    paise !== null && paise > 0 && taxPaise !== null && taxPaise < paise
      ? { net: paise - taxPaise, ...splitGst(taxPaise) }
      : null;
  const bookedTo = accounts.find((a) => a.id === accountId);

  const save = useMutation({
    mutationFn: async (body: ExpenseBody) => {
      const text = JSON.stringify(body);
      if (key.current?.body !== text) key.current = { body: text, key: newIdempotencyKey() };
      return api.accounting.recordExpense(body, { idempotencyKey: key.current.key });
    },
    onSuccess: (expense) => {
      void invalidateAccounting(queryClient);
      toast(t('accounts.expenses.recorded', { amount: money(expense.amount) }));
      onClose();
    },
  });

  function submit() {
    const found: ExpenseErrors = {};
    if (accountId === '') found.account = t('accounts.expenses.accountError');
    if (paidFrom === '') found.paidFrom = t('accounts.expenses.paidFromError');
    if (paise === null || paise <= 0) found.amount = t('validation.amount');
    if (taxPaise === null) found.tax = t('validation.amount');
    else if (paise !== null && taxPaise >= paise) found.tax = t('accounts.expenses.taxError');
    if (description.trim().length < 3) found.description = t('accounts.expenses.descriptionError');
    if (!isCalendarDay(date) || date > today) found.date = t('accounts.expenses.dateError');
    setErrors(found);
    if (Object.keys(found).length > 0 || paise === null || taxPaise === null) return;
    save.mutate({
      expenseAccountId: accountId,
      paidFromAccountId: paidFrom,
      amount: paise,
      taxAmount: taxPaise,
      description: description.trim(),
      reference: reference.trim() === '' ? null : reference.trim(),
      expenseDate: date,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={t('accounts.expenses.record')}
      description={t('accounts.expenses.recordHint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="expense-form" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('accounts.expenses.save')}
          </Button>
        </>
      }
    >
      <form
        id="expense-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('accounts.expenses.account')} required error={errors.account}>
            {(p) => (
              <Select {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="" disabled>
                  {t('accounts.journal.form.chooseAccount')}
                </option>
                {expenseAccounts.map(({ account }) => (
                  <option key={account.id} value={account.id}>
                    {label(account)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('accounts.expenses.paidFrom')} required error={errors.paidFrom}>
            {(p) => (
              <Select {...p} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
                {paying.map((a) => (
                  <option key={a.id} value={a.id}>
                    {label(a)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <PriceField
            label={t('accounts.expenses.amountLabel')}
            value={amount}
            onChange={setAmount}
            error={errors.amount}
            required
          />
          <PriceField
            label={t('accounts.expenses.gstLabel')}
            hint={t('accounts.expenses.gstHint')}
            value={tax}
            onChange={setTax}
            error={errors.tax}
          />
        </div>
        <Field label={t('accounts.expenses.description')} required error={errors.description}>
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('accounts.expenses.reference')} hint={t('common.optional')}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={60}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('accounts.expenses.date')} required error={errors.date}>
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
        </div>
        {split !== null && (
          <p className="rounded-lg bg-muted p-3 text-sm" aria-live="polite">
            {split.cgst + split.sgst === 0
              ? t('accounts.expenses.splitNoTax', {
                  account: bookedTo?.name ?? t('accounts.expenses.theExpense'),
                  amount: money(split.net),
                })
              : t('accounts.expenses.split', {
                  account: bookedTo?.name ?? t('accounts.expenses.theExpense'),
                  amount: money(split.net),
                  cgst: money(split.cgst),
                  sgst: money(split.sgst),
                })}
          </p>
        )}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

function CancelExpenseDialog({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useAccountsErrorMessage();
  const money = useMoney();
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      api.accounting.cancelExpense(expense.id, expense.version, reason),
    onSuccess: () => {
      void invalidateAccounting(queryClient);
      toast(t('accounts.expenses.cancelled', { description: expense.description }));
      onClose();
    },
  });
  return (
    <ReasonDialog
      title={t('accounts.expenses.cancelTitle', { description: expense.description })}
      description={t('accounts.expenses.cancelBody', { amount: money(expense.amount) })}
      confirmLabel={t('accounts.expenses.cancel')}
      busy={cancel.isPending}
      error={cancel.isError ? errorMessage(cancel.error) : null}
      onConfirm={(reason) => cancel.mutate(reason)}
      onClose={onClose}
    />
  );
}
