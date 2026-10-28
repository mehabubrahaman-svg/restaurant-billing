import type { Invoice } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Alert, ArrowLeft, Ban, Button, RotateCcw, Undo2 } from '@restroos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { QueryState } from '../../features/admin/query-state';
import {
  BILLING_KEYS,
  useCreditNotes,
  useInvoice,
  useOrderInvoices,
} from '../../features/billing/billing-queries';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { BillBreakdown } from './bill-breakdown';
import { CancelBillDialog } from './cancel-bill-dialog';
import { InvoiceStatusBadge } from './counter-page';
import { useOrderLabel } from './order-queue';
import { PaymentsList } from './payments-list';
import { PrintInvoiceActions } from './print-invoice';
import { RefundDialog } from './refund-dialog';

/** /pos/bills/:invoiceId: one invoice or credit note with its payments and refunds. */
export function InvoiceDetailPage() {
  const { invoiceId = '' } = useParams();
  const invoice = useInvoice(invoiceId);
  return <QueryState query={invoice}>{(i) => <InvoiceDetail invoice={i} />}</QueryState>;
}

const REFUNDABLE = new Set<Invoice['status']>(['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED']);
const CANCELLABLE = new Set<Invoice['status']>(['UNPAID', 'PARTIALLY_PAID', 'PAID']);

function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const format = useFormat();
  const label = useOrderLabel();
  const queryClient = useQueryClient();
  const siblings = useOrderInvoices(invoice.orderId);
  const [dialog, setDialog] = useState<'refund' | 'cancel' | null>(null);
  const all = siblings.data ?? [];
  const creditNotes = useCreditNotes(invoice);
  const originalQuery = useInvoice(
    invoice.originalInvoiceId ?? '',
    invoice.originalInvoiceId !== null,
  );
  const original = invoice.originalInvoiceId === null ? null : (originalQuery.data ?? null);
  const isInvoice = invoice.kind === 'INVOICE';
  const canRefund = isInvoice && REFUNDABLE.has(invoice.status) && invoice.paidTotal > 0;
  const canCancel = isInvoice && CANCELLABLE.has(invoice.status);
  const pair = all.filter(
    (i) => i.kind === 'INVOICE' && i.status !== 'CANCELLED' && i.id !== invoice.id,
  );

  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <title>{`${invoice.invoiceNo} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('pos.detail.back')}>
          <Link to={`/pos/bills?date=${invoice.businessDate}`}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold">
            <span className="tabular-nums">{invoice.invoiceNo}</span>
            <InvoiceStatusBadge status={invoice.status} />
          </h2>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span>{t(`pos.bill.series.${invoice.series}`)}</span>
            <span>{label(invoice)}</span>
            <span>{t('order.number', { orderNo: invoice.orderNo })}</span>
            <span>{format.dateTime(invoice.createdAt)}</span>
            {invoice.createdByName !== null && <span>{invoice.createdByName}</span>}
          </p>
          {(invoice.customerName !== null || invoice.customerTaxId !== null) && (
            <p className="text-sm">
              {t('pos.detail.customer', {
                name: invoice.customerName ?? '',
                gstin: invoice.customerTaxId ?? '',
              })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRefund && (
            <Button variant="outline" onClick={() => setDialog('refund')}>
              <Undo2 aria-hidden="true" />
              {t('pos.detail.refund')}
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" onClick={() => setDialog('cancel')}>
              <Ban aria-hidden="true" />
              {t('pos.detail.cancel')}
            </Button>
          )}
          <PrintInvoiceActions invoice={invoice} />
        </div>
      </header>

      {invoice.status === 'CANCELLED' && invoice.cancelReason !== null && (
        <Alert tone="warning">{t('pos.detail.cancelled', { reason: invoice.cancelReason })}</Alert>
      )}
      {original !== null && (
        <Alert tone="info">
          {t('pos.detail.creditNoteFor')}{' '}
          <Link to={`/pos/bills/${original.id}`} className="font-medium underline">
            {original.invoiceNo}
          </Link>
        </Alert>
      )}

      <section className="rounded-xl border bg-surface p-4">
        <BillBreakdown bill={invoice} />
      </section>
      {invoice.payments.length > 0 && (
        <section className="rounded-xl border bg-surface p-4">
          <PaymentsList payments={invoice.payments} level={3} />
        </section>
      )}
      {creditNotes.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border bg-surface p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <RotateCcw aria-hidden="true" className="size-4" />
            {t('pos.detail.creditNotes')}
          </h3>
          <ul className="flex flex-col gap-1">
            {creditNotes.map((cn) => (
              <li key={cn.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Link to={`/pos/bills/${cn.id}`} className="font-medium text-primary underline">
                  {cn.invoiceNo}
                </Link>
                <span className="text-muted-foreground">{format.dateTime(cn.createdAt)}</span>
                <span className="ms-auto tabular-nums">
                  {format.money(Money.ofPaise(Math.abs(cn.grandTotal)))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog === 'refund' && (
        <RefundDialog
          invoice={invoice}
          creditNotes={creditNotes}
          onClose={() => setDialog(null)}
          onRefunded={(cn) => {
            setDialog(null);
            toast(t('pos.refund.done', { number: cn.invoiceNo }));
            void queryClient.invalidateQueries({
              queryKey: BILLING_KEYS.orderInvoices(invoice.orderId),
            });
            void queryClient.invalidateQueries({ queryKey: BILLING_KEYS.invoiceLists });
          }}
        />
      )}
      {dialog === 'cancel' && (
        <CancelBillDialog
          invoices={[invoice, ...pair]}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            setDialog(null);
            toast(t('pos.cancelBill.done'));
          }}
        />
      )}
    </article>
  );
}
