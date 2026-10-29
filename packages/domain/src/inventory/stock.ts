import { invariant } from '../shared/result';
import { divideRounded, toSafeNumber } from '../shared/rounding';

/**
 * Stock arithmetic (docs/03 §6). Quantities are integer milli-units of the
 * item's base unit (g, ml or pc): 2.5 kg = 2_500_000. Costs are paise per
 * 1000 base units (per kg, per litre, per 1000 pieces), so a stock value in
 * paise is `qtyMilli × costPerBase ÷ 1_000_000`.
 */
export const MILLI_PER_BASE_THOUSAND = 1_000_000n;

/** Value in paise of a quantity at a cost (paise per 1000 base units), rounded half-even. */
export function stockValue(qtyMilli: number, costPerBase: number): number {
  return toSafeNumber(
    divideRounded(BigInt(qtyMilli) * BigInt(costPerBase), MILLI_PER_BASE_THOUSAND, 'HALF_EVEN'),
    'stock value',
  );
}

/** Value in paise of a sum of qty_milli × cost-per-1000 products (a SQL SUM over movements). */
export function stockValueOfSum(sumOfProducts: number): number {
  return toSafeNumber(
    divideRounded(BigInt(Math.trunc(sumOfProducts)), MILLI_PER_BASE_THOUSAND, 'HALF_EVEN'),
    'stock value',
  );
}

/** The cost per 1000 base units of a receipt: what was paid for how much. */
export function costPerBase(totalPaise: number, qtyMilli: number): number {
  invariant(qtyMilli > 0, 'QUANTITY_INVALID', 'a receipt must add a positive quantity');
  return toSafeNumber(
    divideRounded(BigInt(totalPaise) * MILLI_PER_BASE_THOUSAND, BigInt(qtyMilli), 'HALF_EVEN'),
    'unit cost',
  );
}

/**
 * Weighted average cost after receiving `inQty` at `inCost`. Stock that went
 * negative (sold before it was received) doesn't drag the average: only
 * what is on hand counts.
 */
export function weightedAverageCost(
  onHandMilli: number,
  onHandCost: number,
  inQtyMilli: number,
  inCost: number,
): number {
  const held = BigInt(Math.max(0, onHandMilli));
  const total = held + BigInt(inQtyMilli);
  if (total <= 0n) return inCost;
  return toSafeNumber(
    divideRounded(
      held * BigInt(onHandCost) + BigInt(inQtyMilli) * BigInt(inCost),
      total,
      'HALF_EVEN',
    ),
    'average cost',
  );
}

/** Stock coming in, as the ledger posted it: a receipt, a put-back or a find. */
export interface StockInflow {
  readonly qtyMilli: number;
  /** The balance after it, so what was on hand before is this less `qtyMilli`. */
  readonly balanceAfterMilli: number;
  readonly unitCostPerBase: number;
}

/**
 * The weighted average cost after `inflows`, in the order they were posted,
 * worked out as the stock ledger did. Stock going out leaves the average
 * as it is, so only what came in is needed: the cost on any past day is
 * this over that day's inflows.
 */
export function averageCostAfter(inflows: Iterable<StockInflow>): number {
  let cost = 0;
  for (const m of inflows) {
    cost = weightedAverageCost(
      m.balanceAfterMilli - m.qtyMilli,
      cost,
      m.qtyMilli,
      m.unitCostPerBase,
    );
  }
  return cost;
}

export interface RecipeLine {
  readonly inventoryItemId: string;
  /** Per `yieldPortions` portions. */
  readonly qtyMilli: number;
  /** Expected trim loss on top of the net quantity, basis points. */
  readonly wastageBp: number;
}

export interface ConsumptionLine {
  readonly inventoryItemId: string;
  readonly qtyMilli: number;
}

