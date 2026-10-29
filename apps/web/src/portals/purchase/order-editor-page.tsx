import type { InventoryItem, PurchaseOrder, Unit, Vendor } from '@restroos/contracts';
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
import { isApiError } from '../../api/client';
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
  usePurchaseErrorMessage,
  usePurchaseOrder,
  useStockItems,
  useUnits,
  useVendors,
} from '../../features/purchasing/purchasing-queries';
import { toast } from '../../features/toast/toast-store';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import { LinesEditor } from './lines-editor';
import { TotalsBox } from './purchase-ui';

/** Loading or failing to load what a purchase document's lines need (items, units, vendors). */
export function useLineData() {
  const items = useStockItems();
  const units = useUnits();
  const vendors = useVendors();
  const failed = [items, units, vendors].find((q) => q.isError);
  return {
    items: items.data?.data,
    units: units.data?.data,
    vendors: vendors.data?.data,
    error: failed?.error ?? null,
  };
}

/** Why the line data did not load; a role without the stock list gets its own explanation. */
export function LineDataError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const errorMessage = usePurchaseErrorMessage();
  return (
    <Alert tone="danger" role="alert">
      {isApiError(error, 'FORBIDDEN') ? t('purchase.lines.itemsForbidden') : errorMessage(error)}
    </Alert>
  );
}

/** /purchase/orders/new (?vendor=) and /purchase/orders/:poId/edit: a draft purchase order. */
export function OrderEditorPage() {
  const { t } = useTranslation();
  const { poId } = useParams();
  const [params] = useSearchParams();
  const po = usePurchaseOrder(poId ?? '', poId !== undefined);
  const data = useLineData();
  const errorMessage = usePurchaseErrorMessage();

  if (po.isError) {
    return (
      <Alert tone="danger" role="alert">
        {errorMessage(po.error)}
      </Alert>
    );
  }
  if (data.error !== null) return <LineDataError error={data.error} />;
  if (
    (poId !== undefined && po.data === undefined) ||
    data.items === undefined ||
    data.units === undefined ||
    data.vendors === undefined
  ) {
    return <Spinner label={t('common.loading')} className="py-6" />;
  }
  const order = po.data ?? null;
  if (order !== null && order.status !== 'DRAFT') {
    return (
      <Alert tone="warning" role="alert">
        {t('purchase.orders.notDraft')}{' '}
        <Link className="font-medium underline" to={`/purchase/orders/${order.id}`}>
          {t('purchase.orders.open', { number: order.poNo })}
        </Link>
      </Alert>
    );
  }
  return (
    <OrderEditor
      key={order?.id ?? 'new'}
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
  expectedOn?: string;
  lines?: string;
}

function OrderEditor({
  po,
  initialVendorId,
  items,
  units,
  vendors,
}: {
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
  const [initial] = useState(() => ({
    vendorId: po?.vendorId ?? initialVendorId,
    expectedOn: po?.expectedOn ?? '',
    notes: po?.notes ?? '',
    rows: po === null ? [emptyLine()] : po.lines.map((l) => lineToRow(l)),
  }));
  const [vendorId, setVendorId] = useState(initial.vendorId);
  const [expectedOn, setExpectedOn] = useState(initial.expectedOn);
  const [notes, setNotes] = useState(initial.notes);
  const [rows, setRows] = useState<LineRow[]>(initial.rows);
  const [errors, setErrors] = useState<HeadErrors>({});
  const [lineErrors, setLineErrors] = useState<LineErrors>({});
  const dirty = useMemo(
    () => JSON.stringify({ vendorId, expectedOn, notes, rows }) !== JSON.stringify(initial),
    [vendorId, expectedOn, notes, rows, initial],
  );
  const { blocker, release } = useUnsavedGuard(dirty);
  const totals = liveTotals(rows, 'PO');
  const itemNames = new Map(po?.lines.map((l) => [l.inventoryItemId, l.itemName] as const));
  const shownVendors = vendors.filter((v) => v.isActive || v.id === vendorId);

  const save = useMutation({
    mutationFn: async () => {
      const found: HeadErrors = {};
      if (vendorId === '') found.vendor = t('purchase.orders.vendorRequired');
      if (expectedOn !== '' && !isCalendarDay(expectedOn))
        found.expectedOn = t('purchase.lines.errors.expiresOn');
      if (rows.length === 0) found.lines = t('purchase.lines.atLeastOne');
      const parsed = rowsToBody(rows, 'PO', items, units);
      setErrors(found);
      setLineErrors(parsed.ok ? {} : parsed.errors);
      if (Object.keys(found).length > 0 || !parsed.ok) return null;
      const body = {
        vendorId,
        expectedOn: expectedOn === '' ? null : expectedOn,
        notes: notes.trim() === '' ? null : notes.trim(),
        lines: parsed.lines.map((l) => ({
          inventoryItemId: l.inventoryItemId,
          unitId: l.unitId,
          quantityMilli: l.quantityMilli,
          unitPrice: l.unitPrice,
          taxRateBp: l.taxRateBp,
        })),
      };
      return po === null
        ? api.purchasing.createOrder(body)
        : api.purchasing.updateOrder(po.id, { ...body, version: po.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      queryClient.setQueryData(PURCHASING_KEYS.order(saved.id), saved);
      void invalidatePurchasing(queryClient);
      toast(t('purchase.orders.saved', { number: saved.poNo }));
      release();
      void navigate(`/purchase/orders/${saved.id}`);
    },
  });

  const back = po === null ? '/purchase/orders' : `/purchase/orders/${po.id}`;
  return (
    <div className="flex flex-col gap-4">
      <Link
        to={back}
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {po === null ? t('purchase.orders.back') : t('purchase.orders.open', { number: po.poNo })}
      </Link>
      <AdminHeader
        title={
          po === null
            ? t('purchase.orders.new')
            : t('purchase.orders.editTitle', { number: po.poNo })
        }
        description={t('purchase.orders.draftHint')}
        actions={
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('purchase.orders.saveDraft')}
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
        <Card className="grid gap-4 p-4 md:grid-cols-2 md:p-5">
          <Field label={t('purchase.orders.vendor')} required error={errors.vendor}>
            {(p) => (
              <Select {...p} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="" disabled>
                  {t('purchase.payments.chooseVendor')}
                </option>
                {shownVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
                {po !== null && !shownVendors.some((v) => v.id === po.vendorId) && (
                  <option value={po.vendorId}>{po.vendorName}</option>
                )}
              </Select>
            )}
          </Field>
          <Field
            label={t('purchase.orders.expectedOn')}
            hint={t('common.optional')}
            error={errors.expectedOn}
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                value={expectedOn}
                onChange={(e) => setExpectedOn(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('purchase.orders.notes')}
            hint={t('purchase.orders.notesHint')}
            className="md:col-span-2"
          >
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
        <section aria-labelledby="po-lines" className="flex flex-col gap-3">
          <h2 id="po-lines" className="text-lg font-semibold">
            {t('purchase.lines.title')}
          </h2>
          <LinesEditor
            kind="PO"
            rows={rows}
            errors={lineErrors}
            items={items}
            units={units}
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
