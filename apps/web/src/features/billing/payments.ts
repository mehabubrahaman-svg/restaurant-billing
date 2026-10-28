import type { PaymentMethod } from '@restroos/contracts';
import type { NewPaymentBody } from '../../api/endpoints';
import { paiseToRupees, rupeesToPaise } from '../../lib/units';

/** Tenders the counter takes (AGGREGATOR payments come with the aggregator's order). */
export const TENDERS = ['CASH', 'CARD', 'UPI', 'WALLET', 'CREDIT'] as const;
export type Tender = (typeof TENDERS)[number];

/** One line of the payment pad, as typed. Rupee amounts stay strings until parsed. */
export interface PaymentEntry {
  readonly key: string;
  readonly method: Tender;
  readonly amount: string;
  /** Cash only: what the guest handed over. Empty = exact. */
  readonly tendered: string;
  /** Card/UPI/wallet: approval code or RRN from the terminal slip. */
  readonly reference: string;
  readonly cardLast4: string;
  readonly terminalLabel: string;
}

export type EntryProblem =
  'amount' | 'tendered' | 'reference' | 'cardLast4' | 'creditNeedsCustomer';

export interface CheckedEntry {
  readonly entry: PaymentEntry;
  /** Paise, or null when the amount is not a valid positive sum. */
  readonly amount: number | null;
  /** Cash: paise handed over (the amount when left empty). */
  readonly tendered: number | null;
  readonly problems: readonly EntryProblem[];
}

export interface PadCheck {
  readonly entries: readonly CheckedEntry[];
  /** Sum of valid amounts, paise. */
  readonly total: number;
  /** Still owed after these entries; negative when they add up to more. */
  readonly remaining: number;
  /** Change to hand back across cash entries. */
  readonly change: number;
  readonly overpaid: boolean;
  /** Every entry valid, at least one, not more than owed. */
  readonly ok: boolean;
}

/** Method-specific details that need a reference from the terminal slip. */
export const NEEDS_REFERENCE: ReadonlySet<Tender> = new Set(['CARD', 'UPI']);
/** Methods that carry a terminal (and the remembered last terminal). */
export const HAS_TERMINAL: ReadonlySet<Tender> = new Set(['CARD', 'UPI', 'WALLET']);

export function newEntry(method: Tender, amountPaise: number, terminalLabel = ''): PaymentEntry {
  return {
    key: `${method}-${Math.random().toString(36).slice(2, 10)}`,
    method,
    amount: amountPaise > 0 ? paiseToRupees(amountPaise) : '',
    tendered: '',
    reference: '',
    cardLast4: '',
    terminalLabel: HAS_TERMINAL.has(method) ? terminalLabel : '',
  };
}

/** Validates the pad against what is owed (`due`, paise). */
export function checkPad(
  entries: readonly PaymentEntry[],
  due: number,
  { hasCustomerName }: { hasCustomerName: boolean },
): PadCheck {
  let total = 0;
  let change = 0;
  const checked = entries.map((entry): CheckedEntry => {
    const problems: EntryProblem[] = [];
    const amount = rupeesToPaise(entry.amount);
    const validAmount = amount !== null && amount > 0 ? amount : null;
    if (validAmount === null) problems.push('amount');
    else total += validAmount;

    let tendered: number | null = null;
    if (entry.method === 'CASH') {
      if (entry.tendered.trim() === '') tendered = validAmount;
      else {
        tendered = rupeesToPaise(entry.tendered);
        if (tendered === null || (validAmount !== null && tendered < validAmount)) {
          problems.push('tendered');
          tendered = null;
        } else if (validAmount !== null) change += tendered - validAmount;
      }
    }
    const reference = entry.reference.trim();
    if (NEEDS_REFERENCE.has(entry.method) && (reference.length < 2 || reference.length > 40)) {
      problems.push('reference');
    }
    if (entry.method === 'CARD' && entry.cardLast4 !== '' && !/^\d{4}$/.test(entry.cardLast4)) {
      problems.push('cardLast4');
    }
    if (entry.method === 'CREDIT' && !hasCustomerName) problems.push('creditNeedsCustomer');
    return { entry, amount: validAmount, tendered, problems };
  });
  const remaining = due - total;
  const overpaid = remaining < 0;
  return {
    entries: checked,
    total,
    remaining,
    change,
    overpaid,
    ok: checked.length > 0 && !overpaid && checked.every((e) => e.problems.length === 0),
  };
}

function toBody(e: CheckedEntry, amount: number, tendered: number | undefined): NewPaymentBody {
  const reference = e.entry.reference.trim();
  const terminal = e.entry.terminalLabel.trim();
  return {
    method: e.entry.method as PaymentMethod,
    amount,
    ...(tendered === undefined ? {} : { tendered }),
    ...(reference === '' ? {} : { reference }),
    ...(e.entry.method === 'CARD' && e.entry.cardLast4 !== ''
      ? { cardLast4: e.entry.cardLast4 }
      : {}),
    ...(terminal === '' ? {} : { terminalLabel: terminal }),
  };
}

/**
 * Spreads checked entries over one or more invoices in order ("pay together"
 * for an INV + LIQ pair): each invoice is filled up to its balance before the
 * next. A cash entry split across invoices carries what was handed over on its
 * last part only, so the change is counted once.
 */
export function allocatePayments(
  check: PadCheck,
  invoices: readonly { readonly id: string; readonly balance: number }[],
): Map<string, NewPaymentBody[]> {
  const out = new Map<string, NewPaymentBody[]>(invoices.map((i) => [i.id, []]));
  const left = invoices.map((i) => ({ id: i.id, balance: i.balance }));
  for (const e of check.entries) {
    if (e.amount === null) continue;
    let rest = e.amount;
    const parts: { id: string; amount: number }[] = [];
    for (const inv of left) {
      if (rest === 0) break;
      const take = Math.min(rest, inv.balance);
      if (take <= 0) continue;
      parts.push({ id: inv.id, amount: take });
      inv.balance -= take;
      rest -= take;
    }
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const extra = e.tendered !== null && e.amount !== null ? e.tendered - e.amount : 0;
      const tendered =
        e.entry.method === 'CASH' && last && extra > 0 ? part.amount + extra : undefined;
      out.get(part.id)!.push(toBody(e, part.amount, tendered));
    });
  }
  for (const [id, list] of out) if (list.length === 0) out.delete(id);
  return out;
}

/** Quick-cash buttons: exact, then the next ₹100, ₹500 and ₹2,000 at or above the amount. */
export function quickCash(amount: number): number[] {
  if (amount <= 0) return [];
  const up = (step: number) => (amount % step === 0 ? amount : amount + step - (amount % step));
  return [...new Set([amount, up(10_000), up(50_000), up(2_00_000)])].sort((a, b) => a - b);
}
