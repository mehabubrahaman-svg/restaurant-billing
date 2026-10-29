// Read models for reports (shapes match packages/contracts reports.ts). Amounts in paise.

export interface DayEndReportView {
  businessDate: string;
  branchName: string;
  generatedAt: string;
  orders: {
    count: number;
    dineIn: number;
    takeaway: number;
    delivery: number;
    covers: number;
    cancelled: number;
    open: number;
  };
  sales: {
    invoiceCount: number;
    gross: number;
    discounts: number;
    charges: number;
    taxable: number;
    tax: number;
    roundOff: number;
    total: number;
    net: number;
    averageBill: number;
  };
  taxes: { code: string; rateBp: number; taxable: number; tax: number }[];
  liquor: { invoiceCount: number; total: number; vat: number };
  payments: { method: string; count: number; amount: number }[];
  refunds: { creditNotes: number; amount: number };
  cancellations: {
    invoices: number;
    invoiceValue: number;
    voidedItems: number;
    voidedValue: number;
    wastageValue: number;
  };
  discountsGiven: { kind: string; count: number; amount: number }[];
  channels: {
    name: string;
    orders: number;
    sales: number;
    commission: number;
    netRevenue: number;
  }[];
  shifts: {
    openedBy: string | null;
    status: 'OPEN' | 'CLOSED';
    expectedCash: number;
    countedCash: number | null;
    variance: number | null;
  }[];
  topItems: TopItemView[];
  kitchen: { kots: number; avgCookSeconds: number | null; delayed: number };
  hourly: { hour: number; invoices: number; total: number }[];
}

export interface TopItemView {
  name: string;
  quantity: number;
  amount: number;
}

export interface PeriodView {
  from: string;
  to: string;
  sales: number;
  invoices: number;
  covers: number;
  averageBill: number;
}

export interface DashboardView {
  businessDate: string;
  today: PeriodView;
  month: PeriodView;
  financialYear: PeriodView;
  daily: { date: string; sales: number; invoices: number }[];
  paymentMix: { method: string; amount: number }[];
  topItems: TopItemView[];
  kitchen: { pending: number; delayed: number; avgCookSeconds: number | null };
  openOrders: number;
  openTables: number;
}

/** One row of the sales register: every invoice and credit note in a date range. */
export interface SalesRegisterRow {
  businessDate: string;
  invoiceNo: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  series: string;
  status: string;
  orderNo: string;
  orderType: string;
  channel: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  subtotal: number;
  discount: number;
  charges: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  vat: number;
  otherTax: number;
  roundOff: number;
  total: number;
  createdAt: string;
}

export interface ReportQueries {
  dayEnd(branchId: string, businessDate: string, now: Date): DayEndReportView;
  dashboard(branchId: string, businessDate: string, now: Date): DashboardView;
  salesRegister(branchId: string, from: string, to: string): SalesRegisterRow[];
  sales(
    branchId: string,
    from: string,
    to: string,
    groupBy: SalesReportView['groupBy'],
    now: Date,
  ): SalesReportView;
}

/** Money figures of a set of business days. Credit notes are `refunds`; `net` = total − refunds. */
export interface SalesFigures {
  invoices: number;
  orders: number;
  covers: number;
  gross: number;
  discounts: number;
  charges: number;
  taxable: number;
  tax: number;
  roundOff: number;
  total: number;
  refunds: number;
  net: number;
  averageBill: number;
}

/** The report engine's sales report: any range, grouped by day, week, month or financial year. */
export interface SalesReportView {
  from: string;
  to: string;
  groupBy: 'day' | 'week' | 'month' | 'year';
  branchName: string;
  generatedAt: string;
  totals: SalesFigures;
  periods: (SalesFigures & { key: string; from: string; to: string })[];
  orderTypes: { orderType: string; orders: number; covers: number; sales: number }[];
  channels: {
    name: string;
    orders: number;
    sales: number;
    commission: number;
    netRevenue: number;
  }[];
  payments: { method: string; count: number; amount: number }[];
  categories: { name: string; quantity: number; amount: number }[];
  items: { name: string; category: string | null; quantity: number; amount: number }[];
  hourly: { hour: number; invoices: number; total: number }[];
  /** 0 = Sunday. */
  weekdays: { weekday: number; invoices: number; total: number }[];
  /** Orders taken as captain, and bills made as cashier. */
  staff: {
    name: string;
    orders: number;
    covers: number;
    orderSales: number;
    bills: number;
    billed: number;
  }[];
  discounts: { kind: string; count: number; amount: number }[];
  taxes: { code: string; rateBp: number; taxable: number; tax: number }[];
}
