import type { Batch, ConsumptionLine, RecipeLine, StockLevel } from '@restroos/domain';
import type { Translations } from '../catalog/ports';

export type BaseUnit = 'g' | 'ml' | 'pc';
export type MovementType =
  | 'OPENING'
  | 'PURCHASE'
  | 'SALE_CONSUMPTION'
  | 'SALE_REVERSAL'
  | 'WASTAGE'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN_TO_VENDOR';

export interface UnitRecord {
  id: string;
  code: string;
  name: string;
  baseCode: BaseUnit;
  toBaseMilli: number;
}

export interface InventoryItemRecord {
  id: string;
  sku: string;
  name: string;
  nameTranslations: Translations;
  category: string | null;
  baseUnit: BaseUnit;
  purchaseUnitId: string | null;
  isPerishable: boolean;
  shelfLifeDays: number | null;
  isActive: boolean;
  version: number;
}

/** One item's balance in one branch (inventory_stock). */
export interface StockRecord {
  qtyMilli: number;
  avgCostPerBase: number;
  reorderLevelMilli: number;
  maxLevelMilli: number | null;
}

export interface RecipeRecord {
  id: string;
  menuItemId: string;
  variantId: string | null;
  yieldPortions: number;
  lines: RecipeLine[];
  version: number;
}

export interface NewMovement {
  branchId: string;
  inventoryItemId: string;
  batchId: string | null;
  type: MovementType;
  /** Signed: + in, − out. */
  qtyMilli: number;
  unitCostPerBase: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  businessDate: string;
  createdBy: string | null;
}

/** A movement already in the ledger, as needed to reverse it. */
export interface PostedMovement {
  inventoryItemId: string;
  batchId: string | null;
  type: MovementType;
  qtyMilli: number;
  unitCostPerBase: number;
}

export interface StockCountRecord {
  id: string;
  branchId: string;
  countType: 'OPENING' | 'CLOSING' | 'SPOT';
  businessDate: string;
  status: 'DRAFT' | 'POSTED';
  notes: string | null;
  version: number;
}

/** What an order line takes from stock: the dish, its size, how many, which add-ons. */
export interface SoldLine {
  id: string;
  menuItemId: string;
  variantId: string | null;
  quantity: number;
  addons: { addonId: string; quantity: number }[];
}

export interface InventoryRepository {
  units(): UnitRecord[];
  unit(id: string): UnitRecord | undefined;

  item(id: string): InventoryItemRecord | undefined;
  itemBySku(sku: string): InventoryItemRecord | undefined;
  /** How many active recipes and add-ons use the item as an ingredient. */
  ingredientUses(itemId: string): number;
  insertItem(record: InventoryItemRecord, actorId: string | null, at: Date): void;
  /** Version-checked. */
  updateItem(record: InventoryItemRecord, actorId: string | null, at: Date): void;

  /** The item's balance in a branch, or zeroes when it has never had stock there. */
  stock(branchId: string, itemId: string): StockRecord;
  setLevels(
    branchId: string,
    itemId: string,
    levels: { reorderLevelMilli: number; maxLevelMilli: number | null },
    at: Date,
  ): void;
  /** In one branch, or in any (`branchId` null). */
  hasMovements(branchId: string | null, itemId: string): boolean;
  /**
   * Appends a movement and moves the branch balance in the same transaction,
   * setting the average cost to `avgCostPerBase`. Returns the new balance.
   */
  move(id: string, movement: NewMovement, avgCostPerBase: number, at: Date): number;
  movementsFor(referenceType: string, referenceId: string): PostedMovement[];

  /** Batches with stock left. */
  batches(branchId: string, itemId: string): Batch[];
  insertBatch(
    batch: {
      id: string;
      branchId: string;
      inventoryItemId: string;
      grnLineId: string | null;
      batchNo: string | null;
      expiresOn: string | null;
      qtyMilli: number;
      unitCostPerBase: number;
    },
    at: Date,
  ): void;
  /** Signed: − takes from the batch, + puts back (never above what was received). */
  adjustBatch(batchId: string, qtyMilli: number, at: Date): void;

  /** The active recipe for exactly this dish and variant (null = the dish-level one). */
  recipeFor(menuItemId: string, variantId: string | null): RecipeRecord | undefined;
  recipe(id: string): RecipeRecord | undefined;
  insertRecipe(record: RecipeRecord, at: Date): void;
  /** Version-checked; replaces the ingredients. */
  updateRecipe(record: RecipeRecord, at: Date): void;
  /** Version-checked. */
  retireRecipe(id: string, expectedVersion: number, at: Date): void;

  addonIngredients(addonId: string): ConsumptionLine[];
  setAddonIngredients(addonId: string, lines: readonly ConsumptionLine[]): void;

  insertCount(record: StockCountRecord, actorId: string | null, at: Date): void;
  count(branchId: string, id: string): StockCountRecord | undefined;
  /** Counted quantity per item (null clears it), and the system quantity it was compared with. */
  setCountLines(
    countId: string,
    lines: readonly {
      inventoryItemId: string;
      countedQtyMilli: number | null;
      systemQtyMilli: number;
    }[],
  ): void;
  countLines(countId: string): { inventoryItemId: string; countedQtyMilli: number }[];
  /** Version-checked: bumps the version (lines changed) or posts the count. */
  touchCount(
    id: string,
    expectedVersion: number,
    at: Date,
    posted?: { by: string | null; systemQty: ReadonlyMap<string, number> },
  ): void;

