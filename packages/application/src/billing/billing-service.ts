import {
  BusinessDate,
  computeBill,
  creditNoteForAmount,
  creditNoteForLines,
  DomainError,
  Invoice,
  type BillInput,
  type ComputedInvoice,
  type DiscountInput,
  type NewPayment,
  type Order,
  type PaymentMethod,
  type TaxGroupSpec,
} from '@restroos/domain';
import type { CatalogRepository } from '../catalog/ports';
import type { CustomerRepository, CustomerService } from '../crm/customers';
import type { LoyaltyService } from '../crm/loyalty';
import type { FloorRepository } from '../floor/ports';
import type { SalesChannelRepository } from '../ordering/channels';
import type { BusinessCalendar, OrderRepository } from '../ordering/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import type { BranchSettingsRecord, SettingsRepository } from '../settings/ports';
import { recordChanged } from '../shared-events';
import type { CouponRecord, CouponRepository, InvoiceRepository, ShiftRepository } from './ports';

export interface BillingServiceDeps {
  readonly invoices: InvoiceRepository;
  readonly orders: OrderRepository;
  readonly coupons: CouponRepository;
  readonly shifts: ShiftRepository;
  readonly catalog: CatalogRepository;
  readonly settings: SettingsRepository;
  readonly floor: FloorRepository;
  readonly channels: SalesChannelRepository;
  readonly customers: CustomerRepository;
  readonly customerService: CustomerService;
  readonly loyalty: LoyaltyService;
  readonly calendar: BusinessCalendar;
  /** billing.default_tax_group_id: for menu items without a tax group of their own. */
  readonly defaultTaxGroupId: () => string | null;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface BillOptions {
  discount?: { kind: 'PERCENT' | 'FIXED'; value: number; reason?: string | undefined } | undefined;
  couponCode?: string | undefined;
  complimentary?: { reason: string } | undefined;
  removeChargeRuleIds: readonly string[];
  customer?:
    | { phone?: string | undefined; name?: string | undefined; taxId?: string | undefined }
    | undefined;
}

/** What the caller may do, from their permissions or a manager's approval for this request. */
export interface BillingRights {
  readonly discount: boolean;
  readonly discountOverride: boolean;
  readonly complimentary: boolean;
  readonly creditSale: boolean;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  tendered?: number | undefined;
  reference?: string | undefined;
  cardLast4?: string | undefined;
  terminalLabel?: string | undefined;
}

/** Billing at the counter (docs/09 WP 5.1–5.4, docs/07 §7.4–7.5). */
export class BillingService {
  constructor(private readonly d: BillingServiceDeps) {}

  /** Totals for the bill panel; nothing is saved and no approval is needed yet. */
  preview(orderId: string, options: BillOptions, ctx: CommandContext): ComputedInvoice[] {
    const order = this.loadOrder(ctx.branchId, orderId);
    if (order.state.status !== 'OPEN' && order.state.status !== 'BILLED') {
      throw new DomainError('ORDER_NOT_OPEN', `this order is ${order.state.status.toLowerCase()}`);
    }
    const branch = this.branch(ctx.branchId);
    return computeBill(this.billInput(order, options, branch, null).input);
  }

