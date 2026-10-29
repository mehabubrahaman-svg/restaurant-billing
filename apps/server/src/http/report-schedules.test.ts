import {
  BillResponseSchema,
  ReportFileSchema,
  ReportFilesResponseSchema,
  ReportScheduleSchema,
  ReportSchedulesResponseSchema,
} from '@restroos/contracts';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { caller, signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

const DAY = 24 * 60 * 60_000;

describe('scheduled reports', () => {
  it('makes each file once its day, week or month has ended, and keeps it to download', async () => {
    const r = await restaurantServer();
    s = r.s;
    const { admin, menu, tables, openAt, ok } = r;
    const jobs = r.s.container.cradle.reportScheduleService;

    // Wednesday 28 October 2026: a bill today.
    await admin('POST', '/cash-shifts', { openingFloat: 0 });
    const order = await openAt(admin, tables.t1.id, 2);
    await admin('POST', `/orders/${order.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 2 }],
    });
    await admin('POST', `/orders/${order.id}/kots`);
    const [bill] = BillResponseSchema.parse(
      (await admin('POST', `/orders/${order.id}/invoice`, {})).json(),
    ).invoices;
    await admin('POST', `/invoices/${bill!.id}/payments`, {
      payments: [{ method: 'CASH', amount: bill!.grandTotal }],
    });

    const sales = await ok(
      admin('POST', '/report-schedules', { report: 'SALES', frequency: 'DAILY', format: 'XLSX' }),
      ReportScheduleSchema,
    );
    expect(sales).toMatchObject({ isActive: true, lastPeriodTo: null, lastError: null });
    await ok(
      admin('POST', '/report-schedules', { report: 'DAY_END', frequency: 'DAILY', format: 'CSV' }),
      ReportScheduleSchema,
    );
    const gstr1 = await ok(
      admin('POST', '/report-schedules', { report: 'GSTR1', frequency: 'MONTHLY', format: 'XLSX' }),
      ReportScheduleSchema,
    );
    await ok(
      admin('POST', '/report-schedules', {
        report: 'SALES_REGISTER',
        frequency: 'WEEKLY',
        format: 'CSV',
      }),
      ReportScheduleSchema,
    );
    expect(
      (
        await admin('POST', '/report-schedules', {
          report: 'DAY_END',
          frequency: 'WEEKLY',
          format: 'CSV',
        })
      ).json().code,
    ).toBe('VALIDATION_FAILED');

    // The first run makes the last whole periods: yesterday, last week (Mon–Sun), September.
    const first = jobs.runDue();
    expect(first.failed).toEqual([]);
    expect(first.made.map((f) => [f.fileName, f.createdBy])).toEqual([
      ['sales-2026-10-27.xlsx', null],
      ['day-end-2026-10-27.csv', null],
      ['gstr1-2026-09-01-to-2026-09-30.xlsx', null],
      ['sales-register-2026-10-19-to-2026-10-25.csv', null],
    ]);
    // Nothing new until a period ends.
    expect(jobs.runDue().made).toEqual([]);

    // A day later: today's sales and day-end; the week and month are not over.
    r.s.clock.advance(DAY);
    const second = jobs.runDue();
    expect(second.made.map((f) => f.fileName)).toEqual([
      'sales-2026-10-28.xlsx',
      'day-end-2026-10-28.csv',
    ]);
    const owner = caller(r.s, (await r.s.login()).accessToken);
    const schedules = ReportSchedulesResponseSchema.parse(
      (await owner('GET', '/report-schedules')).json(),
    ).data;
    expect(schedules.find((x) => x.id === sales.id)).toMatchObject({
      lastPeriodTo: '2026-10-28',
      lastError: null,
    });

    const files = ReportFilesResponseSchema.parse(
      (await owner('GET', '/report-files')).json(),
    ).data;
    expect(files).toHaveLength(6);
    expect(files[0]).not.toHaveProperty('filePath');
    const dayEnd = files.find((f) => f.fileName === 'day-end-2026-10-28.csv')!;
    const csv = await owner('GET', `/report-files/${dayEnd.id}/download`);
    expect(csv.headers['content-disposition']).toBe(
      'attachment; filename="day-end-2026-10-28.csv"',
    );
    expect(csv.body).toContain('2026-10-28');
    const xlsx = await owner(
      'GET',
      `/report-files/${files.find((f) => f.fileName === 'sales-2026-10-28.xlsx')!.id}/download`,
    );
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    // On the Hub, under the data folder.
    expect(readdirSync(join(r.s.database.dir, 'reports'))).toHaveLength(6);

    // "Make now" makes the file again, by the person who asked.
    const again = await ok(owner('POST', `/report-schedules/${gstr1.id}/run`), ReportFileSchema);
    expect(again).toMatchObject({
      fileName: 'gstr1-2026-09-01-to-2026-09-30.xlsx',
      createdBy: expect.any(String),
    });

    // Switched off: no more files. A new frequency starts again from the last whole period.
    await owner('PATCH', `/report-schedules/${sales.id}`, { isActive: false, version: 1 });
    const weekly = await owner('PATCH', `/report-schedules/${gstr1.id}`, {
      frequency: 'WEEKLY',
      version: 1,
    });
    expect(weekly.json()).toMatchObject({ frequency: 'WEEKLY', lastPeriodTo: null });
    r.s.clock.advance(DAY);
    expect(jobs.runDue().made.map((f) => f.fileName)).toEqual([
      'day-end-2026-10-29.csv',
      'gstr1-2026-10-19-to-2026-10-25.xlsx',
    ]);
    expect(existsSync(join(r.s.database.dir, 'reports'))).toBe(true);
  });

  it('is for reports.export, and GST returns also need reports.financial', async () => {
    const r = await restaurantServer();
    s = r.s;
    const { admin } = r;
    const cashier = await signInAs(r.s, admin, 'CASHIER', 'meera');
    expect((await cashier('GET', '/report-schedules')).statusCode).toBe(403);

    await admin('POST', '/roles', {
      code: 'CLERK',
      name: 'Report clerk',
      permissions: ['reports.sales', 'reports.export'],
    });
    const clerk = await signInAs(r.s, admin, 'CLERK', 'tara');
    const gst = ReportScheduleSchema.parse(
      (
        await admin('POST', '/report-schedules', {
          report: 'GSTR3B',
          frequency: 'MONTHLY',
          format: 'CSV',
        })
      ).json(),
    );
    await admin('POST', '/report-schedules', {
      report: 'SALES',
      frequency: 'WEEKLY',
      format: 'CSV',
    });
    r.s.container.cradle.reportScheduleService.runDue();

    const seen = ReportSchedulesResponseSchema.parse(
      (await clerk('GET', '/report-schedules')).json(),
    ).data;
    expect(seen.map((x) => x.report)).toEqual(['SALES']);
    const files = ReportFilesResponseSchema.parse(
      (await clerk('GET', '/report-files')).json(),
    ).data;
    expect(files.map((f) => f.report)).toEqual(['SALES']);
    expect((await clerk('POST', `/report-schedules/${gst.id}/run`)).statusCode).toBe(403);
    expect(
      (
        await clerk('POST', '/report-schedules', {
          report: 'VAT_REGISTER',
          frequency: 'MONTHLY',
          format: 'XLSX',
        })
      ).statusCode,
    ).toBe(403);
    const accountant = await signInAs(r.s, admin, 'ACCOUNTANT', 'gita');
    const all = ReportFilesResponseSchema.parse(
      (await accountant('GET', '/report-files')).json(),
    ).data;
    expect(all.map((f) => f.report).sort()).toEqual(['GSTR3B', 'SALES']);
  });
});
