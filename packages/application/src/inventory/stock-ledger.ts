import { allocateFefo, costPerBase, DomainError, weightedAverageCost } from '@restroos/domain';
import type { IdGenerator } from '../ports/id-generator';
import type {
  InventoryItemRecord,
  InventoryRepository,
  MovementType,
  PostedMovement,
} from './ports';

/** Who, when and why for a group of movements. */
export interface MovementContext {
  readonly branchId: string;
  readonly businessDate: string;
  readonly actorId: string | null;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly reason: string | null;
  readonly at: Date;
}

/**
 * Every change to stock goes through here (docs/03 §4.3): a movement in the
 * append-only ledger, the branch balance and weighted average cost moved in
 * the same transaction, and batches consumed earliest expiry first. Callers
 * hold a UnitOfWork transaction.
 */
export class StockLedger {
  constructor(
    private readonly d: {
      inventory: InventoryRepository;
      ids: IdGenerator;
    },
  ) {}

  /**
   * Stock in at a price (purchase, opening stock). Perishable items, and any
   * receipt with a batch number or expiry date, get a batch for FEFO.
   */
  receive(
    m: MovementContext,
    item: InventoryItemRecord,
    line: {
      qtyMilli: number;
      totalCost: number;
      batchNo: string | null;
      expiresOn: string | null;
      grnLineId?: string | null;
    },
    type: Extract<MovementType, 'PURCHASE' | 'OPENING' | 'TRANSFER_IN'>,
  ): void {
    const unitCost = costPerBase(line.totalCost, line.qtyMilli);
    const stock = this.d.inventory.stock(m.branchId, item.id);
    const average = weightedAverageCost(
      stock.qtyMilli,
      stock.avgCostPerBase,
      line.qtyMilli,
      unitCost,
    );
    const expiresOn =
      line.expiresOn ??
      (item.isPerishable && item.shelfLifeDays !== null
        ? addDays(m.businessDate, item.shelfLifeDays)
        : null);
    let batchId: string | null = null;
    if (item.isPerishable || line.batchNo !== null || expiresOn !== null) {
      batchId = this.d.ids.next();
      this.d.inventory.insertBatch(
        {
          id: batchId,
          branchId: m.branchId,
          inventoryItemId: item.id,
          grnLineId: line.grnLineId ?? null,
          batchNo: line.batchNo,
          expiresOn,
          qtyMilli: line.qtyMilli,
          unitCostPerBase: unitCost,
        },
        m.at,
      );
    }
    this.post(m, item.id, type, line.qtyMilli, unitCost, batchId, average);
  }

  /**
   * Stock out at average cost, earliest expiry first. What the batches don't
   * cover is taken unbatched: stock may go negative, a sale is never blocked.
   */
  issue(
    m: MovementContext,
    itemId: string,
    qtyMilli: number,
    type: Extract<
      MovementType,
      'SALE_CONSUMPTION' | 'WASTAGE' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'RETURN_TO_VENDOR'
    >,
  ): void {
    if (qtyMilli <= 0) throw new DomainError('QUANTITY_INVALID', 'issue a positive quantity');
    const { avgCostPerBase } = this.d.inventory.stock(m.branchId, itemId);
    const { takes, unbatched } = allocateFefo(
      this.d.inventory.batches(m.branchId, itemId),
      qtyMilli,
    );
    for (const take of takes) {
      this.d.inventory.adjustBatch(take.batchId, -take.qtyMilli, m.at);
      this.post(m, itemId, type, -take.qtyMilli, avgCostPerBase, take.batchId, avgCostPerBase);
    }
    if (unbatched > 0) this.post(m, itemId, type, -unbatched, avgCostPerBase, null, avgCostPerBase);
  }

  /** Found more than the books said: in at average cost, without a batch. */
  addAtAverage(m: MovementContext, itemId: string, qtyMilli: number): void {
    const { avgCostPerBase } = this.d.inventory.stock(m.branchId, itemId);
    this.post(m, itemId, 'ADJUSTMENT', qtyMilli, avgCostPerBase, null, avgCostPerBase);
  }

  /** Puts back what earlier movements took (a cancelled dish), at the cost and into the batch it came from. */
  reverse(m: MovementContext, taken: readonly PostedMovement[]): void {
    for (const t of taken) {
      if (t.qtyMilli >= 0) continue;
      const qty = -t.qtyMilli;
      const stock = this.d.inventory.stock(m.branchId, t.inventoryItemId);
      const average = weightedAverageCost(
        stock.qtyMilli,
        stock.avgCostPerBase,
        qty,
        t.unitCostPerBase,
      );
      if (t.batchId !== null) this.d.inventory.adjustBatch(t.batchId, qty, m.at);
      this.post(m, t.inventoryItemId, 'SALE_REVERSAL', qty, t.unitCostPerBase, t.batchId, average);
    }
  }

  private post(
    m: MovementContext,
    itemId: string,
    type: MovementType,
    qtyMilli: number,
    unitCostPerBase: number,
    batchId: string | null,
    average: number,
  ): void {
    this.d.inventory.move(
      this.d.ids.next(),
      {
        branchId: m.branchId,
        inventoryItemId: itemId,
        batchId,
        type,
        qtyMilli,
        unitCostPerBase,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        reason: m.reason,
        businessDate: m.businessDate,
        createdBy: m.actorId,
      },
      average,
      m.at,
    );
  }
}

/** "2026-10-28" + 3 → "2026-10-31". */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
