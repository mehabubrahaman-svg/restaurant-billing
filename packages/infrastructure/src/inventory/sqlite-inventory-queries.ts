import type {
  BaseUnit,
  ConsumptionReportView,
  ConsumptionRowView,
  InventoryItemView,
  InventoryQueries,
  MovementType,
  RecipeView,
  StockAlertsView,
  StockCountSummaryView,
  StockCountView,
  StockMovementView,
} from '@restroos/application';
import { portionCost, shareBp, stockLevel, stockValue, stockValueOfSum } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';

type ItemRow = Omit<
  InventoryItemView,
  'nameTranslations' | 'isPerishable' | 'isActive' | 'value' | 'level'
> & {
  nameTranslations: string;
  isPerishable: number;
  isActive: number;
};

const ITEM_SELECT = `
  SELECT i.id, i.sku, i.name, i.name_translations AS nameTranslations, i.category, i.base_unit_code AS baseUnit,
         i.purchase_unit_id AS purchaseUnitId, i.is_perishable AS isPerishable, i.shelf_life_days AS shelfLifeDays,
         (i.deleted_at IS NULL) AS isActive, i.version,
         coalesce(s.qty_milli, 0) AS qtyMilli, coalesce(s.avg_cost_per_base, 0) AS avgCostPerBase,
         coalesce(s.reorder_level_milli, 0) AS reorderLevelMilli, s.max_level_milli AS maxLevelMilli
    FROM inventory_items i
    LEFT JOIN inventory_stock s ON s.inventory_item_id = i.id AND s.branch_id = @branchId`;
const ITEM_ORDER = 'ORDER BY i.category IS NULL, i.category COLLATE NOCASE, i.name COLLATE NOCASE';

function toItem(r: ItemRow): InventoryItemView {
  return {
    ...r,
    nameTranslations: JSON.parse(r.nameTranslations) as InventoryItemView['nameTranslations'],
    isPerishable: r.isPerishable === 1,
    isActive: r.isActive === 1,
    value: r.qtyMilli > 0 ? stockValue(r.qtyMilli, r.avgCostPerBase) : 0,
    level: stockLevel(r.qtyMilli, r.reorderLevelMilli, r.maxLevelMilli),
  };
}

const SALE = "('SALE_CONSUMPTION','SALE_REVERSAL')";
const RECEIVED = "('PURCHASE','OPENING','TRANSFER_IN')";
const IS_COUNT = "(sm.movement_type = 'ADJUSTMENT' AND sm.reference_type = 'STOCK_COUNT')";
const IS_ADJUSTED = `((sm.movement_type = 'ADJUSTMENT' AND coalesce(sm.reference_type, '') <> 'STOCK_COUNT')
                      OR sm.movement_type IN ('TRANSFER_OUT','RETURN_TO_VENDOR'))`;

export class SqliteInventoryQueries implements InventoryQueries {
  constructor(private readonly db: SqliteDatabase) {}

  items(branchId: string, includeRetired: boolean): InventoryItemView[] {
    return this.db
      .prepare<{ branchId: string; all: number }, ItemRow>(
        `${ITEM_SELECT} WHERE (@all = 1 OR i.deleted_at IS NULL) ${ITEM_ORDER}`,
      )
      .all({ branchId, all: includeRetired ? 1 : 0 })
      .map(toItem);
  }

  item(branchId: string, id: string): InventoryItemView | undefined {
    const r = this.db
      .prepare<{ branchId: string; id: string }, ItemRow>(`${ITEM_SELECT} WHERE i.id = @id`)
      .get({ branchId, id });
    return r && toItem(r);
  }

  recipes(menuItemId: string | null, branchId: string): RecipeView[] {
    return this.recipeHeads(menuItemId, null).map((h) => this.withIngredients(h, branchId));
  }

  recipe(id: string, branchId: string): RecipeView | undefined {
    const head = this.recipeHeads(null, id)[0];
    return head && this.withIngredients(head, branchId);
  }

  private recipeHeads(menuItemId: string | null, id: string | null) {
    return this.db
      .prepare<
        { menuItemId: string | null; id: string | null },
        Pick<
          RecipeView,
          | 'id'
          | 'menuItemId'
          | 'menuItemName'
          | 'variantId'
          | 'variantName'
          | 'yieldPortions'
          | 'sellingPrice'
          | 'version'
        >
      >(
        `SELECT r.id, r.menu_item_id AS menuItemId, m.name AS menuItemName, r.variant_id AS variantId,
                v.name AS variantName, r.yield_portions AS yieldPortions, r.version,
                CASE WHEN r.variant_id IS NULL THEN m.base_price ELSE v.price END AS sellingPrice
           FROM recipes r
           JOIN menu_items m ON m.id = r.menu_item_id
           LEFT JOIN menu_item_variants v ON v.id = r.variant_id
          WHERE r.is_active = 1 AND r.deleted_at IS NULL
            AND (@menuItemId IS NULL OR r.menu_item_id = @menuItemId) AND (@id IS NULL OR r.id = @id)
          ORDER BY m.name COLLATE NOCASE, r.variant_id IS NOT NULL, v.sort_order`,
      )
      .all({ menuItemId, id });
  }

