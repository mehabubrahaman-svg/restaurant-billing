import type { ReservationRecord } from '@restroos/application';
import {
  ReservationActionRequestSchema,
  ReservationsQuerySchema,
  SaveReservationRequestSchema,
  UpdateReservationRequestSchema,
  type Reservation,
  type ReservationsResponse,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
// Captains and cashiers see who is coming; booking takes reservations.manage.
const VIEW = { permission: ['reservations.manage', 'tables.view'] } as const;
const MANAGE = { permission: 'reservations.manage' } as const;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const toReservation = (r: ReservationRecord): Reservation => r;

/** Table bookings (docs/05 §3 Reservations). */
export async function reservationRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { reservationService: reservations, clock } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;

  app.get('/reservations', { config: VIEW }, async (request): Promise<ReservationsResponse> => {
    const query = ReservationsQuerySchema.parse(request.query);
    const now = clock.now().getTime();
    const from = query.from === undefined ? now - 3 * HOUR : Date.parse(query.from);
    const to = query.to === undefined ? from + 30 * DAY : Date.parse(query.to);
    if (to < from || to - from > 62 * DAY) {
      throw new DomainError('VALIDATION_FAILED', 'ask for at most 62 days, from before to');
    }
    return {
      data: reservations
        .list(branchOf(request), new Date(from).toISOString(), new Date(to).toISOString())
        .map(toReservation),
    };
  });

  app.post('/reservations', { config: MANAGE }, async (request, reply) => {
    const body = SaveReservationRequestSchema.parse(request.body);
    const reservation = reservations.create(body, commandContext(request));
    reply.status(201);
    return toReservation(reservation);
  });

  app.patch('/reservations/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateReservationRequestSchema.parse(request.body);
    return toReservation(reservations.update(id, body, commandContext(request)));
  });

  for (const [path, status] of [
    ['seat', 'SEATED'],
    ['cancel', 'CANCELLED'],
    ['no-show', 'NO_SHOW'],
  ] as const) {
    app.post(`/reservations/:id/${path}`, { config: MANAGE }, async (request) => {
      const { id } = IdParams.parse(request.params);
      const { version } = ReservationActionRequestSchema.parse(request.body);
      return toReservation(reservations.close(id, status, version, commandContext(request)));
    });
  }
}
