import type { AddonGroup, Category, KitchenStation, MenuItem, TaxGroup } from '@restroos/contracts';
import { readWorkbook, WorkbookError, writeWorkbook, type WriteSheet } from '../../lib/xlsx';

/**
 * The menu spreadsheet (docs/12 "Menu upload"): column order of the template
 * and of an export. Headers are matched case-insensitively by the Hub, and a
 * space counts as an underscore, so "Food Type" works too.
 */
export const MENU_COLUMNS = [
  'sku',
  'name',
  'category',
  'price',
  'food_type',
  'tax_group',
  'kitchen_station',
  'variants',
  'addon_groups',
  'image',
  'short_name',
  'name_hi',
  'name_bn',
  'description',
  'description_hi',
  'description_bn',
  'hsn_sac',
  'prep_time_min',
  'active',
] as const;
export type MenuColumn = (typeof MENU_COLUMNS)[number];
export const REQUIRED_COLUMNS: readonly MenuColumn[] = ['sku', 'name', 'category', 'price'];
export const MENU_SHEET = 'Menu items';
export const FOOD_TYPES = ['veg', 'non-veg', 'egg', 'vegan', 'na'] as const;

const WIDTHS: Record<MenuColumn, number> = {
  sku: 14,
  name: 30,
  category: 18,
  price: 10,
  food_type: 11,
  tax_group: 14,
  kitchen_station: 16,
  variants: 24,
  addon_groups: 20,
  image: 22,
  short_name: 16,
  name_hi: 26,
  name_bn: 26,
  description: 40,
  description_hi: 40,
  description_bn: 40,
  hsn_sac: 10,
  prep_time_min: 13,
  active: 8,
};

const FOOD: Record<MenuItem['foodType'], (typeof FOOD_TYPES)[number]> = {
  VEG: 'veg',
  NON_VEG: 'non-veg',
  EGG: 'egg',
  VEGAN: 'vegan',
  NA: 'na',
};

/** 24950 paise → "249.50" (no floating point). */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Examples in the template. `tax_group` stays empty: names differ per restaurant. */
const EXAMPLES: readonly Partial<Record<MenuColumn, string>>[] = [
  {
    sku: 'BIR-CHK',
    name: 'Chicken Biryani',
    category: 'Biryani',
    price: '320',
    food_type: 'non-veg',
    kitchen_station: 'Main Kitchen',
    variants: 'Half:220 | Full:320',
    image: 'chicken-biryani.jpg',
    short_name: 'Chk Biryani',
    name_hi: 'चिकन बिरयानी',
    name_bn: 'চিকেন বিরিয়ানি',
    description: 'Kolkata-style dum biryani, with potato and egg',
    hsn_sac: '996331',
    prep_time_min: '20',
    active: 'yes',
  },
  {
    sku: 'CUR-PBM',
    name: 'Paneer Butter Masala',
    category: 'Curries',
    price: '280',
    food_type: 'veg',
    kitchen_station: 'Main Kitchen',
    short_name: 'Paneer BM',
    name_hi: 'पनीर बटर मसाला',
    name_bn: 'পনির বাটার মশলা',
    description: 'Cottage cheese in a rich tomato and butter gravy',
    hsn_sac: '996331',
    prep_time_min: '15',
    active: 'yes',
  },
  {
    sku: 'BRD-BNAAN',
    name: 'Butter Naan',
    category: 'Breads',
    price: '60',
    food_type: 'veg',
    kitchen_station: 'Tandoor',
    name_hi: 'बटर नान',
    name_bn: 'বাটার নান',
    hsn_sac: '996331',
    active: 'yes',
  },
  {
    sku: 'BEV-CHAI',
    name: 'Masala Chai',
    category: 'Beverages',
    price: '30',
    food_type: 'veg',
    kitchen_station: 'Beverages',
    name_hi: 'मसाला चाय',
    name_bn: 'মশলা চা',
    description: 'Spiced milk tea',
    hsn_sac: '996331',
    active: 'yes',
  },
];

export interface MenuLookups {
  readonly categories: readonly Category[];
  readonly stations: readonly KitchenStation[];
  readonly taxGroups: readonly TaxGroup[];
  readonly addonGroups: readonly AddonGroup[];
}

/** The "Lists" sheet: what already exists on this Hub, for the drop-downs. */
function listsSheet(l: MenuLookups): WriteSheet {
  const columns = [
    ['category', ...l.categories.filter((c) => c.isActive).map((c) => c.name)],
    ['kitchen_station', ...l.stations.filter((s) => s.isActive).map((s) => s.name)],
    ['tax_group', ...l.taxGroups.filter((g) => g.isActive).map((g) => g.name)],
    ['addon_groups', ...l.addonGroups.filter((g) => g.isActive).map((g) => g.name)],
    ['food_type', ...FOOD_TYPES],
  ];
  const height = Math.max(...columns.map((c) => c.length));
  return {
    name: 'Lists',
    rows: Array.from({ length: height }, (_, r) => columns.map((c) => c[r] ?? '')),
    widths: [24, 20, 16, 24, 12],
  };
}

