import { consumptionFor } from '@restroos/domain';
import type { BusinessCalendar } from '../ordering/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { UnitOfWork } from '../ports/unit-of-work';
import type { InventoryRepository, ProjectionLog, StoredEvent } from './ports';
import { StockLedger, type MovementContext } from './stock-ledger';

export const INVENTORY_PROJECTION = 'inventory';
/** The events that move stock; the projector is woken by these. */
export const INVENTORY_EVENT_TYPES = ['KotFired', 'OrderItemCancelled'] as const;
const BATCH = 200;

/**
 * Automatic consumption (docs/03 §4.3). Reads `domain_events` after its
 * checkpoint and, for each fired dish, takes its recipe (the variant's, else
 * the dish's) plus its add-ons' ingredients from stock. A dish cancelled
 * after it was fired puts them back, and when it was thrown away books them
 * as wastage instead. Each event is applied in one transaction with the
 * checkpoint, so it counts exactly once, also after a crash or restart.
 * Stock may go negative: a sale is never blocked.
 */
export class InventoryProjector {
  private readonly ledger: StockLedger;
  private running = false;

  constructor(
    private readonly d: {
      log: ProjectionLog;
      inventory: InventoryRepository;
      calendar: BusinessCalendar;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      /** An event that can't be applied is reported and skipped, so stock keeps moving. */
      onError: (error: unknown, event: StoredEvent) => void;
    },
  ) {
    this.ledger = new StockLedger({ inventory: d.inventory, ids: d.ids });
  }

  /** Applies everything committed since the checkpoint. Returns how many events moved stock. */
  catchUp(): number {
    if (this.running) return 0;
    this.running = true;
    try {
      const head = this.d.log.head();
      let applied = 0;
      for (;;) {
        const from = this.d.log.checkpoint(INVENTORY_PROJECTION);
        if (from >= head) break;
        const events = this.d.log.events(from, head, INVENTORY_EVENT_TYPES, BATCH);
        for (const event of events) {
          try {
            this.inTransaction(event, () => this.apply(event), event.seq);
            applied += 1;
          } catch (error) {
            this.d.onError(error, event);
            this.inTransaction(event, () => {}, event.seq);
          }
        }
        if (events.length < BATCH) {
          this.inTransaction(null, () => {}, head);
          break;
        }
      }
      return applied;
    } finally {
      this.running = false;
    }
  }

  private inTransaction(event: StoredEvent | null, work: () => void, seq: number): void {
    const context = {
      branchId: event?.branchId ?? 'system',
      actorId: null,
      correlationId: `projection:${INVENTORY_PROJECTION}:${seq}`,
    };
    this.d.unitOfWork.run(context, () => {
      work();
      this.d.log.advance(INVENTORY_PROJECTION, seq, this.d.clock.now());
    });
  }

  private apply(event: StoredEvent): void {
    const at = this.d.clock.now();
    const base = {
      branchId: event.branchId,
      businessDate: this.d.calendar.businessDate(event.branchId, event.occurredAt),
      actorId: null,
      referenceType: 'ORDER_ITEM',
      reason: null,
      at,
    };
    if (event.type === 'KotFired') {
      const { itemIds } = event.payload as { itemIds: string[] };
      for (const line of this.d.inventory.soldLines(itemIds)) {
        if (this.d.inventory.movementsFor('ORDER_ITEM', line.id).length > 0) continue;
        const recipe =
          this.d.inventory.recipeFor(line.menuItemId, line.variantId) ??
          (line.variantId === null ? undefined : this.d.inventory.recipeFor(line.menuItemId, null));
        const addons = line.addons
          .map((a) => ({
            quantity: a.quantity,
            lines: this.d.inventory.addonIngredients(a.addonId),
          }))
          .filter((a) => a.lines.length > 0);
        if (!recipe && addons.length === 0) continue;
        const m: MovementContext = { ...base, referenceId: line.id };
        for (const c of consumptionFor(line.quantity, recipe ?? null, addons))
          this.ledger.issue(m, c.inventoryItemId, c.qtyMilli, 'SALE_CONSUMPTION');
      }
      return;
    }
    // OrderItemCancelled
    const p = event.payload as {
      itemId: string;
      wasSent: boolean;
      isWastage: boolean;
      reason: string | null;
    };
    if (!p.wasSent) return;
    const taken = this.d.inventory.movementsFor('ORDER_ITEM', p.itemId);
    if (taken.some((t) => t.type === 'SALE_REVERSAL')) return;
    const consumed = taken.filter((t) => t.type === 'SALE_CONSUMPTION');
    if (consumed.length === 0) return;
    const m: MovementContext = { ...base, referenceId: p.itemId, reason: p.reason };
    this.ledger.reverse(m, consumed);
    if (!p.isWastage) return;
    const wasted = new Map<string, number>();
    for (const t of consumed)
      wasted.set(t.inventoryItemId, (wasted.get(t.inventoryItemId) ?? 0) - t.qtyMilli);
    for (const [itemId, qty] of wasted) this.ledger.issue(m, itemId, qty, 'WASTAGE');
  }
}
