/** The import columns, in template order (documented on MenuImportRequestSchema). */
export const MENU_CSV_COLUMNS = [
  'sku',
  'name',
  'category',
  'price',
  'food_type',
  'tax_group',
  'kitchen_station',
  'short_name',
  'name_hi',
  'name_bn',
  'hsn_sac',
  'description',
] as const;
export type MenuCsvColumn = (typeof MENU_CSV_COLUMNS)[number];

/**
 * Example rows. `tax_group` is left empty: it must match an existing tax group
 * by name, which differs per restaurant. 996331 is the SAC for restaurant service.
 */
const EXAMPLES: readonly Record<MenuCsvColumn, string>[] = [
  {
    sku: 'BIR-CHK',
    name: 'Chicken Biryani',
    category: 'Biryani',
    price: '320.00',
    food_type: 'NON_VEG',
    tax_group: '',
    kitchen_station: 'Main Kitchen',
    short_name: 'Chk Biryani',
    name_hi: 'चिकन बिरयानी',
    name_bn: 'চিকেন বিরিয়ানি',
    hsn_sac: '996331',
    description: 'Kolkata-style dum biryani, with potato and egg',
  },
  {
    sku: 'CUR-PBM',
    name: 'Paneer Butter Masala',
    category: 'Curries',
    price: '280.00',
    food_type: 'VEG',
    tax_group: '',
    kitchen_station: 'Main Kitchen',
    short_name: 'Paneer BM',
    name_hi: 'पनीर बटर मसाला',
    name_bn: 'পনির বাটার মশলা',
    hsn_sac: '996331',
    description: 'Cottage cheese in a rich tomato and butter gravy',
  },
  {
    sku: 'BRD-BNAAN',
    name: 'Butter Naan',
    category: 'Breads',
    price: '60.00',
    food_type: 'VEG',
    tax_group: '',
    kitchen_station: 'Tandoor',
    short_name: 'Btr Naan',
    name_hi: 'बटर नान',
    name_bn: 'বাটার নান',
    hsn_sac: '996331',
    description: '',
  },
  {
    sku: 'BEV-CHAI',
    name: 'Masala Chai',
    category: 'Beverages',
    price: '30.00',
    food_type: 'VEG',
    tax_group: '',
    kitchen_station: 'Beverages',
    short_name: 'M Chai',
    name_hi: 'मसाला चाय',
    name_bn: 'মশলা চা',
    hsn_sac: '996331',
    description: 'Spiced milk tea',
  },
];

/** RFC 4180 quoting: only when the value has a comma, quote or line break. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function menuCsvTemplate(): string {
  const lines = [
    MENU_CSV_COLUMNS.join(','),
    ...EXAMPLES.map((row) => MENU_CSV_COLUMNS.map((c) => csvCell(row[c])).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
