import {
  CancelGrnRequestSchema,
  CancelPurchaseOrderRequestSchema,
  GrnStatusSchema,
  PostGrnRequestSchema,
  PurchaseOrderActionRequestSchema,
  PurchaseOrderStatusSchema,
  RecordVendorPaymentRequestSchema,
  SaveGrnRequestSchema,
  SavePurchaseOrderRequestSchema,
  SaveVendorRequestSchema,
  UpdateGrnRequestSchema,
  UpdatePurchaseOrderRequestSchema,
  UpdateVendorRequestSchema,
  type Grn,
  type PurchaseOrder,
  type Vendor,
  type VendorDuesReport,
  type VendorsResponse,
  type VendorStatement,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const VendorsQuery = z.object({ includeRetired: z.enum(['true', 'false']).default('false') });
const PoQuery = z.object({
  status: PurchaseOrderStatusSchema.optional(),
  vendorId: z.uuid().optional(),
});
const GrnQuery = z.object({
  status: GrnStatusSchema.optional(),
  vendorId: z.uuid().optional(),
  purchaseOrderId: z.uuid().optional(),
});
const PaymentsQuery = z.object({
  vendorId: z.uuid().optional(),
  from: DateString.optional(),
  to: DateString.optional(),
});
const RangeQuery = z.object({ from: DateString, to: DateString });
const AsOfQuery = z.object({ asOf: DateString.optional() });
const MAX_RANGE_DAYS = 366;

const VIEW = { permission: ['vendors.view', 'po.create', 'po.approve', 'grn.post'] } as const;
const MANAGE_VENDORS = { permission: 'vendors.manage' } as const;
const PO = { permission: 'po.create' } as const;
const APPROVE = { permission: 'po.approve' } as const;
const GRN = { permission: 'grn.post' } as const;
const PAY = { permission: 'vendor_payments.create' } as const;

/** Phase 3 (docs/05 §3): vendors, purchase orders, GRNs, vendor payments, statements, dues. */
export async function purchasingRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { purchasingService: purchasing } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;
  const idOf = (r: FastifyRequest) => IdParams.parse(r.params).id;
  const created = <T>(reply: { status(code: number): unknown }, value: T): T => {
    reply.status(201);
    return value;
  };

  // ---- vendors --------------------------------------------------------------------
  app.get('/vendors', { config: VIEW }, async (request): Promise<VendorsResponse> => {
    const { includeRetired } = VendorsQuery.parse(request.query);
    return { data: purchasing.vendors(branchOf(request), includeRetired === 'true') };
  });

  app.get('/vendors/:id', { config: VIEW }, async (request): Promise<Vendor> =>
    purchasing.vendor(branchOf(request), idOf(request)),
  );

  app.post('/vendors', { config: MANAGE_VENDORS }, async (request, reply): Promise<Vendor> =>
    created(
      reply,
      purchasing.createVendor(SaveVendorRequestSchema.parse(request.body), commandContext(request)),
    ),
  );

  app.patch('/vendors/:id', { config: MANAGE_VENDORS }, async (request): Promise<Vendor> =>
    purchasing.updateVendor(
      idOf(request),
      UpdateVendorRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  app.get(
    '/vendors/:id/statement',
    { config: { permission: ['vendors.view', 'vendor_payments.create'] } },
    async (request): Promise<VendorStatement> => {
      const { from, to } = RangeQuery.parse(request.query);
      assertRange(from, to);
      return purchasing.statement(branchOf(request), idOf(request), from, to);
    },
  );

  // ---- purchase orders ----------------------------------------------------------------
  app.get('/purchase-orders', { config: VIEW }, async (request) => ({
    data: purchasing.purchaseOrders(branchOf(request), PoQuery.parse(request.query)),
  }));

  app.get('/purchase-orders/:id', { config: VIEW }, async (request): Promise<PurchaseOrder> =>
    purchasing.purchaseOrder(branchOf(request), idOf(request)),
  );

  app.post('/purchase-orders', { config: PO }, async (request, reply): Promise<PurchaseOrder> =>
    created(
      reply,
      purchasing.createPurchaseOrder(
        SavePurchaseOrderRequestSchema.parse(request.body),
        commandContext(request),
      ),
    ),
  );

  app.patch('/purchase-orders/:id', { config: PO }, async (request): Promise<PurchaseOrder> =>
    purchasing.updatePurchaseOrder(
      idOf(request),
      UpdatePurchaseOrderRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  app.post(
    '/purchase-orders/:id/approve',
    { config: APPROVE },
    async (request): Promise<PurchaseOrder> =>
      purchasing.approvePurchaseOrder(
        idOf(request),
        PurchaseOrderActionRequestSchema.parse(request.body),
        commandContext(request),
      ),
  );

  app.post('/purchase-orders/:id/send', { config: PO }, async (request): Promise<PurchaseOrder> =>
    purchasing.sendPurchaseOrder(
      idOf(request),
      PurchaseOrderActionRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  app.post('/purchase-orders/:id/cancel', { config: PO }, async (request): Promise<PurchaseOrder> =>
    purchasing.cancelPurchaseOrder(
      idOf(request),
      CancelPurchaseOrderRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  app.post('/purchase-orders/:id/close', { config: PO }, async (request): Promise<PurchaseOrder> =>
    purchasing.closePurchaseOrder(
      idOf(request),
      PurchaseOrderActionRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  // ---- goods received notes ---------------------------------------------------------------
  app.get('/grns', { config: VIEW }, async (request) => ({
    data: purchasing.grns(branchOf(request), GrnQuery.parse(request.query)),
  }));

  app.get('/grns/:id', { config: VIEW }, async (request): Promise<Grn> =>
    purchasing.grn(branchOf(request), idOf(request)),
  );

  app.post('/grns', { config: GRN }, async (request, reply): Promise<Grn> =>
    created(
      reply,
      purchasing.createGrn(SaveGrnRequestSchema.parse(request.body), commandContext(request)),
    ),
  );

  app.patch('/grns/:id', { config: GRN }, async (request): Promise<Grn> =>
    purchasing.updateGrn(
      idOf(request),
      UpdateGrnRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  app.post('/grns/:id/post', { config: GRN }, async (request): Promise<Grn> =>
    purchasing.postGrn(
      idOf(request),
      PostGrnRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  app.post('/grns/:id/cancel', { config: GRN }, async (request): Promise<Grn> =>
    purchasing.cancelGrn(
      idOf(request),
      CancelGrnRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  // ---- vendor payments ----------------------------------------------------------------------
  app.get(
    '/vendor-payments',
    { config: { permission: ['vendors.view', 'vendor_payments.create'] } },
    async (request) => ({
      data: purchasing.payments(branchOf(request), PaymentsQuery.parse(request.query)),
    }),
  );

  app.post('/vendor-payments', { config: PAY }, async (request, reply) =>
    created(
      reply,
      purchasing.recordPayment(
        RecordVendorPaymentRequestSchema.parse(request.body),
        commandContext(request),
      ),
    ),
  );

  app.get(
    '/reports/vendor-dues',
    { config: { permission: ['vendors.view', 'reports.financial'] } },
    async (request): Promise<VendorDuesReport> =>
      purchasing.dues(branchOf(request), AsOfQuery.parse(request.query).asOf),
  );
}

function assertRange(from: string, to: string): void {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0 || days >= MAX_RANGE_DAYS) {
    throw new DomainError('VALIDATION_FAILED', `the range must be 1 to ${MAX_RANGE_DAYS} days`);
  }
}
