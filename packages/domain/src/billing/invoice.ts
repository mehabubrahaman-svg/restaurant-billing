import { AggregateRoot } from '../shared/aggregate-root';
import { DomainError } from '../shared/result';
import type { ComputedInvoice, ComputedLine } from './tax-engine';

export type InvoiceStatus =
  'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CREDIT' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'WALLET' | 'CREDIT' | 'AGGREGATOR';

export interface InvoiceLineRecord extends ComputedLine {
  readonly id: string;
  readonly originalLineId: string | null;
}

export interface InvoiceState {
  branchId: string;
  orderId: string;
  invoiceNo: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  series: 'INV' | 'LIQ' | 'CN';
  supplyType: 'B2B' | 'B2C';
  gstPaidByOperator: boolean;
  originalInvoiceId: string | null;
  businessDate: string;
  fiscalYear: string;
  customerName: string | null;
  customerTaxId: string | null;
  placeOfSupply: string | null;
  bill: Omit<ComputedInvoice, 'lines' | 'series'> & { lines: InvoiceLineRecord[] };
  paidTotal: number;
  refundedTotal: number;
  status: InvoiceStatus;
  cancelReason: string | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  approvedBy: string | null;
  printCount: number;
  createdAt: Date;
  createdBy: string;
}

export interface NewPayment {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly amount: number;
  readonly tendered: number | null;
  readonly changeDue: number | null;
  readonly reference: string | null;
  readonly cardLast4: string | null;
  readonly terminalLabel: string | null;
  readonly refundOfPaymentId: string | null;
  readonly shiftId: string | null;
  readonly createdBy: string;
}

/**
 * A tax invoice or credit note. Never edited after issue (docs/03 §4.1): only
 * its payment status moves. Cancelled invoices keep their number. A refund is
 * a separate credit note plus a negative payment.
 */
export class Invoice extends AggregateRoot {
  readonly aggregateType = 'Invoice';
  /** Payments added since loading, for the repository (payments are append-only). */
  readonly newPayments: NewPayment[] = [];

  private constructor(
    id: string,
    version: number,
    private readonly s: InvoiceState,
  ) {
    super(id, version);
  }

  static restore(id: string, version: number, state: InvoiceState): Invoice {
    return new Invoice(id, version, state);
  }

  static issue(
    id: string,
    input: Omit<
      InvoiceState,
      | 'paidTotal'
      | 'refundedTotal'
      | 'status'
      | 'cancelReason'
      | 'cancelledBy'
      | 'cancelledAt'
      | 'printCount'
    >,
  ): Invoice {
    const free = input.bill.grandTotal === 0;
    const invoice = new Invoice(id, 0, {
      ...input,
      paidTotal: 0,
      refundedTotal: 0,
      status: free ? 'PAID' : 'UNPAID',
      cancelReason: null,
      cancelledBy: null,
      cancelledAt: null,
      printCount: 0,
    });
    invoice.raise(
      input.kind === 'CREDIT_NOTE' ? 'CreditNoteIssued' : 'InvoiceIssued',
      {
        invoiceNo: input.invoiceNo,
        orderId: input.orderId,
        series: input.series,
        grandTotal: input.bill.grandTotal,
        taxTotal: input.bill.taxTotal,
        originalInvoiceId: input.originalInvoiceId,
      },
      input.createdAt,
    );
    return invoice;
  }

  get state(): Readonly<InvoiceState> {
    return this.s;
  }

  get balance(): number {
    return this.s.bill.grandTotal - this.s.paidTotal;
  }

  get isSettled(): boolean {
    return this.s.status === 'PAID' || this.s.status === 'CREDIT';
  }

  /** Split payments allowed; together they may not exceed what is owed. */
  pay(payments: readonly Omit<NewPayment, 'refundOfPaymentId'>[], at: Date): void {
    if (this.s.kind !== 'INVOICE')
      throw new DomainError('VALIDATION_FAILED', 'a credit note is not paid');
    if (this.s.status !== 'UNPAID' && this.s.status !== 'PARTIALLY_PAID') {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        `this invoice is ${this.s.status.toLowerCase().replace('_', ' ')}`,
      );
    }
    const total = payments.reduce((s, p) => s + p.amount, 0);
    if (total > this.balance) {
      throw new DomainError(
        'OVERPAYMENT',
        `the payments add up to more than the ${this.balance} paise owed`,
      );
    }
    for (const p of payments) this.newPayments.push({ ...p, refundOfPaymentId: null });
    this.s.paidTotal += total;
    const onCredit = payments.some((p) => p.method === 'CREDIT');
    this.s.status = this.balance === 0 ? (onCredit ? 'CREDIT' : 'PAID') : 'PARTIALLY_PAID';
    this.raise(
      'PaymentRecorded',
      { amount: total, methods: payments.map((p) => p.method), status: this.s.status },
      at,
    );
    if (this.balance === 0)
      this.raise(
        'InvoicePaid',
        { orderId: this.s.orderId, grandTotal: this.s.bill.grandTotal },
        at,
      );
  }

  /**
   * Cancels the invoice. Payments already taken are reversed by `refunds`
   * (the application decides they may be: same shift, approval given).
   */
  cancel(
    input: {
      reason: string;
      by: string | null;
      approvedBy: string | null;
      refunds: readonly NewPayment[];
    },
    at: Date,
  ): void {
    if (this.s.kind !== 'INVOICE')
      throw new DomainError('VALIDATION_FAILED', 'a credit note cannot be cancelled');
    if (this.s.status === 'CANCELLED' || this.s.refundedTotal > 0) {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'this invoice was already cancelled or refunded',
      );
    }
    const reversed = -input.refunds.reduce((s, p) => s + p.amount, 0);
    if (reversed !== this.s.paidTotal) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'every payment must be reversed to cancel a paid invoice',
      );
    }
    this.newPayments.push(...input.refunds);
    this.s.paidTotal = 0;
    this.s.status = 'CANCELLED';
    this.s.cancelReason = input.reason;
    this.s.cancelledBy = input.by;
    this.s.cancelledAt = at;
    this.s.approvedBy = input.approvedBy;
    this.raise('InvoiceCancelled', { orderId: this.s.orderId, reason: input.reason, reversed }, at);
  }

  /** A credit note was issued against this invoice for `amount`. */
  recordRefund(amount: number, creditNoteId: string, at: Date): void {
    if (!this.isSettled && this.s.status !== 'PARTIALLY_REFUNDED') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'only a paid invoice can be refunded');
    }
    if (this.s.refundedTotal + amount > this.s.paidTotal) {
      throw new DomainError('VALIDATION_FAILED', 'refunds can not exceed what was paid');
    }
    this.s.refundedTotal += amount;
    this.s.status =
      this.s.refundedTotal >= this.s.bill.grandTotal ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    this.raise('InvoiceRefunded', { amount, creditNoteId, status: this.s.status }, at);
  }

  /** A credit note pays out its refund immediately. */
  settleRefund(payment: NewPayment, at: Date): void {
    if (this.s.kind !== 'CREDIT_NOTE')
      throw new DomainError('VALIDATION_FAILED', 'not a credit note');
    this.newPayments.push(payment);
    this.s.paidTotal = this.s.bill.grandTotal;
    this.s.status = 'PAID';
    this.raise('RefundPaid', { amount: -payment.amount, method: payment.method }, at);
  }
}
