import type { InventoryItem, StockEntryResponse, Unit } from '@restroos/contracts';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Plus,
  SegmentedControl,
  Select,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { UnsavedChangesDialog } from '../../components/unsaved-changes-dialog';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import {
  invalidateStock,
  useInventoryItems,
  useUnits,
} from '../../features/inventory/inventory-queries';
import {
  knownUnits,
  parseQuantity,
  preferredUnit,
  receiptUnitPrice,
  unitsFor,
} from '../../features/inventory/quantity';
import {
  ItemSelect,
  LevelBadge,
  QuantityField,
  useItemName,
} from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { PriceField } from '../../features/menu/price-field';
import { toast } from '../../features/toast/toast-store';
import { useErrorMessage } from '../../lib/errors';
import { rupeesToPaise } from '../../lib/units';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import {
  emptyLine,
  ENTRY_KINDS,
  entryToRequest,
  MAX_LINES,
  type EntryErrors,
  type EntryKind,
  type EntryLine,
  type EntryRequest,
  type LineProblem,
} from './entry-form';

const isKind = (v: string | null): v is EntryKind =>
  v !== null && (ENTRY_KINDS as readonly string[]).includes(v);

/**
 * /inventory/stock?kind=receive|opening|wastage|adjust: stock in (a direct
 * purchase, opening stock) and out (wastage, adjustments), several lines at once.
 * `?item=` starts the first line with that item (from an alert).
 */
export function StockEntryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const kindParam = params.get('kind');
  const kind: EntryKind = isKind(kindParam) ? kindParam : 'receive';
  const items = useInventoryItems(false);
  const units = useUnits();
  // Another kind starts a fresh form: ask before clearing lines that were typed.
  const [typed, setTyped] = useState(false);
  const [switchTo, setSwitchTo] = useState<EntryKind | null>(null);
  const switchKind = (next: EntryKind) => {
    setTyped(false);
    setParams({ kind: next }, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.entry.title')}
        description={t('inventory.entry.description')}
      />
      <SegmentedControl<EntryKind>
        className="self-start"
        aria-label={t('inventory.entry.kind')}
        value={kind}
        onValueChange={(next) => (typed ? setSwitchTo(next) : switchKind(next))}
        options={ENTRY_KINDS.map((k) => ({ value: k, label: t(`inventory.entry.kinds.${k}`) }))}
      />
      {switchTo !== null && (
        <ConfirmDialog
          title={t('inventory.entry.switchTitle')}
          body={t('inventory.entry.switchBody', { kind: t(`inventory.entry.kinds.${switchTo}`) })}
          confirmLabel={t('inventory.entry.switchConfirm')}
          destructive
          onConfirm={() => {
            setSwitchTo(null);
            switchKind(switchTo);
          }}
          onClose={() => setSwitchTo(null)}
        />
      )}
      <QueryState query={items}>
        {({ data }) =>
          data.length === 0 ? (
            <Alert tone="info">
              {t('inventory.entry.noItems')}{' '}
              <Link className="font-medium underline" to="/inventory">
                {t('inventory.items.title')}
              </Link>
            </Alert>
          ) : units.isPending ? null : (
            <EntryForm
              key={kind}
              kind={kind}
              items={data}
              units={knownUnits(units.data?.data ?? [])}
              startWith={params.get('item')}
              onTypedChange={setTyped}
            />
          )
        }
      </QueryState>
    </div>
  );
}