/**
 * What selling `portions` of a dish takes from stock: each ingredient
 * × (1 + trim loss) × portions ÷ portions per batch, plus each add-on's
 * ingredients × how many of that add-on × portions. Same ingredient twice
 * (e.g. butter in the dish and in an add-on) is summed.
 */
export function consumptionFor(
  portions: number,
  recipe: { readonly yieldPortions: number; readonly lines: readonly RecipeLine[] } | null,
  addons: readonly { readonly quantity: number; readonly lines: readonly ConsumptionLine[] }[] = [],
): ConsumptionLine[] {
  invariant(Number.isSafeInteger(portions) && portions > 0, 'QUANTITY_INVALID', 'portions');
  const total = new Map<string, bigint>();
  const add = (id: string, milli: bigint) => total.set(id, (total.get(id) ?? 0n) + milli);
  if (recipe) {
    for (const l of recipe.lines) {
      const gross = BigInt(l.qtyMilli) * BigInt(10_000 + l.wastageBp) * BigInt(portions);
      add(
        l.inventoryItemId,
        divideRounded(gross, BigInt(recipe.yieldPortions) * 10_000n, 'HALF_EVEN'),
      );
    }
  }
  for (const a of addons) {
    for (const l of a.lines)
      add(l.inventoryItemId, BigInt(l.qtyMilli) * BigInt(a.quantity * portions));
  }
  return [...total]
    .filter(([, milli]) => milli > 0n)
    .map(([inventoryItemId, milli]) => ({
      inventoryItemId,
      qtyMilli: toSafeNumber(milli, 'consumption'),
    }));
}

export interface Batch {
  readonly id: string;
  readonly expiresOn: string | null;
  readonly remainingMilli: number;
  readonly createdAt: string;
}

/**
 * First expiry, first out: takes `qtyMilli` from batches that expire soonest
 * (undated batches last, oldest first). Whatever the batches can't cover is
 * `unbatched`: stock is allowed to go negative rather than block a sale.
 */
export function allocateFefo(
  batches: readonly Batch[],
  qtyMilli: number,
): { takes: { batchId: string; qtyMilli: number }[]; unbatched: number } {
  const order = [...batches]
    .filter((b) => b.remainingMilli > 0)
    .sort(
      (a, b) =>
        (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const takes: { batchId: string; qtyMilli: number }[] = [];
  let left = qtyMilli;
  for (const b of order) {
    if (left <= 0) break;
    const take = Math.min(left, b.remainingMilli);
    takes.push({ batchId: b.id, qtyMilli: take });
    left -= take;
  }
  return { takes, unbatched: Math.max(0, left) };
}

export type StockLevel = 'OUT' | 'LOW' | 'OK' | 'OVER';

/** Where a balance sits against its reorder and maximum levels. */
export function stockLevel(
  qtyMilli: number,
  reorderMilli: number,
  maxMilli: number | null,
): StockLevel {
  if (qtyMilli <= 0) return 'OUT';
  if (reorderMilli > 0 && qtyMilli <= reorderMilli) return 'LOW';
  if (maxMilli !== null && maxMilli > 0 && qtyMilli > maxMilli) return 'OVER';
  return 'OK';
}

/** One portion's cost of a recipe ingredient: qty × (1 + trim loss) ÷ portions per batch, at a cost per 1000 base units. */
export function portionCost(line: RecipeLine, yieldPortions: number, costPerBase: number): number {
  return toSafeNumber(
    divideRounded(
      BigInt(line.qtyMilli) * BigInt(10_000 + line.wastageBp) * BigInt(costPerBase),
      BigInt(yieldPortions) * 10_000n * MILLI_PER_BASE_THOUSAND,
      'HALF_EVEN',
    ),
    'portion cost',
  );
}

/** `part` as basis points of `whole` (food cost %, variance %); null when `whole` is 0. */
export function shareBp(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return toSafeNumber(divideRounded(BigInt(part) * 10_000n, BigInt(whole), 'HALF_EVEN'), 'share');
}
