import type { BillingRights } from '@restroos/application';
import {
  BillRequestSchema,
  CancelInvoiceRequestSchema,
  CloseShiftRequestSchema,
  InvoiceStatusSchema,
  OpenShiftRequestSchema,
  RecordPaymentsRequestSchema,
  RefundRequestSchema,
  SaveCouponRequestSchema,
  UpdateCouponRequestSchema,
  type BillPreviewResponse,
  type BillResponse,
  type Invoice,
  type InvoicesResponse,
  type ShiftReport,
} from '@restroos/contracts';
import { DomainError, type ComputedInvoice } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';
import { mayElevate } from '../elevation';

const IdParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: InvoiceStatusSchema.optional(),
});
const BILL = { permission: 'billing.create' } as const;
const SHIFT = { permission: 'cash.shift_manage' } as const;

/** Drafts for the bill panel: the computed invoice without ids or payments. */
function toDraft(c: ComputedInvoice): BillPreviewResponse['invoices'][number] {
  return {
    series: c.series,
    lines: c.lines.map((l) => ({
      orderItemId: l.orderItemId,
      description: l.description,
      hsnSacCode: l.hsnSacCode,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      taxableValue: l.taxableValue,
      taxRateBp: l.taxRateBp,
      taxAmount: l.taxAmount,
      lineTotal: l.lineTotal,
    })),
    taxes: c.taxes.map((t) => ({ ...t })),
    discounts: c.discounts.map((d) => ({ ...d })),
    charges: c.charges.map((ch) => ({
      chargeRuleId: ch.chargeRuleId,
      name: ch.name,
      amount: ch.amount,
      taxAmount: ch.taxAmount,
    })),
    subtotal: c.subtotal,
    discountTotal: c.discountTotal,
    chargesTotal: c.chargesTotal,
    taxableTotal: c.taxableTotal,
    taxTotal: c.taxTotal,
    roundOff: c.roundOff,
    grandTotal: c.grandTotal,
  };
}

