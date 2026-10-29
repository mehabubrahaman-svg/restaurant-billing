import type {
  ConsumptionReport,
  InventoryItem,
  InventoryValuation,
  Recipe,
  StockAlerts,
  StockCount,
  StockMovement,
  Unit,
} from '@restroos/contracts';
import { shareBp, stockLevel, stockValue } from '@restroos/domain';
import { ITEM_BIRYANI, VARIANT_FULL } from './catalog-fixtures';

export const KG = 1_000_000;
export const G = 1_000;

export const RICE = '1a000000-0000-4000-8000-000000000001';
export const FLOUR = '1a000000-0000-4000-8000-000000000002';
export const CHICKEN = '1a000000-0000-4000-8000-000000000003';
export const BUTTER = '1a000000-0000-4000-8000-000000000004';
export const CURD = '1a000000-0000-4000-8000-000000000005';
export const EGGS = '1a000000-0000-4000-8000-000000000006';
export const PANEER = '1a000000-0000-4000-8000-000000000007';
export const COUNT_DRAFT = '1c000000-0000-4000-8000-000000000001';
export const COUNT_POSTED = '1c000000-0000-4000-8000-000000000002';
export const RECIPE_DISH = '1e000000-0000-4000-8000-000000000001';
export const RECIPE_FULL = '1e000000-0000-4000-8000-000000000002';
export const RAITA = 'a1000000-0000-4000-8000-000000000001';

/** As seeded by migration 0002. */
export const UNITS: Unit[] = [
  { id: 'unit-g', code: 'g', name: 'Gram', baseCode: 'g', toBaseMilli: 1000 },
  { id: 'unit-kg', code: 'kg', name: 'Kilogram', baseCode: 'g', toBaseMilli: KG },
  { id: 'unit-ml', code: 'ml', name: 'Millilitre', baseCode: 'ml', toBaseMilli: 1000 },
  { id: 'unit-l', code: 'l', name: 'Litre', baseCode: 'ml', toBaseMilli: KG },
  { id: 'unit-pc', code: 'pc', name: 'Piece', baseCode: 'pc', toBaseMilli: 1000 },
  { id: 'unit-dozen', code: 'dozen', name: 'Dozen', baseCode: 'pc', toBaseMilli: 12_000 },
  { id: 'unit-tray', code: 'tray', name: 'Tray (30)', baseCode: 'pc', toBaseMilli: 30_000 },
];

/** An item with its value and level worked out the way the Hub does. */
export function makeInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  const base: Omit<InventoryItem, 'value' | 'level'> = {
    id: RICE,
    sku: 'RICE-BAS',
    name: 'Basmati rice',
    nameTranslations: { hi: 'बासमती चावल', bn: 'বাসমতি চাল' },
    category: 'Grains',
    baseUnit: 'g',
    purchaseUnitId: 'unit-kg',
    isPerishable: false,
    shelfLifeDays: null,
    reorderLevelMilli: 5 * KG,
    maxLevelMilli: 25 * KG,
    qtyMilli: 30 * KG,
    // ₹86.67 a kg
    avgCostPerBase: 8_667,
    isActive: true,
    version: 2,
    ...overrides,
  };
  return {
    ...base,
    value: base.qtyMilli > 0 ? stockValue(base.qtyMilli, base.avgCostPerBase) : 0,
    level: stockLevel(base.qtyMilli, base.reorderLevelMilli, base.maxLevelMilli),
    ...overrides,
  };
}

