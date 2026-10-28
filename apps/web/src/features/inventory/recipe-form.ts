import type { InventoryItem, Recipe, Unit } from '@restroos/contracts';
import { portionCost, shareBp } from '@restroos/domain';
import { bpToPercent, percentToBp, toLatinDigits } from '../../lib/units';
import { newRowKey } from '../menu/item-form';
import { parseQuantity, preferredUnit, quantityText } from './quantity';
import type { QuantityDraft } from './stock-controls';

/** One ingredient row as typed: the item, how much (for the whole batch) and trim loss %. */
export interface IngredientRow {
  readonly key: string;
  readonly itemId: string;
  readonly qty: QuantityDraft;
  /** Percent as typed, '' = none. */
  readonly trim: string;
}

export interface RecipeDraft {
  /** Portions the quantities make, as typed. */
  readonly yieldPortions: string;
  readonly rows: readonly IngredientRow[];
}

export type RowProblem = 'item' | 'qty' | 'trim' | 'duplicate';
export interface RecipeErrors {
  readonly yieldPortions?: true;
  readonly rows: Readonly<Record<string, readonly RowProblem[]>>;
  readonly empty?: true;
}

export interface IngredientLine {
  readonly inventoryItemId: string;
  readonly qtyMilli: number;
  readonly wastageBp: number;
}

export const MAX_INGREDIENTS = 50;

/** Recipe quantities are small, so rows start in the base unit (g, ml, pc). */
const rowUnit = (baseUnit: InventoryItem['baseUnit'], units: readonly Unit[]) =>
  preferredUnit({ baseUnit, purchaseUnitId: null }, units);

export function emptyRow(): IngredientRow {
  return { key: newRowKey(), itemId: '', qty: { text: '', unitId: '' }, trim: '' };
}

/** A new row for `item`, in its base unit. */
export function rowFor(
  item: InventoryItem,
  units: readonly Unit[],
  previous?: IngredientRow,
): IngredientRow {
  return {
    ...(previous ?? emptyRow()),
    itemId: item.id,
    qty: { text: previous?.qty.text ?? '', unitId: rowUnit(item.baseUnit, units).id },
  };
}

/** The editor's rows for a saved recipe (or a blank one to start from). */
export function recipeToDraft(
  recipe: Pick<Recipe, 'yieldPortions' | 'ingredients'> | null,
  units: readonly Unit[],
): RecipeDraft {
  if (recipe === null) return { yieldPortions: '1', rows: [emptyRow()] };
  return {
    yieldPortions: String(recipe.yieldPortions),
    rows: recipe.ingredients.map((i) => {
      const unit = rowUnit(i.baseUnit, units);
      return {
        key: newRowKey(),
        itemId: i.inventoryItemId,
        qty: { text: quantityText(i.qtyMilli, unit.toBaseMilli) ?? '', unitId: unit.id },
        trim: i.wastageBp === 0 ? '' : bpToPercent(i.wastageBp),
      };
    }),
  };
}

const isBlank = (r: IngredientRow) =>
  r.itemId === '' && r.qty.text.trim() === '' && r.trim.trim() === '';

/**
 * Checks the rows and turns them into the ingredient lines the Hub takes:
 * quantities in milli base units, trim loss in basis points. Blank rows are skipped.
 */
export function draftToLines(
  draft: RecipeDraft,
  units: readonly Unit[],
):
  | { ok: true; yieldPortions: number; lines: IngredientLine[] }
  | { ok: false; errors: RecipeErrors } {
  const rows: Record<string, RowProblem[]> = {};
  const lines: IngredientLine[] = [];
  const seen = new Set<string>();
  const filled = draft.rows.filter((r) => !isBlank(r));
  for (const row of filled) {
    const wrong: RowProblem[] = [];
    if (row.itemId === '') wrong.push('item');
    else if (seen.has(row.itemId)) wrong.push('duplicate');
    seen.add(row.itemId);
    const unit = units.find((u) => u.id === row.qty.unitId);
    const qty = unit === undefined ? null : parseQuantity(row.qty.text, unit.toBaseMilli);
    if (qty === null || qty <= 0) wrong.push('qty');
    const trimText = toLatinDigits(row.trim).trim();
    const trim = trimText === '' ? 0 : percentToBp(trimText);
    if (trim === null || trim > 10_000) wrong.push('trim');
    if (wrong.length > 0 || qty === null || trim === null) rows[row.key] = wrong;
    else lines.push({ inventoryItemId: row.itemId, qtyMilli: qty, wastageBp: trim });
  }
  const yieldText = toLatinDigits(draft.yieldPortions).trim();
  const yieldPortions = /^\d{1,4}$/.test(yieldText) ? Number(yieldText) : NaN;
  const badYield = !(yieldPortions >= 1 && yieldPortions <= 1000);
  const empty = filled.length === 0 || filled.length > MAX_INGREDIENTS;
  if (badYield || empty || Object.keys(rows).length > 0) {
    return {
      ok: false,
      errors: {
        rows,
        ...(badYield ? { yieldPortions: true } : {}),
        ...(empty ? { empty: true } : {}),
      },
    };
  }
  return { ok: true, yieldPortions, lines };
}

/**
 * What the rows would cost per portion at today's average costs, the way the
 * Hub works it out (domain `portionCost`), and that as a share of the price.
 * Rows that don't parse yet count as nothing.
 */
export function estimate(
  draft: RecipeDraft,
  items: ReadonlyMap<string, InventoryItem>,
  units: readonly Unit[],
  sellingPrice: number,
): { costPerPortion: number; foodCostBp: number | null } | null {
  const yieldText = toLatinDigits(draft.yieldPortions).trim();
  const portions = /^\d{1,4}$/.test(yieldText) ? Number(yieldText) : 0;
  if (portions < 1) return null;
  let cost = 0;
  for (const row of draft.rows) {
    const item = items.get(row.itemId);
    const unit = units.find((u) => u.id === row.qty.unitId);
    if (item === undefined || unit === undefined) continue;
    const qtyMilli = parseQuantity(row.qty.text, unit.toBaseMilli);
    const trimText = toLatinDigits(row.trim).trim();
    const wastageBp = trimText === '' ? 0 : percentToBp(trimText);
    if (qtyMilli === null || qtyMilli <= 0 || wastageBp === null) continue;
    cost += portionCost(
      { inventoryItemId: item.id, qtyMilli, wastageBp },
      portions,
      item.avgCostPerBase,
    );
  }
  return { costPerPortion: cost, foodCostBp: shareBp(cost, sellingPrice) };
}
