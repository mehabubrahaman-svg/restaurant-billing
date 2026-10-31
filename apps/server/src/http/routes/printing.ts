import {
  DevicePrintResultRequestSchema,
  PrintRequestSchema,
  type DevicePrintJobsResponse,
  type PrintDocument,
  type PrintOutcome,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';
import { mayElevate } from '../elevation';
import { HttpProblem } from '../problem';

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
    async (request) => {
      const data = await printing.printKot(
        IdParams.parse(request.params).id,
        request.principal!.branchId,
        true,
      );
      // Firing prints quietly when no KOT printer is set up; asking to reprint says so.
      if (data.length === 0) {
        throw new DomainError('NO_PRINTER', 'no KOT printer is set up for this station');
      }
      return { data };
    },
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

  // ---- Bluetooth printers attached to a tablet (apps/android) --------------------------------
  // The tablet's app asks with its device token (cookie or X-Device-Token), signed in or not:
  // a kitchen tablet keeps printing KOTs between cooks' sign-ins.
  const thisDevice = (request: FastifyRequest) => {
    if (!request.device) {
      throw new HttpProblem('DEVICE_NOT_PAIRED', 'pair this device with the Hub to print here');
    }
    return request.device;
  };

  app.get(
    '/devices/me/print-jobs',
    { config: { public: true } },
    async (request): Promise<DevicePrintJobsResponse> => {
      const device = thisDevice(request);
      return { data: printing.deviceJobs(device.id, device.branchId) };
    },
  );

  app.post(
    '/devices/me/print-jobs/:id/result',
    { config: { public: true } },
    async (request, reply) => {
      const device = thisDevice(request);
      const { id } = IdParams.parse(request.params);
      const result = DevicePrintResultRequestSchema.parse(request.body);
      printing.finishDeviceJob(device.id, id, {
        ok: result.ok,
        ...(result.error !== undefined && { error: result.error }),
      });
      return reply.status(204).send();
    },
  );
}
