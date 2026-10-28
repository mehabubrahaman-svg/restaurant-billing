import type {
  InventoryItemRecord,
  InventoryRepository,
  MenuLookup,
  NewMovement,
  PostedMovement,
  RecipeRecord,
  SoldLine,
  StockCountRecord,
  StockRecord,
  UnitRecord,
} from '@restroos/application';
import type { Batch, ConsumptionLine } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';
import { uuidv7Generator } from '../system/uuidv7-generator';

type ItemRow = Omit<InventoryItemRecord, 'nameTranslations' | 'isPerishable' | 'isActive'> & {
  nameTranslations: string;
  isPerishable: number;
  isActive: number;
};
const ITEM_COLUMNS = `id, sku, name, name_translations AS nameTranslations, category, base_unit_code AS baseUnit,
                      purchase_unit_id AS purchaseUnitId, is_perishable AS isPerishable, shelf_life_days AS shelfLifeDays,
                      (deleted_at IS NULL) AS isActive, version`;
const toItem = (r: ItemRow): InventoryItemRecord => ({
  ...r,
  nameTranslations: JSON.parse(r.nameTranslations) as InventoryItemRecord['nameTranslations'],
  isPerishable: r.isPerishable === 1,
  isActive: r.isActive === 1,
});

const ORG = '(SELECT id FROM organizations ORDER BY created_at LIMIT 1)';

