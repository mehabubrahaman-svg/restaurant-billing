import { SaveMenuItemRequestSchema, type MenuItem } from '@restroos/contracts';
import type { FoodType, SaveMenuItemBody } from '../../api/endpoints';
import { paiseToRupees, rupeesToPaise } from '../../lib/units';
import { cleanTranslations } from './localized-name';

/** One row of the variants editor. `key` is local; `id` is kept so the Hub updates, not replaces. */
export interface VariantRow {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly hi: string;
  readonly bn: string;
  readonly price: string;
}

/** Everything the item editor edits, as typed (strings), before parsing. */
export interface ItemForm {
  readonly sku: string;
  readonly name: string;
  readonly shortName: string;
  readonly nameHi: string;
  readonly nameBn: string;
  readonly description: string;
  readonly descriptionHi: string;
  readonly descriptionBn: string;
  readonly categoryId: string;
  readonly foodType: FoodType;
  readonly price: string;
  /** '' = no tax group. */
  readonly taxGroupId: string;
  readonly hsnSac: string;
  /** '' = not sent to a particular station. */
  readonly kitchenStationId: string;
  /** Whole minutes, '' = not set. */
  readonly prepMinutes: string;
  readonly sortOrder: string;
  readonly variants: readonly VariantRow[];
  readonly addonGroupIds: readonly string[];
}

export type ItemErrorKey =
  | 'menu.item.errors.sku'
  | 'menu.item.errors.name'
  | 'menu.item.errors.shortName'
  | 'menu.item.errors.category'
  | 'menu.item.errors.hsn'
  | 'menu.item.errors.prep'
  | 'menu.item.errors.sortOrder'
  | 'menu.item.errors.description'
  | 'menu.item.errors.tooManyVariants'
  | 'menu.item.errors.tooManyAddons'
  | 'validation.amount'
  | 'errors.validation';

export type ItemField =
  | 'sku'
  | 'name'
  | 'shortName'
  | 'categoryId'
  | 'price'
  | 'hsnSac'
  | 'prepMinutes'
  | 'sortOrder'
  | 'description'
  | 'variants'
  | 'addonGroupIds'
  | 'form';

export interface ItemFormErrors {
  readonly fields: Partial<Record<ItemField, ItemErrorKey>>;
  /** Per variant row (by `key`): which of its fields are wrong. */
  readonly variants: Readonly<Record<string, { name?: ItemErrorKey; price?: ItemErrorKey }>>;
}

export const MAX_VARIANTS = 10;
export const MAX_ADDON_GROUPS = 10;
const SKU = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

let rowCounter = 0;
export function newRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

export function emptyVariant(): VariantRow {
  return { key: newRowKey(), name: '', hi: '', bn: '', price: '' };
}

/** The editor's starting values for an item, or for a new one in `categoryId`. */
export function itemToForm(item: MenuItem | null, categoryId = ''): ItemForm {
  if (item === null) {
    return {
      sku: '',
      name: '',
      shortName: '',
      nameHi: '',
      nameBn: '',
      description: '',
      descriptionHi: '',
      descriptionBn: '',
      categoryId,
      foodType: 'VEG',
      price: '',
      taxGroupId: '',
      hsnSac: '',
      kitchenStationId: '',
      prepMinutes: '',
      sortOrder: '0',
      variants: [],
      addonGroupIds: [],
    };
  }
  return {
    sku: item.sku,
    name: item.name,
    shortName: item.shortName ?? '',
    nameHi: item.nameTranslations.hi ?? '',
    nameBn: item.nameTranslations.bn ?? '',
    description: item.description ?? '',
    descriptionHi: item.descriptionTranslations.hi ?? '',
    descriptionBn: item.descriptionTranslations.bn ?? '',
    categoryId: item.categoryId,
    foodType: item.foodType,
    price: paiseToRupees(item.basePrice),
    taxGroupId: item.taxGroupId ?? '',
    hsnSac: item.hsnSacCode ?? '',
    kitchenStationId: item.kitchenStationId ?? '',
    // Shown in whole minutes; an odd number of seconds from an import rounds up.
    prepMinutes: item.prepTimeSec === null ? '' : String(Math.ceil(item.prepTimeSec / 60)),
    sortOrder: String(item.sortOrder),
    variants: [...item.variants]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({
        key: newRowKey(),
        id: v.id,
        name: v.name,
        hi: v.nameTranslations.hi ?? '',
        bn: v.nameTranslations.bn ?? '',
        price: paiseToRupees(v.price),
      })),
    addonGroupIds: item.addonGroupIds,
  };
}

