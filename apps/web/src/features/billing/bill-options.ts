import type { BillRequest } from '@restroos/contracts';

/** What the cashier chose for the bill of one order, before it is issued. */
export interface BillOptions {
  /** Basis points (PERCENT) or paise (FIXED). */
  readonly discount: {
    readonly kind: 'PERCENT' | 'FIXED';
    readonly value: number;
    readonly reason: string;
  } | null;
  readonly couponCode: string | null;
  readonly complimentary: { readonly reason: string } | null;
  /** Optional charges (service charge) the guest asked to drop. */
  readonly removeChargeRuleIds: readonly string[];
  readonly customer: {
    readonly name: string;
    /** Mobile number: the Hub finds or adds the guest by it. */
    readonly phone: string;
    readonly taxId: string;
  } | null;
}

export const NO_OPTIONS: BillOptions = {
  discount: null,
  couponCode: null,
  complimentary: null,
  removeChargeRuleIds: [],
  customer: null,
};

/** The request body for bill-preview and invoice. Empty fields are left out. */
export function toBillRequest(o: BillOptions): BillRequest {
  const name = o.customer?.name.trim() ?? '';
  const taxId = o.customer?.taxId.trim().toUpperCase() ?? '';
  const phone = o.customer?.phone.replaceAll(/[\s-]/g, '') ?? '';
  const reason = o.discount?.reason.trim() ?? '';
  return {
    ...(o.discount === null
      ? {}
      : {
          discount: {
            kind: o.discount.kind,
            value: o.discount.value,
            ...(reason === '' ? {} : { reason }),
          },
        }),
    ...(o.couponCode === null ? {} : { couponCode: o.couponCode }),
    ...(o.complimentary === null ? {} : { complimentary: { reason: o.complimentary.reason } }),
    removeChargeRuleIds: [...o.removeChargeRuleIds].sort(),
    ...(name === '' && taxId === '' && phone === ''
      ? {}
      : {
          customer: {
            ...(phone === '' ? {} : { phone }),
            ...(name === '' ? {} : { name }),
            ...(taxId === '' ? {} : { taxId }),
          },
        }),
  };
}

/**
 * Whether a discount goes over the branch limit (so a manager must approve
 * it unless the cashier holds billing.discount_override). A fixed amount is
 * compared with the subtotal: value / subtotal > limit, in integers.
 */
export function exceedsLimit(
  discount: NonNullable<BillOptions['discount']>,
  subtotal: number,
  limitBp: number,
): boolean {
  if (discount.kind === 'PERCENT') return discount.value > limitBp;
  if (subtotal <= 0) return discount.value > 0;
  return discount.value * 10_000 > limitBp * subtotal;
}