export const rice = makeInventoryItem();
export const flour = makeInventoryItem({
  id: FLOUR,
  sku: 'MAIDA',
  name: 'Flour',
  nameTranslations: { hi: 'मैदा', bn: 'ময়দা' },
  reorderLevelMilli: 2 * KG,
  maxLevelMilli: null,
  qtyMilli: 10 * KG,
  avgCostPerBase: 4_000,
  version: 1,
});
export const chicken = makeInventoryItem({
  id: CHICKEN,
  sku: 'CHK',
  name: 'Chicken',
  nameTranslations: { hi: 'चिकन', bn: 'মুরগি' },
  category: 'Meat',
  purchaseUnitId: 'unit-kg',
  isPerishable: true,
  shelfLifeDays: 2,
  reorderLevelMilli: 3 * KG,
  maxLevelMilli: null,
  qtyMilli: 15 * KG,
  avgCostPerBase: 24_333,
  version: 1,
});
export const butter = makeInventoryItem({
  id: BUTTER,
  sku: 'BUTTER',
  name: 'Butter',
  nameTranslations: { hi: 'मक्खन', bn: 'মাখন' },
  category: 'Dairy',
  purchaseUnitId: null,
  reorderLevelMilli: 2 * KG,
  maxLevelMilli: null,
  qtyMilli: 1_200 * G,
  avgCostPerBase: 50_000,
  version: 1,
});
export const curd = makeInventoryItem({
  id: CURD,
  sku: 'CURD',
  name: 'Curd',
  nameTranslations: { hi: 'दही', bn: 'দই' },
  category: 'Dairy',
  purchaseUnitId: null,
  reorderLevelMilli: KG,
  maxLevelMilli: null,
  qtyMilli: 0,
  avgCostPerBase: 0,
  version: 1,
});
export const eggs = makeInventoryItem({
  id: EGGS,
  sku: 'EGG',
  name: 'Eggs',
  nameTranslations: { hi: 'अंडे', bn: 'ডিম' },
  category: 'Dairy',
  baseUnit: 'pc',
  purchaseUnitId: 'unit-dozen',
  reorderLevelMilli: 12_000,
  maxLevelMilli: null,
  qtyMilli: 36_000,
  // ₹6 an egg
  avgCostPerBase: 600_000,
  version: 1,
});

/** In the Hub's order: category, then name. */
export const ITEMS: InventoryItem[] = [butter, curd, eggs, flour, rice, chicken];

export function makeMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: '1b000000-0000-4000-8000-000000000001',
    inventoryItemId: RICE,
    itemName: 'Basmati rice',
    baseUnit: 'g',
    type: 'PURCHASE',
    qtyMilli: 10 * KG,
    balanceAfterMilli: 30 * KG,
    unitCostPerBase: 10_000,
    value: 100_000,
    batchNo: null,
    referenceType: 'RECEIPT',
    referenceId: '1d000000-0000-4000-8000-000000000001',
    reason: null,
    businessDate: '2026-10-28',
    createdAt: '2026-10-28T05:30:00.000Z',
    createdByName: 'Gopal Mondal',
    ...overrides,
  };
}

export function makeAlerts(overrides: Partial<StockAlerts> = {}): StockAlerts {
  return {
    businessDate: '2026-10-28',
    levels: [
      {
        inventoryItemId: BUTTER,
        sku: 'BUTTER',
        name: 'Butter',
        baseUnit: 'g',
        qtyMilli: 1_200 * G,
        reorderLevelMilli: 2 * KG,
        maxLevelMilli: null,
        level: 'LOW',
      },
      {
        inventoryItemId: CURD,
        sku: 'CURD',
        name: 'Curd',
        baseUnit: 'g',
        qtyMilli: -50 * G,
        reorderLevelMilli: KG,
        maxLevelMilli: null,
        level: 'OUT',
      },
      {
        inventoryItemId: RICE,
        sku: 'RICE-BAS',
        name: 'Basmati rice',
        baseUnit: 'g',
        qtyMilli: 30 * KG,
        reorderLevelMilli: 5 * KG,
        maxLevelMilli: 25 * KG,
        level: 'OVER',
      },
    ],
    negative: [
      { inventoryItemId: CURD, sku: 'CURD', name: 'Curd', baseUnit: 'g', qtyMilli: -50 * G },
    ],
    expiring: [
      {
        batchId: '1f000000-0000-4000-8000-000000000001',
        inventoryItemId: PANEER,
        name: 'Paneer',
        baseUnit: 'g',
        batchNo: 'P-12',
        expiresOn: '2026-10-27',
        remainingMilli: 800 * G,
        value: 28_000,
        expired: true,
      },
      {
        batchId: '1f000000-0000-4000-8000-000000000002',
        inventoryItemId: CHICKEN,
        name: 'Chicken',
        baseUnit: 'g',
        batchNo: 'LOT-7',
        expiresOn: '2026-10-30',
        remainingMilli: 4_560 * G,
        value: 110_958,
        expired: false,
      },
    ],
    ...overrides,
  };
}

type Line = StockCount['lines'][number];
const line = (
  item: InventoryItem,
  systemQtyMilli: number,
  countedQtyMilli: number | null = null,
): Line => ({
  inventoryItemId: item.id,
  sku: item.sku,
  name: item.name,
  category: item.category,
  baseUnit: item.baseUnit,
  systemQtyMilli,
  countedQtyMilli,
  varianceMilli: countedQtyMilli === null ? null : countedQtyMilli - systemQtyMilli,
  varianceValue:
    countedQtyMilli === null
      ? null
      : stockValue(countedQtyMilli - systemQtyMilli, item.avgCostPerBase),
});