export class SqliteInventoryRepository implements InventoryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  units(): UnitRecord[] {
    return this.db
      .prepare<[], UnitRecord>(
        `SELECT id, code, name, base_code AS baseCode, to_base_milli AS toBaseMilli
           FROM units ORDER BY base_code, to_base_milli`,
      )
      .all();
  }

  unit(id: string): UnitRecord | undefined {
    return this.units().find((u) => u.id === id);
  }

  item(id: string): InventoryItemRecord | undefined {
    const r = this.db
      .prepare<[string], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM inventory_items WHERE id = ?`)
      .get(id);
    return r && toItem(r);
  }

  itemBySku(sku: string): InventoryItemRecord | undefined {
    const r = this.db
      .prepare<[string], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM inventory_items WHERE sku = ?`)
      .get(sku);
    return r && toItem(r);
  }

  ingredientUses(itemId: string): number {
    return this.db
      .prepare<[string, string], number>(
        `SELECT (SELECT count(*) FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id
                  WHERE ri.inventory_item_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL)
              + (SELECT count(*) FROM addon_ingredients ai JOIN addons a ON a.id = ai.addon_id
                  WHERE ai.inventory_item_id = ? AND a.deleted_at IS NULL)`,
      )
      .pluck()
      .get(itemId, itemId)!;
  }

  insertItem(r: InventoryItemRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO inventory_items (id, organization_id, sku, name, name_translations, category, base_unit_code,
                                      purchase_unit_id, is_perishable, shelf_life_days, created_at, created_by,
                                      updated_at, updated_by, version)
         VALUES (?, ${ORG}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.sku,
        r.name,
        JSON.stringify(r.nameTranslations),
        r.category,
        r.baseUnit,
        r.purchaseUnitId,
        r.isPerishable ? 1 : 0,
        r.shelfLifeDays,
        at.toISOString(),
        actorId,
        at.toISOString(),
        actorId,
        r.version,
      );
  }

  updateItem(r: InventoryItemRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE inventory_items
            SET sku = ?, name = ?, name_translations = ?, category = ?, base_unit_code = ?, purchase_unit_id = ?,
                is_perishable = ?, shelf_life_days = ?, updated_at = ?, updated_by = ?, version = ?,
                deleted_at = CASE WHEN ? THEN NULL ELSE coalesce(deleted_at, ?) END,
                deleted_by = CASE WHEN ? THEN NULL ELSE coalesce(deleted_by, ?) END
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.sku,
        r.name,
        JSON.stringify(r.nameTranslations),
        r.category,
        r.baseUnit,
        r.purchaseUnitId,
        r.isPerishable ? 1 : 0,
        r.shelfLifeDays,
        at.toISOString(),
        actorId,
        r.version,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.isActive ? 1 : 0,
        actorId,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'InventoryItem', r.id);
  }

  stock(branchId: string, itemId: string): StockRecord {
    return (
      this.db
        .prepare<[string, string], StockRecord>(
          `SELECT qty_milli AS qtyMilli, avg_cost_per_base AS avgCostPerBase,
                  reorder_level_milli AS reorderLevelMilli, max_level_milli AS maxLevelMilli
             FROM inventory_stock WHERE branch_id = ? AND inventory_item_id = ?`,
        )
        .get(branchId, itemId) ?? {
        qtyMilli: 0,
        avgCostPerBase: 0,
        reorderLevelMilli: 0,
        maxLevelMilli: null,
      }
    );
  }

  setLevels(
    branchId: string,
    itemId: string,
    levels: { reorderLevelMilli: number; maxLevelMilli: number | null },
    at: Date,
  ): void {
    this.db
      .prepare(
        `INSERT INTO inventory_stock (branch_id, inventory_item_id, reorder_level_milli, max_level_milli, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (branch_id, inventory_item_id) DO UPDATE SET
           reorder_level_milli = excluded.reorder_level_milli, max_level_milli = excluded.max_level_milli,
           updated_at = excluded.updated_at, version = version + 1`,
      )
      .run(branchId, itemId, levels.reorderLevelMilli, levels.maxLevelMilli, at.toISOString());
  }

  hasMovements(branchId: string | null, itemId: string): boolean {
    return (
      this.db
        .prepare<[string, string | null, string | null], number>(
          `SELECT EXISTS (SELECT 1 FROM stock_movements
                           WHERE inventory_item_id = ? AND (? IS NULL OR branch_id = ?))`,
        )
        .pluck()
        .get(itemId, branchId, branchId) === 1
    );
  }

  hasReceipts(branchId: string, itemId: string): boolean {
    return (
      this.db
        .prepare<[string, string], number>(
          `SELECT EXISTS (SELECT 1 FROM stock_movements
                           WHERE inventory_item_id = ? AND branch_id = ?
                             AND movement_type IN ('OPENING','PURCHASE','TRANSFER_IN'))`,
        )
        .pluck()
        .get(itemId, branchId) === 1
    );
  }

  move(id: string, m: NewMovement, avgCostPerBase: number, at: Date): number {
    const balance = this.db
      .prepare<[string, string, number, number, string], number>(
        `INSERT INTO inventory_stock (branch_id, inventory_item_id, qty_milli, avg_cost_per_base, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (branch_id, inventory_item_id) DO UPDATE SET
           qty_milli = qty_milli + excluded.qty_milli, avg_cost_per_base = excluded.avg_cost_per_base,
           updated_at = excluded.updated_at, version = version + 1
         RETURNING qty_milli`,
      )
      .pluck()
      .get(m.branchId, m.inventoryItemId, m.qtyMilli, avgCostPerBase, at.toISOString())!;
    this.db
      .prepare(
        `INSERT INTO stock_movements (id, branch_id, inventory_item_id, batch_id, movement_type, qty_milli,
                                      balance_after_milli, unit_cost_per_base, reference_type, reference_id,
                                      reason, business_date, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        m.branchId,
        m.inventoryItemId,
        m.batchId,
        m.type,
        m.qtyMilli,
        balance,
        m.unitCostPerBase,
        m.referenceType,
        m.referenceId,
        m.reason,
        m.businessDate,
        at.toISOString(),
        m.createdBy,
      );
    return balance;
  }

  movementsFor(referenceType: string, referenceId: string): PostedMovement[] {
    return this.db
      .prepare<[string, string], PostedMovement>(
        `SELECT inventory_item_id AS inventoryItemId, batch_id AS batchId, movement_type AS type,
                qty_milli AS qtyMilli, unit_cost_per_base AS unitCostPerBase
           FROM stock_movements WHERE reference_type = ? AND reference_id = ? ORDER BY rowid`,
      )
      .all(referenceType, referenceId);
  }

  batches(branchId: string, itemId: string): Batch[] {
    return this.db
      .prepare<[string, string], Batch>(
        `SELECT id, expires_on AS expiresOn, remaining_qty_milli AS remainingMilli, created_at AS createdAt
           FROM stock_batches
          WHERE branch_id = ? AND inventory_item_id = ? AND remaining_qty_milli > 0`,
      )
      .all(branchId, itemId);
  }

  insertBatch(b: Parameters<InventoryRepository['insertBatch']>[0], at: Date): void {
    this.db
      .prepare(
        `INSERT INTO stock_batches (id, branch_id, inventory_item_id, grn_line_id, batch_no, expires_on,
                                    received_qty_milli, remaining_qty_milli, unit_cost_per_base, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        b.id,
        b.branchId,
        b.inventoryItemId,
        b.grnLineId,
        b.batchNo,
        b.expiresOn,
        b.qtyMilli,
        b.remainingMilli,
        b.unitCostPerBase,
        at.toISOString(),
        at.toISOString(),
      );
  }

  adjustBatch(batchId: string, qtyMilli: number, at: Date): void {
    this.db
      .prepare(
        `UPDATE stock_batches
            SET remaining_qty_milli = max(0, min(received_qty_milli, remaining_qty_milli + ?)),
                updated_at = ?, version = version + 1
          WHERE id = ?`,
      )
      .run(qtyMilli, at.toISOString(), batchId);
  }

  recipeFor(menuItemId: string, variantId: string | null): RecipeRecord | undefined {
    const id = this.db
      .prepare<[string, string | null], string>(
        `SELECT id FROM recipes
          WHERE menu_item_id = ? AND variant_id IS ? AND is_active = 1 AND deleted_at IS NULL`,
      )
      .pluck()
      .get(menuItemId, variantId);
    return id === undefined ? undefined : this.recipe(id);
  }

  recipe(id: string): RecipeRecord | undefined {
    const head = this.db
      .prepare<[string], Omit<RecipeRecord, 'lines'>>(
        `SELECT id, menu_item_id AS menuItemId, variant_id AS variantId, yield_portions AS yieldPortions, version
           FROM recipes WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
      )
      .get(id);
    if (!head) return undefined;
    const lines = this.db
      .prepare<[string], RecipeRecord['lines'][number]>(
        `SELECT inventory_item_id AS inventoryItemId, qty_milli AS qtyMilli, wastage_bp AS wastageBp
           FROM recipe_ingredients WHERE recipe_id = ? ORDER BY rowid`,
      )
      .all(id);
    return { ...head, lines };
  }

  insertRecipe(r: RecipeRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO recipes (id, menu_item_id, variant_id, yield_portions, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.menuItemId,
        r.variantId,
        r.yieldPortions,
        at.toISOString(),
        at.toISOString(),
        r.version,
      );
    this.writeLines(r);
  }

  updateRecipe(r: RecipeRecord, at: Date): void {
    const result = this.db
      .prepare(
        'UPDATE recipes SET yield_portions = ?, updated_at = ?, version = ? WHERE id = ? AND version = ?',
      )
      .run(r.yieldPortions, at.toISOString(), r.version, r.id, r.version - 1);
    assertVersionMatched(result, 'Recipe', r.id);
    // Ingredients are configuration, replaced as a whole (the recipe's version and the audit record the change).
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(r.id);
    this.writeLines(r);
  }

  retireRecipe(id: string, expectedVersion: number, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE recipes SET is_active = 0, deleted_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ?`,
      )
      .run(at.toISOString(), at.toISOString(), id, expectedVersion);
    assertVersionMatched(result, 'Recipe', id);
  }

  private writeLines(r: RecipeRecord): void {
    const insert = this.db.prepare(
      `INSERT INTO recipe_ingredients (id, recipe_id, inventory_item_id, qty_milli, wastage_bp)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const l of r.lines)
      insert.run(uuidv7Generator.next(), r.id, l.inventoryItemId, l.qtyMilli, l.wastageBp);
  }

  addonIngredients(addonId: string): ConsumptionLine[] {
    return this.db
      .prepare<[string], ConsumptionLine>(
        `SELECT inventory_item_id AS inventoryItemId, qty_milli AS qtyMilli
           FROM addon_ingredients WHERE addon_id = ? ORDER BY rowid`,
      )
      .all(addonId);
  }

  setAddonIngredients(addonId: string, lines: readonly ConsumptionLine[]): void {
    // Configuration, replaced as a whole and audited.
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM addon_ingredients WHERE addon_id = ?').run(addonId);
    const insert = this.db.prepare(
      'INSERT INTO addon_ingredients (id, addon_id, inventory_item_id, qty_milli) VALUES (?, ?, ?, ?)',
    );
    for (const l of lines)
      insert.run(uuidv7Generator.next(), addonId, l.inventoryItemId, l.qtyMilli);
  }

  insertCount(r: StockCountRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO stock_counts (id, branch_id, count_type, business_date, status, notes, created_at, created_by,
                                   updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.countType,
        r.businessDate,
        r.status,
        r.notes,
        at.toISOString(),
        actorId,
        at.toISOString(),
        r.version,
      );
  }

  count(branchId: string, id: string): StockCountRecord | undefined {
    return this.db
      .prepare<[string, string], StockCountRecord>(
        `SELECT id, branch_id AS branchId, count_type AS countType, business_date AS businessDate, status, notes,
                version
           FROM stock_counts WHERE branch_id = ? AND id = ?`,
      )
      .get(branchId, id);
  }

  setCountLines(
    countId: string,
    lines: readonly {
      inventoryItemId: string;
      countedQtyMilli: number | null;
      systemQtyMilli: number;
    }[],
  ): void {
    // A draft count's lines can be cleared; a trigger refuses it once the count is posted.
    const remove = this.db.prepare(
      // eslint-disable-next-line no-restricted-syntax
      'DELETE FROM stock_count_lines WHERE stock_count_id = ? AND inventory_item_id = ?',
    );
    const upsert = this.db.prepare(
      `INSERT INTO stock_count_lines (id, stock_count_id, inventory_item_id, system_qty_milli, counted_qty_milli)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (stock_count_id, inventory_item_id) DO UPDATE SET
         system_qty_milli = excluded.system_qty_milli, counted_qty_milli = excluded.counted_qty_milli`,
    );
    for (const l of lines) {
      if (l.countedQtyMilli === null) remove.run(countId, l.inventoryItemId);
      else
        upsert.run(
          uuidv7Generator.next(),
          countId,
          l.inventoryItemId,
          l.systemQtyMilli,
          l.countedQtyMilli,
        );
    }
  }

  countLines(countId: string) {
    return this.db
      .prepare<
        [string],
        { inventoryItemId: string; countedQtyMilli: number; systemQtyMilli: number }
      >(
        `SELECT inventory_item_id AS inventoryItemId, counted_qty_milli AS countedQtyMilli,
                system_qty_milli AS systemQtyMilli
           FROM stock_count_lines WHERE stock_count_id = ? ORDER BY rowid`,
      )
      .all(countId);
  }

  touchCount(id: string, expectedVersion: number, at: Date, posted?: { by: string | null }): void {
    const result = posted
      ? this.db
          .prepare(
            `UPDATE stock_counts SET status = 'POSTED', posted_at = ?, posted_by = ?, updated_at = ?,
                    version = version + 1
              WHERE id = ? AND version = ? AND status = 'DRAFT'`,
          )
          .run(at.toISOString(), posted.by, at.toISOString(), id, expectedVersion)
      : this.db
          .prepare(
            `UPDATE stock_counts SET updated_at = ?, version = version + 1
              WHERE id = ? AND version = ? AND status = 'DRAFT'`,
          )
          .run(at.toISOString(), id, expectedVersion);
    assertVersionMatched(result, 'StockCount', id);
  }

  soldLines(ids: readonly string[]): SoldLine[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare<string[], Omit<SoldLine, 'addons'> & { addons: string }>(
        `SELECT oi.id, oi.menu_item_id AS menuItemId, oi.variant_id AS variantId, oi.quantity,
                coalesce((SELECT json_group_array(json_object('addonId', a.addon_id, 'quantity', a.quantity))
                            FROM order_item_addons a WHERE a.order_item_id = oi.id), '[]') AS addons
           FROM order_items oi WHERE oi.id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(...ids);
    const byId = new Map(
      rows.map((r) => [r.id, { ...r, addons: JSON.parse(r.addons) as SoldLine['addons'] }]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}

/** Menu prices and add-ons, for recipes. */
export class SqliteMenuLookup implements MenuLookup {
  constructor(private readonly db: SqliteDatabase) {}

  priceOf(menuItemId: string, variantId: string | null): number | null {
    if (variantId === null) {
      return (
        this.db
          .prepare<[string], number>(
            'SELECT base_price FROM menu_items WHERE id = ? AND deleted_at IS NULL',
          )
          .pluck()
          .get(menuItemId) ?? null
      );
    }
    return (
      this.db
        .prepare<[string, string], number>(
          `SELECT v.price FROM menu_item_variants v JOIN menu_items m ON m.id = v.menu_item_id
            WHERE v.id = ? AND v.menu_item_id = ? AND v.deleted_at IS NULL AND m.deleted_at IS NULL`,
        )
        .pluck()
        .get(variantId, menuItemId) ?? null
    );
  }

  addonExists(addonId: string): boolean {
    return (
      this.db
        .prepare<[string], number>(
          'SELECT EXISTS (SELECT 1 FROM addons WHERE id = ? AND deleted_at IS NULL)',
        )
        .pluck()
        .get(addonId) === 1
    );
  }
}
