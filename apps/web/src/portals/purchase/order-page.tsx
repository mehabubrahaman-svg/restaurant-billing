import type { PurchaseOrder } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Ban,
  Button,
  Card,
  Check,
  CircleCheck,
  Package,
  Pencil,
  Printer,
  Send,
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
  usePurchaseErrorMessage,
  usePurchaseOrder,
} from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { ReasonDialog } from '../accounts/reason-dialog';
import {
  Facts,
  GrnStatusBadge,
  PoStatusBadge,
  TotalsBox,
  useMoney,
  useQuantity,
  useTaxRate,
  useUnitLabel,
} from './purchase-ui';

/** Goods can be received against a PO in these states (domain `isReceivable`). */
const RECEIVABLE = new Set<PurchaseOrder['status']>(['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']);
const CANCELLABLE = new Set<PurchaseOrder['status']>(['DRAFT', 'APPROVED', 'SENT']);
const CLOSABLE = new Set<PurchaseOrder['status']>(['PARTIALLY_RECEIVED', 'RECEIVED']);

/** /purchase/orders/:poId: one purchase order with what has arrived, its GRNs and next steps. */
export function OrderPage() {
  const { poId = '' } = useParams();
  const po = usePurchaseOrder(poId);
  return <QueryState query={po}>{(o) => <OrderDetail po={o} />}</QueryState>;
}

type Step = 'approve' | 'send' | 'close';