/** WP 5.1–5.4: bills, payments, cancellations, refunds and cash shifts (docs/05 §2 Billing). */
export async function billingRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const {
    couponService: coupons,
    billingService: billing,
    shiftService: shifts,
    billingQueries: queries,
    authService,
    calendar,
    clock,
  } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;
  const view = (r: FastifyRequest, id: string): Invoice => {
    const invoice = queries.invoice(branchOf(r), id);
    if (!invoice) throw new DomainError('NOT_FOUND', 'invoice not found');
    return invoice;
  };
  const rights = async (r: FastifyRequest): Promise<BillingRights> => ({
    discount: r.principal!.permissions.has('billing.discount'),
    discountOverride: await mayElevate(r, authService, 'billing.discount_override'),
    complimentary: await mayElevate(r, authService, 'billing.complimentary'),
    creditSale: await mayElevate(r, authService, 'billing.credit_sale'),
  });
  const report = (r: FastifyRequest, id: string): ShiftReport => {
    const shift = queries.shiftReport(branchOf(r), id);
    if (!shift) throw new DomainError('NOT_FOUND', 'shift not found');
    return shift;
  };

  // ---- billing an order ------------------------------------------------------------------
  app.post(
    '/orders/:id/bill-preview',
    { config: BILL },
    async (request): Promise<BillPreviewResponse> => {
      const { id } = IdParams.parse(request.params);
      const options = BillRequestSchema.parse(request.body ?? {});
      return { invoices: billing.preview(id, options, commandContext(request)).map(toDraft) };
    },
  );

  app.post(
    '/orders/:id/invoice',
    { config: BILL },
    async (request, reply): Promise<BillResponse> => {
      const { id } = IdParams.parse(request.params);
      const options = BillRequestSchema.parse(request.body ?? {});
      const granted = await rights(request);
      const invoices = billing.bill(id, options, commandContext(request), granted);
      reply.status(201);
      return { invoices: invoices.map((i) => view(request, i.id)) };
    },
  );

  app.get('/orders/:id/invoices', { config: BILL }, async (request) => ({
    data: queries.forOrder(branchOf(request), IdParams.parse(request.params).id),
  }));

  // ---- invoices ----------------------------------------------------------------------------
  app.get('/invoices', { config: BILL }, async (request): Promise<InvoicesResponse> => {
    const { date, status } = ListQuery.parse(request.query);
    const businessDate = date ?? calendar.businessDate(branchOf(request), clock.now());
    return { data: queries.list(branchOf(request), businessDate, status) };
  });

  app.get('/invoices/:id', { config: BILL }, async (request): Promise<Invoice> =>
    view(request, IdParams.parse(request.params).id),
  );

  app.get(
    '/invoices/:id/credit-notes',
    { config: BILL },
    async (request): Promise<{ data: Invoice[] }> => {
      const { id } = IdParams.parse(request.params);
      view(request, id); // 404 for an unknown invoice
      return { data: queries.creditNotes(branchOf(request), id) };
    },
  );

  app.post(
    '/invoices/:id/payments',
    { config: { permission: 'billing.collect_payment' } },
    async (request): Promise<Invoice> => {
      const { id } = IdParams.parse(request.params);
      const { payments } = RecordPaymentsRequestSchema.parse(request.body);
      const granted = await rights(request);
      billing.pay(id, payments, commandContext(request), granted);
      return view(request, id);
    },
  );

  app.post(
    '/invoices/:id/cancel',
    { config: { permission: 'billing.cancel', approvable: true } },
    async (request): Promise<Invoice> => {
      const { id } = IdParams.parse(request.params);
      billing.cancel(id, CancelInvoiceRequestSchema.parse(request.body), commandContext(request));
      return view(request, id);
    },
  );

  app.post(
    '/invoices/:id/refunds',
    { config: { permission: 'billing.refund', approvable: true } },
    async (request, reply) => {
      const { id } = IdParams.parse(request.params);
      const { creditNote, invoice } = billing.refund(
        id,
        RefundRequestSchema.parse(request.body),
        commandContext(request),
      );
      reply.status(201);
      return { creditNote: view(request, creditNote.id), invoice: view(request, invoice.id) };
    },
  );

  // ---- cash shifts ---------------------------------------------------------------------------
  app.post('/cash-shifts', { config: SHIFT }, async (request, reply): Promise<ShiftReport> => {
    const { openingFloat } = OpenShiftRequestSchema.parse(request.body);
    const shift = shifts.open(openingFloat, commandContext(request));
    reply.status(201);
    return report(request, shift.id);
  });

  app.get('/cash-shifts/current', { config: SHIFT }, async (request): Promise<ShiftReport> => {
    const shift = shifts.current(commandContext(request));
    if (!shift) throw new DomainError('NOT_FOUND', 'no shift is open on this counter');
    return report(request, shift.id);
  });

  app.get('/cash-shifts/:id', { config: SHIFT }, async (request): Promise<ShiftReport> =>
    report(request, IdParams.parse(request.params).id),
  );

  app.post('/cash-shifts/:id/close', { config: SHIFT }, async (request): Promise<ShiftReport> => {
    const { id } = IdParams.parse(request.params);
    shifts.close(id, CloseShiftRequestSchema.parse(request.body), commandContext(request));
    return report(request, id);
  });

  // ---- coupons -------------------------------------------------------------------------------
  const MANAGE = { permission: 'settings.manage' } as const;
  app.get('/coupons', { config: MANAGE }, async () => ({ data: coupons.list() }));
  app.post('/coupons', { config: MANAGE }, async (request, reply) => {
    const coupon = coupons.create(
      SaveCouponRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return coupon;
  });
  app.patch('/coupons/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return coupons.update(
      id,
      UpdateCouponRequestSchema.parse(request.body),
      commandContext(request),
    );
  });
}