function EntryForm({
  kind,
  items,
  units,
  startWith,
  onTypedChange,
}: {
  kind: EntryKind;
  items: readonly InventoryItem[];
  units: readonly Unit[];
  startWith: string | null;
  onTypedChange: (typed: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [lines, setLines] = useState<EntryLine[]>(() => {
    const first = items.find((i) => i.id === startWith);
    return [emptyLine(first, units)];
  });
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<EntryErrors | null>(null);
  const [done, setDone] = useState<StockEntryResponse | null>(null);
  // Anything typed is worth a 'Leave without saving?' (an item picked from an alert alone is not).
  const typed =
    note.trim() !== '' ||
    lines.some((l) => l.qty.text.trim() !== '' || l.cost.trim() !== '' || l.batchNo.trim() !== '');
  const { blocker } = useUnsavedGuard(typed);
  useEffect(() => onTypedChange(typed), [typed, onTypedChange]);
  // One key per distinct entry: a retry after a dropped connection is not booked twice.
  const key = useRef<{ body: string; key: string } | null>(null);
  const byId = new Map(items.map((i) => [i.id, i]));
  // Opening stock goes in once, before the item is first received (sales before it are fine).
  // Only stock received (opening, a purchase, a transfer in) sets an average cost, so an item
  // with one has been received; the Hub refuses the rest (received at no cost) itself.
  const received = new Set(
    kind === 'opening' ? items.filter((i) => i.avgCostPerBase > 0).map((i) => i.id) : [],
  );

  const save = useMutation({
    mutationFn: (request: EntryRequest) => {
      const text = JSON.stringify(request);
      if (key.current?.body !== text) key.current = { body: text, key: newIdempotencyKey() };
      const o = { idempotencyKey: key.current.key };
      switch (request.kind) {
        case 'receive':
          return api.inventory.receive(request.body, o);
        case 'opening':
          return api.inventory.opening(request.body, o);
        case 'wastage':
          return api.inventory.wastage(request.body, o);
        case 'adjust':
          return api.inventory.adjust(request.body, o);
      }
    },
    onSuccess: (result) => {
      key.current = null;
      void invalidateStock(queryClient);
      setDone(result);
      setLines([emptyLine()]);
      setNote('');
      toast(t(`inventory.entry.saved.${kind}`, { count: result.items.length }));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = entryToRequest(kind, lines, note, units);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(null);
    setDone(null);
    save.mutate(result.request);
  }

  const update = (lineKey: string, patch: Partial<EntryLine>) =>
    setLines((ls) => ls.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)));
  const priced = kind === 'receive' || kind === 'opening';
  const noteLabel =
    kind === 'receive' ? t('inventory.entry.reference') : t('inventory.entry.reason');

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <p className="text-sm text-muted-foreground">{t(`inventory.entry.hints.${kind}`)}</p>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {save.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(save.error)}
            </Alert>
          )}
          {errors?.empty === true && (
            <Alert tone="danger" role="alert">
              {t('inventory.entry.emptyError')}
            </Alert>
          )}
          <ol className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <EntryLineRow
                key={line.key}
                n={i + 1}
                kind={kind}
                line={line}
                item={byId.get(line.itemId)}
                items={items}
                units={units}
                received={received}
                problems={errors?.lines[line.key] ?? []}
                onChange={(patch) => update(line.key, patch)}
                onRemove={
                  lines.length > 1
                    ? () => setLines((ls) => ls.filter((l) => l.key !== line.key))
                    : null
                }
              />
            ))}
          </ol>
          <Button
            variant="outline"
            className="self-start"
            disabled={lines.length >= MAX_LINES[kind]}
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
          >
            <Plus aria-hidden="true" />
            {t('inventory.entry.addLine')}
          </Button>
          {kind !== 'opening' && (
            <Field
              label={noteLabel}
              hint={
                kind === 'receive'
                  ? t('inventory.entry.referenceHint')
                  : t('inventory.entry.reasonHint')
              }
              required={kind !== 'receive'}
              error={
                errors?.note === undefined
                  ? undefined
                  : errors.note === 'reason'
                    ? t('inventory.errors.reason')
                    : t('inventory.errors.reference')
              }
              className="max-w-xl"
            >
              {(p) => (
                <Input
                  {...p}
                  maxLength={kind === 'receive' ? 60 : 200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t(`inventory.entry.submit.${kind}`)}
            </Button>
            {priced && <ReceiptTotal lines={lines} />}
          </div>
        </form>
      </Card>
      {done !== null && <EntryResult result={done} />}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

/** The sum of the line costs typed so far. */
function ReceiptTotal({ lines }: { lines: readonly EntryLine[] }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const total = lines.reduce((sum, l) => sum + (rupeesToPaise(l.cost) ?? 0), 0);
  if (total === 0) return null;
  return (
    <p className="text-sm font-medium tabular-nums" aria-live="polite">
      {t('inventory.entry.total', { amount: format.money(total) })}
    </p>
  );
}

const PROBLEM_KEYS = {
  item: 'inventory.errors.item',
  qty: 'inventory.errors.quantity',
  cost: 'validation.amount',
  batch: 'inventory.errors.batch',
  expiry: 'inventory.errors.expiry',
  duplicate: 'inventory.errors.duplicate',
} as const;

function EntryLineRow({
  n,
  kind,
  line,
  item,
  items,
  units,
  received,
  problems,
  onChange,
  onRemove,
}: {
  n: number;
  kind: EntryKind;
  line: EntryLine;
  item: InventoryItem | undefined;
  items: readonly InventoryItem[];
  units: readonly Unit[];
  /** Opening stock only: items already received, which can't take it. */
  received: ReadonlySet<string>;
  problems: readonly LineProblem[];
  onChange: (patch: Partial<EntryLine>) => void;
  onRemove: (() => void) | null;
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  const err = (p: LineProblem) => (problems.includes(p) ? t(PROBLEM_KEYS[p]) : undefined);
  const choices = item === undefined ? [] : unitsFor(item.baseUnit, units);
  const unit = units.find((u) => u.id === line.qty.unitId);
  const label = item === undefined ? t('inventory.entry.lineN', { n }) : name(item);

  // ₹250 for 2.5 kg reads as ₹100.00/kg.
  const qtyMilli = unit === undefined ? null : parseQuantity(line.qty.text, unit.toBaseMilli);
  const cost = rupeesToPaise(line.cost);
  const rate =
    unit !== undefined &&
    qtyMilli !== null &&
    qtyMilli > 0 &&
    cost !== null &&
    line.cost.trim() !== ''
      ? format.priceIn(receiptUnitPrice(cost, qtyMilli, unit.toBaseMilli), unit)
      : undefined;

  return (
    <li
      aria-label={label}
      className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.4fr)_minmax(12rem,1fr)_minmax(9rem,0.8fr)_auto]"
    >
      <Field
        label={t('inventory.fields.item')}
        required
        hint={
          item === undefined
            ? undefined
            : t('inventory.entry.onHand', { qty: format.qty(item.qtyMilli, item.baseUnit) })
        }
        error={err('item') ?? err('duplicate')}
      >
        {(p) => (
          <ItemSelect
            control={p}
            items={items}
            value={line.itemId}
            disabledIds={received}
            disabledNote={t('inventory.entry.alreadyReceived')}
            onChange={(id) => {
              const next = items.find((i) => i.id === id);
              onChange({
                itemId: id,
                qty: {
                  ...line.qty,
                  unitId: next === undefined ? '' : preferredUnit(next, units).id,
                },
              });
            }}
          />
        )}
      </Field>
      <QuantityField
        label={t('inventory.fields.quantity')}
        required
        error={err('qty')}
        value={line.qty}
        units={choices}
        onChange={(qty) => onChange({ qty })}
      />
      {kind === 'adjust' && (
        <Field label={t('inventory.entry.direction')}>
          {(p) => (
            <Select
              {...p}
              value={line.direction}
              onChange={(e) => onChange({ direction: e.target.value as EntryLine['direction'] })}
            >
              <option value="in">{t('inventory.entry.directions.in')}</option>
              <option value="out">{t('inventory.entry.directions.out')}</option>
            </Select>
          )}
        </Field>
      )}
      {(kind === 'receive' || kind === 'opening') && (
        <PriceField
          label={t('inventory.entry.lineCost')}
          {...(rate === undefined ? {} : { hint: rate })}
          value={line.cost}
          error={err('cost')}
          onChange={(v) => onChange({ cost: v })}
          required
        />
      )}
      {kind === 'wastage' && <span className="hidden lg:block" />}
      <div className="flex items-end justify-end self-stretch">
        {onRemove !== null && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('inventory.entry.removeLine', { name: label })}
            onClick={onRemove}
          >
            <Trash aria-hidden="true" />
          </Button>
        )}
      </div>
      {(kind === 'receive' || kind === 'opening') && (
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-subgrid lg:col-span-3">
          <Field
            label={t('inventory.entry.batchNo')}
            hint={t('common.optional')}
            error={err('batch')}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={40}
                value={line.batchNo}
                onChange={(e) => onChange({ batchNo: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('inventory.entry.expiresOn')}
            hint={
              item?.isPerishable === true && item.shelfLifeDays !== null
                ? t('inventory.entry.expiryDefault', { count: item.shelfLifeDays })
                : t('common.optional')
            }
            error={err('expiry')}
          >
            {(p) => (
              <Input
                {...p}
                type="date"
                value={line.expiresOn}
                onChange={(e) => onChange({ expiresOn: e.target.value })}
              />
            )}
          </Field>
        </div>
      )}
    </li>
  );
}

/** The new balances of the items an entry changed. */
function EntryResult({ result }: { result: StockEntryResponse }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const name = useItemName();
  return (
    <Card className="flex flex-col gap-2 p-4" role="status">
      <h2 className="font-semibold">{t('inventory.entry.newBalances')}</h2>
      <ul className="flex flex-col divide-y">
        {result.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Link
              to={`/inventory/items/${item.id}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {name(item)}
            </Link>
            <span className="flex items-center gap-2 tabular-nums">
              {format.qty(item.qtyMilli, item.baseUnit)}
              <LevelBadge level={item.level} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
