import type { DayEndReportView, SalesRegisterRow } from './ports';

type Cell = string | number | null;

/** RFC 4180 CSV with a BOM and CRLF, so Excel opens Hindi and Bengali text correctly. */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  const cell = (v: Cell) => {
    if (v === null) return '';
    const s = String(v);
    // A leading =, +, - or @ would run as a formula in a spreadsheet; plain numbers are fine.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Paise as rupees with two decimals, without grouping: what a spreadsheet parses. */
export const rupees = (paise: number) => hundredths(paise);
const pct = (bp: number) => hundredths(bp);

/** An integer in hundredths as a decimal string, without floating point. */
function hundredths(n: number): string {
  const abs = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** The day-end report as one sheet of labelled sections. */
export function dayEndCsv(r: DayEndReportView): string {
  const rows: Cell[][] = [];
  const section = (title: string, header: Cell[], body: Cell[][]) => {
    rows.push([], [title], header, ...body);
  };
  rows.push(
    ['Day-end report', r.branchName],
    ['Business date', r.businessDate],
    ['Generated', r.generatedAt],
  );
  section(
    'Sales',
    ['Measure', 'Amount (INR)'],
    [
      ['Invoices', r.sales.invoiceCount],
      ['Gross', rupees(r.sales.gross)],
      ['Discounts', rupees(r.sales.discounts)],
      ['Charges', rupees(r.sales.charges)],
      ['Taxable value', rupees(r.sales.taxable)],
      ['Tax', rupees(r.sales.tax)],
      ['Round-off', rupees(r.sales.roundOff)],
      ['Total', rupees(r.sales.total)],
      ['Credit notes', rupees(r.refunds.amount)],
      ['Net sales', rupees(r.sales.net)],
      ['Average bill', rupees(r.sales.averageBill)],
    ],
  );
  section(
    'Orders',
    ['Measure', 'Count'],
    [
      ['Orders', r.orders.count],
      ['Dine-in', r.orders.dineIn],
      ['Takeaway', r.orders.takeaway],
      ['Delivery', r.orders.delivery],
      ['Covers', r.orders.covers],
      ['Cancelled', r.orders.cancelled],
      ['Still open', r.orders.open],
    ],
  );
  section(
    'Taxes',
    ['Tax', 'Rate %', 'Taxable value', 'Tax'],
    r.taxes.map((t) => [t.code, pct(t.rateBp), rupees(t.taxable), rupees(t.tax)]),
  );
  section(
    'Liquor (separate bills)',
    ['Bills', 'Total', 'VAT'],
    [[r.liquor.invoiceCount, rupees(r.liquor.total), rupees(r.liquor.vat)]],
  );
  section(
    'Payments',
    ['Method', 'Count', 'Amount'],
    r.payments.map((p) => [p.method, p.count, rupees(p.amount)]),
  );
  section(
    'Discounts',
    ['Kind', 'Count', 'Amount'],
    r.discountsGiven.map((d) => [d.kind, d.count, rupees(d.amount)]),
  );
  section(
    'Cancellations',
    ['Measure', 'Count', 'Amount'],
    [
      ['Cancelled bills', r.cancellations.invoices, rupees(r.cancellations.invoiceValue)],
      [
        'Voided items (after KOT)',
        r.cancellations.voidedItems,
        rupees(r.cancellations.voidedValue),
      ],
      ['Wastage', null, rupees(r.cancellations.wastageValue)],
    ],
  );
  section(
    'Channels',
    ['Channel', 'Orders', 'Sales', 'Commission', 'Net revenue'],
    r.channels.map((c) => [
      c.name,
      c.orders,
      rupees(c.sales),
      rupees(c.commission),
      rupees(c.netRevenue),
    ]),
  );
  section(
    'Cash shifts',
    ['Opened by', 'Status', 'Expected cash', 'Counted cash', 'Variance'],
    r.shifts.map((s) => [
      s.openedBy,
      s.status,
      rupees(s.expectedCash),
      s.countedCash === null ? null : rupees(s.countedCash),
      s.variance === null ? null : rupees(s.variance),
    ]),
  );
  section(
    'Top items',
    ['Item', 'Quantity', 'Amount'],
    r.topItems.map((i) => [i.name, i.quantity, rupees(i.amount)]),
  );
  section(
    'By hour',
    ['Hour', 'Bills', 'Total'],
    r.hourly.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.invoices, rupees(h.total)]),
  );
  section(
    'Kitchen',
    ['KOTs', 'Average cook time (s)', 'Late'],
    [[r.kitchen.kots, r.kitchen.avgCookSeconds, r.kitchen.delayed]],
  );
  return toCsv(rows);
}

/** Invoice-wise register for the accountant (GSTR-1 / VAT returns). Credit notes are negative. */
export function salesRegisterCsv(rows: readonly SalesRegisterRow[]): string {
  const header = [
    'Business date',
    'Number',
    'Type',
    'Series',
    'Status',
    'Order',
    'Order type',
    'Channel',
    'Customer',
    'GSTIN',
    'Subtotal',
    'Discount',
    'Charges',
    'Taxable value',
    'CGST',
    'SGST',
    'IGST',
    'VAT',
    'Other tax',
    'Round-off',
    'Total',
    'Created at',
  ];
  return toCsv([
    header,
    ...rows.map((r) => {
      const sign = r.kind === 'CREDIT_NOTE' ? -1 : 1;
      const m = (v: number) => rupees(sign * v);
      return [
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
        m(r.subtotal),
        m(r.discount),
        m(r.charges),
        m(r.taxable),
        m(r.cgst),
        m(r.sgst),
        m(r.igst),
        m(r.vat),
        m(r.otherTax),
        m(r.roundOff),
        m(r.total),
        r.createdAt,
      ];
    }),
  ]);
}
