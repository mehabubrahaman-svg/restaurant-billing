import type { InventoryItem, Unit } from '@restroos/contracts';
import { documentTotals, lineAmounts, type LineAmounts } from '@restroos/domain';
import { paiseToRupees, rupeesToPaise } from '../../lib/units';
import { isCalendarDay } from '../accounting/calendar-day';
import { MAX_LINE_MILLI, milliToQuantity, quantityToMilli } from './quantity';

/** GST slabs a purchase line can carry, in basis points. */
export const GST_SLABS_BP = [0, 500, 1_200, 1_800, 2_800] as const;
/** Lines on one purchase order or GRN (contracts). */
export const MAX_LINES = 100;

export type DocumentKind = 'PO' | 'GRN';

/** One line of the PO or GRN editor, as typed. `key` is local to the editor. */
export interface LineRow {
  readonly key: string;
  /** The PO line a GRN line receives: its item and unit are fixed. */
  readonly purchaseOrderLineId: string | null;
  readonly inventoryItemId: string;
  readonly unitId: string;
  /** In the line's unit ("2.5" kg); on a GRN, what was delivered. */
  readonly quantity: string;
  /** Rupees per unit, before tax. */
  readonly price: string;
  readonly taxRateBp: number;
  /** GRN only: sent back at the door. */
  readonly rejected: string;
  readonly batchNo: string;
  readonly expiresOn: string;
}

/** A line as the Hub takes it: milli-units of the unit, paise per unit, basis points. */
export interface LineBody {
  purchaseOrderLineId: string | null;
  inventoryItemId: string;
  unitId: string;
  quantityMilli: number;
  rejectedQtyMilli: number;
  unitPrice: number;
  taxRateBp: number;
  batchNo: string | null;
  expiresOn: string | null;
}

export type LineField =
  'item' | 'unit' | 'quantity' | 'price' | 'rejected' | 'batchNo' | 'expiresOn';
export type LineErrorKey =
  | 'purchase.lines.errors.item'
  | 'purchase.lines.errors.unit'
  | 'purchase.lines.errors.quantity'
  | 'purchase.lines.errors.price'
  | 'purchase.lines.errors.rejected'
  | 'purchase.lines.errors.batchNo'
  | 'purchase.lines.errors.expiresOn';
export type LineErrors = Readonly<Record<string, Partial<Record<LineField, LineErrorKey>>>>;

let counter = 0;
export function newLineKey(): string {
  counter += 1;
  return `line-${counter}`;
}

export function emptyLine(): LineRow {
  return {
    key: newLineKey(),
    purchaseOrderLineId: null,
    inventoryItemId: '',
    unitId: '',
    quantity: '',
    price: '',
    taxRateBp: 0,
    rejected: '',
    batchNo: '',
    expiresOn: '',
  };
}

/** A saved line (PO or GRN) back into the editor. */
export function lineToRow(line: {
  purchaseOrderLineId?: string | null;
  inventoryItemId: string;
  unitId: string;
  quantityMilli: number;
  rejectedQtyMilli?: number;
  unitPrice: number;
  taxRateBp: number;
  batchNo?: string | null;
  expiresOn?: string | null;
}): LineRow {
  return {
    key: newLineKey(),
    purchaseOrderLineId: line.purchaseOrderLineId ?? null,
    inventoryItemId: line.inventoryItemId,
    unitId: line.unitId,
    quantity: milliToQuantity(line.quantityMilli),
    price: paiseToRupees(line.unitPrice),
    taxRateBp: line.taxRateBp,
    rejected:
      line.rejectedQtyMilli === undefined || line.rejectedQtyMilli === 0
        ? ''
        : milliToQuantity(line.rejectedQtyMilli),
    batchNo: line.batchNo ?? '',
    expiresOn: line.expiresOn ?? '',
  };
}

