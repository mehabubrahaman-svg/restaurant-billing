import type { Invoice, InvoiceDraft, Order } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  BadgePercent,
  Badge,
  BookUser,
  Button,
  CircleCheck,
  cn,
  CreditCard,
  Gift,
  Receipt,
  Spinner,
  Ticket,
  X,
  type LucideIcon,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { withApproval } from '../../features/approval/with-approval';
import { usePermission } from '../../features/auth/permissions';
import { NO_OPTIONS, toBillRequest, type BillOptions } from '../../features/billing/bill-options';
import {
  BILLING_KEYS,
  isSettled,
  setInvoice,
  useBillPreview,
  useBranchSettings,
  useChargeRules,
  useOrderInvoices,
} from '../../features/billing/billing-queries';
import { useShortcuts } from '../../features/billing/use-shortcuts';
import { useNow } from '../../features/devices/use-now';
import { useElapsed } from '../../features/orders/elapsed';
import { setOrder, useOrder } from '../../features/orders/order-queries';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { BillBreakdown, useRate } from './bill-breakdown';
import { ComplimentaryDialog, CouponDialog, CustomerDialog, DiscountDialog } from './bill-dialogs';
import { CancelBillDialog } from './cancel-bill-dialog';
import { OrderQueue, useOrderLabel } from './order-queue';
import { PaymentPad, type PaymentPadHandle } from './payment-pad';
import { PaymentsList } from './payments-list';
import { PrintInvoiceActions } from './print-invoice';
import { Kbd, SETTLE_KEY, ShortcutBar } from './shortcut-bar';

const PANEL = 'flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-3 md:p-4';

/** /pos: the billing counter (wireframes §7). `?order=` is the selected order. */
export function CounterPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('order');
  const searchRef = useRef<HTMLInputElement>(null);
  const select = (id: string | null) =>
    setParams(id === null ? {} : { order: id }, { replace: true });

  useShortcuts({ F2: () => searchRef.current?.focus() });

  return (
    <div className="flex flex-col gap-2">
      <title>{`${t('pos.tabs.counter')} · ${t('app.name')}`}</title>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] xl:h-[calc(100dvh-12.5rem)] xl:min-h-[30rem] xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <OrderQueue
          searchRef={searchRef}
          selectedId={selectedId}
          onSelect={select}
          className="lg:col-span-2 xl:col-span-1 xl:min-h-0"
        />
        {selectedId === null ? (
          <div
            className={cn(
              PANEL,
              'items-center justify-center text-center lg:col-span-2 xl:col-span-2',
            )}
          >
            <Receipt aria-hidden="true" className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground">{t('pos.counter.pick')}</p>
          </div>
        ) : (
          <Workspace key={selectedId} orderId={selectedId} onDone={() => select(null)} />
        )}
      </div>
      <ShortcutBar />
    </div>
  );
}