  /** Order lines by id, for the consumption projector. */
  soldLines(ids: readonly string[]): SoldLine[];
}

/** The menu, as recipes need it: does the dish exist and what does it sell for. */
export interface MenuLookup {
  /** null when the dish (or the variant of it) doesn't exist. */
  priceOf(menuItemId: string, variantId: string | null): number | null;
  addonExists(addonId: string): boolean;
}

/** Events read back from domain_events by a projector, with its checkpoint. */
export interface StoredEvent {
  seq: number;
  type: string;
  branchId: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: Date;
}

export interface ProjectionLog {
  /** The highest seq in domain_events now. */
  head(): number;
  checkpoint(name: string): number;
  /** Events of these types with after < seq ≤ upTo, oldest first. */
  events(after: number, upTo: number, types: readonly string[], limit: number): StoredEvent[];
  advance(name: string, seq: number, at: Date): void;
}

// ---- read models (shapes match packages/contracts inventory.ts) -------------------------
export interface InventoryItemView extends InventoryItemRecord, StockRecord {
  value: number;
  level: StockLevel;
}

export interface RecipeView {
  id: string;
  menuItemId: string;
  menuItemName: string;
  variantId: string | null;
  variantName: string | null;
  yieldPortions: number;
  ingredients: {
    inventoryItemId: string;
    name: string;
    baseUnit: BaseUnit;
    qtyMilli: number;
    wastageBp: number;
    costPerPortion: number;
  }[];
  costPerPortion: number;
  sellingPrice: number;
  foodCostBp: number | null;
  version: number;
}

export interface StockMovementView {
  id: string;
  inventoryItemId: string;
  itemName: string;
  baseUnit: BaseUnit;
  type: MovementType;
  qtyMilli: number;
  balanceAfterMilli: number;
  unitCostPerBase: number;
  value: number;
  batchNo: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  businessDate: string;
  createdAt: string;
  createdByName: string | null;
}

export interface StockCountSummaryView {
  id: string;
  countType: StockCountRecord['countType'];
  businessDate: string;
  status: StockCountRecord['status'];
  notes: string | null;
  counted: number;
  varianceValue: number;
  createdAt: string;
  createdByName: string | null;
  postedAt: string | null;
  postedByName: string | null;
  version: number;
}

export interface StockCountView extends StockCountSummaryView {
  lines: {
    inventoryItemId: string;
    sku: string;
    name: string;
    category: string | null;
    baseUnit: BaseUnit;
    systemQtyMilli: number;
    countedQtyMilli: number | null;
    varianceMilli: number | null;
    varianceValue: number | null;
  }[];
}

export interface StockAlertsView {
  businessDate: string;
  levels: {
    inventoryItemId: string;
    sku: string;
    name: string;
    baseUnit: BaseUnit;
    qtyMilli: number;
    reorderLevelMilli: number;
    maxLevelMilli: number | null;
    level: 'OUT' | 'LOW' | 'OVER';
  }[];
  negative: {
    inventoryItemId: string;
    sku: string;
    name: string;
    baseUnit: BaseUnit;
    qtyMilli: number;
  }[];
  expiring: {
    batchId: string;
    inventoryItemId: string;
    name: string;
    baseUnit: BaseUnit;
    batchNo: string | null;
    expiresOn: string;
    remainingMilli: number;
    value: number;
    expired: boolean;
  }[];
}

export interface ConsumptionRowView {
  inventoryItemId: string;
  sku: string;
  name: string;
  category: string | null;
  baseUnit: BaseUnit;
  openingMilli: number;
  receivedMilli: number;
  soldMilli: number;
  wastageMilli: number;
  adjustedMilli: number;
  countVarianceMilli: number;
  closingMilli: number;
  soldValue: number;
  wastageValue: number;
  countVarianceValue: number;
  closingValue: number;
  varianceBp: number | null;
}

export interface ConsumptionReportView {
  from: string;
  to: string;
  rows: ConsumptionRowView[];
  totals: {
    soldValue: number;
    wastageValue: number;
    countVarianceValue: number;
    closingValue: number;
    varianceBp: number | null;
  };
}

export interface InventoryQueries {
  items(branchId: string, includeRetired: boolean): InventoryItemView[];
  item(branchId: string, id: string): InventoryItemView | undefined;
  /** Every active recipe, or those of one dish. */
  recipes(menuItemId: string | null, branchId: string): RecipeView[];
  recipe(id: string, branchId: string): RecipeView | undefined;
  addonIngredients(addonId: string): {
    inventoryItemId: string;
    name: string;
    baseUnit: BaseUnit;
    qtyMilli: number;
  }[];
  movements(
    branchId: string,
    filter: {
      inventoryItemId?: string | undefined;
      type?: MovementType | undefined;
      from?: string | undefined;
      to?: string | undefined;
      before?: string | undefined;
      limit: number;
    },
  ): StockMovementView[];
  counts(branchId: string): StockCountSummaryView[];
  count(branchId: string, id: string): StockCountView | undefined;
  alerts(branchId: string, businessDate: string, expiringBy: string): StockAlertsView;
  consumption(branchId: string, from: string, to: string): ConsumptionReportView;
}
