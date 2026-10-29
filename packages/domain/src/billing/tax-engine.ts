import { Money } from '../shared/money';
import { Rate } from '../shared/rate';
import { DomainError } from '../shared/result';

export type TaxCode = 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SURCHARGE' | 'CESS';
export type InvoiceSeries = 'INV' | 'LIQ';
export type Supply = 'INTRA_STATE' | 'INTER_STATE';

export interface TaxGroupSpec {
  readonly id: string;
  readonly taxType: 'GST' | 'VAT' | 'NONE';
  readonly isInclusive: boolean;
  readonly invoiceSeries: InvoiceSeries;
  readonly components: readonly {
    readonly code: TaxCode;
    readonly rateBp: number;
    readonly appliesTo: 'ALWAYS' | Supply;
  }[];
}

export interface BillLineInput {
  readonly orderItemId: string | null;
  readonly description: string;
  readonly hsnSacCode: string | null;
  readonly quantity: number;
  /** Paise per unit, add-ons included; tax-inclusive when the group is. */
  readonly unitPrice: number;
  readonly taxGroup: TaxGroupSpec | null;
}

export interface ChargeInput {
  readonly chargeRuleId: string | null;
  readonly name: string;
  readonly kind: 'PERCENT' | 'FIXED';
  /** Basis points or paise. */
  readonly value: number;
  readonly taxGroup: TaxGroupSpec | null;
}

export interface DiscountInput {
  readonly kind: 'PERCENT' | 'FIXED' | 'COUPON' | 'LOYALTY' | 'COMPLIMENTARY';
  /** Basis points (PERCENT, percent coupons) or paise (FIXED, fixed coupons). */
  readonly value: number;
  readonly valueIsPercent: boolean;
  /** Coupons: the most this discount may take. */
  readonly cap: number | null;
  readonly couponCode: string | null;
  readonly reason: string | null;
}

export interface BillInput {
  readonly lines: readonly BillLineInput[];
  readonly charges: readonly ChargeInput[];
  /** Applied in order, each on what is left after the previous ones. */
  readonly discounts: readonly DiscountInput[];
  readonly supply: Supply;
  /** Aggregator orders (CGST Act s.9(5)): the operator pays the GST, so none is charged. */
  readonly gstPaidByOperator: boolean;
  /** Paise: 100 = round the bill to the nearest rupee. */
  readonly cashRounding: number;
  /** Liquor (LIQ tax groups) on its own invoice. */
  readonly separateLiquor: boolean;
}

export interface ComponentTax {
  readonly code: TaxCode;
  readonly rateBp: number;
  readonly amount: number;
}

export interface ComputedLine {
  readonly orderItemId: string | null;
  readonly description: string;
  readonly hsnSacCode: string | null;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly taxGroupId: string | null;
  readonly discount: number;
  readonly taxableValue: number;
  readonly taxRateBp: number;
  readonly taxes: readonly ComponentTax[];
  readonly taxAmount: number;
  readonly lineTotal: number;
}

export interface ComputedCharge {
  readonly chargeRuleId: string | null;
  readonly name: string;
  readonly amount: number;
  readonly taxGroupId: string | null;
  readonly taxes: readonly ComponentTax[];
  readonly taxAmount: number;
}

export interface ComputedTax {
  readonly code: TaxCode;
  readonly rateBp: number;
  readonly taxableValue: number;
  readonly taxAmount: number;
}

export interface ComputedDiscount {
  readonly kind: DiscountInput['kind'];
  readonly value: number;
  readonly amount: number;
  readonly couponCode: string | null;
  readonly reason: string | null;
}

export interface ComputedInvoice {
  readonly series: InvoiceSeries;
  readonly lines: readonly ComputedLine[];
  readonly charges: readonly ComputedCharge[];
  readonly discounts: readonly ComputedDiscount[];
  readonly taxes: readonly ComputedTax[];
  readonly subtotal: number;
  readonly discountTotal: number;
  readonly chargesTotal: number;
  readonly taxableTotal: number;
  readonly taxTotal: number;
  readonly roundOff: number;
  readonly grandTotal: number;
}