/** A closing count started this morning; nothing counted yet unless `lines` say so. */
export function makeCount(overrides: Partial<StockCount> = {}): StockCount {
  return {
    id: COUNT_DRAFT,
    countType: 'CLOSING',
    businessDate: '2026-10-28',
    status: 'DRAFT',
    notes: null,
    counted: 0,
    varianceValue: 0,
    createdAt: '2026-10-28T16:30:00.000Z',
    createdByName: 'Gopal Mondal',
    postedAt: null,
    postedByName: null,
    version: 1,
    lines: [
      line(butter, 1_200 * G),
      line(curd, 0),
      line(eggs, 36_000),
      line(flour, 10 * KG),
      line(rice, 28_500 * G),
      line(chicken, 15 * KG),
    ],
    ...overrides,
  };
}

/** The same count once rice was found at 28 kg and posted. */
export function postedCount(): StockCount {
  const lines = [line(flour, 10 * KG, 10 * KG), line(rice, 28_500 * G, 28 * KG)];
  return makeCount({
    status: 'POSTED',
    counted: 2,
    varianceValue: -4_334,
    postedAt: '2026-10-28T17:05:00.000Z',
    postedByName: 'Ananya Sen',
    version: 3,
    lines,
  });
}

export function countLine(item: InventoryItem, system: number, counted: number | null): Line {
  return line(item, system, counted);
}

type Row = ConsumptionReport['rows'][number];
const row = (item: InventoryItem, figures: Partial<Row>): Row => ({
  inventoryItemId: item.id,
  sku: item.sku,
  name: item.name,
  category: item.category,
  baseUnit: item.baseUnit,
  openingMilli: 0,
  receivedMilli: 0,
  soldMilli: 0,
  wastageMilli: 0,
  adjustedMilli: 0,
  countVarianceMilli: 0,
  closingMilli: 0,
  soldValue: 0,
  wastageValue: 0,
  countVarianceValue: 0,
  closingValue: 0,
  varianceBp: null,
  ...figures,
});

/** One day: rice used 500 g more than the recipes say (100%); flour 2% more. */
export function makeConsumption(overrides: Partial<ConsumptionReport> = {}): ConsumptionReport {
  return {
    from: '2026-10-28',
    to: '2026-10-28',
    rows: [
      row(butter, {
        openingMilli: KG,
        adjustedMilli: 200 * G,
        closingMilli: 1_200 * G,
        closingValue: 60_000,
      }),
      row(flour, {
        openingMilli: 10 * KG,
        soldMilli: 5 * KG,
        countVarianceMilli: -100 * G,
        closingMilli: 4_900 * G,
        soldValue: 20_000,
        countVarianceValue: -400,
        closingValue: 19_600,
        varianceBp: 200,
      }),
      row(rice, {
        receivedMilli: 30 * KG,
        soldMilli: 500 * G,
        wastageMilli: KG,
        countVarianceMilli: -500 * G,
        closingMilli: 28 * KG,
        soldValue: 4_334,
        wastageValue: 8_667,
        countVarianceValue: -4_334,
        closingValue: 242_676,
        varianceBp: 10_000,
      }),
    ],
    totals: {
      soldValue: 24_334,
      wastageValue: 8_667,
      countVarianceValue: -4_734,
      closingValue: 322_276,
      varianceBp: 1_945,
    },
    ...overrides,
  };
}

type ValuationRow = InventoryValuation['rows'][number];
const valued = (item: InventoryItem, figures: Partial<ValuationRow>): ValuationRow => {
  const r: ValuationRow = {
    inventoryItemId: item.id,
    sku: item.sku,
    name: item.name,
    category: item.category,
    baseUnit: item.baseUnit,
    openingMilli: 0,
    openingCostPerBase: 0,
    openingValue: 0,
    receivedMilli: 0,
    receivedValue: 0,
    soldMilli: 0,
    soldValue: 0,
    wastageMilli: 0,
    wastageValue: 0,
    adjustedMilli: 0,
    adjustedValue: 0,
    closingMilli: 0,
    closingCostPerBase: 0,
    closingValue: 0,
    differenceValue: 0,
    ...figures,
  };
  return {
    ...r,
    openingValue: r.openingMilli > 0 ? stockValue(r.openingMilli, r.openingCostPerBase) : 0,
    closingValue: r.closingMilli > 0 ? stockValue(r.closingMilli, r.closingCostPerBase) : 0,
  };
};

