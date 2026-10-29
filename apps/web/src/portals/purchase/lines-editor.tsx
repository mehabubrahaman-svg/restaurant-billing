import type { InventoryItem, Unit } from '@restroos/contracts';
import { Button, Field, Input, Plus, Select, Trash } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { PriceField } from '../../features/menu/price-field';
import {
  defaultUnitId,
  emptyLine,
  GST_SLABS_BP,
  MAX_LINES,
  rowAmounts,
  unitsFor,
  type DocumentKind,
  type LineErrors,
  type LineRow,
} from '../../features/purchasing/purchase-lines';
import { useMoney, useQuantity, useTaxRate, useUnitLabel } from './purchase-ui';

/** What a GRN line receiving a PO line was ordered, and has received so far. */
export interface OrderedLine {
  readonly itemName: string;
  readonly unitCode: string;
  readonly orderedMilli: number;
  readonly receivedMilli: number;
}

/**
 * The lines of a purchase order or GRN: item, a unit of the item's own kind,
 * quantity, price per unit and GST, with each line's total as it is typed.
 * A GRN line also takes what was rejected at the door, a batch number and an expiry.
 */
export function LinesEditor({
  kind,
  rows,
  errors,
  items,
  units,
  ordered = new Map(),
  itemNames = new Map(),
  onChange,
}: {
  kind: DocumentKind;
  rows: readonly LineRow[];
  errors: LineErrors;
  /** Active stock items. */
  items: readonly InventoryItem[];
  units: readonly Unit[];
  /** By purchase order line id: lines received against a PO keep its item and unit. */
  ordered?: ReadonlyMap<string, OrderedLine>;
  /** Names of items on the saved document (one may have been retired since). */
  itemNames?: ReadonlyMap<string, string>;
  onChange: (rows: LineRow[]) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const quantity = useQuantity();
  const rate = useTaxRate();
  const unitLabel = useUnitLabel();
  const update = (key: string, patch: Partial<LineRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('purchase.lines.empty')}</p>
      )}
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const e = errors[row.key] ?? {};
          const item = items.find((x) => x.id === row.inventoryItemId);
          const poLine =
            row.purchaseOrderLineId === null ? undefined : ordered.get(row.purchaseOrderLineId);
          const name = poLine?.itemName ?? item?.name ?? itemNames.get(row.inventoryItemId) ?? '';
          const label =
            name === ''
              ? t('purchase.lines.lineN', { n: i + 1 })
              : t('purchase.lines.lineNamed', { n: i + 1, name });
          const own = unitsFor(item, units);
          const unitCode = units.find((u) => u.id === row.unitId)?.code ?? poLine?.unitCode ?? '';
          const amounts = rowAmounts(row, kind);
          const err = (k: keyof typeof e) => {
            const key = e[k];
            return key === undefined ? undefined : t(key);
          };
          return (
            <li
              key={row.key}
              aria-label={label}
              className="flex flex-col gap-3 rounded-xl border bg-surface p-3"
            >
              <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_7rem_7rem_minmax(0,1fr)_7rem]">
                {poLine !== undefined ? (
                  <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
                    <span className="text-sm font-medium">{t('purchase.lines.item')}</span>
                    <span className="flex min-h-touch items-center font-medium break-words">
                      {poLine.itemName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('purchase.lines.orderedHint', {
                        ordered: quantity(poLine.orderedMilli, poLine.unitCode),
                        received: quantity(poLine.receivedMilli, poLine.unitCode),
                      })}
                    </span>
                  </div>
                ) : (
                  <Field
                    label={t('purchase.lines.item')}
                    required
                    error={err('item')}
                    className="sm:col-span-2 lg:col-span-1"
                  >
                    {(p) => (
                      <Select
                        {...p}
                        value={row.inventoryItemId}
                        onChange={(ev) => {
                          const picked = items.find((x) => x.id === ev.target.value);
                          update(row.key, {
                            inventoryItemId: ev.target.value,
                            unitId: picked === undefined ? '' : defaultUnitId(picked, units),
                          });
                        }}
                      >
                        <option value="" disabled>
                          {t('purchase.lines.chooseItem')}
                        </option>
                        {sortedItems.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                        {row.inventoryItemId !== '' && item === undefined && (
                          <option value={row.inventoryItemId}>
                            {t('purchase.lines.retiredItem', {
                              name: itemNames.get(row.inventoryItemId) ?? row.inventoryItemId,
                            })}
                          </option>
                        )}
                      </Select>
                    )}
                  </Field>
                )}
                {poLine !== undefined ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">{t('purchase.lines.unit')}</span>
                    <span className="flex min-h-touch items-center">
                      {unitLabel(poLine.unitCode)}
                    </span>
                  </div>
                ) : (
                  <Field label={t('purchase.lines.unit')} required error={err('unit')}>
                    {(p) => (
                      <Select
                        {...p}
                        value={row.unitId}
                        disabled={own.length === 0}
                        onChange={(ev) => update(row.key, { unitId: ev.target.value })}
                      >
                        {own.length === 0 && <option value="">{t('reports.none')}</option>}
                        {own.map((u) => (
                          <option key={u.id} value={u.id}>
                            {unitLabel(u.code)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <Field
                  label={
                    kind === 'GRN' ? t('purchase.lines.delivered') : t('purchase.lines.quantity')
                  }
                  required
                  error={err('quantity')}
                >
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      autoComplete="off"
                      className="tabular-nums"
                      value={row.quantity}
                      onChange={(ev) => update(row.key, { quantity: ev.target.value })}
                    />
                  )}
                </Field>
                <PriceField
                  label={
                    unitCode === ''
                      ? t('purchase.lines.price')
                      : t('purchase.lines.pricePer', { unit: unitLabel(unitCode) })
                  }
                  value={row.price}
                  error={err('price')}
                  required
                  onChange={(price) => update(row.key, { price })}
                />
                <Field label={t('purchase.lines.gst')}>
                  {(p) => (
                    <Select
                      {...p}
                      value={String(row.taxRateBp)}
                      onChange={(ev) => update(row.key, { taxRateBp: Number(ev.target.value) })}
                    >
                      {GST_SLABS_BP.map((bp) => (
                        <option key={bp} value={bp}>
                          {rate(bp)}
                        </option>
                      ))}
                      {!(GST_SLABS_BP as readonly number[]).includes(row.taxRateBp) && (
                        <option value={row.taxRateBp}>{rate(row.taxRateBp)}</option>
                      )}
                    </Select>
                  )}
                </Field>
              </div>
              {kind === 'GRN' && (
                <div className="grid items-start gap-3 sm:grid-cols-3">
                  <Field
                    label={t('purchase.lines.rejected')}
                    hint={t('purchase.lines.rejectedHint')}
                    error={err('rejected')}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        inputMode="decimal"
                        autoComplete="off"
                        className="tabular-nums"
                        value={row.rejected}
                        onChange={(ev) => update(row.key, { rejected: ev.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={t('purchase.lines.batchNo')} error={err('batchNo')}>
                    {(p) => (
                      <Input
                        {...p}
                        autoComplete="off"
                        maxLength={40}
                        value={row.batchNo}
                        onChange={(ev) => update(row.key, { batchNo: ev.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={t('purchase.lines.expiresOn')} error={err('expiresOn')}>
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        value={row.expiresOn}
                        onChange={(ev) => update(row.key, { expiresOn: ev.target.value })}
                      />
                    )}
                  </Field>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <span className="text-sm">
                  {amounts === null ? (
                    <span className="text-muted-foreground">{t('purchase.lines.noTotal')}</span>
                  ) : (
                    t('purchase.lines.lineTotal', {
                      value: money(amounts.value),
                      tax: money(amounts.tax),
                      total: money(amounts.total),
                    })
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('purchase.lines.remove', { line: label })}
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                >
                  <Trash aria-hidden="true" />
                  {t('purchase.lines.removeShort')}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <Button
        variant="outline"
        className="self-start"
        disabled={rows.length >= MAX_LINES}
        onClick={() => onChange([...rows, emptyLine()])}
      >
        <Plus aria-hidden="true" />
        {kind === 'GRN' ? t('purchase.lines.addOther') : t('purchase.lines.add')}
      </Button>
    </div>
  );
}
