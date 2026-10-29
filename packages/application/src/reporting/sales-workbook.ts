import type { SalesFigures, SalesRegisterRow, SalesReportView } from './ports';
import type { CellValue, Column, Sheet, Workbook } from './workbook';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GROUPING = { day: 'Day', week: 'Week from', month: 'Month', year: 'Financial year' };

const money = (header: string): Column => ({ header, kind: 'money' });
const int = (header: string): Column => ({ header, kind: 'int' });
const text = (header: string, width?: number): Column =>
  width === undefined ? { header, kind: 'text' } : { header, kind: 'text', width };

const FIGURE_COLUMNS: Column[] = [
  int('Bills'),
  int('Orders'),
  int('Guests'),
  money('Gross'),
  money('Discounts'),
  money('Charges'),
  money('Taxable value'),
  money('Tax'),
  money('Round-off'),
  money('Total'),
  money('Credit notes'),
  money('Net sales'),
  money('Average bill'),
];
const figures = (f: SalesFigures): CellValue[] => [
  f.invoices,
  f.orders,
  f.covers,
  f.gross,
  f.discounts,
  f.charges,
  f.taxable,
  f.tax,
  f.roundOff,
  f.total,
  f.refunds,
  f.net,
  f.averageBill,
];

/** The sales report as a workbook: a summary, the periods, then each breakdown. */
export function salesReportWorkbook(r: SalesReportView): Workbook {
  const title = [
    `Sales report · ${r.branchName}`,
    `${r.from} to ${r.to} · generated ${r.generatedAt}`,
  ];
  const sheet = (name: string, columns: Column[], rows: CellValue[][], totals?: CellValue[]) =>
    ({ name, title, columns, rows, ...(totals ? { totals } : {}) }) satisfies Sheet;
  const sum = <T>(rows: readonly T[], f: (row: T) => number) =>
    rows.reduce((s, row) => s + f(row), 0);

  return {
    sheets: [
      sheet(
        'Summary',
        [text('Measure'), { header: 'Value', kind: 'money' }],
        [
          ['Net sales', r.totals.net],
          ['Total billed', r.totals.total],
          ['Credit notes', r.totals.refunds],
          ['Gross', r.totals.gross],
          ['Discounts', r.totals.discounts],
          ['Charges', r.totals.charges],
          ['Taxable value', r.totals.taxable],
          ['Tax', r.totals.tax],
          ['Average bill', r.totals.averageBill],
        ],
      ),
      sheet(
        'By period',
        [{ header: GROUPING[r.groupBy], kind: 'date' }, text('To', 12), ...FIGURE_COLUMNS],
        r.periods.map((p) => [p.key, p.to, ...figures(p)]),
        ['Total', null, ...figures(r.totals)],
      ),
      sheet(
        'Order types',
        [text('Order type'), int('Orders'), int('Guests'), money('Sales')],
        r.orderTypes.map((t) => [t.orderType, t.orders, t.covers, t.sales]),
        [
          'Total',
          sum(r.orderTypes, (t) => t.orders),
          sum(r.orderTypes, (t) => t.covers),
          sum(r.orderTypes, (t) => t.sales),
        ],
      ),
      sheet(
        'Channels',
        [text('Channel'), int('Orders'), money('Sales'), money('Commission'), money('Net revenue')],
        r.channels.map((c) => [c.name, c.orders, c.sales, c.commission, c.netRevenue]),
      ),
      sheet(
        'Payments',
        [text('Method'), int('Payments'), money('Amount')],
        r.payments.map((p) => [p.method, p.count, p.amount]),
        ['Total', sum(r.payments, (p) => p.count), sum(r.payments, (p) => p.amount)],
      ),
      sheet(
        'Categories',
        [text('Category'), int('Quantity'), money('Taxable value')],
        r.categories.map((c) => [c.name, c.quantity, c.amount]),
        ['Total', sum(r.categories, (c) => c.quantity), sum(r.categories, (c) => c.amount)],
      ),
      sheet(
        'Items',
        [text('Item', 36), text('Category'), int('Quantity'), money('Taxable value')],
        r.items.map((i) => [i.name, i.category, i.quantity, i.amount]),
      ),
      sheet(
        'Hours',
        [text('Hour', 10), int('Bills'), money('Total')],
        r.hourly.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.invoices, h.total]),
      ),
      sheet(
        'Weekdays',
        [text('Day', 12), int('Bills'), money('Total')],
        r.weekdays.map((d) => [WEEKDAYS[d.weekday] ?? String(d.weekday), d.invoices, d.total]),
      ),
      sheet(
        'Staff',
        [
          text('Name'),
          int('Orders taken'),
          int('Guests'),
          money('Their orders’ sales'),
          int('Bills made'),
          money('Billed'),
        ],
        r.staff.map((s) => [s.name, s.orders, s.covers, s.orderSales, s.bills, s.billed]),
      ),
      sheet(
        'Discounts',
        [text('Kind'), int('Count'), money('Amount')],
        r.discounts.map((d) => [d.kind, d.count, d.amount]),
      ),
      sheet(
        'Taxes',
        [
          text('Tax', 10),
          { header: 'Rate', kind: 'percent' },
          money('Taxable value'),
          money('Tax'),
        ],
        r.taxes.map((t) => [t.code, t.rateBp, t.taxable, t.tax]),
        ['Total', null, null, sum(r.taxes, (t) => t.tax)],
      ),
    ],
  };
}

/** Every invoice and credit note of a range, one per row (the sales register). */
export function salesRegisterWorkbook(
  rows: readonly SalesRegisterRow[],
  meta: { branchName: string; from: string; to: string },
): Workbook {
  const sign = (r: SalesRegisterRow) => (r.kind === 'CREDIT_NOTE' ? -1 : 1);
  return {
    sheets: [
      {
        name: 'Sales register',
        title: [`Sales register · ${meta.branchName}`, `${meta.from} to ${meta.to}`],
        columns: [
          { header: 'Business date', kind: 'date' },
          text('Number', 22),
          text('Kind', 12),
          text('Series', 8),
          text('Status', 12),
          text('Order', 10),
          text('Order type', 12),
          text('Channel', 14),
          text('Customer'),
          text('Customer GSTIN', 18),
          money('Subtotal'),
          money('Discount'),
          money('Charges'),
          money('Taxable value'),
          money('CGST'),
          money('SGST'),
          money('IGST'),
          money('VAT'),
          money('Other tax'),
          money('Round-off'),
          money('Total'),
        ],
        // Credit notes count against sales, so they are negative here.
        rows: rows.map((r) => [
          r.businessDate,
          r.invoiceNo,
          r.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice',
          r.series,
          r.status,
          r.orderNo,
          r.orderType,
          r.channel,
          r.customerName,
          r.customerTaxId,
          sign(r) * r.subtotal,
          sign(r) * r.discount,
          sign(r) * r.charges,
          sign(r) * r.taxable,
          sign(r) * r.cgst,
          sign(r) * r.sgst,
          sign(r) * r.igst,
          sign(r) * r.vat,
          sign(r) * r.otherTax,
          sign(r) * r.roundOff,
          sign(r) * r.total,
        ]),
      },
    ],
  };
}