function OrderDetail({ po }: { po: PurchaseOrder }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = usePurchaseErrorMessage();
  const money = useMoney();
  const format = useFormat();
  const day = useDayFormat();
  const quantity = useQuantity();
  const unitLabel = useUnitLabel();
  const rate = useTaxRate();
  const canEdit = usePermission('po.create');
  const canApprove = usePermission('po.approve');
  const canReceive = usePermission('grn.post');
  const [dialog, setDialog] = useState<'cancel' | 'close' | null>(null);

  const done = (saved: PurchaseOrder, message: string) => {
    queryClient.setQueryData(PURCHASING_KEYS.order(saved.id), saved);
    void invalidatePurchasing(queryClient);
    toast(message);
    setDialog(null);
  };
  const move = useMutation({
    mutationFn: (step: Step) => api.purchasing.moveOrder(po.id, step, po.version),
    onSuccess: (saved, step) =>
      done(saved, t(`purchase.orders.done.${step}`, { number: saved.poNo })),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.purchasing.cancelOrder(po.id, po.version, reason),
    onSuccess: (saved) => done(saved, t('purchase.orders.done.cancel', { number: saved.poNo })),
  });
  const busy = move.isPending || cancel.isPending;
  const due = po.lines.reduce((n, l) => n + (l.receivedQtyMilli < l.quantityMilli ? 1 : 0), 0);

  return (
    <article className="flex flex-col gap-4">
      <title>{`${po.poNo} · ${t('app.name')}`}</title>
      <Link
        to="/purchase/orders"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('purchase.orders.back')}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            <span className="break-all">{po.poNo}</span>
            <PoStatusBadge status={po.status} />
          </h1>
          <p className="text-muted-foreground">
            <Link
              to={`/purchase/vendors/${po.vendorId}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {po.vendorName}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {po.status === 'DRAFT' && canEdit && (
            <Button asChild variant="outline">
              <Link to={`/purchase/orders/${po.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Link>
            </Button>
          )}
          {po.status === 'DRAFT' && canApprove && (
            <Button disabled={busy} onClick={() => move.mutate('approve')}>
              <Check aria-hidden="true" />
              {t('purchase.orders.approve')}
            </Button>
          )}
          {po.status === 'APPROVED' && canEdit && (
            <Button variant="outline" disabled={busy} onClick={() => move.mutate('send')}>
              <Send aria-hidden="true" />
              {t('purchase.orders.markSent')}
            </Button>
          )}
          {RECEIVABLE.has(po.status) && canReceive && (
            <Button asChild>
              <Link to={`/purchase/grns/new?po=${po.id}`}>
                <Package aria-hidden="true" />
                {t('purchase.orders.receive')}
              </Link>
            </Button>
          )}
          {CLOSABLE.has(po.status) && canEdit && (
            <Button variant="outline" disabled={busy} onClick={() => setDialog('close')}>
              <CircleCheck aria-hidden="true" />
              {t('purchase.orders.close')}
            </Button>
          )}
          {CANCELLABLE.has(po.status) && canEdit && (
            <Button variant="outline" disabled={busy} onClick={() => setDialog('cancel')}>
              <Ban aria-hidden="true" />
              {t('purchase.orders.cancel')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t('purchase.print')}
          </Button>
        </div>
      </header>
      {po.status === 'DRAFT' && !canApprove && (
        <Alert tone="info">{t('purchase.orders.awaitingApproval')}</Alert>
      )}
      {po.status === 'CANCELLED' && po.cancelReason !== null && (
        <Alert tone="warning">
          {t('purchase.orders.cancelledBecause', { reason: po.cancelReason })}
        </Alert>
      )}
      {move.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(move.error)}
        </Alert>
      )}
      <Card className="p-4">
        <Facts
          rows={[
            [
              t('purchase.orders.created'),
              [format.dateTime(po.createdAt), po.createdByName]
                .filter((s) => s !== null)
                .join(' · '),
            ],
            [
              t('purchase.orders.expectedOn'),
              po.expectedOn === null ? t('reports.none') : day(po.expectedOn),
            ],
            ...(po.approvedAt === null
              ? []
              : [
                  [
                    t('purchase.orders.approved'),
                    [format.dateTime(po.approvedAt), po.approvedByName]
                      .filter((s) => s !== null)
                      .join(' · '),
                  ] as const,
                ]),
            ...(po.sentAt === null
              ? []
              : [[t('purchase.orders.sent'), format.dateTime(po.sentAt)] as const]),
            ...(po.notes === null ? [] : [[t('purchase.orders.notes'), po.notes] as const]),
          ]}
        />
      </Card>

      <section aria-labelledby="po-lines" className="flex flex-col gap-2">
        <h2 id="po-lines" className="text-lg font-semibold">
          {t('purchase.lines.title')}
        </h2>
        <Table>
          <THead>
            <Tr>
              <Th>{t('purchase.lines.item')}</Th>
              <Th className="text-end">{t('purchase.lines.ordered')}</Th>
              <Th className="text-end">{t('purchase.lines.received')}</Th>
              <Th className="text-end">{t('purchase.lines.stillDue')}</Th>
              <Th className="text-end">{t('purchase.lines.price')}</Th>
              <Th className="text-end">{t('purchase.lines.gst')}</Th>
              <Th className="text-end">{t('purchase.totals.total')}</Th>
            </Tr>
          </THead>
          <TBody>
            {po.lines.map((l) => {
              const left = Math.max(0, l.quantityMilli - l.receivedQtyMilli);
              return (
                <Tr key={l.id}>
                  <Td className="break-words">{l.itemName}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {quantity(l.quantityMilli, l.unitCode)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {quantity(l.receivedQtyMilli, l.unitCode)}
                  </Td>
                  <Td
                    className={
                      left > 0
                        ? 'text-end font-semibold whitespace-nowrap tabular-nums'
                        : 'text-end whitespace-nowrap text-muted-foreground tabular-nums'
                    }
                  >
                    {quantity(left, l.unitCode)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {t('purchase.lines.perUnit', {
                      price: money(l.unitPrice),
                      unit: unitLabel(l.unitCode),
                    })}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{rate(l.taxRateBp)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(l.total)}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
        {RECEIVABLE.has(po.status) && (
          <p className="text-sm text-muted-foreground">
            {t('purchase.orders.linesDue', { count: due })}
          </p>
        )}
      </section>
      <TotalsBox subtotal={po.subtotal} tax={po.taxTotal} total={po.grandTotal} />

      <section aria-labelledby="po-grns" className="flex flex-col gap-2">
        <h2 id="po-grns" className="text-lg font-semibold">
          {t('purchase.orders.grns')}
        </h2>
        {po.grns.length === 0 ? (
          <p className="text-muted-foreground">{t('purchase.orders.noGrns')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-surface">
            {po.grns.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Link
                  to={`/purchase/grns/${g.id}`}
                  className="font-medium break-all text-primary underline-offset-2 hover:underline"
                >
                  {g.grnNo}
                </Link>
                <GrnStatusBadge status={g.status} />
                <span className="ms-auto tabular-nums">{money(g.grandTotal)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog === 'cancel' && (
        <ReasonDialog
          title={t('purchase.orders.cancelTitle', { number: po.poNo })}
          description={t('purchase.orders.cancelBody')}
          confirmLabel={t('purchase.orders.cancel')}
          minLength={1}
          busy={cancel.isPending}
          error={cancel.isError ? errorMessage(cancel.error) : null}
          onConfirm={(reason) => cancel.mutate(reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'close' && (
        <ConfirmDialog
          title={t('purchase.orders.closeTitle', { number: po.poNo })}
          body={t('purchase.orders.closeBody')}
          confirmLabel={t('purchase.orders.close')}
          busy={move.isPending}
          error={move.isError ? errorMessage(move.error) : null}
          onConfirm={() => move.mutate('close')}
          onClose={() => setDialog(null)}
        />
      )}
    </article>
  );
}