/** Units that measure the item's base unit: kg and g for an item kept in g. */
export function unitsFor(item: InventoryItem | undefined, units: readonly Unit[]): Unit[] {
  if (item === undefined) return [];
  return units
    .filter((u) => u.baseCode === item.baseUnit)
    .sort((a, b) => b.toBaseMilli - a.toBaseMilli);
}

/** Where a new line of this item starts: its purchase unit, else its base unit. */
export function defaultUnitId(item: InventoryItem, units: readonly Unit[]): string {
  const own = unitsFor(item, units);
  return (
    own.find((u) => u.id === item.purchaseUnitId)?.id ??
    own.find((u) => u.code === item.baseUnit)?.id ??
    own[0]?.id ??
    ''
  );
}

/** Amounts of one row when it parses (GRN: on what was accepted), else null. */
export function rowAmounts(row: LineRow, kind: DocumentKind): LineAmounts | null {
  const quantity = quantityToMilli(row.quantity);
  const price = rupeesToPaise(row.price);
  const rejected = kind === 'GRN' && row.rejected.trim() !== '' ? quantityToMilli(row.rejected) : 0;
  if (quantity === null || price === null || rejected === null || rejected > quantity) return null;
  if (quantity > MAX_LINE_MILLI) return null;
  return lineAmounts(quantity - rejected, price, row.taxRateBp);
}

/** Live totals of the rows that parse: the same arithmetic the Hub uses. */
export function liveTotals(rows: readonly LineRow[], kind: DocumentKind) {
  return documentTotals(
    rows.map((r) => rowAmounts(r, kind)).filter((a): a is LineAmounts => a !== null),
  );
}

/**
 * Checks every row and turns them into request lines. Units are checked
 * against the item (UNIT_MISMATCH on the Hub otherwise).
 */
export function rowsToBody(
  rows: readonly LineRow[],
  kind: DocumentKind,
  items: readonly InventoryItem[],
  units: readonly Unit[],
): { ok: true; lines: LineBody[] } | { ok: false; errors: LineErrors } {
  const errors: Record<string, Partial<Record<LineField, LineErrorKey>>> = {};
  const lines: LineBody[] = [];
  for (const row of rows) {
    const e: Partial<Record<LineField, LineErrorKey>> = {};
    const item = items.find((i) => i.id === row.inventoryItemId);
    if (item === undefined) e.item = 'purchase.lines.errors.item';
    else if (!unitsFor(item, units).some((u) => u.id === row.unitId))
      e.unit = 'purchase.lines.errors.unit';
    const quantity = quantityToMilli(row.quantity);
    if (quantity === null || quantity <= 0 || quantity > MAX_LINE_MILLI)
      e.quantity = 'purchase.lines.errors.quantity';
    const price = row.price.trim() === '' ? null : rupeesToPaise(row.price);
    if (price === null) e.price = 'purchase.lines.errors.price';
    let rejected = 0;
    if (kind === 'GRN' && row.rejected.trim() !== '') {
      const parsed = quantityToMilli(row.rejected);
      if (parsed === null || (quantity !== null && parsed > quantity))
        e.rejected = 'purchase.lines.errors.rejected';
      else rejected = parsed;
    }
    const batchNo = row.batchNo.trim();
    if (batchNo.length > 40) e.batchNo = 'purchase.lines.errors.batchNo';
    if (row.expiresOn !== '' && !isCalendarDay(row.expiresOn))
      e.expiresOn = 'purchase.lines.errors.expiresOn';
    if (Object.keys(e).length > 0 || quantity === null || price === null) {
      errors[row.key] = e;
      continue;
    }
    lines.push({
      purchaseOrderLineId: row.purchaseOrderLineId,
      inventoryItemId: row.inventoryItemId,
      unitId: row.unitId,
      quantityMilli: quantity,
      rejectedQtyMilli: rejected,
      unitPrice: price,
      taxRateBp: row.taxRateBp,
      batchNo: kind === 'GRN' && batchNo !== '' ? batchNo : null,
      expiresOn: kind === 'GRN' && row.expiresOn !== '' ? row.expiresOn : null,
    });
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, lines };
}
