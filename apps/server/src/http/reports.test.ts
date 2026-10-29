import {
  BillResponseSchema,
  DashboardSchema,
  DayEndReportSchema,
  FireKotsResponseSchema,
  InvoiceSchema,
  SalesReportSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { caller, signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

/**
 * One business day: a dine-in bill paid by card and cash (₹1,008), a Swiggy
 * order (₹132, GST paid by Swiggy), a cancelled bill and one naan refunded.
 */
async function dayOfTrade() {
  const r = await restaurantServer();
  s = r.s;
  const { admin, menu, tables, openAt, ok } = r;
  await admin('POST', '/cash-shifts', { openingFloat: 200000 });

  const dineIn = await openAt(admin, tables.t1.id, 3);
  await admin('POST', `/orders/${dineIn.id}/items`, {
    items: [
      {
        menuItemId: menu.biryani.id,
        variantId: menu.full.id,
        quantity: 2,
        addons: [{ addonId: menu.raita.id }],
      },
      { menuItemId: menu.naan.id, quantity: 4 },
    ],
  });
  await admin('POST', `/orders/${dineIn.id}/kots`);
  const bill = BillResponseSchema.parse(
    (await admin('POST', `/orders/${dineIn.id}/invoice`, {})).json(),
  ).invoices[0]!;
  await ok(
    admin('POST', `/invoices/${bill.id}/payments`, {
      payments: [
        { method: 'CARD', amount: 50000, reference: 'AUTH1', terminalLabel: 'HDFC-1' },
        { method: 'CASH', amount: 50800 },
      ],
    }),
    InvoiceSchema,
  );
  const naanLine = bill.lines.find((l) => l.description.startsWith('Butter Naan'))!;
  expect(
    (
      await admin('POST', `/invoices/${bill.id}/refunds`, {
        lines: [{ invoiceLineId: naanLine.id, quantity: 1 }],
        method: 'CASH',
        reason: 'Naan was burnt',
      })
    ).statusCode,
  ).toBe(201);

  const swiggy = (
    await admin('POST', '/sales-channels', {
      code: 'swiggy',
      name: 'Swiggy',
      commissionBp: 2200,
      priceMarkupBp: 1000,
    })
  ).json();
  const delivery = FireKotsResponseSchema.parse(
    (
      await admin('POST', '/orders/aggregator', {
        salesChannelId: swiggy.id,
        externalOrderId: 'SWG-1',
        items: [{ menuItemId: menu.naan.id, quantity: 2 }],
      })
    ).json(),
  );
  const swiggyBill = BillResponseSchema.parse(
    (await admin('POST', `/orders/${delivery.order.id}/invoice`, {})).json(),
  ).invoices[0]!;
  await admin('POST', `/invoices/${swiggyBill.id}/payments`, {
    payments: [{ method: 'AGGREGATOR', amount: 13200, reference: 'SWG-1' }],
  });

  const second = await openAt(admin, tables.t2.id, 2);
  await admin('POST', `/orders/${second.id}/items`, {
    items: [{ menuItemId: menu.naan.id, quantity: 1 }],
  });
  await admin('POST', `/orders/${second.id}/kots`);
  const wrong = BillResponseSchema.parse(
    (await admin('POST', `/orders/${second.id}/invoice`, {})).json(),
  ).invoices[0]!;
  expect(
    (
      await admin('POST', `/invoices/${wrong.id}/cancel`, {
        version: wrong.version,
        reason: 'Wrong table billed',
      })
    ).statusCode,
  ).toBe(200);
  return r;
}

describe('reports', () => {
  it('adds up the day: sales, taxes, payments, refunds, channels and cancellations', async () => {
    const { admin } = await dayOfTrade();
    const report = DayEndReportSchema.parse((await admin('GET', '/reports/day-end')).json());
    expect(report.businessDate).toBe('2026-10-28');
    expect(report.orders).toMatchObject({
      count: 3,
      dineIn: 2,
      delivery: 1,
      covers: 5,
      cancelled: 0,
      open: 1, // T2 went back to OPEN when its bill was cancelled
    });
    expect(report.sales).toMatchObject({
      invoiceCount: 2,
      gross: 96000 + 13200,
      tax: 4800,
      total: 100800 + 13200,
      net: 100800 + 13200 - 6300,
      averageBill: 57000,
    });
    expect(report.taxes).toEqual([
      { code: 'CGST', rateBp: 250, taxable: 96000, tax: 2400 },
      { code: 'SGST', rateBp: 250, taxable: 96000, tax: 2400 },
    ]);
    expect(report.refunds).toEqual({ creditNotes: 1, amount: 6300 });
    expect(report.payments).toEqual([
      { method: 'CASH', count: 1, amount: 50800 - 6300 },
      { method: 'CARD', count: 1, amount: 50000 },
      { method: 'AGGREGATOR', count: 1, amount: 13200 },
    ]);
    expect(report.cancellations).toMatchObject({ invoices: 1, invoiceValue: 6300 });
    // Swiggy's 22% is on the food value it billed.
    expect(report.channels.find((c) => c.name === 'Swiggy')).toEqual({
      name: 'Swiggy',
      orders: 1,
      sales: 13200,
      commission: 2904,
      netRevenue: 10296,
    });
    expect(report.shifts).toEqual([
      {
        openedBy: 'Ananya Sen',
        status: 'OPEN',
        expectedCash: 200000 + 50800 - 6300,
        countedCash: null,
        variance: null,
      },
    ]);
    expect(report.topItems[0]).toMatchObject({ quantity: 2 });
    expect(report.hourly.map((h) => h.invoices).reduce((a, b) => a + b)).toBe(2);
    expect(report.kitchen.kots).toBeGreaterThanOrEqual(3);
  });

  it('exports the day and the sales register as CSV for Excel', async () => {
    const { admin } = await dayOfTrade();
    const res = await admin('GET', '/reports/day-end.csv?date=2026-10-28');
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain('day-end-2026-10-28.csv');
    expect(res.body.startsWith('﻿Day-end report,')).toBe(true);
    expect(res.body).toContain('\r\nNet sales,1077.00\r\n');
    expect(res.body).toContain('\r\nSwiggy,1,132.00,29.04,102.96\r\n');

    const register = await admin(
      'GET',
      '/reports/sales-register.csv?from=2026-10-01&to=2026-10-31',
    );
    const lines = register.body.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 4); // two bills, a cancelled bill and a credit note
    expect(lines.find((l) => l.includes('/CN/'))).toContain(',Credit note,CN,');
    expect(lines.find((l) => l.includes('/CN/'))).toContain(',-63.00,');

    const tooLong = await admin('GET', '/reports/sales-register.csv?from=2025-01-01&to=2026-10-31');
    expect(tooLong.json().code).toBe('VALIDATION_FAILED');
  });

  it('reports any range by day, week, month or year, and exports it as XLSX and CSV', async () => {
    const r = await dayOfTrade();
    const { s, openAt, tables, menu } = r;
    // The next business day: one naan on T3 (₹63 with GST). A day on, the owner signs in again.
    s.clock.advance(86_400_000);
    const admin = caller(s, (await s.login()).accessToken);
    const next = await openAt(admin, tables.t3.id, 1);
    await admin('POST', `/orders/${next.id}/items`, {
      items: [{ menuItemId: menu.naan.id, quantity: 1 }],
    });
    await admin('POST', `/orders/${next.id}/kots`);
    const bill = BillResponseSchema.parse(
      (await admin('POST', `/orders/${next.id}/invoice`, {})).json(),
    ).invoices[0]!;
    await admin('POST', `/invoices/${bill.id}/payments`, {
      payments: [{ method: 'UPI', amount: bill.grandTotal, reference: 'RRN77' }],
    });

    const byDay = SalesReportSchema.parse(
      (await admin('GET', '/reports/sales?from=2026-10-26&to=2026-11-01&groupBy=day')).json(),
    );
    expect(byDay.periods).toHaveLength(7);
    expect(byDay.periods.find((p) => p.key === '2026-10-28')).toMatchObject({
      invoices: 2,
      total: 114000,
      refunds: 6300,
      net: 107700,
      orders: 3,
      covers: 5,
    });
    expect(byDay.periods.find((p) => p.key === '2026-10-29')).toMatchObject({
      invoices: 1,
      total: 6300,
      net: 6300,
    });
    expect(byDay.totals).toMatchObject({
      invoices: 3,
      total: 120300,
      refunds: 6300,
      net: 114000,
      averageBill: 40100,
    });
    // Breakdowns over the whole range.
    expect(byDay.orderTypes.find((t) => t.orderType === 'DELIVERY')).toMatchObject({
      orders: 1,
      sales: 13200,
    });
    expect(byDay.payments.map((p) => p.method)).toEqual(['CARD', 'CASH', 'AGGREGATOR', 'UPI']);
    expect(byDay.items.find((i) => i.name === 'Butter Naan')).toMatchObject({ quantity: 7 });
    expect(byDay.categories.reduce((n, c) => n + c.amount, 0)).toBe(
      byDay.items.reduce((n, i) => n + i.amount, 0),
    );
    expect(byDay.staff[0]).toMatchObject({ name: 'Ananya Sen', bills: 3, billed: 120300 });
    expect(byDay.hourly.reduce((n, h) => n + h.invoices, 0)).toBe(3);
    // Bills at 12:00 UTC are at 17:00 in India.
    expect(byDay.hourly.map((h) => h.hour)).toEqual([17]);
    expect(byDay.weekdays.map((d) => d.weekday)).toEqual([3, 4]);

    const byWeek = SalesReportSchema.parse(
      (await admin('GET', '/reports/sales?from=2026-10-26&to=2026-11-01&groupBy=week')).json(),
    );
    expect(byWeek.periods).toEqual([
      expect.objectContaining({
        key: '2026-10-26',
        from: '2026-10-26',
        to: '2026-11-01',
        net: 114000,
      }),
    ]);
    const byMonth = SalesReportSchema.parse(
      (await admin('GET', '/reports/sales?from=2026-10-01&to=2026-11-30&groupBy=month')).json(),
    );
    expect(byMonth.periods.map((p) => [p.key, p.net])).toEqual([
      ['2026-10', 114000],
      ['2026-11', 0],
    ]);
    const byYear = SalesReportSchema.parse(
      (await admin('GET', '/reports/sales?from=2025-04-01&to=2027-03-31&groupBy=year')).json(),
    );
    expect(byYear.periods.map((p) => [p.key, p.net])).toEqual([
      ['2025-26', 0],
      ['2026-27', 114000],
    ]);

    const xlsx = await admin('GET', '/reports/sales.xlsx?from=2026-10-26&to=2026-11-01');
    expect(xlsx.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(xlsx.headers['content-disposition']).toContain(
      'sales-2026-10-26-to-2026-11-01-by-day.xlsx',
    );
    expect(xlsx.rawPayload.subarray(0, 4).toString('hex')).toBe('504b0304');
    const csv = await admin('GET', '/reports/sales.csv?from=2026-10-26&to=2026-11-01');
    expect(csv.body).toContain('\r\nNet sales,1140.00\r\n');
    expect(csv.body).toContain('\r\nTotal,,3,4,6,');
    const register = await admin(
      'GET',
      '/reports/sales-register.xlsx?from=2026-10-01&to=2026-10-31',
    );
    expect(register.statusCode).toBe(200);

    expect((await admin('GET', '/reports/sales?from=2020-01-01&to=2026-10-31')).json().code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await admin('GET', '/reports/sales?from=2026-10-31&to=2026-10-01')).json().code).toBe(
      'VALIDATION_FAILED',
    );
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    expect((await captain('GET', '/reports/sales?from=2026-10-01&to=2026-10-31')).statusCode).toBe(
      403,
    );
  });

  it("shows the owner today's numbers and the last two weeks; staff without rights can't see it", async () => {
    const { admin, s } = await dayOfTrade();
    const board = DashboardSchema.parse((await admin('GET', '/reports/dashboard')).json());
    expect(board.today).toMatchObject({ sales: 100800 + 13200 - 6300, invoices: 2, covers: 5 });
    expect(board.month.sales).toBe(board.today.sales);
    expect(board.financialYear).toMatchObject({ from: '2026-04-01', sales: board.today.sales });
    expect(board.daily).toHaveLength(14);
    expect(board.daily.at(-1)).toEqual({ date: '2026-10-28', sales: 107700, invoices: 2 });
    expect(board.daily[0]!.date).toBe('2026-10-15');
    expect(board).toMatchObject({ openOrders: 1, openTables: 1 });

    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    expect((await captain('GET', '/reports/dashboard')).statusCode).toBe(403);
  });
});