  private withIngredients(
    head: ReturnType<SqliteInventoryQueries['recipeHeads']>[number],
    branchId: string,
  ): RecipeView {
    const rows = this.db
      .prepare<
        [string, string],
        {
          inventoryItemId: string;
          name: string;
          baseUnit: BaseUnit;
          qtyMilli: number;
          wastageBp: number;
          avgCost: number;
        }
      >(
        `SELECT ri.inventory_item_id AS inventoryItemId, i.name, i.base_unit_code AS baseUnit,
                ri.qty_milli AS qtyMilli, ri.wastage_bp AS wastageBp, coalesce(s.avg_cost_per_base, 0) AS avgCost
           FROM recipe_ingredients ri
           JOIN inventory_items i ON i.id = ri.inventory_item_id
           LEFT JOIN inventory_stock s ON s.inventory_item_id = ri.inventory_item_id AND s.branch_id = ?
          WHERE ri.recipe_id = ? ORDER BY ri.rowid`,
      )
      .all(branchId, head.id);
    const ingredients = rows.map(({ avgCost, ...r }) => ({
      ...r,
      costPerPortion: portionCost(r, head.yieldPortions, avgCost),
    }));
    const costPerPortion = ingredients.reduce((s, i) => s + i.costPerPortion, 0);
    return {
      ...head,
      ingredients,
      costPerPortion,
      foodCostBp: shareBp(costPerPortion, head.sellingPrice),
    };
  }

