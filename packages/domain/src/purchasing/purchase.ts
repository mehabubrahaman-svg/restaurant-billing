import { DomainError, invariant } from '../shared/result';
import { divideRounded, toSafeNumber } from '../shared/rounding';

/**
 * Purchasing arithmetic and rules (docs/08 Phase 3). Quantities on purchase
 * documents are milli-units of the purchase unit (2.5 kg = 2_500 when the
 * unit is kg); prices are paise per purchase unit; tax rates basis points.
 */

export interface LineAmounts {
  /** Before tax, paise. */
  readonly value: number;
  readonly tax: number;
  readonly total: number;
}

/** What a line costs: quantity × price per unit, then tax on that, each rounded half-even. */
export function lineAmounts(
  quantityMilli: number,
  unitPrice: number,
  taxRateBp: number,
): LineAmounts {
  invariant(quantityMilli >= 0, 'QUANTITY_INVALID', 'quantity');
  const value = toSafeNumber(
    divideRounded(BigInt(quantityMilli) * BigInt(unitPrice), 1_000n, 'HALF_EVEN'),
    'line value',
  );
  const tax = toSafeNumber(
    divideRounded(BigInt(value) * BigInt(taxRateBp), 10_000n, 'HALF_EVEN'),
    'line tax',
  );
  return { value, tax, total: value + tax };
}

export function documentTotals(lines: readonly LineAmounts[]): {
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
} {
  const subtotal = lines.reduce((s, l) => s + l.value, 0);
  const taxTotal = lines.reduce((s, l) => s + l.tax, 0);
  return { subtotal, taxTotal, grandTotal: subtotal + taxTotal };
}

/** A quantity in a purchase unit as milli base units: 2.5 kg (2_500) → 2_500_000 milli-grams. */
export function toBaseMilli(quantityMilli: number, unitToBaseMilli: number): number {
  return toSafeNumber(
    divideRounded(BigInt(quantityMilli) * BigInt(unitToBaseMilli), 1_000n, 'HALF_EVEN'),
    'base quantity',
  );
}

export type PurchaseOrderStatus =
  'DRAFT' | 'APPROVED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

const PO_FLOW: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * Draft → approved → sent → (partly) received → closed. A PO can be
 * cancelled until goods arrive against it; after that it is closed short.
 */
export function assertPoTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!PO_FLOW[from].includes(to)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      `a ${from.toLowerCase().replace('_', ' ')} purchase order can’t become ${to.toLowerCase().replace('_', ' ')}`,
    );
  }
}

/** Whether goods can be received against a PO in this status. */
export function isReceivable(status: PurchaseOrderStatus): boolean {
  return status === 'APPROVED' || status === 'SENT' || status === 'PARTIALLY_RECEIVED';
}

/** After a GRN: RECEIVED once every line has arrived in full, else PARTIALLY_RECEIVED. */
export function receivedStatus(
  lines: readonly { readonly orderedMilli: number; readonly receivedMilli: number }[],
): 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  return lines.every((l) => l.receivedMilli >= l.orderedMilli) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}

export type InputTaxKind = 'CGST_SGST' | 'IGST' | 'NONE';

/**
 * How a vendor's GST is claimed: from a registered vendor in the branch's
 * state as CGST + SGST, from another state as IGST; an unregistered vendor
 * (no GSTIN) gives no input credit.
 */
export function inputTaxKind(vendorGstin: string | null, branchStateCode: string): InputTaxKind {
  if (!vendorGstin) return 'NONE';
  return vendorGstin.slice(0, 2) === branchStateCode ? 'CGST_SGST' : 'IGST';
}

export interface AgeingBuckets {
  /** Not yet due. */
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  over90: number;
}

/**
 * Dues ageing as at a day. Each bill's balance goes into a bucket by how many
 * days past its due date it is. Payments made on account (not against a
 * bill) settle the oldest bills first; anything left over is an advance.
 */
export function ageDues(
  bills: readonly { readonly dueOn: string; readonly balance: number }[],
  onAccount: number,
  asOf: string,
): AgeingBuckets & { due: number; advance: number; oldestDueOn: string | null } {
  const buckets: AgeingBuckets = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
  let credit = onAccount;
  let oldestDueOn: string | null = null;
  for (const bill of [...bills].sort((a, b) => a.dueOn.localeCompare(b.dueOn))) {
    const settled = Math.min(Math.max(0, credit), Math.max(0, bill.balance));
    credit -= settled;
    const open = bill.balance - settled;
    if (open === 0) continue;
    oldestDueOn ??= bill.dueOn;
    const overdue = daysBetween(bill.dueOn, asOf);
    if (overdue <= 0) buckets.current += open;
    else if (overdue <= 30) buckets.d1to30 += open;
    else if (overdue <= 60) buckets.d31to60 += open;
    else if (overdue <= 90) buckets.d61to90 += open;
    else buckets.over90 += open;
  }
  const due = Object.values(buckets).reduce((s, v) => s + v, 0);
  return { ...buckets, due, advance: Math.max(0, credit), oldestDueOn };
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
