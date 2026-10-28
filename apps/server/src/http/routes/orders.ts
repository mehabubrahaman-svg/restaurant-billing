import {
  AddOrderItemsRequestSchema,
  AggregatorOrderRequestSchema,
  SaveSalesChannelRequestSchema,
  UpdateSalesChannelRequestSchema,
  type SalesChannelsResponse,
  CancelOrderItemRequestSchema,
  CancelOrderRequestSchema,
  OpenOrderRequestSchema,
  OrderStatusSchema,
  TransferTableRequestSchema,
  UpdateOrderItemRequestSchema,
  UpdateOrderRequestSchema,
  type FireKotsResponse,
  type Order,
  type OrdersResponse,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';
import { mayElevate } from '../elevation';

const IdParams = z.object({ id: z.uuid() });
const ItemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const ListQuery = z.object({ status: OrderStatusSchema.default('OPEN') });
const READ = { permission: ['tables.view', 'billing.create', 'kds.view'] } as const;

/** WP 4.1: orders for captains and the billing counter (docs/05 §2 Orders). */
export async function orderRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { orderService: orders, orderQueries, authService } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;
  const view = (r: FastifyRequest, id: string): Order => {
    const order = orderQueries.order(branchOf(r), id);
    if (!order) throw new DomainError('NOT_FOUND', 'order not found');
    return order;
  };

  app.get('/orders', { config: READ }, async (request): Promise<OrdersResponse> => {
    const { status } = ListQuery.parse(request.query);
    return { data: orderQueries.summaries(branchOf(request), status) };
  });

  app.get('/orders/:id', { config: READ }, async (request): Promise<Order> => {
    return view(request, IdParams.parse(request.params).id);
  });

  app.post(
    '/orders',
    { config: { permission: 'orders.create' } },
    async (request, reply): Promise<Order> => {
      const body = OpenOrderRequestSchema.parse(request.body);
      const source = request.device?.kind === 'CAPTAIN' ? 'CAPTAIN' : 'POS';
      const order = orders.open({ ...body, source }, commandContext(request));
      reply.status(201);
      return view(request, order.id);
    },
  );

  // Swiggy / Zomato orders keyed in at the counter.
  app.post(
    '/orders/aggregator',
    { config: { permission: 'orders.create' } },
    async (request, reply): Promise<FireKotsResponse> => {
      const body = AggregatorOrderRequestSchema.parse(request.body);
      const { order, kots } = orders.openAggregator(body, commandContext(request));
      const current = view(request, order.id);
      const fired = new Set(kots.map((k) => k.id));
      reply.status(201);
      return { order: current, kots: current.kots.filter((k) => fired.has(k.id)) };
    },
  );

  app.get(
    '/sales-channels',
    { config: { permission: ['settings.manage', 'orders.create', 'billing.create'] } },
    async (): Promise<SalesChannelsResponse> => ({ data: cradle.salesChannelService.list() }),
  );
  app.post(
    '/sales-channels',
    { config: { permission: 'settings.manage' } },
    async (request, reply) => {
      const channel = cradle.salesChannelService.create(
        SaveSalesChannelRequestSchema.parse(request.body),
        commandContext(request),
      );
      reply.status(201);
      return channel;
    },
  );
  app.patch(
    '/sales-channels/:id',
    { config: { permission: 'settings.manage' } },
    async (request) => {
      const { id } = IdParams.parse(request.params);
      return cradle.salesChannelService.update(
        id,
        UpdateSalesChannelRequestSchema.parse(request.body),
        commandContext(request),
      );
    },
  );

  app.patch(
    '/orders/:id',
    { config: { permission: 'orders.update' } },
    async (request): Promise<Order> => {
      const { id } = IdParams.parse(request.params);
      orders.update(id, UpdateOrderRequestSchema.parse(request.body), commandContext(request));
      return view(request, id);
    },
  );

  app.post(
    '/orders/:id/items',
    { config: { permission: 'orders.create' } },
    async (request): Promise<Order> => {
      const { id } = IdParams.parse(request.params);
      const { items } = AddOrderItemsRequestSchema.parse(request.body);
      orders.addItems(id, items, commandContext(request));
      return view(request, id);
    },
  );

  app.patch(
    '/orders/:id/items/:itemId',
    { config: { permission: 'orders.update' } },
    async (request): Promise<Order> => {
      const { id, itemId } = ItemParams.parse(request.params);
      orders.updateItem(
        id,
        itemId,
        UpdateOrderItemRequestSchema.parse(request.body),
        commandContext(request),
      );
      return view(request, id);
    },
  );

  app.post(
    '/orders/:id/items/:itemId/cancel',
    { config: { permission: 'orders.update' } },
    async (request): Promise<Order> => {
      const { id, itemId } = ItemParams.parse(request.params);
      const body = CancelOrderItemRequestSchema.parse(request.body);
      const mayCancelSent = await mayElevate(request, authService, 'orders.item_cancel');
      orders.cancelItem(id, itemId, body, commandContext(request), { mayCancelSent });
      return view(request, id);
    },
  );

  app.post(
    '/orders/:id/kots',
    { config: { permission: 'orders.fire_kot' } },
    async (request, reply): Promise<FireKotsResponse> => {
      const { id } = IdParams.parse(request.params);
      const { kots } = orders.fire(id, commandContext(request));
      const order = view(request, id);
      const fired = new Set(kots.map((k) => k.id));
      reply.status(201);
      return { order, kots: order.kots.filter((k) => fired.has(k.id)) };
    },
  );

  app.post(
    '/orders/:id/cancel',
    { config: { permission: 'orders.update' } },
    async (request): Promise<Order> => {
      const { id } = IdParams.parse(request.params);
      const body = CancelOrderRequestSchema.parse(request.body);
      const mayCancelSent = await mayElevate(request, authService, 'orders.cancel');
      orders.cancel(id, body, commandContext(request), { mayCancelSent });
      return view(request, id);
    },
  );

  app.post(
    '/tables/:id/transfer',
    { config: { permission: 'orders.transfer_table' } },
    async (request): Promise<Order> => {
      const { id } = IdParams.parse(request.params);
      const order = orders.transfer(
        id,
        TransferTableRequestSchema.parse(request.body),
        commandContext(request),
      );
      return view(request, order.id);
    },
  );
}