/**
 * The bill for an order (docs/01 §5.2, §5.7). Tax is computed per line with
 * banker's rounding and then summed; bill-level discounts are spread over the
 * lines in proportion to their value before tax; the total is rounded to the
 * branch's cash rounding, kept apart as `roundOff`. Food (GST) and liquor
 * (state VAT) may sit on one order and, if the branch wants, on two invoices.
 */
export function computeBill(input: BillInput): ComputedInvoice[] {
  if (input.lines.length === 0)
    throw new DomainError('NOTHING_TO_BILL', 'the order has no items to bill');
  const gross = input.lines.map((l) => Money.ofPaise(l.unitPrice).multiply(l.quantity));
  const grossTotal = Money.sum(gross);

  // Bill-level discounts, each on what the previous ones left, spread over the lines.
  const lineDiscounts = input.lines.map(() => Money.ZERO);
  const discountShares: { input: DiscountInput; perLine: Money[] }[] = [];
  let remaining = grossTotal;
  for (const d of input.discounts) {
    let amount =
      d.kind === 'COMPLIMENTARY'
        ? remaining
        : d.valueIsPercent
          ? remaining.percentage(Rate.ofBasisPoints(d.value), 'HALF_UP')
          : Money.ofPaise(d.value);
    if (d.cap !== null && amount.paise > d.cap) amount = Money.ofPaise(d.cap);
    if (amount.compare(remaining) > 0) amount = remaining;
    const weights = input.lines.map((_, i) => gross[i]!.subtract(lineDiscounts[i]!).paise);
    const perLine = amount.allocate(weights);
    perLine.forEach((part, i) => (lineDiscounts[i] = lineDiscounts[i]!.add(part)));
    discountShares.push({ input: d, perLine });
    remaining = remaining.subtract(amount);
  }

  const seriesOf = (group: TaxGroupSpec | null): InvoiceSeries =>
    input.separateLiquor && group?.invoiceSeries === 'LIQ' ? 'LIQ' : 'INV';
  const order: InvoiceSeries[] = [];
  for (const line of input.lines) {
    const series = seriesOf(line.taxGroup);
    if (!order.includes(series)) order.push(series);
  }
  order.sort((a, b) => (a === b ? 0 : a === 'INV' ? -1 : 1));

  return order.map((series, invoiceIndex) => {
    const idx = input.lines
      .map((l, i) => (seriesOf(l.taxGroup) === series ? i : -1))
      .filter((i) => i >= 0);
    const lines = idx.map((i) => {
      const line = input.lines[i]!;
      const net = gross[i]!.subtract(lineDiscounts[i]!);
      const taxed = applyTax(net, line.taxGroup, input);
      return {
        orderItemId: line.orderItemId,
        description: line.description,
        hsnSacCode: line.hsnSacCode,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxGroupId: line.taxGroup?.id ?? null,
        discount: lineDiscounts[i]!.paise,
        taxableValue: taxed.taxable.paise,
        taxRateBp: taxed.taxes.reduce((s, t) => s + t.rateBp, 0),
        taxes: taxed.taxes,
        taxAmount: taxed.taxAmount.paise,
        lineTotal: taxed.taxable.add(taxed.taxAmount).paise,
      } satisfies ComputedLine;
    });

    // Charges (service charge) go on the food invoice, on its value before tax.
    const complimentary = input.discounts.some((d) => d.kind === 'COMPLIMENTARY');
    const takesCharges = invoiceIndex === 0 && !complimentary;
    const base = Money.ofPaise(lines.reduce((s, l) => s + l.taxableValue, 0));
    const charges = takesCharges
      ? input.charges.map((c) => {
          const amount =
            c.kind === 'PERCENT'
              ? base.percentage(Rate.ofBasisPoints(c.value), 'HALF_UP')
              : Money.ofPaise(c.value);
          const taxed = applyTax(
            amount,
            c.taxGroup ? { ...c.taxGroup, isInclusive: false } : null,
            input,
          );
          return {
            chargeRuleId: c.chargeRuleId,
            name: c.name,
            amount: amount.paise,
            taxGroupId: c.taxGroup?.id ?? null,
            taxes: taxed.taxes,
            taxAmount: taxed.taxAmount.paise,
          } satisfies ComputedCharge;
        })
      : [];

    const taxes = summariseTaxes([
      ...lines.map((l) => ({ taxable: l.taxableValue, taxes: l.taxes })),
      ...charges.map((c) => ({ taxable: c.amount, taxes: c.taxes })),
    ]);
    const discounts = discountShares
      .map(({ input: d, perLine }) => ({
        kind: d.kind,
        value: d.value,
        amount: idx.reduce((s, i) => s + perLine[i]!.paise, 0),
        couponCode: d.couponCode,
        reason: d.reason,
      }))
      .filter((d) => d.amount > 0 || d.kind === 'COMPLIMENTARY');

    const subtotal = idx.reduce((s, i) => s + gross[i]!.paise, 0);
    const discountTotal = lines.reduce((s, l) => s + l.discount, 0);
    const chargesTotal = charges.reduce((s, c) => s + c.amount, 0);
    const taxableTotal = lines.reduce((s, l) => s + l.taxableValue, 0) + chargesTotal;
    const taxTotal =
      lines.reduce((s, l) => s + l.taxAmount, 0) + charges.reduce((s, c) => s + c.taxAmount, 0);
    const exact = Money.ofPaise(taxableTotal + taxTotal);
    const grand = exact.roundTo(input.cashRounding);
    return {
      series,
      lines,
      charges,
      discounts,
      taxes,
      subtotal,
      discountTotal,
      chargesTotal,
      taxableTotal,
      taxTotal,
      roundOff: grand.subtract(exact).paise,
      grandTotal: grand.paise,
    } satisfies ComputedInvoice;
  });
}

