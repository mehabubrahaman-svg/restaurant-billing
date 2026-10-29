import { DomainError } from '@restroos/domain';
import type { Translations } from '../catalog/ports';
import type { BusinessCalendar } from '../ordering/ports';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type {
  BaseUnit,
  InventoryItemRecord,
  InventoryItemView,
  InventoryQueries,
  InventoryRepository,
  MenuLookup,
  RecipeRecord,
  RecipeView,
  StockCountView,
} from './ports';
import { addDays, StockLedger, type MovementContext } from './stock-ledger';

export interface InventoryServiceDeps {
  readonly inventory: InventoryRepository;
  readonly queries: InventoryQueries;
  readonly menu: MenuLookup;
  readonly calendar: BusinessCalendar;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface InventoryItemInput {
  sku: string;
  name: string;
  nameTranslations: Translations;
  category: string | null;
  baseUnit: BaseUnit;
  purchaseUnitId: string | null;
  isPerishable: boolean;
  shelfLifeDays: number | null;
  reorderLevelMilli: number;
  maxLevelMilli: number | null;
}

export interface IngredientInput {
  inventoryItemId: string;
  qtyMilli: number;
  wastageBp: number;
}

export interface ReceiptLineInput {
  inventoryItemId: string;
  qtyMilli: number;
  totalCost: number;
  batchNo: string | null;
  expiresOn: string | null;
}

/**
 * The store room (docs/08 Phase 2): items and their levels, recipes, stock in
 * (direct purchases, opening stock), stock out (wastage, adjustments) and
 * physical counts. Sales take stock through the InventoryProjector.
 */
export class InventoryService {
  private readonly ledger: StockLedger;

  constructor(private readonly d: InventoryServiceDeps) {
    this.ledger = new StockLedger({ inventory: d.inventory, ids: d.ids });
  }

  units() {
    return this.d.inventory.units();
  }

  // ---- items --------------------------------------------------------------------
  items(branchId: string, includeRetired: boolean): InventoryItemView[] {
    return this.d.queries.items(branchId, includeRetired);
  }

  item(branchId: string, id: string): InventoryItemView {
    const view = this.d.queries.item(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'inventory item not found');
    return view;
  }

