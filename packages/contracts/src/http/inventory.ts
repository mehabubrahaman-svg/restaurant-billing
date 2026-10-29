import { z } from 'zod';
import {
  CalendarDateSchema,
  BasisPointsSchema,
  IdSchema,
  PaiseSchema,
  patchSchema,
} from './common';
import { SkuSchema, TranslationsSchema } from './catalog';

/**
 * Stock (docs/03 §6, §4.3). Quantities are integer milli-units of the item's
 * base unit: 2.5 kg of rice = 2_500_000 (g × 1000). Costs are paise per 1000
 * base units (per kg, per litre, per 1000 pieces).
 */
const Version = z.number().int();
const Name = z.string().trim().min(1).max(120);
const Day = CalendarDateSchema;
/** Milli-units of the base unit. 10 tonnes is plenty for one line. */
const Milli = z.number().int().min(-10_000_000_000).max(10_000_000_000);
const PositiveMilli = Milli.positive();
const Reason = z.string().trim().min(3).max(200);

export const BaseUnitSchema = z.enum(['g', 'ml', 'pc']);
export type BaseUnit = z.infer<typeof BaseUnitSchema>;
export const StockLevelSchema = z.enum(['OUT', 'LOW', 'OK', 'OVER']);
export type StockLevel = z.infer<typeof StockLevelSchema>;
export const MovementTypeSchema = z.enum([
  'OPENING',
  'PURCHASE',
  'SALE_CONSUMPTION',
  'SALE_REVERSAL',
  'WASTAGE',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RETURN_TO_VENDOR',
]);
export type MovementType = z.infer<typeof MovementTypeSchema>;

// ---- units ----------------------------------------------------------------------
export const UnitSchema = z.object({
  id: z.string(),
  /** g, kg, ml, l, pc, dozen, tray */
  code: z.string(),
  name: z.string(),
  baseCode: BaseUnitSchema,
  /** Milli base units in one of this unit: 1 kg = 1_000_000. */
  toBaseMilli: z.number().int().positive(),
});
export type Unit = z.infer<typeof UnitSchema>;
export const UnitsResponseSchema = z.object({ data: z.array(UnitSchema) });

