import { dayEndCsv, salesRegisterCsv } from '@restroos/application';
import {
  PrintRequestSchema,
  type Dashboard,
  type DayEndReport,
  type PrintOutcome,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DayQuery = z.object({ date: DateString.optional() });
const RangeQuery = z.object({ from: DateString, to: DateString });
const MAX_RANGE_DAYS = 366;

/** WP 5.7: day-end report, owner dashboard and CSV exports (docs/05 §2 Reports). */
export async function reportRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { reportQueries: reports, calendar, clock } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;
  const dateOf = (r: FastifyRequest) =>
    DayQuery.parse(r.query).date ?? calendar.businessDate(branchOf(r), clock.now());

  app.get(
    '/reports/day-end',
    { config: { permission: 'reports.sales' } },
    async (request): Promise<DayEndReport> =>
      reports.dayEnd(branchOf(request), dateOf(request), clock.now()),
  );

  app.get(
    '/reports/day-end.csv',
    { config: { permission: 'reports.export' } },
    async (request, reply) => {
      const date = dateOf(request);
      const report = reports.dayEnd(branchOf(request), date, clock.now());
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="day-end-${date}.csv"`)
        .send(dayEndCsv(report));
    },
  );

  app.post(
    '/reports/day-end/print',
    { config: { permission: 'reports.sales' } },
    async (request): Promise<PrintOutcome> => {
      const report = reports.dayEnd(branchOf(request), dateOf(request), clock.now());
      const { printerId } = PrintRequestSchema.parse(request.body ?? {});
      return cradle.printService.printDayEnd(report, { printerId }, commandContext(request));
    },
  );

  app.get(
    '/reports/sales-register.csv',
    { config: { permission: 'reports.export' } },
    async (request, reply) => {
      const { from, to } = RangeQuery.parse(request.query);
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days < 0 || days >= MAX_RANGE_DAYS) {
        throw new DomainError('VALIDATION_FAILED', `the range must be 1 to ${MAX_RANGE_DAYS} days`);
      }
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="sales-register-${from}-to-${to}.csv"`)
        .send(salesRegisterCsv(reports.salesRegister(branchOf(request), from, to)));
    },
  );

  app.get(
    '/reports/dashboard',
    { config: { permission: 'reports.sales' } },
    async (request): Promise<Dashboard> => {
      const now = clock.now();
      return reports.dashboard(
        branchOf(request),
        calendar.businessDate(branchOf(request), now),
        now,
      );
    },
  );
}
