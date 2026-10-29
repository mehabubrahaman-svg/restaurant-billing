import type { QrRequestRecord } from '@restroos/application';
import {
  AcceptQrRequestSchema,
  RejectQrRequestSchema,
  SubmitQrRequestSchema,
  type FireKotsResponse,
  type QrMenu,
  type QrRequestStatusResponse,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { clientInfo, commandContext } from '../context';

const TokenParams = z.object({ token: z.string().min(8).max(64) });
const RequestParams = TokenParams.extend({ id: z.uuid() });
const IdParams = z.object({ id: z.uuid() });
/** Guests' phones: a few tables' worth per address, well below the staff limit. */
const GUEST_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const ANSWER = { permission: ['orders.create', 'orders.update'] } as const;

const guestView = (r: QrRequestRecord): QrRequestStatusResponse => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  items: r.items,
  rejectReason: r.rejectReason,
  createdAt: r.createdAt,
});

/** QR self-ordering (Phase 5): guests order from the table's code; captains answer. */
export async function qrRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { qrOrderingService: qr, orderQueries } = cradle;

  // ---- public: the guest's phone -----------------------------------------------------
  app.get(
    '/public/qr/:token/menu',
    { config: { public: true, ...GUEST_LIMIT } },
    async (request): Promise<QrMenu> => qr.menu(TokenParams.parse(request.params).token),
  );
  app.post(
    '/public/qr/:token/requests',
    { config: { public: true, ...GUEST_LIMIT } },
    async (request, reply): Promise<QrRequestStatusResponse> => {
      const { token } = TokenParams.parse(request.params);
      const body = SubmitQrRequestSchema.parse(request.body);
      const client = clientInfo(request);
      const saved = qr.submit(token, body, {
        ipAddress: client.ipAddress,
        correlationId: client.correlationId,
      });
      reply.status(201);
      return guestView(saved);
    },
  );
  app.get(
    '/public/qr/:token/requests/:id',
    { config: { public: true, ...GUEST_LIMIT } },
    async (request): Promise<QrRequestStatusResponse> => {
      const { token, id } = RequestParams.parse(request.params);
      return guestView(qr.status(token, id));
    },
  );

  // ---- staff: captains and the counter ---------------------------------------------
  app.get(
    '/qr-requests',
    { config: { permission: ['orders.create', 'orders.update', 'tables.view'] } },
    async (request) => ({
      data: qr.pending(request.principal!.branchId).map((r) => ({
        ...guestView(r),
        tableId: r.tableId,
        tableLabel: r.tableLabel,
        guestName: r.guestName,
        covers: r.covers,
        note: r.note,
        version: r.version,
      })),
    }),
  );
  /** Onto the table's order (opened if none), and to the kitchen unless `fire` is false. */
  app.post(
    '/qr-requests/:id/accept',
    { config: ANSWER },
    async (request): Promise<FireKotsResponse> => {
      const { id } = IdParams.parse(request.params);
      const { fire } = AcceptQrRequestSchema.parse(request.body ?? {});
      const { order, kots } = qr.accept(id, { fire }, commandContext(request));
      const current = orderQueries.order(request.principal!.branchId, order.id);
      if (!current) throw new DomainError('NOT_FOUND', 'order not found');
      const fired = new Set(kots.map((k) => k.id));
      return { order: current, kots: current.kots.filter((k) => fired.has(k.id)) };
    },
  );
  app.post('/qr-requests/:id/reject', { config: ANSWER }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { reason } = RejectQrRequestSchema.parse(request.body);
    return guestView(qr.reject(id, reason, commandContext(request)));
  });
  app.post('/qr-requests/:id/done', { config: ANSWER }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return guestView(qr.done(id, commandContext(request)));
  });
}