// ---- inventory items --------------------------------------------------------------
export const InventoryItemSchema = z.object({
  id: IdSchema,
  sku: z.string(),
  name: z.string(),
  nameTranslations: TranslationsSchema,
  /** "Grains", "Meat", "Dairy" … free text. */
  category: z.string().nullable(),
  baseUnit: BaseUnitSchema,
  /** The unit it is bought in (kg, l, dozen); its base must be `baseUnit`. */
  purchaseUnitId: z.string().nullable(),
  isPerishable: z.boolean(),
  /** Perishable receipts without an expiry date expire this many days after the business day. */
  shelfLifeDays: z.number().int().nullable(),
  /** In this branch. */
  reorderLevelMilli: z.number().int(),
  maxLevelMilli: z.number().int().nullable(),
  /** On hand in this branch; may be negative when sales ran ahead of receipts. */
  qtyMilli: z.number().int(),
  /** Weighted average, paise per 1000 base units. */
  avgCostPerBase: z.number().int(),
  /** qtyMilli × avgCostPerBase, paise (0 when negative). */
  value: PaiseSchema,
  level: StockLevelSchema,
  isActive: z.boolean(),
  version: Version,
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export const InventoryItemsResponseSchema = z.object({ data: z.array(InventoryItemSchema) });
export type InventoryItemsResponse = z.infer<typeof InventoryItemsResponseSchema>;

export const SaveInventoryItemRequestSchema = z.object({
  sku: SkuSchema,
  name: Name,
  nameTranslations: TranslationsSchema.default({}),
  category: z.string().trim().min(1).max(60).nullable().default(null),
  baseUnit: BaseUnitSchema,
  purchaseUnitId: z.string().max(40).nullable().default(null),
  isPerishable: z.boolean().default(false),
  shelfLifeDays: z.number().int().min(1).max(3650).nullable().default(null),
  reorderLevelMilli: Milli.nonnegative().default(0),
  maxLevelMilli: PositiveMilli.nullable().default(null),
});
export type SaveInventoryItemRequest = z.input<typeof SaveInventoryItemRequestSchema>;
/** The base unit can't change once the item has stock movements. `isActive: false` retires it. */
export const UpdateInventoryItemRequestSchema = patchSchema(SaveInventoryItemRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

// ---- recipes ------------------------------------------------------------------------
export const RecipeIngredientSchema = z.object({
  inventoryItemId: IdSchema,
  name: z.string(),
  baseUnit: BaseUnitSchema,
  /** For `yieldPortions` portions, before trim loss. */
  qtyMilli: z.number().int(),
  /** Expected trim loss on top, basis points (500 = 5%). */
  wastageBp: z.number().int(),
  /** This ingredient's share of one portion at today's average cost. */
  costPerPortion: PaiseSchema,
});

/**
 * What one dish (or one size of it) takes from stock. A dish's variant uses
 * its own recipe if it has one, else the dish's (variantId null).
 */
export const RecipeSchema = z.object({
  id: IdSchema,
  menuItemId: IdSchema,
  menuItemName: z.string(),
  variantId: IdSchema.nullable(),
  variantName: z.string().nullable(),
  yieldPortions: z.number().int(),
  ingredients: z.array(RecipeIngredientSchema),
  /** Ingredients of one portion at average cost, paise. */
  costPerPortion: PaiseSchema,
  /** The dish's (or variant's) menu price. */
  sellingPrice: PaiseSchema,
  /** costPerPortion ÷ sellingPrice in basis points; null for a free dish. */
  foodCostBp: z.number().int().nullable(),
  version: Version,
});
export type Recipe = z.infer<typeof RecipeSchema>;
export const RecipesResponseSchema = z.object({ data: z.array(RecipeSchema) });
export type RecipesResponse = z.infer<typeof RecipesResponseSchema>;

const IngredientInput = z.object({
  inventoryItemId: IdSchema,
  qtyMilli: PositiveMilli,
  wastageBp: BasisPointsSchema.default(0),
});
export const SaveRecipeRequestSchema = z.object({
  menuItemId: IdSchema,
  variantId: IdSchema.nullable().default(null),
  yieldPortions: z.number().int().min(1).max(1000).default(1),
  ingredients: z.array(IngredientInput).min(1).max(50),
});
export type SaveRecipeRequest = z.input<typeof SaveRecipeRequestSchema>;
/** `isActive: false` removes the recipe: the dish no longer takes stock. */
export const UpdateRecipeRequestSchema = z.object({
  version: Version,
  yieldPortions: z.number().int().min(1).max(1000).optional(),
  ingredients: z.array(IngredientInput).min(1).max(50).optional(),
  isActive: z.boolean().optional(),
});

// ---- add-on ingredients -------------------------------------------------------------
/** Extra cheese = 30 g of cheese, per add-on on one portion. */
export const AddonIngredientsSchema = z.object({
  addonId: IdSchema,
  ingredients: z.array(
    z.object({
      inventoryItemId: IdSchema,
      name: z.string(),
      baseUnit: BaseUnitSchema,
      qtyMilli: z.number().int(),
    }),
  ),
});
export type AddonIngredients = z.infer<typeof AddonIngredientsSchema>;
/** The full list: ingredients not listed are removed. An empty list means the add-on takes nothing. */
export const SetAddonIngredientsRequestSchema = z.object({
  ingredients: z.array(z.object({ inventoryItemId: IdSchema, qtyMilli: PositiveMilli })).max(20),
});

// ---- stock entries --------------------------------------------------------------------
const ReceiptLine = z.object({
  inventoryItemId: IdSchema,
  qtyMilli: PositiveMilli,
  /** What was paid for the whole line, paise (before input tax). */
  totalCost: PaiseSchema.nonnegative(),
  batchNo: z.string().trim().min(1).max(40).nullable().default(null),
  expiresOn: Day.nullable().default(null),
});

/** Bought directly (from the market, without a purchase order). */
export const StockReceiptRequestSchema = z.object({
  lines: z.array(ReceiptLine).min(1).max(100),
  /** The seller's bill number or a note. */
  reference: z.string().trim().max(60).nullable().default(null),
});
/**
 * Stock already on the shelves when the restaurant starts using RestroOS, per
 * item, once, before it is first received (sales before it are allowed).
 */
export const OpeningStockRequestSchema = z.object({
  lines: z.array(ReceiptLine).min(1).max(500),
});
/** Spoiled, spilt or expired. Taken at average cost, earliest expiry first. */
export const WastageRequestSchema = z.object({
  lines: z
    .array(z.object({ inventoryItemId: IdSchema, qtyMilli: PositiveMilli }))
    .min(1)
    .max(100),
  reason: Reason,
});
/** Corrections outside a stock count: + adds, − removes. */
export const AdjustmentRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        inventoryItemId: IdSchema,
        qtyMilli: Milli.refine((v) => v !== 0, 'not zero'),
      }),
    )
    .min(1)
    .max(100),
  reason: Reason,
});