/** Drop-downs on the items sheet. Categories and stations suggest, but new ones may be typed. */
function itemLists(l: MenuLookups): WriteSheet['lists'] {
  const col = (c: MenuColumn) => MENU_COLUMNS.indexOf(c);
  const range = (letter: string, n: number) =>
    `Lists!$${letter}$2:$${letter}$${Math.max(2, n + 1)}`;
  return [
    { column: col('food_type'), values: [...FOOD_TYPES] },
    { column: col('active'), values: ['yes', 'no'] },
    ...(l.taxGroups.length > 0
      ? [{ column: col('tax_group'), values: range('C', l.taxGroups.length) }]
      : []),
  ];
}

export interface InstructionRow {
  readonly column: MenuColumn;
  readonly text: string;
}

/** The template: example rows, a sheet explaining each column, and the Hub's own lists. */
export function menuTemplate(
  lookups: MenuLookups,
  instructions: { title: string; required: string; optional: string; rows: InstructionRow[] },
): Uint8Array {
  return writeWorkbook([
    {
      name: MENU_SHEET,
      rows: [[...MENU_COLUMNS], ...EXAMPLES.map((e) => MENU_COLUMNS.map((c) => e[c] ?? ''))],
      widths: MENU_COLUMNS.map((c) => WIDTHS[c]),
      lists: itemLists(lookups),
    },
    {
      name: instructions.title,
      rows: [
        ['column', '', ''],
        ...instructions.rows.map((r) => [
          r.column,
          REQUIRED_COLUMNS.includes(r.column) ? instructions.required : instructions.optional,
          r.text,
        ]),
      ],
      widths: [18, 12, 100],
    },
    listsSheet(lookups),
  ]);
}

/** The menu as it is now, in the template's columns: edit it and upload it again. */
export function menuExport(items: readonly MenuItem[], lookups: MenuLookups): Uint8Array {
  const name = <T extends { id: string; name: string }>(list: readonly T[], id: string | null) =>
    id === null ? '' : (list.find((x) => x.id === id)?.name ?? '');
  const rows = [...items]
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder)
    .map((i) => {
      const row: Record<MenuColumn, string> = {
        sku: i.sku,
        name: i.name,
        category: name(lookups.categories, i.categoryId),
        price: rupees(i.basePrice),
        food_type: FOOD[i.foodType],
        tax_group: name(lookups.taxGroups, i.taxGroupId),
        kitchen_station: name(lookups.stations, i.kitchenStationId),
        variants: i.variants.map((v) => `${v.name}:${rupees(v.price)}`).join(' | '),
        addon_groups: i.addonGroupIds.map((id) => name(lookups.addonGroups, id)).join(' | '),
        // The photo's id on the Hub: keep it to keep the photo, or put a file name instead.
        image: i.imageId ?? '',
        short_name: i.shortName ?? '',
        name_hi: i.nameTranslations.hi ?? '',
        name_bn: i.nameTranslations.bn ?? '',
        description: i.description ?? '',
        description_hi: i.descriptionTranslations.hi ?? '',
        description_bn: i.descriptionTranslations.bn ?? '',
        hsn_sac: i.hsnSacCode ?? '',
        prep_time_min: i.prepTimeSec === null ? '' : String(Math.round(i.prepTimeSec / 60)),
        active: i.isActive ? 'yes' : 'no',
      };
      return MENU_COLUMNS.map((c) => row[c]);
    });
  return writeWorkbook([
    {
      name: MENU_SHEET,
      rows: [[...MENU_COLUMNS], ...rows],
      widths: MENU_COLUMNS.map((c) => WIDTHS[c]),
      lists: itemLists(lookups),
    },
    listsSheet(lookups),
  ]);
}

/** RFC 4180 CSV (quotes, doubled quotes, line breaks inside quotes), as the Hub reads it. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface MenuSheet {
  readonly fileName: string;
  /** Which sheet of a workbook was used (null for CSV). */
  readonly sheetName: string | null;
  readonly rows: string[][];
}

export class SheetError extends Error {}

const hasSkuHeader = (rows: readonly (readonly string[])[]) =>
  (rows[0] ?? []).some((h) => h.trim().toLowerCase() === 'sku');

/** Reads an .xlsx or .csv file into rows: the "Menu items" sheet, or the first with a sku column. */
export async function readMenuFile(file: File): Promise<MenuSheet> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    if (/\.xlsx?$/i.test(file.name)) throw new SheetError('notWorkbook');
    return {
      fileName: file.name,
      sheetName: null,
      rows: parseCsv(new TextDecoder().decode(bytes)),
    };
  }
  let sheets;
  try {
    sheets = readWorkbook(bytes);
  } catch (error) {
    throw new SheetError(error instanceof WorkbookError ? 'notWorkbook' : 'unreadable');
  }
  const sheet =
    sheets.find((s) => s.name.trim().toLowerCase() === MENU_SHEET.toLowerCase()) ??
    sheets.find((s) => hasSkuHeader(s.rows));
  if (sheet === undefined) throw new SheetError('noSkuColumn');
  return {
    fileName: file.name,
    sheetName: sheet.name,
    rows: sheet.rows.map((r) => [...r]),
  };
}
