import { Money } from '../shared/money';
import { DomainError } from '../shared/result';
import type { InvoiceLineRecord, InvoiceState } from './invoice';
import { summariseTaxes, type ComponentTax, type ComputedCharge } from './tax-engine';

type Bill = InvoiceState['bill'];
export type CreditNoteLine = Omit<InvoiceLineRecord, 'id'>;

export interface CreditNoteBill {
  readonly lines: CreditNoteLine[];
  readonly charges: ComputedCharge[];
  readonly taxes: ReturnType<typeof summariseTaxes>;
  readonly subtotal: number;
  readonly discountTotal: number;
  readonly chargesTotal: number;
  readonly taxableTotal: number;
  readonly taxTotal: number;
  readonly roundOff: number;
  readonly grandTotal: number;
}

/** value × part / whole, rounded half-up (all non-negative paise and quantities). */
function share(value: number, part: number, whole: number): number {
  if (whole === 0 || value === 0 || part === 0) return 0;
  return Number((BigInt(value) * BigInt(part) * 2n + BigInt(whole)) / (2n * BigInt(whole)));
}

/**
 * The credit note for refunding some quantities of an invoice's lines, with
 * their tax reversed in proportion. Refunding everything that is left also
 * returns the service charge and the round-off, so a full refund equals the
 * amount paid.
 */
export function creditNoteForLines(
  bill: Bill,
  requested: readonly { lineId: string; quantity: number }[],
  alreadyRefunded: ReadonlyMap<string, number>,
  anyAmountRefunds: boolean,
): CreditNoteBill {
  if (requested.length === 0)
    throw new DomainError('VALIDATION_FAILED', 'choose at least one line to refund');
  const lines: CreditNoteLine[] = [];
  const after = new Map(alreadyRefunded);
  for (const r of requested) {
    const line = bill.lines.find((l) => l.id === r.lineId);
    if (!line) throw new DomainError('NOT_FOUND', 'invoice line not found');
    const left = line.quantity - (after.get(line.id) ?? 0);
    if (r.quantity > left) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `only ${left} of ${line.description} can still be refunded`,
      );
    }
    after.set(line.id, (after.get(line.id) ?? 0) + r.quantity);
    const taxes: ComponentTax[] = line.taxes.map((t) => ({
      ...t,
      amount: share(t.amount, r.quantity, line.quantity),
    }));
    const taxable = share(line.taxableValue, r.quantity, line.quantity);
    const taxAmount = taxes.reduce((s, t) => s + t.amount, 0);
    lines.push({
      ...line,
      originalLineId: line.id,
      quantity: r.quantity,
      discount: share(line.discount, r.quantity, line.quantity),
      taxableValue: taxable,
      taxes,
      taxAmount,
      lineTotal: taxable + taxAmount,
    });
  }
  const everything =
    !anyAmountRefunds && bill.lines.every((l) => (after.get(l.id) ?? 0) === l.quantity);
  const charges = everything ? bill.charges : [];
  return assemble(lines, charges, everything ? bill.roundOff : 0);
}

/** A goodwill refund of a flat amount, spread over the bill so its tax is reversed in proportion. */
export function creditNoteForAmount(
  bill: Bill,
  amount: number,
  refundable: number,
): CreditNoteBill {
  if (amount > refundable)
    throw new DomainError('VALIDATION_FAILED', 'refunds can not exceed what was paid');
  const parts = [
    ...bill.lines.map((l) => ({ total: l.lineTotal, taxes: l.taxes, line: l })),
    ...bill.charges.map((c) => ({ total: c.amount + c.taxAmount, taxes: c.taxes, line: null })),
  ];
  const shares = Money.ofPaise(amount).allocate(parts.map((p) => Math.max(p.total, 0)));
  const lines: CreditNoteLine[] = [];
  parts.forEach((p, i) => {
    const part = shares[i]!.paise;
    if (part === 0 || p.total === 0) return;
    const taxes = p.taxes.map((t) => ({ ...t, amount: share(t.amount, part, p.total) }));
    const taxAmount = taxes.reduce((s, t) => s + t.amount, 0);
    const base = p.line ?? {
      orderItemId: null,
      description: 'Charges',
      hsnSacCode: null,
      unitPrice: 0,
      taxGroupId: null,
      taxRateBp: taxes.reduce((s, t) => s + t.rateBp, 0),
      id: null,
    };
    lines.push({
      orderItemId: base.orderItemId,
      description: base.description,
      hsnSacCode: base.hsnSacCode,
      unitPrice: base.unitPrice,
      taxGroupId: base.taxGroupId,
      taxRateBp: base.taxRateBp,
      originalLineId: p.line?.id ?? null,
      quantity: 0,
      discount: 0,
      taxableValue: part - taxAmount,
      taxes,
      taxAmount,
      lineTotal: part,
    });
  });
  return assemble(lines, [], 0);
}

function assemble(
  lines: CreditNoteLine[],
  charges: readonly ComputedCharge[],
  roundOff: number,
): CreditNoteBill {
  const taxes = summariseTaxes([
    ...lines.map((l) => ({ taxable: l.taxableValue, taxes: l.taxes })),
    ...charges.map((c) => ({ taxable: c.amount, taxes: c.taxes })),
  ]);
  const chargesTotal = charges.reduce((s, c) => s + c.amount, 0);
  const taxableTotal = lines.reduce((s, l) => s + l.taxableValue, 0) + chargesTotal;
  const taxTotal =
    lines.reduce((s, l) => s + l.taxAmount, 0) + charges.reduce((s, c) => s + c.taxAmount, 0);
  return {
    lines,
    charges: [...charges],
    taxes,
    subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    discountTotal: lines.reduce((s, l) => s + l.discount, 0),
    chargesTotal,
    taxableTotal,
    taxTotal,
    roundOff,
    grandTotal: taxableTotal + taxTotal + roundOff,
  };
}
