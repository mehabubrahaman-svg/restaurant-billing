import type { InventoryItem, Unit } from '@restroos/contracts';
import type {
  OpeningStockBody,
  ReceiptLineBody,
  StockIssueBody,
  StockReceiptBody,
} from '../../api/endpoints';
import { parseQuantity, preferredUnit } from '../../features/inventory/quantity';
import type { QuantityDraft } from '../../features/inventory/stock-controls';
import { newRowKey } from '../../features/menu/item-form';
import { isCalendarDay } from '../../features/reports/use-day-format';
import { rupeesToPaise } from '../../lib/units';

/** Bought (direct purchase), on the shelves on day one, spoiled, or corrected. */
export type EntryKind = 'receive' | 'opening' | 'wastage' | 'adjust';
export const ENTRY_KINDS: readonly EntryKind[] = ['receive', 'opening', 'wastage', 'adjust'];

/** One line as typed. Cost, batch and expiry are for receipts and opening stock only. */
export interface EntryLine {
  readonly key: string;
  readonly itemId: string;
  readonly qty: QuantityDraft;
  /** Adjustments: found more (in) or less (out) than the books say. */
  readonly direction: 'in' | 'out';
  /** What the whole line cost, in rupees as typed. */
  readonly cost: string;
  readonly batchNo: string;
  /** YYYY-MM-DD, or '' for none. */
  readonly expiresOn: string;
}

export type LineProblem = 'item' | 'qty' | 'cost' | 'batch' | 'expiry' | 'duplicate';
export interface EntryErrors {
  /** By line key. */
  readonly lines: Readonly<Record<string, readonly LineProblem[]>>;
  readonly note?: 'reason' | 'reference';
  readonly empty?: true;
}

export type EntryRequest =
  | { kind: 'receive'; body: StockReceiptBody }
  | { kind: 'opening'; body: OpeningStockBody }
  | { kind: 'wastage' | 'adjust'; body: StockIssueBody };

/** Most lines one entry may carry (the Hub's limits). */
export const MAX_LINES: Record<EntryKind, number> = {
  receive: 100,
  opening: 500,
  wastage: 100,
  adjust: 100,
};

export function emptyLine(item?: InventoryItem, units: readonly Unit[] = []): EntryLine {
  return {
    key: newRowKey(),
    itemId: item?.id ?? '',
    qty: { text: '', unitId: item === undefined ? '' : preferredUnit(item, units).id },
    direction: 'out',
    cost: '',
    batchNo: '',
    expiresOn: '',
  };
}

const isBlank = (l: EntryLine) =>
  l.itemId === '' && l.qty.text.trim() === '' && l.cost.trim() === '' && l.batchNo.trim() === '';

/**
 * Checks an entry and builds its request. Blank lines are skipped; quantities
 * are parsed from text in the line's unit into milli base units and rupees
 * into paise, without floats. `note` is the bill reference (receipts) or the
 * reason (wastage, adjustments).
 */
export function entryToRequest(
  kind: EntryKind,
  lines: readonly EntryLine[],
  note: string,
  units: readonly Unit[],
): { ok: true; request: EntryRequest } | { ok: false; errors: EntryErrors } {
  const problems: Record<string, LineProblem[]> = {};
  const seen = new Set<string>();
  const receipts: ReceiptLineBody[] = [];
  const issues: { inventoryItemId: string; qtyMilli: number }[] = [];
  const priced = kind === 'receive' || kind === 'opening';

  const filled = lines.filter((l) => !isBlank(l));
  for (const line of filled) {
    const wrong: LineProblem[] = [];
    if (line.itemId === '') wrong.push('item');
    if (kind === 'opening' && line.itemId !== '' && seen.has(line.itemId)) wrong.push('duplicate');
    seen.add(line.itemId);
    const unit = units.find((u) => u.id === line.qty.unitId);
    const qty = unit === undefined ? null : parseQuantity(line.qty.text, unit.toBaseMilli);
    if (qty === null || qty <= 0) wrong.push('qty');
    const cost = priced ? rupeesToPaise(line.cost) : 0;
    if (cost === null) wrong.push('cost');
    const batchNo = line.batchNo.trim();
    if (priced && batchNo.length > 40) wrong.push('batch');
    if (priced && line.expiresOn !== '' && !isCalendarDay(line.expiresOn)) wrong.push('expiry');
    if (wrong.length > 0 || qty === null || cost === null) {
      problems[line.key] = wrong;
      continue;
    }
    if (priced) {
      receipts.push({
        inventoryItemId: line.itemId,
        qtyMilli: qty,
        totalCost: cost,
        batchNo: batchNo === '' ? null : batchNo,
        expiresOn: line.expiresOn === '' ? null : line.expiresOn,
      });
    } else {
      issues.push({
        inventoryItemId: line.itemId,
        qtyMilli: kind === 'adjust' && line.direction === 'out' ? -qty : qty,
      });
    }
  }

  const text = note.trim();
  const noteError =
    kind === 'receive'
      ? text.length > 60
        ? ('reference' as const)
        : undefined
      : kind === 'opening'
        ? undefined
        : text.length < 3 || text.length > 200
          ? ('reason' as const)
          : undefined;
  if (filled.length === 0 || Object.keys(problems).length > 0 || noteError !== undefined) {
    return {
      ok: false,
      errors: {
        lines: problems,
        ...(noteError === undefined ? {} : { note: noteError }),
        ...(filled.length === 0 ? { empty: true as const } : {}),
      },
    };
  }
  if (kind === 'receive') {
    return {
      ok: true,
      request: { kind, body: { lines: receipts, reference: text === '' ? null : text } },
    };
  }
  if (kind === 'opening') return { ok: true, request: { kind, body: { lines: receipts } } };
  return { ok: true, request: { kind, body: { lines: issues, reason: text } } };
}