/** Splits `net` into taxable value and per-component tax for one line or charge. */
export function applyTax(
  net: Money,
  group: TaxGroupSpec | null,
  ctx: Pick<BillInput, 'supply' | 'gstPaidByOperator'>,
): { taxable: Money; taxes: ComponentTax[]; taxAmount: Money } {
  const components =
    group === null || group.taxType === 'NONE' || (group.taxType === 'GST' && ctx.gstPaidByOperator)
      ? []
      : group.components.filter(
          (c) => c.rateBp > 0 && (c.appliesTo === 'ALWAYS' || c.appliesTo === ctx.supply),
        );
  if (components.length === 0) return { taxable: net, taxes: [], taxAmount: Money.ZERO };
  const totalRate = Rate.ofBasisPoints(components.reduce((s, c) => s + c.rateBp, 0));
  const taxable = group!.isInclusive ? net.extractTaxable(totalRate) : net;
  const amounts = components.map((c) => taxable.percentage(Rate.ofBasisPoints(c.rateBp)));
  if (group!.isInclusive) {
    // The components must add up exactly to gross − taxable; the last absorbs the paisa.
    const want = net.subtract(taxable);
    const have = Money.sum(amounts);
    amounts[amounts.length - 1] = amounts.at(-1)!.add(want.subtract(have));
  }
  const taxes = components.map((c, i) => ({
    code: c.code,
    rateBp: c.rateBp,
    amount: amounts[i]!.paise,
  }));
  return { taxable, taxes, taxAmount: Money.sum(amounts) };
}

export function summariseTaxes(
  items: readonly { taxable: number; taxes: readonly ComponentTax[] }[],
): ComputedTax[] {
  const map = new Map<
    string,
    { code: TaxCode; rateBp: number; taxableValue: number; taxAmount: number }
  >();
  for (const item of items) {
    for (const t of item.taxes) {
      const key = `${t.code}:${t.rateBp}`;
      const row = map.get(key) ?? { code: t.code, rateBp: t.rateBp, taxableValue: 0, taxAmount: 0 };
      row.taxableValue += item.taxable;
      row.taxAmount += t.amount;
      map.set(key, row);
    }
  }
  const order: TaxCode[] = ['CGST', 'SGST', 'IGST', 'VAT', 'SURCHARGE', 'CESS'];
  return [...map.values()].sort(
    (a, b) => order.indexOf(a.code) - order.indexOf(b.code) || a.rateBp - b.rateBp,
  );
}
