import type { Grn, InventoryItem, PurchaseOrder, Unit, Vendor } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import { UnsavedChangesDialog } from '../../components/unsaved-changes-dialog';
import { isCalendarDay } from '../../features/accounting/calendar-day';
import { AdminHeader } from '../../features/admin/admin-layout';
import {
  emptyLine,
  lineToRow,
  liveTotals,
  rowsToBody,
  type LineErrors,
  type LineRow,
} from '../../features/purchasing/purchase-lines';
import {
  invalidatePurchasing,
  PURCHASING_KEYS,
  useGrn,
  usePurchaseErrorMessage,
  usePurchaseOrder,
} from '../../features/purchasing/purchasing-queries';
import { toast } from '../../features/toast/toast-store';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import { localIsoDate } from '../pos/bills-page';
import { LinesEditor, type OrderedLine } from './lines-editor';
import { LineDataError, useLineData } from './order-editor-page';
import { TotalsBox } from './purchase-ui';

const RECEIVABLE = new Set<PurchaseOrder['status']>(['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']);

/** A PO's lines that are still due, as GRN lines to receive (delivered = what is left). */
export function dueLines(po: PurchaseOrder): LineRow[] {
  return po.lines
    .filter((l) => l.receivedQtyMilli < l.quantityMilli)
    .map((l) =>
      lineToRow({
        purchaseOrderLineId: l.id,
        inventoryItemId: l.inventoryItemId,
        unitId: l.unitId,
        quantityMilli: l.quantityMilli - l.receivedQtyMilli,
        unitPrice: l.unitPrice,
        taxRateBp: l.taxRateBp,
      }),
    );
}

/**
 * /purchase/grns/new?po= (receive against a PO, prefilled with what is still
 * due), /purchase/grns/new (?vendor=: goods without a PO) and
 * /purchase/grns/:grnId/edit (a draft).
 */
export function GrnEditorPage() {
  const { t } = useTranslation();
  const { grnId } = useParams();
  const [params] = useSearchParams();
  const errorMessage = usePurchaseErrorMessage();
  const grn = useGrn(grnId ?? '', grnId !== undefined);
  const poId = grnId === undefined ? (params.get('po') ?? '') : (grn.data?.purchaseOrderId ?? '');
  const po = usePurchaseOrder(poId, poId !== '');
  const data = useLineData();

  const failed = [grn, po].find((q) => q.isError);
  if (failed !== undefined) {
    return (
      <Alert tone="danger" role="alert">
        {errorMessage(failed.error)}
      </Alert>
    );
  }
  if (data.error !== null) return <LineDataError error={data.error} />;
  if (
    (grnId !== undefined && grn.data === undefined) ||
    (poId !== '' && po.data === undefined) ||
    data.items === undefined ||
    data.units === undefined ||
    data.vendors === undefined
  ) {
    return <Spinner label={t('common.loading')} className="py-6" />;
  }
  const draft = grn.data ?? null;
  const order = poId === '' ? null : (po.data ?? null);
  if (draft !== null && draft.status !== 'DRAFT') {
    return (
      <Alert tone="warning" role="alert">
        {t('purchase.grns.notDraft')}{' '}
        <Link className="font-medium underline" to={`/purchase/grns/${draft.id}`}>
          {t('purchase.grns.open', { number: draft.grnNo })}
        </Link>
      </Alert>
    );
  }
  if (draft === null && order !== null && !RECEIVABLE.has(order.status)) {
    return (
      <Alert tone="warning" role="alert">
        {t('purchase.grns.notReceivable')}{' '}
        <Link className="font-medium underline" to={`/purchase/orders/${order.id}`}>
          {t('purchase.orders.open', { number: order.poNo })}
        </Link>
      </Alert>
    );
  }
  return (
    <GrnEditor
      key={draft?.id ?? order?.id ?? 'direct'}
      grn={draft}
      po={order}
      initialVendorId={params.get('vendor') ?? ''}
      items={data.items}
      units={data.units}
      vendors={data.vendors}
    />
  );
}

interface HeadErrors {
  vendor?: string;
  billDate?: string;
  lines?: string;
}

