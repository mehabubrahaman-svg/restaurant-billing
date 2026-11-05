import {
  RatingLookupRequestSchema,
  RatingsQuerySchema,
  RatingSummaryQuerySchema,
  ReviewDishRatingsRequestSchema,
  SetBestsellersRequestSchema,
  SubmitRatingRequestSchema,
  type Bestsellers,
  type RatingLookupResponse,
  type RatingSummary,
} from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { clientInfo, commandContext } from '../context';

const TokenParams = z.object({ token: z.string().min(8).max(64) });
/**
 * Finding an order by phone: a handful of tries per phone and address, so a
 * table can't page through other guests' numbers.
 */
const LOOKUP_LIMIT = { rateLimit: { max: 10, timeWindow: '10 minutes' } };
const RATE_LIMIT = { rateLimit: { max: 20, timeWindow: '10 minutes' } };
const MANAGE = { permission: 'feedback.manage' } as const;

/** Guest ratings: the guest's side on the table's QR page, and Admin → Ratings. */
export async function ratingRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { guestRatingService: ratings } = cradle;

  // ---- public: the guest's phone -----------------------------------------------------
  app.post(
    '/public/qr/:token/ratings/lookup',
    { config: { public: true, ...LOOKUP_LIMIT } },
    async (request): Promise<RatingLookupResponse> => {
      const { token } = TokenParams.parse(request.params);
      const { phone } = RatingLookupRequestSchema.parse(request.body);
      return { orders: ratings.lookup(token, phone) };
    },
  );
  app.post(
    '/public/qr/:token/ratings',
    { config: { public: true, ...RATE_LIMIT } },
    async (request, reply) => {
      const { token } = TokenParams.parse(request.params);
      const body = SubmitRatingRequestSchema.parse(request.body);
      const client = clientInfo(request);
      const saved = ratings.rate(token, body, {
        ipAddress: client.ipAddress,
        correlationId: client.correlationId,
      });
      reply.status(201);
      return { id: saved.id };
    },
  );

  // ---- staff: Admin → Ratings ------------------------------------------------------
  app.get('/ratings', { config: MANAGE }, async (request) => ({
    data: ratings.list(request.principal!.branchId, RatingsQuerySchema.parse(request.query)),
  }));
  app.post('/ratings/dishes/review', { config: MANAGE }, async (request) => {
    const { ids, status } = ReviewDishRatingsRequestSchema.parse(request.body);
    return { updated: ratings.review(ids, status, commandContext(request)) };
  });
  app.get('/ratings/summary', { config: MANAGE }, async (request): Promise<RatingSummary> => {
    const { from, to } = RatingSummaryQuerySchema.parse(request.query);
    return ratings.summary(request.principal!.branchId, from, to);
  });
  app.get('/bestsellers', { config: MANAGE }, async (request): Promise<Bestsellers> =>
    ratings.bestsellers(request.principal!.branchId),
  );
  app.put('/bestsellers', { config: MANAGE }, async (request): Promise<Bestsellers> => {
    const { items } = SetBestsellersRequestSchema.parse(request.body);
    return ratings.setBestsellers(items, commandContext(request));
  });
}