  createItem(input: InventoryItemInput, ctx: CommandContext): InventoryItemView {
    return this.write(ctx, (scope, now) => {
      if (this.d.inventory.itemBySku(input.sku))
        throw new DomainError('SKU_TAKEN', `SKU ${input.sku} is already used`);
      const { reorderLevelMilli, maxLevelMilli, ...fields } = input;
      const record: InventoryItemRecord = {
        ...fields,
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      this.assertValid(record, { reorderLevelMilli, maxLevelMilli });
      this.d.inventory.insertItem(record, ctx.actorId, now);
      this.d.inventory.setLevels(
        ctx.branchId,
        record.id,
        { reorderLevelMilli, maxLevelMilli },
        now,
      );
      scope.recordEvents([
        recordChanged(
          'InventoryItemCreated',
          'InventoryItem',
          record.id,
          1,
          { sku: record.sku, name: record.name },
          now,
        ),
      ]);
      scope.audit({
        action: 'inventory.item.create',
        entityType: 'InventoryItem',
        entityId: record.id,
        after: { ...record, reorderLevelMilli, maxLevelMilli },
      });
      return this.item(ctx.branchId, record.id);
    });
  }

  updateItem(
    id: string,
    patch: Patch<InventoryItemInput & { isActive: boolean }> & { version: number },
    ctx: CommandContext,
  ): InventoryItemView {
    return this.write(ctx, (scope, now) => {
      const current = this.d.inventory.item(id);
      if (!current) throw new DomainError('NOT_FOUND', 'inventory item not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this item changed; reload and try again');
      const { reorderLevelMilli, maxLevelMilli, version: _version, ...fields } = patch;
      const next: InventoryItemRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(fields))
        if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
      if (next.sku !== current.sku && this.d.inventory.itemBySku(next.sku))
        throw new DomainError('SKU_TAKEN', `SKU ${next.sku} is already used`);
      if (next.baseUnit !== current.baseUnit && this.d.inventory.hasMovements(null, id)) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the base unit can’t change once the item has stock movements',
        );
      }
      if (!next.isActive && current.isActive && this.d.inventory.ingredientUses(id) > 0) {
        throw new DomainError(
          'INGREDIENT_IN_USE',
          'remove the item from recipes and add-ons before retiring it',
        );
      }
      const stock = this.d.inventory.stock(ctx.branchId, id);
      const levels = {
        reorderLevelMilli: reorderLevelMilli ?? stock.reorderLevelMilli,
        maxLevelMilli: maxLevelMilli === undefined ? stock.maxLevelMilli : maxLevelMilli,
      };
      this.assertValid(next, levels);
      this.d.inventory.updateItem(next, ctx.actorId, now);
      this.d.inventory.setLevels(ctx.branchId, id, levels, now);
      scope.recordEvents([
        recordChanged(
          'InventoryItemChanged',
          'InventoryItem',
          id,
          next.version,
          { sku: next.sku, name: next.name, isActive: next.isActive },
          now,
        ),
      ]);
      scope.audit({
        action: 'inventory.item.update',
        entityType: 'InventoryItem',
        entityId: id,
        before: {
          ...current,
          reorderLevelMilli: stock.reorderLevelMilli,
          maxLevelMilli: stock.maxLevelMilli,
        },
        after: { ...next, ...levels },
      });
      return this.item(ctx.branchId, id);
    });
  }

  // ---- recipes --------------------------------------------------------------------
  recipes(menuItemId: string | null, branchId: string): RecipeView[] {
    return this.d.queries.recipes(menuItemId, branchId);
  }

  createRecipe(
    input: {
      menuItemId: string;
      variantId: string | null;
      yieldPortions: number;
      ingredients: IngredientInput[];
    },
    ctx: CommandContext,
  ): RecipeView {
    return this.write(ctx, (scope, now) => {
      if (this.d.menu.priceOf(input.menuItemId, input.variantId) === null)
        throw new DomainError('NOT_FOUND', 'dish not found');
      if (this.d.inventory.recipeFor(input.menuItemId, input.variantId)) {
        throw new DomainError('RECIPE_EXISTS', 'this dish already has a recipe; edit that one');
      }
      this.assertIngredients(input.ingredients.map((i) => i.inventoryItemId));
      const record: RecipeRecord = {
        id: this.d.ids.next(),
        menuItemId: input.menuItemId,
        variantId: input.variantId,
        yieldPortions: input.yieldPortions,
        lines: input.ingredients,
        version: 1,
      };
      this.d.inventory.insertRecipe(record, now);
      this.logRecipe(scope, 'create', record, undefined, now);
      return this.recipeView(record.id, ctx.branchId);
    });
  }

  updateRecipe(
    id: string,
    patch: {
      version: number;
      yieldPortions?: number | undefined;
      ingredients?: IngredientInput[] | undefined;
      isActive?: boolean | undefined;
    },
    ctx: CommandContext,
  ): RecipeView | null {
    return this.write(ctx, (scope, now) => {
      const current = this.d.inventory.recipe(id);
      if (!current) throw new DomainError('NOT_FOUND', 'recipe not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this recipe changed; reload and try again');
      if (patch.isActive === false) {
        this.d.inventory.retireRecipe(id, current.version, now);
        this.logRecipe(scope, 'remove', { ...current, version: current.version + 1 }, current, now);
        return null;
      }
      if (patch.ingredients)
        this.assertIngredients(patch.ingredients.map((i) => i.inventoryItemId));
      const next: RecipeRecord = {
        ...current,
        yieldPortions: patch.yieldPortions ?? current.yieldPortions,
        lines: patch.ingredients ?? current.lines,
        version: current.version + 1,
      };
      this.d.inventory.updateRecipe(next, now);
      this.logRecipe(scope, 'update', next, current, now);
      return this.recipeView(id, ctx.branchId);
    });
  }

  addonIngredients(addonId: string) {
    if (!this.d.menu.addonExists(addonId)) throw new DomainError('NOT_FOUND', 'add-on not found');
    return { addonId, ingredients: this.d.queries.addonIngredients(addonId) };
  }

  setAddonIngredients(
    addonId: string,
    lines: { inventoryItemId: string; qtyMilli: number }[],
    ctx: CommandContext,
  ) {
    return this.write(ctx, (scope, now) => {
      if (!this.d.menu.addonExists(addonId)) throw new DomainError('NOT_FOUND', 'add-on not found');
      this.assertIngredients(lines.map((l) => l.inventoryItemId));
      const before = this.d.inventory.addonIngredients(addonId);
      this.d.inventory.setAddonIngredients(addonId, lines);
      scope.recordEvents([
        recordChanged('AddonIngredientsChanged', 'Addon', addonId, 1, { lines }, now),
      ]);
      scope.audit({
        action: 'inventory.addon_ingredients.set',
        entityType: 'Addon',
        entityId: addonId,
        before,
        after: lines,
      });
      return { addonId, ingredients: this.d.queries.addonIngredients(addonId) };
    });
  }

  // ---- stock in and out -------------------------------------------------------------
  /** Bought directly, without a purchase order. */
  receive(input: { lines: ReceiptLineInput[]; reference: string | null }, ctx: CommandContext) {
    return this.entry(ctx, 'RECEIPT', 'StockReceived', 'receive', input.reference, (m) => {
      for (const line of input.lines)
        this.ledger.receive(m, this.activeItem(line.inventoryItemId), line, 'PURCHASE');
      return input.lines;
    });
  }

  /**
   * What was on the shelves on day one, once per item, before it is first
   * received. Sales before it are fine: the stock was there, just not entered.
   */
  opening(input: { lines: ReceiptLineInput[] }, ctx: CommandContext) {
    return this.entry(ctx, 'OPENING', 'OpeningStockEntered', 'opening', null, (m) => {
      const seen = new Set<string>();
      for (const line of input.lines) {
        if (seen.has(line.inventoryItemId))
          throw new DomainError('VALIDATION_FAILED', 'enter each item’s opening stock once');
        seen.add(line.inventoryItemId);
        const item = this.activeItem(line.inventoryItemId);
        if (this.d.inventory.hasReceipts(m.branchId, item.id)) {
          throw new DomainError(
            'STOCK_ALREADY_MOVED',
            `${item.name} has already been received; use an adjustment or a count`,
          );
        }
        this.ledger.receive(m, item, line, 'OPENING');
      }
      return input.lines;
    });
  }

  wastage(
    input: { lines: { inventoryItemId: string; qtyMilli: number }[]; reason: string },
    ctx: CommandContext,
  ) {
    return this.entry(ctx, 'WASTAGE', 'StockWasted', 'wastage', input.reason, (m) => {
      for (const line of input.lines) {
        this.activeItem(line.inventoryItemId);
        this.ledger.issue(m, line.inventoryItemId, line.qtyMilli, 'WASTAGE');
      }
      return input.lines;
    });
  }

  adjust(
    input: { lines: { inventoryItemId: string; qtyMilli: number }[]; reason: string },
    ctx: CommandContext,
  ) {
    return this.entry(ctx, 'ADJUSTMENT', 'StockAdjusted', 'adjust', input.reason, (m) => {
      for (const line of input.lines) {
        this.activeItem(line.inventoryItemId);
        if (line.qtyMilli > 0) this.ledger.addAtAverage(m, line.inventoryItemId, line.qtyMilli);
        else this.ledger.issue(m, line.inventoryItemId, -line.qtyMilli, 'ADJUSTMENT');
      }
      return input.lines;
    });
  }

  movements(branchId: string, filter: Parameters<InventoryQueries['movements']>[1]) {
    return this.d.queries.movements(branchId, filter);
  }

  alerts(branchId: string) {
    const today = this.d.calendar.businessDate(branchId, this.d.clock.now());
    return this.d.queries.alerts(branchId, today, addDays(today, 3));
  }

  consumption(branchId: string, from: string, to: string) {
    return this.d.queries.consumption(branchId, from, to);
  }

  valuation(branchId: string, from: string, to: string) {
    return this.d.queries.valuation(branchId, from, to, this.d.clock.now());
  }

  // ---- stock counts -----------------------------------------------------------------
  counts(branchId: string) {
    return this.d.queries.counts(branchId);
  }

  count(branchId: string, id: string): StockCountView {
    const view = this.d.queries.count(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'stock count not found');
    return view;
  }

  createCount(
    input: { countType: 'OPENING' | 'CLOSING' | 'SPOT'; notes: string | null },
    ctx: CommandContext,
  ): StockCountView {
    return this.write(ctx, (scope, now) => {
      const id = this.d.ids.next();
      const businessDate = this.d.calendar.businessDate(ctx.branchId, now);
      this.d.inventory.insertCount(
        { id, branchId: ctx.branchId, businessDate, status: 'DRAFT', version: 1, ...input },
        ctx.actorId,
        now,
      );
      scope.recordEvents([
        recordChanged('StockCountStarted', 'StockCount', id, 1, { ...input, businessDate }, now),
      ]);
      scope.audit({
        action: 'inventory.count.create',
        entityType: 'StockCount',
        entityId: id,
        after: { ...input, businessDate },
      });
      return this.count(ctx.branchId, id);
    });
  }

  saveCountLines(
    id: string,
    input: {
      version: number;
      lines: { inventoryItemId: string; countedQtyMilli: number | null }[];
    },
    ctx: CommandContext,
  ): StockCountView {
    return this.write(ctx, (scope, now) => {
      const count = this.draftCount(ctx.branchId, id, input.version);
      const lines = input.lines.map((l) => {
        if (!this.d.inventory.item(l.inventoryItemId))
          throw new DomainError('NOT_FOUND', 'inventory item not found');
        return {
          ...l,
          systemQtyMilli: this.d.inventory.stock(ctx.branchId, l.inventoryItemId).qtyMilli,
        };
      });
      this.d.inventory.setCountLines(id, lines);
      this.d.inventory.touchCount(id, count.version, now);
      scope.recordEvents([
        recordChanged(
          'StockCountUpdated',
          'StockCount',
          id,
          count.version + 1,
          { lines: lines.length },
          now,
        ),
      ]);
      scope.audit({
        action: 'inventory.count.update',
        entityType: 'StockCount',
        entityId: id,
        after: input.lines,
      });
      return this.count(ctx.branchId, id);
    });
  }

  /**
   * Books each difference between what was counted and what the books said
   * when it was counted as an adjustment, so a count taken during service
   * doesn't undo the sales made since.
   */
  postCount(id: string, input: { version: number }, ctx: CommandContext): StockCountView {
    return this.write(ctx, (scope, now) => {
      const count = this.draftCount(ctx.branchId, id, input.version);
      const lines = this.d.inventory.countLines(id);
      if (lines.length === 0)
        throw new DomainError('VALIDATION_FAILED', 'nothing has been counted');
      const m: MovementContext = {
        branchId: ctx.branchId,
        businessDate: this.d.calendar.businessDate(ctx.branchId, now),
        actorId: ctx.actorId,
        referenceType: 'STOCK_COUNT',
        referenceId: id,
        reason: 'Stock count',
        at: now,
      };
      let adjusted = 0;
      for (const line of lines) {
        // Against what the books said when the shelf was counted: sales since then still count.
        const diff = line.countedQtyMilli - line.systemQtyMilli;
        if (diff > 0) this.ledger.addAtAverage(m, line.inventoryItemId, diff);
        if (diff < 0) this.ledger.issue(m, line.inventoryItemId, -diff, 'ADJUSTMENT');
        if (diff !== 0) adjusted += 1;
      }
      this.d.inventory.touchCount(id, count.version, now, { by: ctx.actorId });
      const view = this.count(ctx.branchId, id);
      scope.recordEvents([
        recordChanged(
          'StockCountPosted',
          'StockCount',
          id,
          count.version + 1,
          { counted: lines.length, adjusted, varianceValue: view.varianceValue },
          now,
        ),
      ]);
      scope.audit({
        action: 'inventory.count.post',
        entityType: 'StockCount',
        entityId: id,
        after: { counted: lines.length, adjusted, varianceValue: view.varianceValue },
      });
      return view;
    });
  }

  // ---- helpers ------------------------------------------------------------------------
  private write<T>(ctx: CommandContext, work: (scope: TransactionScope, now: Date) => T): T {
    return this.d.unitOfWork.run(ctx, (scope) => work(scope, this.d.clock.now()));
  }

  /** One stock entry (receipt, opening, wastage, adjustment): its movements share a reference id. */
  private entry(
    ctx: CommandContext,
    referenceType: string,
    eventType: string,
    verb: string,
    reasonOrReference: string | null,
    work: (m: MovementContext) => readonly { inventoryItemId: string; qtyMilli: number }[],
  ) {
    return this.write(ctx, (scope, now) => {
      const referenceId = this.d.ids.next();
      const isReason = referenceType === 'WASTAGE' || referenceType === 'ADJUSTMENT';
      const lines = work({
        branchId: ctx.branchId,
        businessDate: this.d.calendar.businessDate(ctx.branchId, now),
        actorId: ctx.actorId,
        referenceType,
        referenceId,
        reason: isReason ? reasonOrReference : null,
        at: now,
      });
      const after = {
        lines: lines.map((l) => ({ inventoryItemId: l.inventoryItemId, qtyMilli: l.qtyMilli })),
        ...(isReason ? {} : { reference: reasonOrReference }),
      };
      scope.recordEvents([recordChanged(eventType, 'StockEntry', referenceId, 1, after, now)]);
      scope.audit({
        action: `inventory.stock.${verb}`,
        entityType: 'StockEntry',
        entityId: referenceId,
        after,
        reason: isReason ? reasonOrReference : null,
      });
      const ids = [...new Set(lines.map((l) => l.inventoryItemId))];
      return { referenceId, items: ids.map((itemId) => this.item(ctx.branchId, itemId)) };
    });
  }

  private activeItem(id: string): InventoryItemRecord {
    const item = this.d.inventory.item(id);
    if (!item) throw new DomainError('NOT_FOUND', 'inventory item not found');
    if (!item.isActive) throw new DomainError('VALIDATION_FAILED', `${item.name} is retired`);
    return item;
  }

  private assertIngredients(itemIds: readonly string[]): void {
    if (new Set(itemIds).size !== itemIds.length)
      throw new DomainError('VALIDATION_FAILED', 'an ingredient is listed twice');
    for (const id of itemIds) this.activeItem(id);
  }

  private assertValid(
    item: InventoryItemRecord,
    levels: { reorderLevelMilli: number; maxLevelMilli: number | null },
  ): void {
    if (item.purchaseUnitId !== null) {
      const unit = this.d.inventory.unit(item.purchaseUnitId);
      if (!unit) throw new DomainError('NOT_FOUND', 'unit not found');
      if (unit.baseCode !== item.baseUnit) {
        throw new DomainError(
          'UNIT_MISMATCH',
          `${unit.code} doesn’t measure ${item.baseUnit}; pick a unit of the same kind`,
        );
      }
    }
    if (levels.maxLevelMilli !== null && levels.maxLevelMilli <= levels.reorderLevelMilli) {
      throw new DomainError('VALIDATION_FAILED', 'the maximum must be above the reorder level');
    }
  }

  private draftCount(branchId: string, id: string, version: number) {
    const count = this.d.inventory.count(branchId, id);
    if (!count) throw new DomainError('NOT_FOUND', 'stock count not found');
    if (count.status !== 'DRAFT')
      throw new DomainError('INVALID_STATE_TRANSITION', 'this count is already posted');
    if (count.version !== version)
      throw new DomainError('VERSION_CONFLICT', 'this count changed; reload and try again');
    return count;
  }

  private recipeView(id: string, branchId: string): RecipeView {
    const view = this.d.queries.recipe(id, branchId);
    if (!view) throw new DomainError('NOT_FOUND', 'recipe not found');
    return view;
  }

  private logRecipe(
    scope: TransactionScope,
    verb: 'create' | 'update' | 'remove',
    record: RecipeRecord,
    before: RecipeRecord | undefined,
    at: Date,
  ): void {
    const type = { create: 'RecipeCreated', update: 'RecipeChanged', remove: 'RecipeRemoved' }[
      verb
    ];
    scope.recordEvents([
      recordChanged(
        type,
        'Recipe',
        record.id,
        record.version,
        { menuItemId: record.menuItemId, variantId: record.variantId },
        at,
      ),
    ]);
    scope.audit({
      action: `inventory.recipe.${verb}`,
      entityType: 'Recipe',
      entityId: record.id,
      before,
      after: verb === 'remove' ? undefined : record,
    });
  }
}
