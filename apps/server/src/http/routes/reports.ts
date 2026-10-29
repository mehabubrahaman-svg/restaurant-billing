import {
  dayEndCsv,
  gstr1Workbook,
  gstr3bWorkbook,
  salesRegisterCsv,
  salesRegisterWorkbook,
  salesReportWorkbook,
  sheetToCsv,
  vatRegisterWorkbook,
  workbookToCsv,
  type Workbook,
} from '@restroos/application';
import {
  PrintRequestSchema,
  ReportRangeQuerySchema,
  SalesReportQuerySchema,
  type Dashboard,
  type SalesReport,
  type DayEndReport,
  type PrintOutcome,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import { writeXlsx } from '@restroos/infrastructure';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DayQuery = z.object({ date: DateString.optional() });
const RangeQuery = z.object({ from: DateString, to: DateString });
const MAX_RANGE_DAYS = 366;
/** The report engine reads up to five years (by month or financial year). */
const MAX_REPORT_DAYS = 1830;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** from ≤ to, at most `max` days. */
export function checkRange(from: string, to: string, max = MAX_REPORT_DAYS): void {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0 || days >= max) {
    throw new DomainError('VALIDATION_FAILED', `the range must be 1 to ${max} days`);
  }
}

/** A workbook as an .xlsx or .csv download. */
export function sendWorkbook(
  reply: FastifyReply,
  workbook: Workbook,
  name: string,
  format: 'xlsx' | 'csv',
) {
  const disposition = `attachment; filename="${name}.${format}"`;
  return format === 'xlsx'
    ? reply.type(XLSX).header('content-disposition', disposition).send(writeXlsx(workbook))
    : reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', disposition)
        .send(workbookToCsv(workbook));
}

/** WP 5.7: day-end report, owner dashboard and CSV exports (docs/05 §2 Reports). */
export async function reportRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { reportQueries: reports, gstQueries: gst, calendar, clock } = cradle;
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

  // ---- report engine (Phase 5) ---------------------------------------------------
  const salesOf = (request: FastifyRequest): SalesReport => {
    const { from, to, groupBy } = SalesReportQuerySchema.parse(request.query);
    checkRange(from, to);
    return reports.sales(branchOf(request), from, to, groupBy, clock.now());
  };
  app.get('/reports/sales', { config: { permission: 'reports.sales' } }, async (request) =>
    salesOf(request),
  );
  for (const format of ['xlsx', 'csv'] as const) {
    app.get(
      `/reports/sales.${format}`,
      { config: { permission: 'reports.export' } },
      async (request, reply) => {
        const report = salesOf(request);
        return sendWorkbook(
          reply,
          salesReportWorkbook(report),
          `sales-${report.from}-to-${report.to}-by-${report.groupBy}`,
          format,
        );
      },
    );
  }
  app.get(
    '/reports/sales-register.xlsx',
    { config: { permission: 'reports.export' } },
    async (request, reply) => {
      const { from, to } = ReportRangeQuerySchema.parse(request.query);
      checkRange(from, to, MAX_RANGE_DAYS);
      const branchName = cradle.settingsService.branch(branchOf(request)).name;
      return sendWorkbook(
        reply,
        salesRegisterWorkbook(reports.salesRegister(branchOf(request), from, to), {
          branchName,
          from,
          to,
        }),
        `sales-register-${from}-to-${to}`,
        'xlsx',
      );
    },
  );

  // ---- GST returns and the liquor VAT register ---------------------------------------
  const FINANCIAL = { permission: 'reports.financial' } as const;
  const rangeOf = (request: FastifyRequest) => {
    const { from, to } = ReportRangeQuerySchema.parse(request.query);
    checkRange(from, to, MAX_RANGE_DAYS);
    return { from, to };
  };
  const returns = {
    gstr1: {
      read: (r: FastifyRequest) => {
        const { from, to } = rangeOf(r);
        return gst.gstr1(branchOf(r), from, to, clock.now());
      },
      workbook: gstr1Workbook,
    },
    gstr3b: {
      read: (r: FastifyRequest) => {
        const { from, to } = rangeOf(r);
        return gst.gstr3b(branchOf(r), from, to, clock.now());
      },
      workbook: gstr3bWorkbook,
    },
    'vat-register': {
      read: (r: FastifyRequest) => {
        const { from, to } = rangeOf(r);
        return gst.vatRegister(branchOf(r), from, to, clock.now());
      },
      workbook: vatRegisterWorkbook,
    },
  } as const;
  for (const [name, { read, workbook }] of Object.entries(returns)) {
    app.get(`/reports/${name}`, { config: FINANCIAL }, async (request) => read(request));
    for (const format of ['xlsx', 'csv'] as const) {
      app.get(`/reports/${name}.${format}`, { config: FINANCIAL }, async (request, reply) => {
        const view = read(request);
        return sendWorkbook(
          reply,
          (workbook as (v: typeof view) => Workbook)(view),
          `${name}-${view.from}-to-${view.to}`,
          format,
        );
      });
    }
  }
  /** One GSTR-1 section as its own CSV, the way the GST offline tool imports them. */
  app.get('/reports/gstr1/:section.csv', { config: FINANCIAL }, async (request, reply) => {
    const { section } = z.object({ section: z.string() }).parse(request.params);
    const view = returns.gstr1.read(request);
    const sheet = gstr1Workbook(view).sheets.find((s) => s.name === section);
    if (!sheet) throw new DomainError('NOT_FOUND', `no GSTR-1 section ${section}`);
    return reply
      .type('text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="gstr1-${section}-${view.from}-to-${view.to}.csv"`,
      )
      .send(sheetToCsv(sheet));
  });

  app.get(
    '/reports/dashboard',
    // Also the owner's home (Admin → Overview).
    { config: { permission: ['reports.sales', 'dashboard.view'] } },
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
