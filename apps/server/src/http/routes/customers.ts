import {
  AdjustLoyaltyRequestSchema,
  SaveCustomerRequestSchema,
  SaveMembershipTierRequestSchema,
  UpdateCustomerRequestSchema,
  UpdateMembershipTierRequestSchema,
  type CustomerDetail,
  type CustomersResponse,
  type LoyaltyLedger,
  type MembershipTiersResponse,
} from '@restroos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';
import { HttpProblem } from '../problem';

const IdParams = z.object({ id: z.uuid() });
const SearchQuery = z.object({ q: z.string().trim().max(60).default('') });
const VIEW = { permission: ['customers.view', 'customers.manage', 'billing.create'] } as const;
const MANAGE = { permission: 'customers.manage' } as const;
/** Tiers carry discounts, so they are set up like coupons. */
const TIERS = { permission: 'settings.manage' } as const;

/** Counter staff add guests (customers.manage); giving one a tier by hand is a manager's call. */
function checkPinning(request: FastifyRequest, membershipTierId: string | null | undefined) {
  if (membershipTierId === undefined || request.principal!.permissions.has('loyalty.adjust'))
    return;
  throw new HttpProblem(
    'FORBIDDEN',
    'you need the loyalty.adjust permission to give a guest a tier',
    undefined,
    'loyalty.adjust',
  );
}

/** WP 5.6: guests by mobile number, their visits, spend and favourites. */
export async function customerRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { customerService: customers, loyaltyService: loyalty, membershipService } = cradle;

  app.get('/customers', { config: VIEW }, async (request): Promise<CustomersResponse> => {
    const { q } = SearchQuery.parse(request.query);
    return { data: q ? customers.search(q) : [] };
  });

  app.get('/customers/:id', { config: VIEW }, async (request): Promise<CustomerDetail> =>
    customers.detail(IdParams.parse(request.params).id),
  );

  app.post('/customers', { config: MANAGE }, async (request, reply) => {
    const body = SaveCustomerRequestSchema.parse(request.body);
    checkPinning(request, body.membershipTierId ?? undefined);
    const customer = customers.create(body, commandContext(request));
    reply.status(201);
    return customer;
  });

  app.patch('/customers/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateCustomerRequestSchema.parse(request.body);
    checkPinning(request, body.membershipTierId);
    return customers.update(id, body, commandContext(request));
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

  // ---- membership tiers (Phase 5) -------------------------------------------------
  app.get('/membership-tiers', { config: VIEW }, async (): Promise<MembershipTiersResponse> => ({
    data: membershipService.list(),
  }));

  app.post('/membership-tiers', { config: TIERS }, async (request, reply) => {
    const tier = membershipService.create(
      SaveMembershipTierRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return tier;
  });

  app.patch('/membership-tiers/:id', { config: TIERS }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return membershipService.update(
      id,
      UpdateMembershipTierRequestSchema.parse(request.body),
      commandContext(request),
    );
  });
}
