import { z } from 'zod';
import { PaiseSchema } from './common';

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