  addonIngredients(addonId: string) {
    return this.db
      .prepare<
        [string],
        { inventoryItemId: string; name: string; baseUnit: BaseUnit; qtyMilli: number }
      >(
        `SELECT ai.inventory_item_id AS inventoryItemId, i.name, i.base_unit_code AS baseUnit, ai.qty_milli AS qtyMilli
           FROM addon_ingredients ai JOIN inventory_items i ON i.id = ai.inventory_item_id
          WHERE ai.addon_id = ? ORDER BY ai.rowid`,
      )
      .all(addonId);
  }

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
  ): StockMovementView[] {
    return this.db
      .prepare<Record<string, string | number | null>, Omit<StockMovementView, 'value'>>(
        `SELECT sm.id, sm.inventory_item_id AS inventoryItemId, i.name AS itemName, i.base_unit_code AS baseUnit,
                sm.movement_type AS type, sm.qty_milli AS qtyMilli, sm.balance_after_milli AS balanceAfterMilli,
                sm.unit_cost_per_base AS unitCostPerBase, b.batch_no AS batchNo, sm.reference_type AS referenceType,
                sm.reference_id AS referenceId, sm.reason, sm.business_date AS businessDate,
                sm.created_at AS createdAt, u.full_name AS createdByName
           FROM stock_movements sm
           JOIN inventory_items i ON i.id = sm.inventory_item_id
           LEFT JOIN stock_batches b ON b.id = sm.batch_id
           LEFT JOIN users u ON u.id = sm.created_by
          WHERE sm.branch_id = @branchId
            AND (@itemId IS NULL OR sm.inventory_item_id = @itemId)
            AND (@type IS NULL OR sm.movement_type = @type)
            AND (@from IS NULL OR sm.business_date >= @from)
            AND (@to IS NULL OR sm.business_date <= @to)
            AND (@before IS NULL OR sm.id < @before)
          ORDER BY sm.id DESC LIMIT @limit`,
      )
      .all({
        branchId,
        itemId: filter.inventoryItemId ?? null,
        type: filter.type ?? null,
        from: filter.from ?? null,
        to: filter.to ?? null,
        before: filter.before ?? null,
        limit: filter.limit,
      })
      .map((m) => ({ ...m, value: stockValue(m.qtyMilli, m.unitCostPerBase) }));
  }

  counts(branchId: string): StockCountSummaryView[] {
    return this.countRows(branchId, null);
  }

  private countRows(branchId: string, id: string | null): StockCountSummaryView[] {
    return this.db
      .prepare<
        { branchId: string; id: string | null },
        Omit<StockCountSummaryView, 'varianceValue'> & { varianceRaw: number }
      >(
        `SELECT c.id, c.count_type AS countType, c.business_date AS businessDate, c.status, c.notes,
                (SELECT count(*) FROM stock_count_lines l WHERE l.stock_count_id = c.id) AS counted,
                (SELECT coalesce(sum(sm.qty_milli * sm.unit_cost_per_base), 0) FROM stock_movements sm
                  WHERE sm.reference_type = 'STOCK_COUNT' AND sm.reference_id = c.id) AS varianceRaw,
                c.created_at AS createdAt, cu.full_name AS createdByName,
                c.posted_at AS postedAt, pu.full_name AS postedByName, c.version
           FROM stock_counts c
           LEFT JOIN users cu ON cu.id = c.created_by
           LEFT JOIN users pu ON pu.id = c.posted_by
          WHERE c.branch_id = @branchId AND (@id IS NULL OR c.id = @id)
          ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,
      )
      .all({ branchId, id })
      .map(({ varianceRaw, ...c }) => ({ ...c, varianceValue: stockValueOfSum(varianceRaw) }));
  }

  count(branchId: string, id: string): StockCountView | undefined {
    const head = this.countRows(branchId, id)[0];
    if (!head) return undefined;
    type Line = StockCountView['lines'][number] & { avgCost: number; postedRaw: number };
    const rows =
      head.status === 'DRAFT'
        ? this.db
            .prepare<{ branchId: string; id: string }, Line>(
              `SELECT i.id AS inventoryItemId, i.sku, i.name, i.category, i.base_unit_code AS baseUnit,
                      coalesce(l.system_qty_milli, s.qty_milli, 0) AS systemQtyMilli, l.counted_qty_milli AS countedQtyMilli,
                      coalesce(s.avg_cost_per_base, 0) AS avgCost, 0 AS postedRaw
                 FROM inventory_items i
                 LEFT JOIN inventory_stock s ON s.inventory_item_id = i.id AND s.branch_id = @branchId
                 LEFT JOIN stock_count_lines l ON l.inventory_item_id = i.id AND l.stock_count_id = @id
                WHERE i.deleted_at IS NULL OR l.id IS NOT NULL
                ${ITEM_ORDER}`,
            )
            .all({ branchId, id })
        : this.db
            .prepare<{ id: string }, Line>(
              `SELECT i.id AS inventoryItemId, i.sku, i.name, i.category, i.base_unit_code AS baseUnit,
                      l.system_qty_milli AS systemQtyMilli, l.counted_qty_milli AS countedQtyMilli, 0 AS avgCost,
                      (SELECT coalesce(sum(sm.qty_milli * sm.unit_cost_per_base), 0) FROM stock_movements sm
                        WHERE sm.reference_type = 'STOCK_COUNT' AND sm.reference_id = l.stock_count_id
                          AND sm.inventory_item_id = l.inventory_item_id) AS postedRaw
                 FROM stock_count_lines l JOIN inventory_items i ON i.id = l.inventory_item_id
                WHERE l.stock_count_id = @id
                ${ITEM_ORDER}`,
            )
            .all({ id });
    return {
      ...head,
      lines: rows.map(({ avgCost, postedRaw, ...l }) => {
        const varianceMilli =
          l.countedQtyMilli === null ? null : l.countedQtyMilli - l.systemQtyMilli;
        return {
          ...l,
          varianceMilli,
          varianceValue:
            varianceMilli === null
              ? null
              : head.status === 'DRAFT'
                ? stockValue(varianceMilli, avgCost)
                : stockValueOfSum(postedRaw),
        };
      }),
    };
  }

  alerts(branchId: string, businessDate: string, expiringBy: string): StockAlertsView {
    const items = this.items(branchId, false);
    const levels = items.flatMap((i) =>
      i.level === 'OK'
        ? []
        : [
            {
              inventoryItemId: i.id,
              sku: i.sku,
              name: i.name,
              baseUnit: i.baseUnit,
              qtyMilli: i.qtyMilli,
              reorderLevelMilli: i.reorderLevelMilli,
              maxLevelMilli: i.maxLevelMilli,
              level: i.level,
            },
          ],
    );
    const negative = items
      .filter((i) => i.qtyMilli < 0)
      .map((i) => ({
        inventoryItemId: i.id,
        sku: i.sku,
        name: i.name,
        baseUnit: i.baseUnit,
        qtyMilli: i.qtyMilli,
      }));
    const expiring = this.db
      .prepare<
        [string, string],
        {
          batchId: string;
          inventoryItemId: string;
          name: string;
          baseUnit: BaseUnit;
          batchNo: string | null;
          expiresOn: string;
          remainingMilli: number;
          unitCost: number;
        }
      >(
        `SELECT b.id AS batchId, b.inventory_item_id AS inventoryItemId, i.name, i.base_unit_code AS baseUnit,
                b.batch_no AS batchNo, b.expires_on AS expiresOn, b.remaining_qty_milli AS remainingMilli,
                b.unit_cost_per_base AS unitCost
           FROM stock_batches b JOIN inventory_items i ON i.id = b.inventory_item_id
          WHERE b.branch_id = ? AND b.remaining_qty_milli > 0 AND b.expires_on IS NOT NULL AND b.expires_on <= ?
            AND i.deleted_at IS NULL
          ORDER BY b.expires_on, i.name COLLATE NOCASE`,
      )
      .all(branchId, expiringBy)
      .map(({ unitCost, ...b }) => ({
        ...b,
        value: stockValue(b.remainingMilli, unitCost),
        expired: b.expiresOn < businessDate,
      }));
    return { businessDate, levels, negative, expiring };
  }

  consumption(branchId: string, from: string, to: string): ConsumptionReportView {
    type Row = Omit<
      ConsumptionRowView,
      'soldValue' | 'wastageValue' | 'countVarianceValue' | 'closingValue' | 'varianceBp'
    > & {
      soldRaw: number;
      wastageRaw: number;
      countRaw: number;
      avgCost: number;
      isActive: number;
    };
    const rows = this.db
      .prepare<{ branchId: string; from: string; to: string }, Row>(
        `SELECT i.id AS inventoryItemId, i.sku, i.name, i.category, i.base_unit_code AS baseUnit,
                (i.deleted_at IS NULL) AS isActive, coalesce(s.avg_cost_per_base, 0) AS avgCost,
                coalesce(sum(CASE WHEN sm.business_date < @from THEN sm.qty_milli END), 0) AS openingMilli,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND sm.movement_type IN ${RECEIVED}
                                  THEN sm.qty_milli END), 0) AS receivedMilli,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND sm.movement_type IN ${SALE}
                                  THEN -sm.qty_milli END), 0) AS soldMilli,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND sm.movement_type = 'WASTAGE'
                                  THEN -sm.qty_milli END), 0) AS wastageMilli,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND ${IS_ADJUSTED}
                                  THEN sm.qty_milli END), 0) AS adjustedMilli,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND ${IS_COUNT}
                                  THEN sm.qty_milli END), 0) AS countVarianceMilli,
                coalesce(sum(sm.qty_milli), 0) AS closingMilli,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND sm.movement_type IN ${SALE}
                                  THEN -sm.qty_milli * sm.unit_cost_per_base END), 0) AS soldRaw,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND sm.movement_type = 'WASTAGE'
                                  THEN -sm.qty_milli * sm.unit_cost_per_base END), 0) AS wastageRaw,
                coalesce(sum(CASE WHEN sm.business_date >= @from AND ${IS_COUNT}
                                  THEN sm.qty_milli * sm.unit_cost_per_base END), 0) AS countRaw
           FROM inventory_items i
           LEFT JOIN inventory_stock s ON s.inventory_item_id = i.id AND s.branch_id = @branchId
           LEFT JOIN stock_movements sm ON sm.inventory_item_id = i.id AND sm.branch_id = @branchId
                                       AND sm.business_date <= @to
          GROUP BY i.id
          ${ITEM_ORDER}`,
      )
      .all({ branchId, from, to });
    const out: ConsumptionRowView[] = rows
      .filter(
        (r) =>
          r.isActive === 1 ||
          r.openingMilli !== 0 ||
          r.closingMilli !== 0 ||
          r.soldMilli !== 0 ||
          r.receivedMilli !== 0,
      )
      .map(({ soldRaw, wastageRaw, countRaw, avgCost, isActive: _active, ...r }) => ({
        ...r,
        soldValue: stockValueOfSum(soldRaw),
        wastageValue: stockValueOfSum(wastageRaw),
        countVarianceValue: stockValueOfSum(countRaw),
        closingValue: r.closingMilli > 0 ? stockValue(r.closingMilli, avgCost) : 0,
        varianceBp: r.soldMilli > 0 ? shareBp(-r.countVarianceMilli, r.soldMilli) : null,
      }));
    const sum = (key: 'soldValue' | 'wastageValue' | 'countVarianceValue' | 'closingValue') =>
      out.reduce((s, r) => s + r[key], 0);
    const totals = {
      soldValue: sum('soldValue'),
      wastageValue: sum('wastageValue'),
      countVarianceValue: sum('countVarianceValue'),
      closingValue: sum('closingValue'),
    };
    return {
      from,
      to,
      rows: out,
      totals: {
        ...totals,
        varianceBp:
          totals.soldValue > 0 ? shareBp(-totals.countVarianceValue, totals.soldValue) : null,
      },
    };
  }
}