/** The items a stock entry changed, with their new balances. */
export const StockEntryResponseSchema = z.object({
  referenceId: IdSchema,
  items: z.array(InventoryItemSchema),
});
export type StockEntryResponse = z.infer<typeof StockEntryResponseSchema>;

// ---- movements ------------------------------------------------------------------------
export const StockMovementSchema = z.object({
  id: IdSchema,
  inventoryItemId: IdSchema,
  itemName: z.string(),
  baseUnit: BaseUnitSchema,
  type: MovementTypeSchema,
  /** Signed: + in, − out. */
  qtyMilli: z.number().int(),
  balanceAfterMilli: z.number().int(),
  unitCostPerBase: z.number().int(),
  /** Signed, paise. */
  value: PaiseSchema,
  batchNo: z.string().nullable(),
  /** ORDER_ITEM, RECEIPT, OPENING, WASTAGE, ADJUSTMENT, STOCK_COUNT, GRN_LINE … */
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  reason: z.string().nullable(),
  businessDate: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;
export const StockMovementsResponseSchema = z.object({
  data: z.array(StockMovementSchema),
  /** Pass as `before` for the next (older) page; null at the end. */
  nextCursor: z.string().nullable(),
});
export type StockMovementsResponse = z.infer<typeof StockMovementsResponseSchema>;
export const StockMovementsQuerySchema = z.object({
  inventoryItemId: IdSchema.optional(),
  type: MovementTypeSchema.optional(),
  from: Day.optional(),
  to: Day.optional(),
  before: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ---- stock counts -----------------------------------------------------------------------
export const StockCountTypeSchema = z.enum(['OPENING', 'CLOSING', 'SPOT']);
export const StockCountStatusSchema = z.enum(['DRAFT', 'POSTED']);

export const StockCountSummarySchema = z.object({
  id: IdSchema,
  countType: StockCountTypeSchema,
  businessDate: z.string(),
  status: StockCountStatusSchema,
  notes: z.string().nullable(),
  /** Items counted so far. */
  counted: z.number().int(),
  /** Value of what was found minus what the books said, paise (posted counts). */
  varianceValue: PaiseSchema,
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  postedAt: z.string().nullable(),
  postedByName: z.string().nullable(),
  version: Version,
});
export type StockCountSummary = z.infer<typeof StockCountSummarySchema>;
export const StockCountsResponseSchema = z.object({ data: z.array(StockCountSummarySchema) });

/**
 * The count sheet: every active item. `systemQtyMilli` is what the books said
 * when the item was counted (the balance now for an item not counted yet).
 * Items left uncounted are not changed.
 */
export const StockCountSchema = StockCountSummarySchema.extend({
  lines: z.array(
    z.object({
      inventoryItemId: IdSchema,
      sku: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      baseUnit: BaseUnitSchema,
      systemQtyMilli: z.number().int(),
      countedQtyMilli: z.number().int().nullable(),
      /** counted − system. */
      varianceMilli: z.number().int().nullable(),
      varianceValue: PaiseSchema.nullable(),
    }),
  ),
});
export type StockCount = z.infer<typeof StockCountSchema>;

export const CreateStockCountRequestSchema = z.object({
  countType: StockCountTypeSchema.default('SPOT'),
  notes: z.string().trim().max(200).nullable().default(null),
});
/** Counted quantities to record (merged into the sheet); `null` clears an item. */
export const SaveStockCountLinesRequestSchema = z.object({
  version: Version,
  lines: z
    .array(z.object({ inventoryItemId: IdSchema, countedQtyMilli: Milli.nonnegative().nullable() }))
    .min(1)
    .max(2000),
});
/**
 * Books each item's counted − books-when-counted as an ADJUSTMENT (reference
 * STOCK_COUNT), so sales made while the count was under way still count.
 */
export const PostStockCountRequestSchema = z.object({ version: Version });

// ---- alerts ---------------------------------------------------------------------------------
export const StockAlertsSchema = z.object({
  businessDate: z.string(),
  /** Out (nothing on hand), low (at or under the reorder level) or over the maximum. */
  levels: z.array(
    z.object({
      inventoryItemId: IdSchema,
      sku: z.string(),
      name: z.string(),
      baseUnit: BaseUnitSchema,
      qtyMilli: z.number().int(),
      reorderLevelMilli: z.number().int(),
      maxLevelMilli: z.number().int().nullable(),
      level: z.enum(['OUT', 'LOW', 'OVER']),
    }),
  ),
  /** Sold or used more than the books had: a receipt is missing or a recipe is off. */
  negative: z.array(
    z.object({
      inventoryItemId: IdSchema,
      sku: z.string(),
      name: z.string(),
      baseUnit: BaseUnitSchema,
      qtyMilli: z.number().int(),
    }),
  ),
  /** Batches with stock left that expire within 3 days (or already have). */
  expiring: z.array(
    z.object({
      batchId: IdSchema,
      inventoryItemId: IdSchema,
      name: z.string(),
      baseUnit: BaseUnitSchema,
      batchNo: z.string().nullable(),
      expiresOn: z.string(),
      remainingMilli: z.number().int(),
      value: PaiseSchema,
      expired: z.boolean(),
    }),
  ),
});
export type StockAlerts = z.infer<typeof StockAlertsSchema>;

// ---- consumption report -----------------------------------------------------------------------
const ConsumptionFigures = {
  /** Balance at the start of `from`. */
  openingMilli: z.number().int(),
  /** Purchases, opening stock entered in the period, transfers in. */
  receivedMilli: z.number().int(),
  /** By recipe from KOTs, net of reversals: the theoretical consumption. */
  soldMilli: z.number().int(),
  wastageMilli: z.number().int(),
  /** Manual adjustments, returns and transfers out (signed). */
  adjustedMilli: z.number().int(),
  /** Found by stock counts minus the books (signed). */
  countVarianceMilli: z.number().int(),
  closingMilli: z.number().int(),
  soldValue: PaiseSchema,
  wastageValue: PaiseSchema,
  countVarianceValue: PaiseSchema,
  closingValue: PaiseSchema,
};

/**
 * Theoretical (recipe) against actual (counted) consumption per item. The
 * variance is how much more (or less) was used than recipes say: −count
 * variance ÷ sold, in basis points; null when nothing was sold.
 */
export const ConsumptionReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      inventoryItemId: IdSchema,
      sku: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      baseUnit: BaseUnitSchema,
      ...ConsumptionFigures,
      varianceBp: z.number().int().nullable(),
    }),
  ),
  totals: z.object({
    soldValue: PaiseSchema,
    wastageValue: PaiseSchema,
    countVarianceValue: PaiseSchema,
    closingValue: PaiseSchema,
    /** −countVarianceValue ÷ soldValue. */
    varianceBp: z.number().int().nullable(),
  }),
});
export type ConsumptionReport = z.infer<typeof ConsumptionReportSchema>;