const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

/**
 * Parses and checks the form. On success returns the full request body
 * (variants and add-on groups as complete lists); otherwise translated-key
 * errors per field. Money is parsed from the rupee string without floats.
 */
export function formToBody(
  form: ItemForm,
): { ok: true; body: SaveMenuItemBody } | { ok: false; errors: ItemFormErrors } {
  const fields: Partial<Record<ItemField, ItemErrorKey>> = {};
  const variantErrors: Record<string, { name?: ItemErrorKey; price?: ItemErrorKey }> = {};

  const sku = form.sku.trim().toUpperCase();
  if (!SKU.test(sku)) fields.sku = 'menu.item.errors.sku';
  const name = form.name.trim();
  if (name.length < 1 || name.length > 120) fields.name = 'menu.item.errors.name';
  if (form.shortName.trim().length > 24) fields.shortName = 'menu.item.errors.shortName';
  if (form.description.trim().length > 500) fields.description = 'menu.item.errors.description';
  if (form.categoryId === '') fields.categoryId = 'menu.item.errors.category';
  const basePrice = rupeesToPaise(form.price);
  if (basePrice === null) fields.price = 'validation.amount';
  const hsn = form.hsnSac.trim();
  if (hsn !== '' && !/^\d{4,8}$/.test(hsn)) fields.hsnSac = 'menu.item.errors.hsn';

  let prepTimeSec: number | null = null;
  if (form.prepMinutes.trim() !== '') {
    const minutes = /^\d{1,3}$/.test(form.prepMinutes.trim()) ? Number(form.prepMinutes) : NaN;
    if (!(minutes >= 1 && minutes <= 240)) fields.prepMinutes = 'menu.item.errors.prep';
    else prepTimeSec = minutes * 60;
  }
  const sortText = form.sortOrder.trim() === '' ? '0' : form.sortOrder.trim();
  if (!/^-?\d{1,6}$/.test(sortText)) fields.sortOrder = 'menu.item.errors.sortOrder';

  if (form.variants.length > MAX_VARIANTS) fields.variants = 'menu.item.errors.tooManyVariants';
  const variants: NonNullable<SaveMenuItemBody['variants']> = [];
  for (const row of form.variants) {
    const vName = row.name.trim();
    const price = rupeesToPaise(row.price);
    const wrong: { name?: ItemErrorKey; price?: ItemErrorKey } = {};
    if (vName.length < 1 || vName.length > 120) wrong.name = 'menu.item.errors.name';
    if (price === null) wrong.price = 'validation.amount';
    if (wrong.name !== undefined || wrong.price !== undefined) {
      variantErrors[row.key] = wrong;
      continue;
    }
    variants.push({
      ...(row.id === undefined ? {} : { id: row.id }),
      name: vName,
      nameTranslations: cleanTranslations(row.hi, row.bn),
      price: price ?? 0,
    });
  }
  if (form.addonGroupIds.length > MAX_ADDON_GROUPS) {
    fields.addonGroupIds = 'menu.item.errors.tooManyAddons';
  }

  if (Object.keys(fields).length > 0 || Object.keys(variantErrors).length > 0) {
    return { ok: false, errors: { fields, variants: variantErrors } };
  }

  const body: SaveMenuItemBody = {
    sku,
    name,
    shortName: blankToNull(form.shortName),
    nameTranslations: cleanTranslations(form.nameHi, form.nameBn),
    description: blankToNull(form.description),
    descriptionTranslations: cleanTranslations(form.descriptionHi, form.descriptionBn),
    categoryId: form.categoryId,
    foodType: form.foodType,
    basePrice: basePrice ?? 0,
    taxGroupId: form.taxGroupId === '' ? null : form.taxGroupId,
    hsnSacCode: hsn === '' ? null : hsn,
    kitchenStationId: form.kitchenStationId === '' ? null : form.kitchenStationId,
    prepTimeSec,
    sortOrder: Number(sortText),
    variants,
    addonGroupIds: [...form.addonGroupIds],
  };
  // The contract is the source of truth: anything it rejects that the checks
  // above missed still stops here instead of becoming a 422.
  if (!SaveMenuItemRequestSchema.safeParse(body).success) {
    return { ok: false, errors: { fields: { form: 'errors.validation' }, variants: {} } };
  }
  return { ok: true, body };
}
