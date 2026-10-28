import { PrintRequestSchema, type PrintDocument, type PrintOutcome } from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';
import { mayElevate } from '../elevation';

const IdParams = z.object({ id: z.uuid() });

/** WP 5.5: bills, KOTs and shift reports on thermal printers. */
export async function printingRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { printService: printing, authService } = cradle;

  // The first print is the original; reprints say DUPLICATE and need billing.reprint (or approval).
  app.post(
    '/invoices/:id/print',
    { config: { permission: 'billing.create' } },
    async (request): Promise<PrintOutcome> => {
      const { id } = IdParams.parse(request.params);
      const { printerId } = PrintRequestSchema.parse(request.body ?? {});
      const mayReprint = await mayElevate(request, authService, 'billing.reprint');
      return printing.printInvoice(id, { printerId, mayReprint }, commandContext(request));
    },
  );

  /** The bill as a slip, for an on-screen preview or a browser print when there's no thermal printer. */
  app.get(
    '/invoices/:id/receipt',
    { config: { permission: 'billing.create' } },
    async (request): Promise<PrintDocument> => {
      const { id } = IdParams.parse(request.params);
      const doc = printing.invoicePreview(id, request.principal!.branchId);
      return { blocks: [...doc.blocks], cut: doc.cut };
    },
  );

  app.post(
    '/kitchen/kots/:id/reprint',
    { config: { permission: ['kds.view', 'orders.fire_kot'] } },
    async (request) => ({
      data: await printing.printKot(
        IdParams.parse(request.params).id,
        request.principal!.branchId,
        true,
      ),
    }),
  );

  app.post(
    '/cash-shifts/:id/print',
    { config: { permission: 'cash.shift_manage' } },
    async (request): Promise<PrintOutcome> => {
      const { id } = IdParams.parse(request.params);
      const { printerId } = PrintRequestSchema.parse(request.body ?? {});
      return printing.printShift(id, { printerId }, commandContext(request));
    },
  );
}
