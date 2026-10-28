import type {
  BusinessCalendar,
  DashboardView,
  DayEndReportView,
  PeriodView,
  ReportQueries,
  SalesRegisterRow,
  TopItemView,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

/** Tax invoices that count as sales: not credit notes, not cancelled. */
const SOLD = `i.kind = 'INVOICE' AND i.status <> 'CANCELLED'`;
/** Orders that were folded into another one don't count twice. */
const REAL_ORDER = `o.merged_into_order_id IS NULL AND o.status <> 'VOID'`;
const COOKING = `('NEW','ACCEPTED','COOKING')`;

const round = (v: number | null) => (v === null ? null : Math.round(v));
const average = (total: number, count: number) => (count === 0 ? 0 : Math.round(total / count));

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 April of the Indian financial year the date falls in. */
function financialYearStart(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** Day-end report, owner dashboard and the sales register (docs/09 WP 5.7). */
export class SqliteReportQueries implements ReportQueries {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly calendar: BusinessCalendar,
  ) {}

  dayEnd(branchId: string, date: string, now: Date): DayEndReportView {
    const db = this.db;
    const branch = db
      .prepare<[string], { name: string; timezone: string }>(
        'SELECT name, timezone FROM branches WHERE id = ?',
      )
      .get(branchId) ?? { name: '', timezone: 'Asia/Kolkata' };

    const orders = db
      .prepare<[string, string], DayEndReportView['orders']>(
        `SELECT count(*) AS count,
                coalesce(sum(o.order_type = 'DINE_IN' AND o.status <> 'CANCELLED'), 0) AS dineIn,
                coalesce(sum(o.order_type = 'TAKEAWAY' AND o.status <> 'CANCELLED'), 0) AS takeaway,
                coalesce(sum(o.order_type = 'DELIVERY' AND o.status <> 'CANCELLED'), 0) AS delivery,
                coalesce(sum(CASE WHEN o.status <> 'CANCELLED' THEN o.covers END), 0) AS covers,
                coalesce(sum(o.status = 'CANCELLED'), 0) AS cancelled,
                coalesce(sum(o.status IN ('OPEN','BILLED')), 0) AS open
           FROM orders o WHERE o.branch_id = ? AND o.business_date = ? AND ${REAL_ORDER}`,
      )
      .get(branchId, date)!;

    const s = db
      .prepare<
        [string, string],
        {
          invoiceCount: number;
          gross: number;
          discounts: number;
          charges: number;
          taxable: number;
          tax: number;
          roundOff: number;
          total: number;
        }
      >(
        `SELECT count(*) AS invoiceCount, coalesce(sum(subtotal), 0) AS gross,
                coalesce(sum(discount_total), 0) AS discounts, coalesce(sum(charges_total), 0) AS charges,
                coalesce(sum(taxable_total), 0) AS taxable, coalesce(sum(tax_total), 0) AS tax,
                coalesce(sum(round_off), 0) AS roundOff, coalesce(sum(grand_total), 0) AS total
           FROM invoices i WHERE i.branch_id = ? AND i.business_date = ? AND ${SOLD}`,
      )
      .get(branchId, date)!;

    const refunds = db
      .prepare<[string, string], DayEndReportView['refunds']>(
        `SELECT count(*) AS creditNotes, coalesce(sum(grand_total), 0) AS amount
           FROM invoices WHERE branch_id = ? AND business_date = ? AND kind = 'CREDIT_NOTE'`,
      )
      .get(branchId, date)!;

    const taxes = db
      .prepare<[string, string], DayEndReportView['taxes'][number]>(
        `SELECT t.tax_code AS code, t.rate_bp AS rateBp, sum(t.taxable_value) AS taxable, sum(t.tax_amount) AS tax
           FROM invoice_taxes t JOIN invoices i ON i.id = t.invoice_id
          WHERE i.branch_id = ? AND i.business_date = ? AND ${SOLD}
          GROUP BY t.tax_code, t.rate_bp
          ORDER BY CASE t.tax_code WHEN 'CGST' THEN 0 WHEN 'SGST' THEN 1 WHEN 'IGST' THEN 2 WHEN 'VAT' THEN 3 ELSE 4 END, t.rate_bp`,
      )
      .all(branchId, date);

    const liquor = db
      .prepare<[string, string], DayEndReportView['liquor']>(
        `SELECT count(*) AS invoiceCount, coalesce(sum(grand_total), 0) AS total, coalesce(sum(tax_total), 0) AS vat
           FROM invoices i WHERE i.branch_id = ? AND i.business_date = ? AND i.series = 'LIQ' AND ${SOLD}`,
      )
      .get(branchId, date)!;

    const payments = db
      .prepare<[string, string], DayEndReportView['payments'][number]>(
        `SELECT method, count(CASE WHEN amount > 0 THEN 1 END) AS count, sum(amount) AS amount
           FROM payments WHERE branch_id = ? AND business_date = ?
          GROUP BY method ORDER BY method = 'CASH' DESC, sum(amount) DESC`,
      )
      .all(branchId, date);

    const cancelledInvoices = db
      .prepare<[string, string], { invoices: number; invoiceValue: number }>(
        `SELECT count(*) AS invoices, coalesce(sum(grand_total), 0) AS invoiceValue
           FROM invoices WHERE branch_id = ? AND business_date = ? AND kind = 'INVOICE' AND status = 'CANCELLED'`,
      )
      .get(branchId, date)!;
    const voids = db
      .prepare<
        [string, string],
        { voidedItems: number; voidedValue: number; wastageValue: number }
      >(
        `SELECT coalesce(sum(oi.status = 'CANCELLED' AND oi.kot_id IS NOT NULL), 0) AS voidedItems,
                coalesce(sum(CASE WHEN oi.status = 'CANCELLED' AND oi.kot_id IS NOT NULL THEN oi.line_total END), 0) AS voidedValue,
                coalesce(sum(CASE WHEN oi.is_wastage = 1 THEN oi.line_total END), 0) AS wastageValue
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.branch_id = ? AND o.business_date = ?`,
      )
      .get(branchId, date)!;

    const discountsGiven = db
      .prepare<[string, string], DayEndReportView['discountsGiven'][number]>(
        `SELECT d.kind, count(*) AS count, sum(d.amount) AS amount
           FROM invoice_discounts d JOIN invoices i ON i.id = d.invoice_id
          WHERE i.branch_id = ? AND i.business_date = ? AND ${SOLD}
          GROUP BY d.kind ORDER BY sum(d.amount) DESC`,
      )
      .all(branchId, date);

    // Commission is charged on the food value (before GST, which the operator pays).
    const channels = db
      .prepare<
        [string, string],
        { name: string; orders: number; sales: number; taxable: number; commission_bp: number }
      >(
        `SELECT c.name, count(DISTINCT o.id) AS orders, coalesce(sum(i.grand_total), 0) AS sales,
                coalesce(sum(i.taxable_total), 0) AS taxable, c.commission_bp
           FROM orders o JOIN sales_channels c ON c.id = o.sales_channel_id
           LEFT JOIN invoices i ON i.order_id = o.id AND ${SOLD}
          WHERE o.branch_id = ? AND o.business_date = ? AND o.status <> 'CANCELLED' AND ${REAL_ORDER}
          GROUP BY c.id ORDER BY c.name`,
      )
      .all(branchId, date)
      .map((c) => {
        const commission = Math.round((c.taxable * c.commission_bp) / 10_000);
        return {
          name: c.name,
          orders: c.orders,
          sales: c.sales,
          commission,
          netRevenue: c.sales - commission,
        };
      });

    const today = this.calendar.businessDate(branchId, now);
    const shifts = db
      .prepare<
        [string, string, string, string],
        {
          openedBy: string | null;
          status: 'OPEN' | 'CLOSED';
          opening_float: number;
          expected_cash: number | null;
          live_cash: number;
          countedCash: number | null;
          variance: number | null;
        }
      >(
        `SELECT u.full_name AS openedBy, s.status, s.opening_float, s.expected_cash,
                coalesce((SELECT sum(p.amount) FROM payments p WHERE p.shift_id = s.id AND p.method = 'CASH'), 0) AS live_cash,
                s.counted_cash AS countedCash, s.variance
           FROM cash_shifts s LEFT JOIN users u ON u.id = s.opened_by
          WHERE s.branch_id = ?
            AND (s.id IN (SELECT shift_id FROM payments WHERE business_date = ? AND shift_id IS NOT NULL)
                 OR (s.status = 'OPEN' AND ? = ?))
          ORDER BY s.opened_at`,
      )
      .all(branchId, date, date, today)
      .map((r) => ({
        openedBy: r.openedBy,
        status: r.status,
        expectedCash: r.expected_cash ?? r.opening_float + r.live_cash,
        countedCash: r.countedCash,
        variance: r.variance,
      }));

    const kitchen = db
      .prepare<[string, string, string], { kots: number; avg: number | null; delayed: number }>(
        `SELECT count(*) AS kots, avg((julianday(ready_at) - julianday(fired_at)) * 86400) AS avg,
                coalesce(sum(coalesce(ready_at, ?) > target_ready_at), 0) AS delayed
           FROM kots WHERE branch_id = ? AND business_date = ? AND status <> 'CANCELLED'`,
      )
      .get(now.toISOString(), branchId, date)!;

    const hourOf = new Intl.DateTimeFormat('en-GB', {
      timeZone: branch.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const byHour = new Map<number, { hour: number; invoices: number; total: number }>();
    for (const row of db
      .prepare<[string, string], { created_at: string; grand_total: number }>(
        `SELECT i.created_at, i.grand_total FROM invoices i WHERE i.branch_id = ? AND i.business_date = ? AND ${SOLD}`,
      )
      .all(branchId, date)) {
      const hour = Number(hourOf.format(new Date(row.created_at)));
      const slot = byHour.get(hour) ?? { hour, invoices: 0, total: 0 };
      slot.invoices += 1;
      slot.total += row.grand_total;
      byHour.set(hour, slot);
    }

    return {
      businessDate: date,
      branchName: branch.name,
      generatedAt: now.toISOString(),
      orders,
      sales: {
        ...s,
        net: s.total - refunds.amount,
        averageBill: average(s.total, s.invoiceCount),
      },
      taxes,
      liquor,
      payments,
      refunds,
      cancellations: { ...cancelledInvoices, ...voids },
      discountsGiven,
      channels,
      shifts,
      topItems: this.topItems(branchId, date, date, 10),
      kitchen: { kots: kitchen.kots, avgCookSeconds: round(kitchen.avg), delayed: kitchen.delayed },
      hourly: [...byHour.values()].sort((a, b) => a.hour - b.hour),
    };
  }

  dashboard(branchId: string, date: string, now: Date): DashboardView {
    const db = this.db;
    const daily = this.dailySales(branchId, addDays(date, -13), date);
    const days: DashboardView['daily'] = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(date, -i);
      days.push(daily.get(d) ?? { date: d, sales: 0, invoices: 0 });
    }
    const kitchen = db
      .prepare<[string, string, string], { pending: number; delayed: number }>(
        `SELECT count(*) AS pending, coalesce(sum(target_ready_at < ?), 0) AS delayed
           FROM kots WHERE branch_id = ? AND business_date = ? AND status IN ${COOKING}`,
      )
      .get(now.toISOString(), branchId, date)!;
    const cook = db
      .prepare<[string, string], { avg: number | null }>(
        `SELECT avg((julianday(ready_at) - julianday(fired_at)) * 86400) AS avg
           FROM kots WHERE branch_id = ? AND business_date = ? AND ready_at IS NOT NULL AND status <> 'CANCELLED'`,
      )
      .get(branchId, date)!;
    const monthStart = `${date.slice(0, 7)}-01`;
    return {
      businessDate: date,
      today: this.period(branchId, date, date),
      month: this.period(branchId, monthStart, date),
      financialYear: this.period(branchId, financialYearStart(date), date),
      daily: days,
      paymentMix: db
        .prepare<[string, string], { method: string; amount: number }>(
          `SELECT method, sum(amount) AS amount FROM payments WHERE branch_id = ? AND business_date = ?
            GROUP BY method HAVING sum(amount) <> 0 ORDER BY sum(amount) DESC`,
        )
        .all(branchId, date),
      topItems: this.topItems(branchId, monthStart, date, 5),
      kitchen: { ...kitchen, avgCookSeconds: round(cook.avg) },
      openOrders: db
        .prepare<[string], number>(
          `SELECT count(*) FROM orders o WHERE o.branch_id = ? AND o.status IN ('OPEN','BILLED') AND ${REAL_ORDER}`,
        )
        .pluck()
        .get(branchId)!,
      openTables: db
        .prepare<[string], number>(
          `SELECT count(*) FROM dining_tables
            WHERE branch_id = ? AND current_order_id IS NOT NULL AND deleted_at IS NULL`,
        )
        .pluck()
        .get(branchId)!,
    };
  }

  salesRegister(branchId: string, from: string, to: string): SalesRegisterRow[] {
    return this.db
      .prepare<[string, string, string], SalesRegisterRow>(
        `SELECT i.business_date AS businessDate, i.invoice_no AS invoiceNo, i.kind, i.series, i.status,
                o.order_no AS orderNo, o.order_type AS orderType, c.name AS channel,
                i.customer_name AS customerName, i.customer_tax_id AS customerTaxId,
                i.subtotal, i.discount_total AS discount, i.charges_total AS charges, i.taxable_total AS taxable,
                coalesce(sum(CASE WHEN t.tax_code = 'CGST' THEN t.tax_amount END), 0) AS cgst,
                coalesce(sum(CASE WHEN t.tax_code = 'SGST' THEN t.tax_amount END), 0) AS sgst,
                coalesce(sum(CASE WHEN t.tax_code = 'IGST' THEN t.tax_amount END), 0) AS igst,
                coalesce(sum(CASE WHEN t.tax_code = 'VAT' THEN t.tax_amount END), 0) AS vat,
                coalesce(sum(CASE WHEN t.tax_code NOT IN ('CGST','SGST','IGST','VAT') THEN t.tax_amount END), 0) AS otherTax,
                i.round_off AS roundOff, i.grand_total AS total, i.created_at AS createdAt
           FROM invoices i JOIN orders o ON o.id = i.order_id
           LEFT JOIN sales_channels c ON c.id = o.sales_channel_id
           LEFT JOIN invoice_taxes t ON t.invoice_id = i.id
          WHERE i.branch_id = ? AND i.business_date BETWEEN ? AND ?
          GROUP BY i.id ORDER BY i.business_date, i.created_at, i.invoice_no`,
      )
      .all(branchId, from, to);
  }

  /** Net sales (invoices less credit notes) per business date. */
  private dailySales(branchId: string, from: string, to: string) {
    const rows = this.db
      .prepare<[string, string, string], { date: string; sales: number; invoices: number }>(
        `SELECT business_date AS date,
                sum(CASE WHEN kind = 'INVOICE' THEN grand_total ELSE -grand_total END) AS sales,
                count(CASE WHEN kind = 'INVOICE' THEN 1 END) AS invoices
           FROM invoices WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND status <> 'CANCELLED'
          GROUP BY business_date`,
      )
      .all(branchId, from, to);
    return new Map(rows.map((r) => [r.date, r]));
  }

  private period(branchId: string, from: string, to: string): PeriodView {
    let sales = 0;
    let invoices = 0;
    for (const d of this.dailySales(branchId, from, to).values()) {
      sales += d.sales;
      invoices += d.invoices;
    }
    const covers = this.db
      .prepare<[string, string, string], number>(
        `SELECT coalesce(sum(o.covers), 0) FROM orders o
          WHERE o.branch_id = ? AND o.business_date BETWEEN ? AND ? AND o.status NOT IN ('CANCELLED','VOID')
            AND o.merged_into_order_id IS NULL`,
      )
      .pluck()
      .get(branchId, from, to)!;
    return { from, to, sales, invoices, covers, averageBill: average(sales, invoices) };
  }

  private topItems(branchId: string, from: string, to: string, limit: number): TopItemView[] {
    return this.db
      .prepare<[string, string, string, number], TopItemView>(
        `SELECT l.description AS name, sum(l.quantity) AS quantity, sum(l.taxable_value) AS amount
           FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE i.branch_id = ? AND i.business_date BETWEEN ? AND ? AND ${SOLD}
          GROUP BY l.description ORDER BY sum(l.taxable_value) DESC, l.description LIMIT ?`,
      )
      .all(branchId, from, to, limit);
  }
}