// ---- stock value (inventory valuation) ------------------------------------------------------
const ValuationTotals = {
  openingValue: PaiseSchema,
  receivedValue: PaiseSchema,
  soldValue: PaiseSchema,
  wastageValue: PaiseSchema,
  adjustedValue: PaiseSchema,
  closingValue: PaiseSchema,
  differenceValue: PaiseSchema,
};

/**
 * The stock value over a period (docs/05 §3, Phase 5). Opening and closing
 * are at each day's weighted average cost, worked out again from the
 * ledger; what moved in between is at the cost it was posted at, as the
 * books have it. Stock out (or below zero) is valued at nil, so the
 * difference is what stock sold before it was received, and rounding, left.
 */
export const InventoryValuationSchema = z.object({
  from: z.string(),
  to: z.string(),
  branchName: z.string(),
  generatedAt: z.string(),
  rows: z.array(
    z.object({
      inventoryItemId: IdSchema,
      sku: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      baseUnit: BaseUnitSchema,
      openingMilli: z.number().int(),
      /** Paise per 1000 base units, as `avgCostPerBase`. */
      openingCostPerBase: z.number().int(),
      /** Purchases, opening stock entered in the period, transfers in. */
      receivedMilli: z.number().int(),
      /** By recipe from KOTs, net of reversals. */
      soldMilli: z.number().int(),
      wastageMilli: z.number().int(),
      /** Counts, adjustments, returns and transfers out (signed). */
      adjustedMilli: z.number().int(),
      closingMilli: z.number().int(),
      closingCostPerBase: z.number().int(),
      ...ValuationTotals,
    }),
  ),
  /** By closing value, largest first. `items`: those with stock. */
  categories: z.array(
    z.object({
      category: z.string().nullable(),
      items: z.number().int(),
      value: PaiseSchema,
      shareBp: z.number().int().nullable(),
    }),
  ),
  totals: z.object(ValuationTotals),
  /** The Inventory account in the books on `to`, and the closing value less it. */
  books: z.object({ inventoryAccount: PaiseSchema, difference: PaiseSchema }),
});
export type InventoryValuation = z.infer<typeof InventoryValuationSchema>;