  /** Generates the bill: one invoice, or INV + LIQ. The order is then BILLED and its table BILLING. */
  bill(
    orderId: string,
    options: BillOptions,
    ctx: CommandContext,
    rights: BillingRights,
  ): Invoice[] {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const order = this.loadOrder(ctx.branchId, orderId);
      order.markBilled(now);
      const branch = this.branch(ctx.branchId);
      const { input, coupon } = this.billInput(order, options, branch, rights);
      const computed = computeBill(input);
      const businessDate = this.d.calendar.businessDate(ctx.branchId, now);
      const fiscalYear = BusinessDate.parse(businessDate).fiscalYear();
      const guest = options.customer?.phone
        ? this.d.customerService.findOrCreateIn(
            scope,
            {
              phone: options.customer.phone,
              name: options.customer.name,
              taxId: options.customer.taxId,
            },
            ctx,
          )
        : null;
      const taxId = options.customer?.taxId ?? guest?.taxId ?? null;
      const invoices = computed.map((bill) => {
        const { series, lines, ...rest } = bill;
        const invoice = Invoice.issue(this.d.ids.next(), {
          branchId: ctx.branchId,
          orderId: order.id,
          invoiceNo: this.d.invoices.nextNumber(ctx.branchId, series, fiscalYear, branch.code),
          kind: 'INVOICE',
          series,
          supplyType: taxId ? 'B2B' : 'B2C',
          gstPaidByOperator: input.gstPaidByOperator,
          originalInvoiceId: null,
          businessDate,
          fiscalYear,
          customerId: guest?.id ?? null,
          customerName: options.customer?.name ?? guest?.name ?? null,
          customerTaxId: taxId,
          placeOfSupply: branch.stateCode,
          bill: {
            ...rest,
            lines: lines.map((l) => ({ ...l, id: this.d.ids.next(), originalLineId: null })),
          },
          approvedBy: ctx.approverId ?? null,
          createdAt: now,
          createdBy: ctx.actorId!,
        });
        this.d.invoices.insert(invoice);
        return invoice;
      });
      if (coupon) this.d.coupons.markUsed(coupon.id, now);
      const allFree = invoices.every((i) => i.isSettled);
      if (allFree) {
        order.markPaid(now);
        if (guest) this.d.customers.recordVisit(guest.id, 0, now);
      }
      this.d.orders.save(order);
      this.setTable(scope, ctx.branchId, order, allFree ? 'CLEANING' : 'BILLING', now);
      scope.audit({
        action: 'billing.invoice.issue',
        entityType: 'Order',
        entityId: order.id,
        after: {
          invoices: invoices.map((i) => ({
            id: i.id,
            invoiceNo: i.state.invoiceNo,
            grandTotal: i.state.bill.grandTotal,
          })),
          discounts: computed.flatMap((c) => c.discounts),
        },
        reason: options.complimentary?.reason ?? options.discount?.reason ?? null,
      });
      scope.recordEvents([...order.pullEvents(), ...invoices.flatMap((i) => i.pullEvents())]);
      return invoices;
    });
  }

  /** Split payment = several entries. When the order's bills are all settled it is PAID and the table needs cleaning. */
  pay(
    invoiceId: string,
    payments: readonly PaymentInput[],
    ctx: CommandContext,
    rights: BillingRights,
  ): Invoice {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const invoice = this.loadInvoice(ctx.branchId, invoiceId);
      const shift = this.d.shifts.openFor(ctx.branchId, ctx.deviceId ?? null, ctx.actorId!);
      if (payments.some((p) => p.method === 'CASH') && !shift) {
        throw new DomainError(
          'SHIFT_NOT_OPEN',
          'open a cash shift on this counter before taking cash',
        );
      }
      if (payments.some((p) => p.method === 'CREDIT')) {
        if (!rights.creditSale)
          throw approvalRequired('billing.credit_sale', 'a manager must approve a credit sale');
        if (!invoice.state.customerName) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'put the customer’s name on the bill for a credit sale',
          );
        }
      }
      for (const p of payments) {
        if (p.method !== 'LOYALTY') continue;
        this.d.loyalty.redeemIn(scope, ctx, {
          customerId: invoice.state.customerId,
          invoiceId: invoice.id,
          amount: p.amount,
        });
      }
      invoice.pay(
        payments.map((p) => ({
          id: this.d.ids.next(),
          method: p.method,
          amount: p.amount,
          tendered: p.method === 'CASH' ? (p.tendered ?? p.amount) : null,
          changeDue: p.method === 'CASH' ? (p.tendered ?? p.amount) - p.amount : null,
          reference: p.reference ?? null,
          cardLast4: p.cardLast4 ?? null,
          terminalLabel: p.terminalLabel ?? null,
          shiftId: shift?.id ?? null,
          createdBy: ctx.actorId!,
        })),
        now,
      );
      this.d.invoices.save(invoice);
      const order = this.loadOrder(ctx.branchId, invoice.state.orderId);
      if (
        invoice.isSettled &&
        this.d.invoices
          .forOrder(order.id)
          .every((i) => i.isSettled || i.state.status === 'CANCELLED')
      ) {
        order.markPaid(now);
        this.d.orders.save(order);
        this.setTable(scope, ctx.branchId, order, 'CLEANING', now);
        this.recordVisit(scope, ctx, order.id, now);
      }
      scope.audit({
        action: 'billing.payment.record',
        entityType: 'Invoice',
        entityId: invoice.id,
        after: {
          payments: payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            reference: p.reference ?? null,
          })),
          status: invoice.state.status,
        },
      });
      scope.recordEvents([...invoice.pullEvents(), ...order.pullEvents()]);
      return invoice;
    });
  }

  /**
   * Cancels this invoice and any issued with it (the INV/LIQ pair). Unpaid:
   * the order reopens. Paid in the current shift: each payment is reversed the
   * same way. Older payments need a refund (credit note) instead.
   */
  cancel(
    invoiceId: string,
    input: { version: number; reason: string },
    ctx: CommandContext,
  ): Invoice {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const target = this.loadInvoice(ctx.branchId, invoiceId);
      if (target.version !== input.version) throw conflict('invoice');
      const shift = this.d.shifts.openFor(ctx.branchId, ctx.deviceId ?? null, ctx.actorId!);
      const siblings = this.d.invoices
        .forOrder(target.state.orderId)
        .filter(
          (i) =>
            i.state.status !== 'CANCELLED' &&
            i.state.createdAt.getTime() === target.state.createdAt.getTime(),
        );
      for (const invoice of siblings) {
        const taken = this.d.invoices.paymentsOf(invoice.id);
        if (taken.some((p) => p.shiftId === null || p.shiftId !== shift?.id)) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'payments from an earlier shift are returned with a refund, not a cancellation',
          );
        }
        invoice.cancel(
          {
            reason: input.reason,
            by: ctx.actorId,
            approvedBy: ctx.approverId ?? null,
            refunds: taken.map((p) => ({
              ...p,
              id: this.d.ids.next(),
              amount: -p.amount,
              tendered: null,
              changeDue: null,
              refundOfPaymentId: p.id,
              createdBy: ctx.actorId!,
            })),
          },
          now,
        );
        this.d.invoices.save(invoice);
      }
      // Points spent on these bills come back; points they earned go.
      this.d.loyalty.reverseIn(
        scope,
        ctx,
        siblings.map((i) => i.id),
      );
      const order = this.loadOrder(ctx.branchId, target.state.orderId);
      order.reopen(now);
      this.d.orders.save(order);
      this.setTable(scope, ctx.branchId, order, 'OCCUPIED', now);
      scope.audit({
        action: 'billing.invoice.cancel',
        entityType: 'Invoice',
        entityId: target.id,
        after: { invoices: siblings.map((i) => i.state.invoiceNo) },
        reason: input.reason,
      });
      scope.recordEvents([...siblings.flatMap((i) => i.pullEvents()), ...order.pullEvents()]);
      return siblings.find((i) => i.id === target.id) ?? target;
    });
  }

  /** A credit note for some lines or a flat amount, paid out at once (docs/07 §7.5). */
  refund(
    invoiceId: string,
    input: {
      lines?: readonly { invoiceLineId: string; quantity: number }[] | undefined;
      amount?: number | undefined;
      method: Exclude<PaymentMethod, 'CREDIT' | 'AGGREGATOR'>;
      reference?: string | undefined;
      reason: string;
    },
    ctx: CommandContext,
  ): { creditNote: Invoice; invoice: Invoice } {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const original = this.loadInvoice(ctx.branchId, invoiceId);
      if (original.state.kind !== 'INVOICE')
        throw new DomainError('VALIDATION_FAILED', 'refund the original invoice');
      const shift = this.d.shifts.openFor(ctx.branchId, ctx.deviceId ?? null, ctx.actorId!);
      if (input.method === 'CASH' && !shift) {
        throw new DomainError(
          'SHIFT_NOT_OPEN',
          'open a cash shift on this counter to pay out cash',
        );
      }
      const refundable = original.state.paidTotal - original.state.refundedTotal;
      const so = this.d.invoices.refundedSoFar(original.id);
      const bill = input.lines
        ? creditNoteForLines(
            original.state.bill,
            input.lines.map((l) => ({ lineId: l.invoiceLineId, quantity: l.quantity })),
            so.quantities,
            so.anyAmountRefunds,
          )
        : creditNoteForAmount(original.state.bill, input.amount!, refundable);
      if (bill.grandTotal > refundable) {
        throw new DomainError('VALIDATION_FAILED', 'refunds can not exceed what was paid');
      }
      const businessDate = this.d.calendar.businessDate(ctx.branchId, now);
      const fiscalYear = BusinessDate.parse(businessDate).fiscalYear();
      const branch = this.branch(ctx.branchId);
      const creditNote = Invoice.issue(this.d.ids.next(), {
        ...original.state,
        invoiceNo: this.d.invoices.nextNumber(ctx.branchId, 'CN', fiscalYear, branch.code),
        kind: 'CREDIT_NOTE',
        series: 'CN',
        originalInvoiceId: original.id,
        businessDate,
        fiscalYear,
        bill: {
          ...bill,
          discounts: [],
          lines: bill.lines.map((l) => ({ ...l, id: this.d.ids.next() })),
        },
        approvedBy: ctx.approverId ?? null,
        createdAt: now,
        createdBy: ctx.actorId!,
      });
      creditNote.settleRefund(
        {
          id: this.d.ids.next(),
          method: input.method,
          amount: -bill.grandTotal,
          tendered: null,
          changeDue: null,
          reference: input.reference ?? null,
          cardLast4: null,
          terminalLabel: null,
          refundOfPaymentId: null,
          shiftId: shift?.id ?? null,
          createdBy: ctx.actorId!,
        },
        now,
      );
      original.recordRefund(bill.grandTotal, creditNote.id, now);
      if (original.state.customerId)
        this.d.customers.addLifetimeValue(original.state.customerId, -bill.grandTotal);
      this.d.invoices.insert(creditNote);
      this.d.invoices.save(original);
      scope.audit({
        action: 'billing.refund',
        entityType: 'Invoice',
        entityId: original.id,
        after: {
          creditNoteNo: creditNote.state.invoiceNo,
          amount: bill.grandTotal,
          method: input.method,
        },
        reason: input.reason,
      });
      scope.recordEvents([...creditNote.pullEvents(), ...original.pullEvents()]);
      return { creditNote, invoice: original };
    });
  }

  // ---- helpers -------------------------------------------------------------------------------
  private billInput(
    order: Order,
    options: BillOptions,
    branch: BranchSettingsRecord,
    rights: BillingRights | null,
  ): { input: BillInput; coupon: CouponRecord | null } {
    const groups = new Map<string, TaxGroupSpec | null>();
    const groupOf = (id: string | null): TaxGroupSpec | null => {
      const key = id ?? this.d.defaultTaxGroupId();
      if (!key) return null;
      if (!groups.has(key)) {
        const g = this.d.settings.taxGroup(key);
        groups.set(
          key,
          g
            ? {
                id: g.id,
                taxType: g.taxType,
                isInclusive: g.isInclusive,
                invoiceSeries: g.invoiceSeries,
                components: g.components,
              }
            : null,
        );
      }
      return groups.get(key)!;
    };
    const lines = order.lines
      .filter((l) => l.status !== 'CANCELLED')
      .map((l) => {
        const item = this.d.catalog.item(order.state.branchId, l.menuItemId);
        const parts = [
          l.variantName ? `${l.name} (${l.variantName})` : l.name,
          ...l.addons.map((a) => `+ ${a.name}`),
        ];
        return {
          orderItemId: l.id,
          description: parts.join(' '),
          hsnSacCode: item?.hsnSacCode ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice + l.addons.reduce((s, a) => s + a.price * a.quantity, 0),
          taxGroup: groupOf(l.taxGroupId),
        };
      });
    const gross = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

    const charges = this.d.settings
      .chargeRules(order.state.branchId)
      .filter((c) => c.isActive && c.orderTypes.includes(order.state.orderType))
      .filter((c) => {
        if (!options.removeChargeRuleIds.includes(c.id)) return true;
        if (!c.isOptional) throw new DomainError('VALIDATION_FAILED', `${c.name} can't be removed`);
        return false;
      })
      .map((c) => ({
        chargeRuleId: c.id,
        name: c.name,
        kind: c.kind,
        value: c.value,
        taxGroup: groupOf(c.taxGroupId),
      }));

    const discounts: DiscountInput[] = [];
    if (options.discount) {
      const d = options.discount;
      const overLimit =
        d.kind === 'PERCENT'
          ? d.value > branch.discountLimitBp
          : d.value * 10_000 > gross * branch.discountLimitBp;
      if (rights && (!rights.discount || overLimit) && !rights.discountOverride) {
        throw approvalRequired(
          'billing.discount_override',
          'this discount needs a manager’s approval',
        );
      }
      if (d.kind === 'PERCENT' && d.value > 10_000)
        throw new DomainError('VALIDATION_FAILED', 'a discount can’t exceed 100%');
      discounts.push({
        kind: d.kind,
        value: d.value,
        valueIsPercent: d.kind === 'PERCENT',
        cap: null,
        couponCode: null,
        reason: d.reason ?? null,
      });
    }
    let coupon: CouponRecord | null = null;
    if (options.couponCode) {
      coupon = this.validCoupon(options.couponCode, gross);
      discounts.push({
        kind: 'COUPON',
        value: coupon.value,
        valueIsPercent: coupon.kind === 'PERCENT',
        cap: coupon.maxDiscount,
        couponCode: coupon.code,
        reason: null,
      });
    }
    if (options.complimentary) {
      if (rights && !rights.complimentary)
        throw approvalRequired(
          'billing.complimentary',
          'a complimentary bill needs a manager’s approval',
        );
      discounts.push({
        kind: 'COMPLIMENTARY',
        value: 0,
        valueIsPercent: false,
        cap: null,
        couponCode: null,
        reason: options.complimentary.reason,
      });
    }
    return {
      input: {
        lines,
        charges,
        discounts,
        // Restaurant service is supplied where the restaurant is (IGST Act s.12(3)), so always intra-state.
        supply: 'INTRA_STATE',
        gstPaidByOperator: order.state.salesChannelId
          ? (this.d.channels.get(order.state.salesChannelId)?.gstPaidByOperator ?? false)
          : false,
        cashRounding: branch.cashRounding,
        separateLiquor: branch.liquorInvoice === 'SEPARATE',
      },
      coupon,
    };
  }

  private validCoupon(code: string, gross: number): CouponRecord {
    const coupon = this.d.coupons.byCode(code.trim().toUpperCase());
    const today = this.d.clock.now().toISOString().slice(0, 10);
    const why =
      !coupon || !coupon.isActive
        ? 'no such coupon'
        : coupon.validFrom && today < coupon.validFrom
          ? 'this coupon is not valid yet'
          : coupon.validTo && today > coupon.validTo
            ? 'this coupon has expired'
            : coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit
              ? 'this coupon has been used up'
              : gross < coupon.minBill
                ? 'the bill is below this coupon’s minimum'
                : null;
    if (why) throw new DomainError('COUPON_INVALID', why);
    return coupon!;
  }

  private setTable(
    scope: TransactionScope,
    branchId: string,
    order: Order,
    status: 'BILLING' | 'CLEANING' | 'OCCUPIED',
    now: Date,
  ) {
    const tableId = order.state.tableId;
    if (!tableId) return;
    const table = this.d.floor.table(branchId, tableId);
    if (!table) return;
    if (status === 'OCCUPIED' && table.currentOrderId !== null && table.currentOrderId !== order.id)
      return;
    const next = {
      ...table,
      status,
      currentOrderId: status === 'CLEANING' ? null : order.id,
      version: table.version + 1,
    };
    this.d.floor.updateTable(branchId, next, now);
    scope.recordEvents([
      recordChanged(
        'TableStatusChanged',
        'DiningTable',
        table.id,
        next.version,
        { from: table.status, to: status, orderId: next.currentOrderId },
        now,
      ),
    ]);
  }

  /**
   * One visit per paid order for its guest, worth what the order's bills came
   * to, and loyalty points on what they paid (not with points, not via an
   * aggregator).
   */
  private recordVisit(
    scope: TransactionScope,
    ctx: CommandContext,
    orderId: string,
    now: Date,
  ): void {
    const invoices = this.d.invoices.forOrder(orderId).filter((i) => i.isSettled);
    const first = invoices.find((i) => i.state.customerId);
    const customerId = first?.state.customerId;
    if (!first || !customerId) return;
    this.d.customers.recordVisit(
      customerId,
      invoices.reduce((s, i) => s + i.state.bill.grandTotal, 0),
      now,
    );
    const paid = invoices
      .flatMap((i) => this.d.invoices.paymentsOf(i.id))
      .filter((p) => p.method !== 'LOYALTY' && p.method !== 'AGGREGATOR')
      .reduce((s, p) => s + p.amount, 0);
    this.d.loyalty.earnIn(scope, ctx, { customerId, invoiceId: first.id, paid });
  }

  private branch(branchId: string): BranchSettingsRecord {
    const branch = this.d.settings.branch(branchId);
    if (!branch) throw new DomainError('NOT_FOUND', 'branch not found');
    return branch;
  }

  private loadOrder(branchId: string, id: string): Order {
    const order = this.d.orders.get(branchId, id);
    if (!order) throw new DomainError('NOT_FOUND', 'order not found');
    return order;
  }

  private loadInvoice(branchId: string, id: string): Invoice {
    const invoice = this.d.invoices.get(branchId, id);
    if (!invoice) throw new DomainError('NOT_FOUND', 'invoice not found');
    return invoice;
  }
}

function conflict(what: string) {
  return new DomainError(
    'VERSION_CONFLICT',
    `this ${what} was changed by someone else; reload and try again`,
  );
}

function approvalRequired(permission: string, message: string) {
  return new DomainError('APPROVAL_REQUIRED', message, { permission });
}

export type { NewPayment };
