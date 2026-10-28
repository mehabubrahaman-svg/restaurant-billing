import {
  SaveInventoryItemRequestSchema,
  type BaseUnit,
  type InventoryItem,
  type SaveInventoryItemRequest,
  type Unit,
} from '@restroos/contracts';
import type { QuantityDraft } from '../../features/inventory/stock-controls';
import {
  parseQuantity,
  preferredUnit,
  quantityText,
  unitsFor,
} from '../../features/inventory/quantity';
import { cleanTranslations } from '../../features/menu/localized-name';
import { toLatinDigits } from '../../lib/units';

/** Everything the item dialog edits, as typed. */
export interface ItemDraft {
  readonly sku: string;
  readonly name: string;
  readonly nameHi: string;
  readonly nameBn: string;
  readonly category: string;
  readonly baseUnit: BaseUnit;
  /** '' = bought in the base unit. */
  readonly purchaseUnitId: string;
  readonly isPerishable: boolean;
  readonly shelfLifeDays: string;
  readonly reorder: QuantityDraft;
  readonly max: QuantityDraft;
}

export type ItemDraftField = 'sku' | 'name' | 'category' | 'shelfLife' | 'reorder' | 'max';
export type ItemDraftError =
  | 'menu.item.errors.sku'
  | 'menu.item.errors.name'
  | 'inventory.errors.category'
  | 'inventory.errors.shelfLife'
  | 'inventory.errors.quantity'
  | 'inventory.errors.maxAboveReorder'
  | 'errors.validation';

const SKU = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

/** A level as the dialog shows it: in the purchase unit when it fits exactly, else the base unit. */
function levelDraft(milli: number | null, unit: Unit, base: Unit): QuantityDraft {
  if (milli === null || milli === 0) return { text: '', unitId: unit.id };
  const inUnit = quantityText(milli, unit.toBaseMilli);
  if (inUnit !== null) return { text: inUnit, unitId: unit.id };
  return { text: quantityText(milli, base.toBaseMilli) ?? '', unitId: base.id };
}

/** The dialog's starting values: an existing item, or a new one counted in grams. */
export function itemToDraft(item: InventoryItem | null, units: readonly Unit[]): ItemDraft {
  const baseUnit = item?.baseUnit ?? 'g';
  const unit = preferredUnit({ baseUnit, purchaseUnitId: item?.purchaseUnitId ?? null }, units);
  const base = preferredUnit({ baseUnit, purchaseUnitId: null }, units);
  return {
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    nameHi: item?.nameTranslations.hi ?? '',
    nameBn: item?.nameTranslations.bn ?? '',
    category: item?.category ?? '',
    baseUnit,
    purchaseUnitId: item?.purchaseUnitId ?? '',
    isPerishable: item?.isPerishable ?? false,
    shelfLifeDays: item === null || item.shelfLifeDays === null ? '' : String(item.shelfLifeDays),
    reorder: levelDraft(item?.reorderLevelMilli ?? null, unit, base),
    max: levelDraft(item?.maxLevelMilli ?? null, unit, base),
  };
}

/** Switching the base unit: purchase unit and level units move to the new kind. */
export function withBaseUnit(
  draft: ItemDraft,
  baseUnit: BaseUnit,
  units: readonly Unit[],
): ItemDraft {
  const base = preferredUnit({ baseUnit, purchaseUnitId: null }, units);
  const keep = (q: QuantityDraft) =>
    unitsFor(baseUnit, units).some((u) => u.id === q.unitId) ? q : { ...q, unitId: base.id };
  return {
    ...draft,
    baseUnit,
    purchaseUnitId: unitsFor(baseUnit, units).some((u) => u.id === draft.purchaseUnitId)
      ? draft.purchaseUnitId
      : '',
    reorder: keep(draft.reorder),
    max: keep(draft.max),
  };
}

/** A typed level → milli base units; '' is "not set". `undefined` when unreadable. */
function levelOf(q: QuantityDraft, units: readonly Unit[]): number | null | undefined {
  if (q.text.trim() === '') return null;
  const unit = units.find((u) => u.id === q.unitId);
  if (unit === undefined) return undefined;
  const milli = parseQuantity(q.text, unit.toBaseMilli);
  return milli === null ? undefined : milli;
}

/**
 * Checks the draft the way the Hub will and builds the request body.
 * Quantities are parsed from text into milli-units; nothing goes through a float.
 */
export function draftToBody(
  draft: ItemDraft,
  units: readonly Unit[],
):
  | { ok: true; body: SaveInventoryItemRequest }
  | { ok: false; errors: Partial<Record<ItemDraftField | 'form', ItemDraftError>> } {
  const errors: Partial<Record<ItemDraftField | 'form', ItemDraftError>> = {};
  const sku = draft.sku.trim().toUpperCase();
  if (!SKU.test(sku)) errors.sku = 'menu.item.errors.sku';
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 120) errors.name = 'menu.item.errors.name';
  const category = draft.category.trim();
  if (category.length > 60) errors.category = 'inventory.errors.category';

  let shelfLifeDays: number | null = null;
  const shelf = toLatinDigits(draft.shelfLifeDays).trim();
  if (draft.isPerishable && shelf !== '') {
    const days = /^\d{1,4}$/.test(shelf) ? Number(shelf) : NaN;
    if (!(days >= 1 && days <= 3650)) errors.shelfLife = 'inventory.errors.shelfLife';
    else shelfLifeDays = days;
  }

  const reorder = levelOf(draft.reorder, units);
  const max = levelOf(draft.max, units);
  if (reorder === undefined) errors.reorder = 'inventory.errors.quantity';
  if (max === undefined || max === 0) errors.max = 'inventory.errors.quantity';
  else if (max !== null && reorder !== undefined && max <= (reorder ?? 0)) {
    errors.max = 'inventory.errors.maxAboveReorder';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: SaveInventoryItemRequest = {
    sku,
    name,
    nameTranslations: cleanTranslations(draft.nameHi, draft.nameBn),
    category: category === '' ? null : category,
    baseUnit: draft.baseUnit,
    purchaseUnitId: draft.purchaseUnitId === '' ? null : draft.purchaseUnitId,
    isPerishable: draft.isPerishable,
    shelfLifeDays: draft.isPerishable ? shelfLifeDays : null,
    reorderLevelMilli: reorder ?? 0,
    maxLevelMilli: max ?? null,
  };
  // The contract has the last word, so a slip in the checks above stops here, not as a 422.
  if (!SaveInventoryItemRequestSchema.safeParse(body).success) {
    return { ok: false, errors: { form: 'errors.validation' } };
  }
  return { ok: true, body };
}
