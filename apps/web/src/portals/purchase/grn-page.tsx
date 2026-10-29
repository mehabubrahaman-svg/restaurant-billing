import type { Grn } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Ban,
  Banknote,
  Button,
  Card,
  CircleCheck,
  Pencil,
  Printer,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  invalidatePurchasing,
  PURCHASING_KEYS,
  useGrn,
  usePurchaseErrorMessage,
  useVendor,
  useVendorPayments,
} from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { ReasonDialog } from '../accounts/reason-dialog';
import { PaymentDialog } from './payment-dialog';
import { PaymentsTable } from './payments-page';
import {
  Facts,
  GrnStatusBadge,
  TotalsBox,
  useMoney,
  useQuantity,
  useTaxRate,
  useUnitLabel,
} from './purchase-ui';
import { useInputTaxHint } from './vendor-dialog';

/** /purchase/grns/:grnId: one goods received note, its lines, tax, balance and payments. */
export function GrnPage() {
  const { grnId = '' } = useParams();
  const grn = useGrn(grnId);
  return <QueryState query={grn}>{(g) => <GrnDetail grn={g} />}</QueryState>;
}

function GrnDetail({ grn }: { grn: Grn }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = usePurchaseErrorMessage();
  const money = useMoney();
  const format = useFormat();
  const day = useDayFormat();
  const quantity = useQuantity();
  const unitLabel = useUnitLabel();
  const rate = useTaxRate();
  const taxHint = useInputTaxHint();
  const canReceive = usePermission('grn.post');
  const canPay = usePermission('vendor_payments.create');
  const [dialog, setDialog] = useState<'post' | 'cancel' | 'pay' | null>(null);
  const isDraft = grn.status === 'DRAFT';
  // A draft's tax treatment is only fixed when it is posted: preview it from the vendor's GSTIN.
  const vendor = useVendor(grn.vendorId, isDraft);
  const payments = useVendorPayments({ vendorId: grn.vendorId }, grn.status === 'POSTED');
  const own = (payments.data?.data ?? []).filter((p) => p.grnId === grn.id);

  const done = (saved: Grn, message: string) => {
    queryClient.setQueryData(PURCHASING_KEYS.grn(saved.id), saved);
    void invalidatePurchasing(queryClient);
    toast(message);
    setDialog(null);
  };
  const post = useMutation({
    mutationFn: () => api.purchasing.postGrn(grn.id, grn.version),
    onSuccess: (saved) => done(saved, t('purchase.grns.posted', { number: saved.grnNo })),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.purchasing.cancelGrn(grn.id, grn.version, reason),
    onSuccess: (saved) => done(saved, t('purchase.grns.cancelled', { number: saved.grnNo })),
  });

  const taxRow = isDraft
    ? vendor.data === undefined
      ? t('common.loading')
      : t('purchase.grns.taxWhenPosted', { hint: taxHint(vendor.data.taxId ?? '') })
    : t(`purchase.inputTax.${grn.inputTaxKind}`);

  return (
    <article className="flex flex-col gap-4">
      <title>{`${grn.grnNo} · ${t('app.name')}`}</title>
      <Link
        to="/purchase/grns"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('purchase.grns.back')}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            <span className="break-all">{grn.grnNo}</span>
            <GrnStatusBadge status={grn.status} />
          </h1>
          <p className="flex flex-wrap gap-x-3 text-muted-foreground">
            <Link
              to={`/purchase/vendors/${grn.vendorId}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {grn.vendorName}
            </Link>
            {grn.purchaseOrderId !== null && grn.poNo !== null && (
              <Link
                to={`/purchase/orders/${grn.purchaseOrderId}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {t('purchase.grns.againstOrder', { number: grn.poNo })}
              </Link>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {isDraft && canReceive && (
            <>
              <Button asChild variant="outline">
                <Link to={`/purchase/grns/${grn.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  {t('common.edit')}
                </Link>
              </Button>
              <Button onClick={() => setDialog('post')}>
                <CircleCheck aria-hidden="true" />
                {t('purchase.grns.post')}
              </Button>
              <Button variant="outline" onClick={() => setDialog('cancel')}>
                <Ban aria-hidden="true" />
                {t('purchase.grns.cancel')}
              </Button>
            </>
          )}
          {grn.status === 'POSTED' && grn.balance > 0 && canPay && (
            <Button onClick={() => setDialog('pay')}>
              <Banknote aria-hidden="true" />
              {t('purchase.payments.record')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t('purchase.print')}
          </Button>
        </div>
      </header>
      {grn.status === 'CANCELLED' && grn.cancelReason !== null && (
        <Alert tone="warning">
          {t('purchase.grns.cancelledBecause', { reason: grn.cancelReason })}
        </Alert>
      )}
      {isDraft && <Alert tone="info">{t('purchase.grns.draftNote')}</Alert>}
      <Card className="p-4">
        <Facts
          rows={[
            [t('purchase.grns.receivedOn'), day(grn.businessDate)],
            [
              t('purchase.grns.vendorBill'),
              grn.vendorInvoiceNo === null
                ? t('reports.none')
                : grn.vendorInvoiceDate === null
                  ? grn.vendorInvoiceNo
                  : t('purchase.grns.billOn', {
                      number: grn.vendorInvoiceNo,
                      date: day(grn.vendorInvoiceDate),
                    }),
            ],
            [t('purchase.grns.inputTax'), taxRow],
            ...(grn.dueOn === null ? [] : [[t('purchase.grns.dueOn'), day(grn.dueOn)] as const]),
            ...(grn.postedAt === null
              ? []
              : [
                  [
                    t('purchase.grns.postedBy'),
                    [format.dateTime(grn.postedAt), grn.postedByName]
                      .filter((s) => s !== null)
                      .join(' · '),
                  ] as const,
                ]),
            [
              t('purchase.orders.created'),
              [format.dateTime(grn.createdAt), grn.createdByName]
                .filter((s) => s !== null)
                .join(' · '),
            ],
            ...(grn.notes === null ? [] : [[t('purchase.orders.notes'), grn.notes] as const]),
          ]}
        />
      </Card>

      <section aria-labelledby="grn-lines" className="flex flex-col gap-2">
        <h2 id="grn-lines" className="text-lg font-semibold">
          {t('purchase.grns.linesTitle')}
        </h2>
        <Table>
          <THead>
            <Tr>
              <Th>{t('purchase.lines.item')}</Th>
              <Th className="text-end">{t('purchase.lines.delivered')}</Th>
              <Th className="text-end">{t('purchase.lines.rejected')}</Th>
              <Th className="text-end">{t('purchase.lines.accepted')}</Th>
              <Th className="text-end">{t('purchase.lines.price')}</Th>
              <Th className="text-end">{t('purchase.lines.gst')}</Th>
              <Th className="text-end">{t('purchase.totals.total')}</Th>
              <Th>{t('purchase.lines.batch')}</Th>
            </Tr>
          </THead>
          <TBody>
            {grn.lines.map((l) => (
              <Tr key={l.id}>
                <Td className="break-words">{l.itemName}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {quantity(l.quantityMilli, l.unitCode)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {l.rejectedQtyMilli === 0 ? '' : quantity(l.rejectedQtyMilli, l.unitCode)}
                </Td>
                <Td className="text-end font-medium whitespace-nowrap tabular-nums">
                  {quantity(l.acceptedQtyMilli, l.unitCode)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {t('purchase.lines.perUnit', {
                    price: money(l.unitPrice),
                    unit: unitLabel(l.unitCode),
                  })}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">{rate(l.taxRateBp)}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">{money(l.total)}</Td>
                <Td className="text-sm">
                  {l.batchNo !== null && <span className="block break-all">{l.batchNo}</span>}
                  {l.expiresOn !== null && (
                    <span className="block whitespace-nowrap text-muted-foreground">
                      {t('purchase.lines.expires', { date: day(l.expiresOn) })}
                    </span>
                  )}
                  {l.batchNo === null && l.expiresOn === null && t('reports.none')}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>
      <TotalsBox
        subtotal={grn.subtotal}
        tax={grn.taxTotal}
        total={grn.grandTotal}
        extra={
          grn.status === 'POSTED'
            ? [
                [t('purchase.totals.paid'), grn.paid],
                [t('purchase.totals.balance'), grn.balance],
              ]
            : []
        }
      />
      {grn.status === 'POSTED' && own.length > 0 && (
        <section aria-labelledby="grn-payments" className="flex flex-col gap-2">
          <h2 id="grn-payments" className="text-lg font-semibold">
            {t('purchase.vendors.payments')}
          </h2>
          <PaymentsTable payments={own} showVendor={false} />
        </section>
      )}

      {dialog === 'post' && (
        <ConfirmDialog
          title={t('purchase.grns.postTitle', { number: grn.grnNo })}
          body={
            <div className="flex flex-col gap-2">
              <p>
                {t('purchase.grns.postBody', {
                  count: grn.lines.length,
                  amount: money(grn.grandTotal),
                  vendor: grn.vendorName,
                })}
              </p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {grn.lines
                  .filter((l) => l.acceptedQtyMilli > 0)
                  .map((l) => (
                    <li key={l.id}>
                      {t('purchase.grns.postLine', {
                        item: l.itemName,
                        qty: quantity(l.acceptedQtyMilli, l.unitCode),
                      })}
                    </li>
                  ))}
              </ul>
              <p className="text-sm font-medium">{t('purchase.grns.postFinal')}</p>
            </div>
          }
          confirmLabel={t('purchase.grns.post')}
          busy={post.isPending}
          error={post.isError ? errorMessage(post.error) : null}
          onConfirm={() => post.mutate()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog
          title={t('purchase.grns.cancelTitle', { number: grn.grnNo })}
          description={t('purchase.grns.cancelBody')}
          confirmLabel={t('purchase.grns.cancel')}
          busy={cancel.isPending}
          error={cancel.isError ? errorMessage(cancel.error) : null}
          onConfirm={(reason) => cancel.mutate(reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'pay' && <PaymentDialog grn={grn} onClose={() => setDialog(null)} />}
    </article>
  );
}