/**
 * October to the 28th: butter found but not used, curd 50 g below zero,
 * flour and chicken used from opening stock, rice bought and used.
 */
export function makeValuation(overrides: Partial<InventoryValuation> = {}): InventoryValuation {
  const rows = [
    valued(butter, {
      openingMilli: KG,
      openingCostPerBase: 50_000,
      adjustedMilli: 200 * G,
      adjustedValue: 10_000,
      closingMilli: 1_200 * G,
      closingCostPerBase: 50_000,
    }),
    valued(curd, { soldMilli: 50 * G, closingMilli: -50 * G }),
    valued(flour, {
      openingMilli: 10 * KG,
      openingCostPerBase: 4_000,
      soldMilli: 5 * KG,
      soldValue: 20_000,
      adjustedMilli: -100 * G,
      adjustedValue: -400,
      closingMilli: 4_900 * G,
      closingCostPerBase: 4_000,
    }),
    valued(rice, {
      receivedMilli: 30 * KG,
      receivedValue: 260_000,
      soldMilli: 500 * G,
      soldValue: 4_334,
      wastageMilli: KG,
      wastageValue: 8_667,
      closingMilli: 28_500 * G,
      closingCostPerBase: 8_667,
      differenceValue: 11,
    }),
    valued(chicken, {
      openingMilli: 10 * KG,
      openingCostPerBase: 24_000,
      soldMilli: 220 * G,
      soldValue: 5_280,
      closingMilli: 9_780 * G,
      closingCostPerBase: 24_000,
    }),
  ];
  const sum = (key: keyof InventoryValuation['totals']) => rows.reduce((s, r) => s + r[key], 0);
  const totals = {
    openingValue: sum('openingValue'),
    receivedValue: sum('receivedValue'),
    soldValue: sum('soldValue'),
    wastageValue: sum('wastageValue'),
    adjustedValue: sum('adjustedValue'),
    closingValue: sum('closingValue'),
    differenceValue: sum('differenceValue'),
  };
  const category = (name: string, items: number) => {
    const value = rows.filter((r) => r.category === name).reduce((s, r) => s + r.closingValue, 0);
    return { category: name, items, value, shareBp: shareBp(value, totals.closingValue) };
  };
  return {
    from: '2026-10-01',
    to: '2026-10-28',
    branchName: 'Park Street',
    generatedAt: '2026-10-28T12:00:00.000Z',
    rows,
    categories: [category('Grains', 2), category('Meat', 1), category('Dairy', 1)],
    totals,
    books: { inventoryAccount: totals.closingValue + 11, difference: -11 },
    ...overrides,
  };
}

/** Chicken Biryani, any size: 150 g rice and 120 g chicken. */
export function makeDishRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: RECIPE_DISH,
    menuItemId: ITEM_BIRYANI,
    menuItemName: 'Chicken Biryani',
    variantId: null,
    variantName: null,
    yieldPortions: 1,
    ingredients: [
      {
        inventoryItemId: RICE,
        name: 'Basmati rice',
        baseUnit: 'g',
        qtyMilli: 150 * G,
        wastageBp: 0,
        costPerPortion: 1_300,
      },
      {
        inventoryItemId: CHICKEN,
        name: 'Chicken',
        baseUnit: 'g',
        qtyMilli: 120 * G,
        wastageBp: 0,
        costPerPortion: 2_920,
      },
    ],
    costPerPortion: 4_220,
    sellingPrice: 32_000,
    foodCostBp: 1_319,
    version: 1,
    ...overrides,
  };
}

/** The Full size: 250 g rice and 200 g chicken with 10% trim loss (₹75.20, 23.5% of ₹320). */
export function makeFullRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return makeDishRecipe({
    id: RECIPE_FULL,
    variantId: VARIANT_FULL,
    variantName: 'Full',
    ingredients: [
      {
        inventoryItemId: RICE,
        name: 'Basmati rice',
        baseUnit: 'g',
        qtyMilli: 250 * G,
        wastageBp: 0,
        costPerPortion: 2_167,
      },
      {
        inventoryItemId: CHICKEN,
        name: 'Chicken',
        baseUnit: 'g',
        qtyMilli: 200 * G,
        wastageBp: 1_000,
        costPerPortion: 5_353,
      },
    ],
    costPerPortion: 7_520,
    sellingPrice: 32_000,
    foodCostBp: 2_350,
    version: 1,
    ...overrides,
  });
}