function GrnEditor({
  grn,
  po,
  initialVendorId,
  items,
  units,
  vendors,
}: {
  grn: Grn | null;
  po: PurchaseOrder | null;
  initialVendorId: string;
  items: readonly InventoryItem[];
  units: readonly Unit[];
  vendors: readonly Vendor[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = usePurchaseErrorMessage();
  const today = localIsoDate();
  const [initial] = useState(() => ({
    vendorId: grn?.vendorId ?? po?.vendorId ?? initialVendorId,
    billNo: grn?.vendorInvoiceNo ?? '',
    billDate: grn?.vendorInvoiceDate ?? '',
    notes: grn?.notes ?? '',
    rows:
      grn !== null
        ? grn.lines.map((l) => lineToRow(l))
        : po !== null
          ? dueLines(po)
          : [emptyLine()],
  }));
  const [vendorId, setVendorId] = useState(initial.vendorId);
  const [billNo, setBillNo] = useState(initial.billNo);
  const [billDate, setBillDate] = useState(initial.billDate);
  const [notes, setNotes] = useState(initial.notes);
  const [rows, setRows] = useState<LineRow[]>(initial.rows);
  const [errors, setErrors] = useState<HeadErrors>({});
  const [lineErrors, setLineErrors] = useState<LineErrors>({});
  const dirty = useMemo(
    () => JSON.stringify({ vendorId, billNo, billDate, notes, rows }) !== JSON.stringify(initial),
    [vendorId, billNo, billDate, notes, rows, initial],
  );
  const { blocker, release } = useUnsavedGuard(dirty);
  const totals = liveTotals(rows, 'GRN');
  const ordered = new Map<string, OrderedLine>(
    (po?.lines ?? []).map((l) => [
      l.id,
      {
        itemName: l.itemName,
        unitCode: l.unitCode,
        orderedMilli: l.quantityMilli,
        receivedMilli: l.receivedQtyMilli,
      },
    ]),
  );
  const itemNames = new Map(grn?.lines.map((l) => [l.inventoryItemId, l.itemName] as const));
  const vendorFixed = grn !== null || po !== null;
  const vendorName =
    grn?.vendorName ?? po?.vendorName ?? vendors.find((v) => v.id === vendorId)?.name ?? '';

  const save = useMutation({
    mutationFn: async () => {
      const found: HeadErrors = {};
      if (vendorId === '') found.vendor = t('purchase.orders.vendorRequired');
      if (billDate !== '' && (!isCalendarDay(billDate) || billDate > today))
        found.billDate = t('purchase.grns.billDateError');
      if (rows.length === 0) found.lines = t('purchase.lines.atLeastOne');
      const parsed = rowsToBody(rows, 'GRN', items, units);
      setErrors(found);
      setLineErrors(parsed.ok ? {} : parsed.errors);
      if (Object.keys(found).length > 0 || !parsed.ok) return null;
      const head = {
        vendorInvoiceNo: billNo.trim() === '' ? null : billNo.trim(),
        vendorInvoiceDate: billDate === '' ? null : billDate,
        notes: notes.trim() === '' ? null : notes.trim(),
        lines: parsed.lines,
      };
      if (grn !== null) return api.purchasing.updateGrn(grn.id, { ...head, version: grn.version });
      return api.purchasing.createGrn({
        ...head,
        purchaseOrderId: po?.id ?? null,
        vendorId: po === null ? vendorId : null,
      });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      queryClient.setQueryData(PURCHASING_KEYS.grn(saved.id), saved);
      void invalidatePurchasing(queryClient);
      toast(t('purchase.grns.saved', { number: saved.grnNo }));
      release();
      void navigate(`/purchase/grns/${saved.id}`);
    },
  });

  const back =
    grn !== null
      ? `/purchase/grns/${grn.id}`
      : po !== null
        ? `/purchase/orders/${po.id}`
        : '/purchase/grns';
  const title =
    grn !== null
      ? t('purchase.grns.editTitle', { number: grn.grnNo })
      : po !== null
        ? t('purchase.grns.receiveTitle', { number: po.poNo })
        : t('purchase.grns.direct');

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={back}
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('common.back')}
      </Link>
      <AdminHeader
        title={title}
        description={t('purchase.grns.draftHint')}
        actions={
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('purchase.grns.saveDraft')}
          </Button>
        }
      />
      {save.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(save.error)}
        </Alert>
      )}
      {(Object.keys(errors).length > 0 || Object.keys(lineErrors).length > 0) && (
        <Alert tone="danger" role="alert">
          {t('errors.validation')}
        </Alert>
      )}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Card className="grid gap-4 p-4 md:grid-cols-3 md:p-5">
          {vendorFixed ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('purchase.orders.vendor')}</span>
              <span className="flex min-h-touch items-center font-medium break-words">
                {vendorName}
              </span>
            </div>
          ) : (
            <Field label={t('purchase.orders.vendor')} required error={errors.vendor}>
              {(p) => (
                <Select {...p} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="" disabled>
                    {t('purchase.payments.chooseVendor')}
                  </option>
                  {vendors
                    .filter((v) => v.isActive)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('purchase.grns.vendorBillNo')} hint={t('common.optional')}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={40}
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('purchase.grns.vendorBillDate')}
            hint={t('purchase.grns.billDateHint')}
            error={errors.billDate}
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                max={today}
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('purchase.orders.notes')} className="md:col-span-3">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </Card>
        <section aria-labelledby="grn-lines" className="flex flex-col gap-3">
          <h2 id="grn-lines" className="text-lg font-semibold">
            {t('purchase.grns.linesTitle')}
          </h2>
          {po !== null && rows.length === 0 && (
            <Alert tone="info">{t('purchase.grns.nothingDue')}</Alert>
          )}
          <LinesEditor
            kind="GRN"
            rows={rows}
            errors={lineErrors}
            items={items}
            units={units}
            ordered={ordered}
            itemNames={itemNames}
            onChange={setRows}
          />
          {errors.lines !== undefined && (
            <p className="text-sm font-medium text-state-danger-fg">{errors.lines}</p>
          )}
        </section>
        <TotalsBox
          subtotal={totals.subtotal}
          tax={totals.taxTotal}
          total={totals.grandTotal}
          live
        />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
