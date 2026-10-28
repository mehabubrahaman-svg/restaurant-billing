import {
  AssignChefRequestSchema,
  SetKotStatusRequestSchema,
  type ChefsResponse,
  type KitchenMetrics,
  type Kot,
  type KotsResponse,
  type TokenBoard,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const ItemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const BoardQuery = z.object({ station: z.uuid().optional() });
const VIEW = { permission: 'kds.view' } as const;
const UPDATE = { permission: 'kds.update_status' } as const;

/** WP 4.2: the kitchen display (docs/05 §2 Kitchen) and the token display. */
export async function kitchenRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { kitchenService: kitchen, kitchenQueries, calendar, clock } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;
  const view = (r: FastifyRequest, id: string): Kot => {
    const kot = kitchenQueries.kot(branchOf(r), id);
    if (!kot) throw new DomainError('NOT_FOUND', 'KOT not found');
    return kot;
  };

  app.get('/kitchen/kots', { config: VIEW }, async (request): Promise<KotsResponse> => {
    const { station } = BoardQuery.parse(request.query);
    return { data: kitchenQueries.active(branchOf(request), station) };
  });

  // Captains (orders.update) may mark food served; everything else is the kitchen's.
  app.post(
    '/kitchen/kots/:id/status',
    { config: { permission: ['kds.update_status', 'orders.update'] } },
    async (request): Promise<Kot> => {
      const { id } = IdParams.parse(request.params);
      const body = SetKotStatusRequestSchema.parse(request.body);
      const servedOnly = !request.principal!.permissions.has('kds.update_status');
      kitchen.setStatus(id, body, commandContext(request), { servedOnly });
      return view(request, id);
    },
  );

  app.post(
    '/kitchen/kots/:id/items/:itemId/ready',
    { config: UPDATE },
    async (request): Promise<Kot> => {
      const { id, itemId } = ItemParams.parse(request.params);
      kitchen.bumpItem(id, itemId, commandContext(request));
      return view(request, id);
    },
  );

  app.post(
    '/kitchen/kots/:id/assign',
    { config: { permission: 'kds.assign_chef' } },
    async (request): Promise<Kot> => {
      const { id } = IdParams.parse(request.params);
      kitchen.assignChef(id, AssignChefRequestSchema.parse(request.body), commandContext(request));
      return view(request, id);
    },
  );

  app.get('/kitchen/chefs', { config: VIEW }, async (request): Promise<ChefsResponse> => ({
    data: kitchenQueries.chefs(branchOf(request)),
  }));

  app.get('/kitchen/metrics', { config: VIEW }, async (request): Promise<KitchenMetrics> => {
    const now = clock.now();
    return kitchenQueries.metrics(
      branchOf(request),
      calendar.businessDate(branchOf(request), now),
      now,
    );
  });

  // The token display TV: public, the numbers are on show in the restaurant anyway.
  app.get('/tokens', { config: { public: true } }, async (request): Promise<TokenBoard> => {
    const branchId =
      request.device?.branchId ??
      cradle.db
        .prepare<[], string>('SELECT id FROM branches ORDER BY created_at LIMIT 1')
        .pluck()
        .get();
    if (!branchId) throw new DomainError('NOT_FOUND', 'this Hub is not set up yet');
    const businessDate = calendar.businessDate(branchId, clock.now());
    return { businessDate, ...kitchenQueries.tokenBoard(branchId, businessDate) };
  });
}
