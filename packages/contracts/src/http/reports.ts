import { z } from 'zod';
import { CalendarDateSchema, PaiseSchema } from './common';

const Money = PaiseSchema;

/** The day-end report for one business day (docs/09 WP 5.7). Amounts in paise. */
export const DayEndReportSchema = z.object({
  businessDate: z.string(),
  branchName: z.string(),
  generatedAt: z.string(),
  orders: z.object({
    count: z.number().int(),
    dineIn: z.number().int(),
    takeaway: z.number().int(),
    delivery: z.number().int(),
    covers: z.number().int(),
    cancelled: z.number().int(),
    open: z.number().int(),
  }),
  /** Tax invoices of the day (not cancelled), before credit notes. */
  sales: z.object({
    invoiceCount: z.number().int(),
    gross: Money,
    discounts: Money,
    charges: Money,
    taxable: Money,
    tax: Money,
    roundOff: Money,
    total: Money,
    /** total − credit notes issued today. */
    net: Money,
    averageBill: Money,
  }),
  /** Per tax code and rate: what GSTR-1 / the VAT register need. */
  taxes: z.array(
    z.object({ code: z.string(), rateBp: z.number().int(), taxable: Money, tax: Money }),
  ),
  liquor: z.object({ invoiceCount: z.number().int(), total: Money, vat: Money }),
  payments: z.array(z.object({ method: z.string(), count: z.number().int(), amount: Money })),
  refunds: z.object({ creditNotes: z.number().int(), amount: Money }),
  cancellations: z.object({
    invoices: z.number().int(),
    invoiceValue: Money,
    /** Items cancelled after the kitchen had them. */
    voidedItems: z.number().int(),
    voidedValue: Money,
    wastageValue: Money,
  }),
  discountsGiven: z.array(z.object({ kind: z.string(), count: z.number().int(), amount: Money })),
  channels: z.array(
    z.object({
      name: z.string(),
      orders: z.number().int(),
      sales: Money,
      commission: Money,
      netRevenue: Money,
    }),
  ),
  shifts: z.array(
    z.object({
      openedBy: z.string().nullable(),
      status: z.enum(['OPEN', 'CLOSED']),
      expectedCash: Money,
      countedCash: Money.nullable(),
      variance: Money.nullable(),
    }),
  ),
  topItems: z.array(z.object({ name: z.string(), quantity: z.number().int(), amount: Money })),
  kitchen: z.object({
    kots: z.number().int(),
    avgCookSeconds: z.number().int().nullable(),
    delayed: z.number().int(),
  }),
  /** Local hour (0–23) of the bill. */
  hourly: z.array(z.object({ hour: z.number().int(), invoices: z.number().int(), total: Money })),
});
export type DayEndReport = z.infer<typeof DayEndReportSchema>;

const Period = z.object({
  from: z.string(),
  to: z.string(),
  sales: Money,
  invoices: z.number().int(),
  covers: z.number().int(),
  averageBill: Money,
});

/** The owner's dashboard: today, this month and this financial year at a glance. */
export const DashboardSchema = z.object({
  businessDate: z.string(),
  today: Period,
  month: Period,
  financialYear: Period,
  /** Net sales of each of the last 14 business days, oldest first. */
  daily: z.array(z.object({ date: z.string(), sales: Money, invoices: z.number().int() })),
  paymentMix: z.array(z.object({ method: z.string(), amount: Money })),
  topItems: z.array(z.object({ name: z.string(), quantity: z.number().int(), amount: Money })),
  kitchen: z.object({
    pending: z.number().int(),
    delayed: z.number().int(),
    avgCookSeconds: z.number().int().nullable(),
  }),
  openOrders: z.number().int(),
  openTables: z.number().int(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

// ---- report engine (Phase 5) -----------------------------------------------------

export const ReportGroupingSchema = z.enum(['day', 'week', 'month', 'year']);
export type ReportGrouping = z.infer<typeof ReportGroupingSchema>;

/** Business dates, both included. At most 1,830 days (5 years). */
export const ReportRangeQuerySchema = z.object({
  from: CalendarDateSchema,
  to: CalendarDateSchema,
});
export const SalesReportQuerySchema = ReportRangeQuerySchema.extend({
  /** Weeks start on Monday; years are Indian financial years (April to March). */
  groupBy: ReportGroupingSchema.default('day'),
});
export type SalesReportQuery = z.input<typeof SalesReportQuerySchema>;

const Int = z.number().int();
const SalesFiguresSchema = z.object({
  invoices: Int,
  orders: Int,
  covers: Int,
  gross: Money,
  discounts: Money,
  charges: Money,
  taxable: Money,
  tax: Money,
  roundOff: Money,
  total: Money,
  /** Credit notes issued in the period. */
  refunds: Money,
  /** total − refunds. */
  net: Money,
  averageBill: Money,
});
export type SalesFigures = z.infer<typeof SalesFiguresSchema>;

/** Sales over any range, by period, with the breakdowns owners ask for. Amounts in paise. */
export const SalesReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  groupBy: ReportGroupingSchema,
  branchName: z.string(),
  generatedAt: z.string(),
  totals: SalesFiguresSchema,
  /** Key: the date, the week's Monday, "YYYY-MM" or the financial year "2026-27". */
  periods: z.array(
    SalesFiguresSchema.extend({ key: z.string(), from: z.string(), to: z.string() }),
  ),
  orderTypes: z.array(z.object({ orderType: z.string(), orders: Int, covers: Int, sales: Money })),
  channels: z.array(
    z.object({
      name: z.string(),
      orders: Int,
      sales: Money,
      commission: Money,
      netRevenue: Money,
    }),
  ),
  payments: z.array(z.object({ method: z.string(), count: Int, amount: Money })),
  categories: z.array(z.object({ name: z.string(), quantity: Int, amount: Money })),
  /** Every dish sold (up to 1,000), by taxable value. */
  items: z.array(
    z.object({ name: z.string(), category: z.string().nullable(), quantity: Int, amount: Money }),
  ),
  hourly: z.array(z.object({ hour: Int, invoices: Int, total: Money })),
  /** 0 = Sunday. */
  weekdays: z.array(z.object({ weekday: Int, invoices: Int, total: Money })),
  /** Orders taken (captain) and bills made (cashier). */
  staff: z.array(
    z.object({
      name: z.string(),
      orders: Int,
      covers: Int,
      orderSales: Money,
      bills: Int,
      billed: Money,
    }),
  ),
  discounts: z.array(z.object({ kind: z.string(), count: Int, amount: Money })),
  taxes: z.array(z.object({ code: z.string(), rateBp: Int, taxable: Money, tax: Money })),
});
export type SalesReport = z.infer<typeof SalesReportSchema>;