function Workspace({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const order = useOrder(orderId);
  if (order.data === undefined) {
    return (
      <div className={cn(PANEL, 'lg:col-span-2')}>
        <QueryState query={order}>{() => null}</QueryState>
      </div>
    );
  }
  return <OrderWorkspace order={order.data} onDone={onDone} />;
}

type DialogKind = 'discount' | 'coupon' | 'comp' | 'customer' | 'cancel';

function OrderWorkspace({ order, onDone }: { order: Order; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<BillOptions>(NO_OPTIONS);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [change, setChange] = useState<number | null>(null);
  const pad = useRef<PaymentPadHandle>(null);
  const isOpen = order.status === 'OPEN';
  const request = useMemo(() => toBillRequest(options), [options]);
  const preview = useBillPreview(order.id, order.version, request, isOpen);
  const invoices = useOrderInvoices(order.id, !isOpen);
  const active = (invoices.data ?? []).filter(
    (i) => i.kind === 'INVOICE' && i.status !== 'CANCELLED',
  );
  const unpaid = active.filter((i) => !isSettled(i));
  const settled = !isOpen && active.length > 0 && unpaid.length === 0;

  const bill = useGenerateBill(order, request, () => setChange(null));
  const set = (patch: Partial<BillOptions>) => setOptions((o) => ({ ...o, ...patch }));

  useShortcuts({
    F4: isOpen ? () => setDialog('discount') : undefined,
    F9: isOpen ? () => bill.mutate() : unpaid.length > 0 ? () => pad.current?.submit() : undefined,
    F6: unpaid.length > 0 ? () => pad.current?.addTender('CARD') : undefined,
    F7: unpaid.length > 0 ? () => pad.current?.addTender('UPI') : undefined,
    F8: unpaid.length > 0 ? () => pad.current?.addTender('CASH') : undefined,
    Escape: () => {
      if (pad.current?.clear() === true) return;
      onDone();
    },
  });

  return (
    <>
      <BillSection
        order={order}
        options={options}
        onOptions={set}
        preview={preview.data?.invoices}
        previewState={preview}
        invoices={active}
        invoicesLoading={!isOpen && invoices.isPending}
      />
      <section
        aria-labelledby="pos-actions-title"
        className={cn(PANEL, 'xl:min-h-0 xl:overflow-y-auto')}
      >
        <h2 id="pos-actions-title" className="sr-only">
          {t('pos.counter.actions')}
        </h2>
        {isOpen && (
          <BillOptionsPanel
            order={order}
            options={options}
            onOptions={set}
            onOpen={setDialog}
            generate={bill}
            canGenerate={order.itemCount > 0}
          />
        )}
        {!isOpen && invoices.isPending && <Spinner label={t('common.loading')} />}
        {unpaid.length > 0 && (
          <>
            <PaymentPad
              ref={pad}
              invoices={unpaid}
              channel={
                order.salesChannelName === null
                  ? null
                  : { name: order.salesChannelName, orderId: order.externalOrderId }
              }
              onRecorded={({ change: due }) => setChange(due)}
            />
            <Button variant="outline" onClick={() => setDialog('cancel')}>
              <X aria-hidden="true" />
              {t('pos.cancelBill.action')}
            </Button>
          </>
        )}
        {settled && <PaidPanel change={change} onNext={onDone} />}
      </section>

      {dialog === 'cancel' && (
        <CancelBillDialog
          invoices={unpaid}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            setDialog(null);
            toast(t('pos.cancelBill.done'));
            void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.orderInvoices(order.id) });
          }}
        />
      )}
      <OptionDialogs
        kind={dialog}
        order={order}
        options={options}
        onOptions={(patch) => {
          set(patch);
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

/** Issues the bill; asks a manager when the discount or complimentary needs approval. */
function useGenerateBill(
  order: Order,
  request: ReturnType<typeof toBillRequest>,
  onDone: () => void,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = useRef<{ body: string; key: string } | null>(null);
  return useMutation({
    mutationFn: () => {
      const body = JSON.stringify(request);
      if (key.current?.body !== body) key.current = { body, key: newIdempotencyKey() };
      const idempotencyKey = key.current.key;
      return withApproval((approverToken) =>
        api.billing.bill(order.id, request, {
          idempotencyKey,
          ...(approverToken === undefined ? {} : { approverToken }),
        }),
      );
    },
    onSuccess: ({ invoices }) => {
      key.current = null;
      queryClient.setQueryData(BILLING_KEYS.orderInvoices(order.id), invoices);
      for (const invoice of invoices) setInvoice(queryClient, invoice);
      setOrder(queryClient, { ...order, status: 'BILLED' });
      void queryClient.invalidateQueries({ queryKey: ['orders', 'detail', order.id] });
      onDone();
      toast(
        t('pos.counter.billed', {
          count: invoices.length,
          numbers: invoices.map((i) => i.invoiceNo).join(', '),
        }),
      );
    },
  });
}

function BillSection({
  order,
  options,
  onOptions,
  preview,
  previewState,
  invoices,
  invoicesLoading,
}: {
  order: Order;
  options: BillOptions;
  onOptions: (patch: Partial<BillOptions>) => void;
  preview: InvoiceDraft[] | undefined;
  previewState: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => unknown;
  };
  invoices: Invoice[];
  invoicesLoading: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const elapsed = useElapsed();
  const now = useNow(30_000);
  const label = useOrderLabel();
  const rules = useChargeRules();
  const removable = useMemo(
    () => new Set((rules.data?.data ?? []).filter((r) => r.isOptional).map((r) => r.id)),
    [rules.data],
  );
  const removed = (rules.data?.data ?? []).filter((r) =>
    options.removeChargeRuleIds.includes(r.id),
  );
  const isOpen = order.status === 'OPEN';
  const bills: (InvoiceDraft | Invoice)[] = isOpen ? (preview ?? []) : invoices;
  const total = bills.reduce((s, b) => s + b.grandTotal, 0);
  const title =
    order.tableLabel === null
      ? label(order)
      : t('order.titleTable', { label: order.tableLabel, orderNo: order.orderNo });

  return (
    <section
      aria-labelledby="pos-bill-title"
      aria-busy={isOpen && previewState.isFetching}
      className={cn(PANEL, 'xl:min-h-0 xl:overflow-y-auto')}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h2 id="pos-bill-title" className="text-xl font-bold">
            {title}
          </h2>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span>{t(`orderTypes.${order.orderType}`)}</span>
            {order.tableLabel === null && (
              <span>{t('order.number', { orderNo: order.orderNo })}</span>
            )}
            <span className="tabular-nums">{elapsed(order.openedAt, now)}</span>
            {order.salesChannelName !== null && (
              <span className="font-medium text-foreground">
                {t('pos.queue.channel', {
                  channel: order.salesChannelName,
                  id: order.externalOrderId ?? '',
                })}
              </span>
            )}
            {order.captainName !== null && <span>{order.captainName}</span>}
            {order.covers !== null && (
              <span>{t('order.covers.count', { covers: order.covers })}</span>
            )}
          </p>
        </div>
        <Badge variant={isOpen ? 'neutral' : order.status === 'BILLED' ? 'info' : 'success'}>
          {t(`pos.orderStatus.${order.status}`)}
        </Badge>
      </header>

      {isOpen && order.pendingCount > 0 && (
        <Alert tone="warning">{t('pos.counter.unsent', { count: order.pendingCount })}</Alert>
      )}
      {isOpen && previewState.isPending && <Spinner label={t('pos.counter.computing')} />}
      {isOpen && previewState.isError && (
        <Alert tone="danger" role="alert">
          <p>{errorMessage(previewState.error)}</p>
          {isApiError(previewState.error, 'COUPON_INVALID') ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onOptions({ couponCode: null })}
            >
              {t('pos.coupon.remove')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void previewState.refetch()}
            >
              {t('common.retry')}
            </Button>
          )}
        </Alert>
      )}
      {invoicesLoading && <Spinner label={t('common.loading')} />}
      {bills.length > 1 && (
        <Alert tone="info" title={t('pos.counter.split', { count: bills.length })}>
          {t('pos.counter.splitHint')}
        </Alert>
      )}
      {bills.map((b, index) => {
        const invoice = 'invoiceNo' in b ? b : null;
        return (
          <article
            key={invoice?.id ?? `${b.series}-${index}`}
            data-series={b.series}
            aria-label={invoice?.invoiceNo ?? t(`pos.bill.series.${b.series}`)}
            className={cn('flex flex-col gap-2', bills.length > 1 && 'rounded-lg border p-3')}
          >
            {(bills.length > 1 || invoice !== null) && (
              <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                <span>{t(`pos.bill.series.${b.series}`)}</span>
                {invoice !== null && (
                  <>
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                      {invoice.invoiceNo}
                    </span>
                    <InvoiceStatusBadge status={invoice.status} />
                    <span className="ms-auto flex gap-1">
                      <PrintInvoiceActions invoice={invoice} compact />
                    </span>
                  </>
                )}
              </h3>
            )}
            <BillBreakdown
              bill={b}
              removableCharges={isOpen ? removable : new Set()}
              onRemoveCharge={(id) =>
                onOptions({ removeChargeRuleIds: [...options.removeChargeRuleIds, id] })
              }
            />
            {invoice?.gstPaidByOperator === true && (
              <p className="text-sm text-muted-foreground">{t('pos.bill.operatorGst')}</p>
            )}
            {invoice !== null && invoice.payments.length > 0 && (
              <PaymentsList payments={invoice.payments} />
            )}
          </article>
        );
      })}
      {removed.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {removed.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>{t('pos.bill.chargeRemoved', { name: r.name })}</span>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-8"
                onClick={() =>
                  onOptions({
                    removeChargeRuleIds: options.removeChargeRuleIds.filter((id) => id !== r.id),
                  })
                }
              >
                {t('pos.bill.addBack')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {bills.length > 1 && (
        <p className="flex items-baseline justify-between border-t pt-2 text-lg font-bold">
          <span>{t('pos.bill.totalAll')}</span>
          <span className="tabular-nums">{format.money(Money.ofPaise(total))}</span>
        </p>
      )}
    </section>
  );
}

const STATUS_VARIANT = {
  UNPAID: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CREDIT: 'info',
  CANCELLED: 'neutral',
  REFUNDED: 'danger',
  PARTIALLY_REFUNDED: 'danger',
} as const;

export function InvoiceStatusBadge({ status }: { status: Invoice['status'] }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`pos.invoiceStatus.${status}`)}</Badge>;
}

function BillOptionsPanel({
  order,
  options,
  onOptions,
  onOpen,
  generate,
  canGenerate,
}: {
  order: Order;
  options: BillOptions;
  onOptions: (patch: Partial<BillOptions>) => void;
  onOpen: (kind: DialogKind) => void;
  generate: ReturnType<typeof useGenerateBill>;
  canGenerate: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const rate = useRate();
  const errorMessage = useErrorMessage();
  const d = options.discount;
  const rows: {
    kind: DialogKind;
    icon: LucideIcon;
    label: string;
    value: string | null;
    clear: Partial<BillOptions>;
    shortcut?: string;
  }[] = [
    {
      kind: 'discount',
      icon: BadgePercent,
      label: t('pos.options.discount'),
      shortcut: 'F4',
      value:
        d === null
          ? null
          : d.kind === 'PERCENT'
            ? t('pos.options.discountPercent', { rate: rate(d.value), reason: d.reason })
            : t('pos.options.discountFixed', {
                amount: format.money(Money.ofPaise(d.value)),
                reason: d.reason,
              }),
      clear: { discount: null },
    },
    {
      kind: 'coupon',
      icon: Ticket,
      label: t('pos.options.coupon'),
      value: options.couponCode,
      clear: { couponCode: null },
    },
    {
      kind: 'comp',
      icon: Gift,
      label: t('pos.options.comp'),
      value: options.complimentary?.reason ?? null,
      clear: { complimentary: null },
    },
    {
      kind: 'customer',
      icon: BookUser,
      label: t('pos.options.customer'),
      value:
        options.customer === null
          ? null
          : [options.customer.name, options.customer.phone, options.customer.taxId]
              .filter((x) => x !== '')
              .join(' · '),
      clear: { customer: null },
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">{t('pos.options.title')}</h3>
      <ul className="grid grid-cols-2 gap-2">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.kind} className="relative flex min-w-0">
              <Button
                variant="outline"
                aria-pressed={row.value !== null}
                aria-keyshortcuts={row.shortcut}
                className="w-full min-w-0 flex-col items-start gap-0.5 px-2 py-2 text-start"
                onClick={() => onOpen(row.kind)}
              >
                <span className="flex w-full items-center gap-1.5">
                  <Icon aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm leading-tight break-words">
                    {row.label}
                  </span>
                  {row.shortcut !== undefined && <Kbd>{row.shortcut}</Kbd>}
                </span>
                {row.value !== null && (
                  <span className="line-clamp-2 text-xs font-normal break-all">{row.value}</span>
                )}
              </Button>
              {row.value !== null && (
                <button
                  type="button"
                  className="absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full border bg-surface text-muted-foreground hover:bg-muted"
                  aria-label={t('pos.options.clear', { option: row.label })}
                  onClick={() => onOptions(row.clear)}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {generate.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(generate.error)}
        </Alert>
      )}
      <Button
        size="lg"
        disabled={!canGenerate || generate.isPending}
        onClick={() => generate.mutate()}
        aria-keyshortcuts="F9"
      >
        <CreditCard aria-hidden="true" />
        {generate.isPending ? t('common.saving') : t('pos.counter.generate')}
        <Kbd inverted>{SETTLE_KEY}</Kbd>
      </Button>
      {order.itemCount === 0 && (
        <p className="text-sm text-muted-foreground">{t('pos.counter.noItems')}</p>
      )}
    </div>
  );
}

function OptionDialogs({
  kind,
  order,
  options,
  onOptions,
  onClose,
}: {
  kind: DialogKind | null;
  order: Order;
  options: BillOptions;
  onOptions: (patch: Partial<BillOptions>) => void;
  onClose: () => void;
}) {
  const settings = useBranchSettings();
  const canOverride = usePermission('billing.discount_override');
  const canComp = usePermission('billing.complimentary');
  switch (kind) {
    case 'discount':
      return (
        <DiscountDialog
          current={options.discount}
          subtotal={order.subtotal}
          limitBp={settings.data?.discountLimitBp ?? null}
          canOverride={canOverride}
          onApply={(discount) => onOptions({ discount })}
          onClose={onClose}
        />
      );
    case 'coupon':
      return (
        <CouponDialog
          current={options.couponCode}
          onApply={(couponCode) => onOptions({ couponCode })}
          onClose={onClose}
        />
      );
    case 'comp':
      return (
        <ComplimentaryDialog
          current={options.complimentary?.reason ?? null}
          canGive={canComp}
          onApply={(reason) => onOptions({ complimentary: { reason } })}
          onClose={onClose}
        />
      );
    case 'customer':
      return (
        <CustomerDialog
          current={options.customer}
          onApply={(customer) => onOptions({ customer })}
          onClose={onClose}
        />
      );
    default:
      return null;
  }
}

/** "Paid ✓", the change to hand back, and on to the next order. */
function PaidPanel({ change, onNext }: { change: number | null; onNext: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
      <CircleCheck aria-hidden="true" className="size-14 text-state-available-fg" />
      <p className="text-2xl font-bold">{t('pos.pay.paid')}</p>
      {change !== null && change > 0 && (
        <p className="rounded-lg bg-state-available-soft px-4 py-2 text-xl font-semibold">
          {t('pos.pay.changeDue', { amount: format.money(Money.ofPaise(change)) })}
        </p>
      )}
      <Button size="lg" onClick={onNext} autoFocus>
        {t('pos.pay.next')}
      </Button>
    </div>
  );
}
