import {
  AdjustLoyaltyRequestSchema,
  SaveCustomerRequestSchema,
  UpdateCustomerRequestSchema,
  type CustomerDetail,
  type CustomersResponse,
  type LoyaltyLedger,
} from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const SearchQuery = z.object({ q: z.string().trim().max(60).default('') });
const VIEW = { permission: ['customers.view', 'customers.manage', 'billing.create'] } as const;
const MANAGE = { permission: 'customers.manage' } as const;

/** WP 5.6: guests by mobile number, their visits, spend and favourites. */
export async function customerRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { customerService: customers, loyaltyService: loyalty } = cradle;

  app.get('/customers', { config: VIEW }, async (request): Promise<CustomersResponse> => {
    const { q } = SearchQuery.parse(request.query);
    return { data: q ? customers.search(q) : [] };
  });

  app.get('/customers/:id', { config: VIEW }, async (request): Promise<CustomerDetail> =>
    customers.detail(IdParams.parse(request.params).id),
  );

  app.post('/customers', { config: MANAGE }, async (request, reply) => {
    const customer = customers.create(
      SaveCustomerRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return customer;
  });

  app.patch('/customers/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return customers.update(
      id,
      UpdateCustomerRequestSchema.parse(request.body),
      commandContext(request),
    );
  });

  // ---- loyalty points (Phase 5) ---------------------------------------------------
  app.get('/customers/:id/loyalty', { config: VIEW }, async (request): Promise<LoyaltyLedger> =>
    loyalty.ledger(IdParams.parse(request.params).id, request.principal!.branchId),
  );

  app.post(
    '/customers/:id/loyalty',
    { config: { permission: 'loyalty.adjust' } },
    async (request): Promise<LoyaltyLedger> => {
      const { id } = IdParams.parse(request.params);
      const { points, note } = AdjustLoyaltyRequestSchema.parse(request.body);
      return loyalty.adjust(id, points, note, commandContext(request));
    },
  );
}
