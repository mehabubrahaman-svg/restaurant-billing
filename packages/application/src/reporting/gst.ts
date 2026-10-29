// GST returns and the liquor VAT register (shapes match packages/contracts gst.ts). Amounts in paise.
import type { CellValue, Column, Sheet, Workbook } from './workbook';

export interface TaxHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}
export interface Taxed extends TaxHeads {
  taxable: number;
}

export interface ReturnHeader {
  from: string;
  to: string;
  branchName: string;
  gstin: string | null;
  stateCode: string;
  stateName: string;
  generatedAt: string;
  stateNames: Record<string, string>;
}

export interface HsnRow extends Taxed {
  hsn: string;
  description: string;
  uqc: string;
  quantity: number;
  rateBp: number;
  totalValue: number;
}

export interface Gstr1View extends ReturnHeader {
  b2b: (Taxed & {
    gstin: string;
    receiverName: string | null;
    invoiceNo: string;
    invoiceDate: string;
    invoiceValue: number;
    placeOfSupply: string;
    rateBp: number;
  })[];
  b2cl: (Taxed & {
    invoiceNo: string;
    invoiceDate: string;
    invoiceValue: number;
    placeOfSupply: string;
    rateBp: number;
  })[];
  b2cs: (Taxed & { placeOfSupply: string; rateBp: number })[];
  cdnr: (Taxed & {
    gstin: string;
    receiverName: string | null;
    noteNo: string;
    noteDate: string;
    noteValue: number;
    originalInvoiceNo: string | null;
    placeOfSupply: string;
    rateBp: number;
  })[];
  cdnur: (Taxed & {
    noteNo: string;
    noteDate: string;
    noteValue: number;
    originalInvoiceNo: string | null;
    placeOfSupply: string;
    rateBp: number;
  })[];
  exempt: {
    kind: 'INTER_REGISTERED' | 'INTRA_REGISTERED' | 'INTER_UNREGISTERED' | 'INTRA_UNREGISTERED';
    nilRated: number;
    exempted: number;
    nonGst: number;
  }[];
  hsn: { b2b: HsnRow[]; b2c: HsnRow[] };
  docs: {
    nature: 'INVOICE' | 'CREDIT_NOTE';
    series: string;
    fromNo: string;
    toNo: string;
    total: number;
    cancelled: number;
  }[];
  eco: { operator: string; operatorGstin: string | null; taxable: number }[];
}

export interface Gstr3bView extends ReturnHeader {
  outward: {
    taxable: Taxed;
    zeroRated: Taxed;
    nilExempt: number;
    reverseCharge: Taxed;
    nonGst: number;
  };
  ecoSupplies: number;
  interStateUnregistered: { placeOfSupply: string; taxable: number; igst: number }[];
  itc: { available: TaxHeads; allowed: boolean };
  inwardNonGst: { interState: number; intraState: number };
  payable: TaxHeads;
  creditCarriedForward: TaxHeads;
}

export interface VatRegisterView {
  from: string;
  to: string;
  branchName: string;
  vatTin: string | null;
  generatedAt: string;
  rows: {
    date: string;
    invoiceNo: string;
    kind: 'INVOICE' | 'CREDIT_NOTE';
    customerName: string | null;
    rateBp: number;
    taxable: number;
    vat: number;
    surcharge: number;
    total: number;
  }[];
  byRate: {
    rateBp: number;
    bills: number;
    taxable: number;
    vat: number;
    surcharge: number;
    total: number;
  }[];
  totals: { taxable: number; vat: number; surcharge: number; total: number };
}

export interface GstReturnQueries {
  gstr1(branchId: string, from: string, to: string, now: Date): Gstr1View;
  gstr3b(branchId: string, from: string, to: string, now: Date): Gstr3bView;
  vatRegister(branchId: string, from: string, to: string, now: Date): VatRegisterView;
}

// ---- workbooks ---------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-28 → 28-Oct-2026, the GST portal's date format. */
export function gstDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}

const money = (header: string): Column => ({ header, kind: 'money' });
const text = (header: string, width?: number): Column =>
  width === undefined ? { header, kind: 'text' } : { header, kind: 'text', width };
const rate = (header = 'Rate'): Column => ({ header, kind: 'percent' });

/** GSTR-1 as the offline tool's sheets (b2b, b2cl, b2cs, cdnr, cdnur, exemp, hsn, docs, eco). */
export function gstr1Workbook(r: Gstr1View): Workbook {
  const pos = (code: string) => `${code}-${r.stateNames[code] ?? code}`;
  const title = [
    `GSTR-1 · ${r.branchName} · GSTIN ${r.gstin ?? '(not registered)'}`,
    `${gstDate(r.from)} to ${gstDate(r.to)}`,
  ];
  const sheet = (name: string, columns: Column[], rows: CellValue[][]): Sheet => ({
    name,
    title,
    columns,
    rows,
  });
  const hsnSheet = (name: string, rows: HsnRow[]) =>
    sheet(
      name,
      [
        text('HSN', 10),
        text('Description', 30),
        text('UQC', 8),
        { header: 'Total Quantity', kind: 'int' },
        money('Total Value'),
        rate(),
        money('Taxable Value'),
        money('Integrated Tax Amount'),
        money('Central Tax Amount'),
        money('State/UT Tax Amount'),
        money('Cess Amount'),
      ],
      rows.map((h) => [
        h.hsn,
        h.description,
        h.uqc,
        h.quantity,
        h.totalValue,
        h.rateBp,
        h.taxable,
        h.igst,
        h.cgst,
        h.sgst,
        h.cess,
      ]),
    );
  const exemptLabels = {
    INTER_REGISTERED: 'Inter-State supplies to registered persons',
    INTRA_REGISTERED: 'Intra-State supplies to registered persons',
    INTER_UNREGISTERED: 'Inter-State supplies to unregistered persons',
    INTRA_UNREGISTERED: 'Intra-State supplies to unregistered persons',
  } as const;
  return {
    sheets: [
      sheet(
        'b2b',
        [
          text('GSTIN/UIN of Recipient', 18),
          text('Receiver Name'),
          text('Invoice Number', 22),
          text('Invoice date', 12),
          money('Invoice Value'),
          text('Place Of Supply', 20),
          text('Reverse Charge', 8),
          text('Applicable % of Tax Rate', 8),
          text('Invoice Type', 12),
          text('E-Commerce GSTIN', 18),
          rate(),
          money('Taxable Value'),
          money('Cess Amount'),
        ],
        r.b2b.map((b) => [
          b.gstin,
          b.receiverName,
          b.invoiceNo,
          gstDate(b.invoiceDate),
          b.invoiceValue,
          pos(b.placeOfSupply),
          'N',
          null,
          'Regular B2B',
          null,
          b.rateBp,
          b.taxable,
          b.cess,
        ]),
      ),
      sheet(
        'b2cl',
        [
          text('Invoice Number', 22),
          text('Invoice date', 12),
          money('Invoice Value'),
          text('Place Of Supply', 20),
          text('Applicable % of Tax Rate', 8),
          rate(),
          money('Taxable Value'),
          money('Cess Amount'),
          text('E-Commerce GSTIN', 18),
        ],
        r.b2cl.map((b) => [
          b.invoiceNo,
          gstDate(b.invoiceDate),
          b.invoiceValue,
          pos(b.placeOfSupply),
          null,
          b.rateBp,
          b.taxable,
          b.cess,
          null,
        ]),
      ),
      sheet(
        'b2cs',
        [
          text('Type', 6),
          text('Place Of Supply', 20),
          text('Applicable % of Tax Rate', 8),
          rate(),
          money('Taxable Value'),
          money('Cess Amount'),
          text('E-Commerce GSTIN', 18),
        ],
        r.b2cs.map((b) => ['OE', pos(b.placeOfSupply), null, b.rateBp, b.taxable, b.cess, null]),
      ),
      sheet(
        'cdnr',
        [
          text('GSTIN/UIN of Recipient', 18),
          text('Receiver Name'),
          text('Note Number', 22),
          text('Note Date', 12),
          text('Note Type', 8),
          text('Place Of Supply', 20),
          text('Reverse Charge', 8),
          text('Note Supply Type', 12),
          money('Note Value'),
          text('Applicable % of Tax Rate', 8),
          rate(),
          money('Taxable Value'),
          money('Cess Amount'),
        ],
        r.cdnr.map((c) => [
          c.gstin,
          c.receiverName,
          c.noteNo,
          gstDate(c.noteDate),
          'C',
          pos(c.placeOfSupply),
          'N',
          'Regular B2B',
          c.noteValue,
          null,
          c.rateBp,
          c.taxable,
          c.cess,
        ]),
      ),
      sheet(
        'cdnur',
        [
          text('UR Type', 8),
          text('Note Number', 22),
          text('Note Date', 12),
          text('Note Type', 8),
          text('Place Of Supply', 20),
          money('Note Value'),
          text('Applicable % of Tax Rate', 8),
          rate(),
          money('Taxable Value'),
          money('Cess Amount'),
        ],
        r.cdnur.map((c) => [
          'B2CL',
          c.noteNo,
          gstDate(c.noteDate),
          'C',
          pos(c.placeOfSupply),
          c.noteValue,
          null,
          c.rateBp,
          c.taxable,
          c.cess,
        ]),
      ),
      sheet(
        'exemp',
        [
          text('Description', 44),
          money('Nil Rated Supplies'),
          money('Exempted(other than nil rated/non GST supply)'),
          money('Non-GST Supplies'),
        ],
        r.exempt.map((e) => [exemptLabels[e.kind], e.nilRated, e.exempted, e.nonGst]),
      ),
      hsnSheet('hsn(b2b)', r.hsn.b2b),
      hsnSheet('hsn(b2c)', r.hsn.b2c),
      sheet(
        'docs',
        [
          text('Nature of Document', 30),
          text('Sr. No. From', 22),
          text('Sr. No. To', 22),
          { header: 'Total Number', kind: 'int' },
          { header: 'Cancelled', kind: 'int' },
        ],
        r.docs.map((d) => [
          d.nature === 'INVOICE' ? 'Invoices for outward supply' : 'Credit Note',
          d.fromNo,
          d.toNo,
          d.total,
          d.cancelled,
        ]),
      ),
      sheet(
        'eco',
        [
          text('Nature of Supply', 40),
          text('GSTIN of E-Commerce Operator', 18),
          text('E-Commerce Operator Name'),
          money('Net value of supplies'),
        ],
        r.eco.map((e) => ['Liable to pay tax u/s 9(5)', e.operatorGstin, e.operator, e.taxable]),
      ),
    ],
  };
}

/** GSTR-3B's tables, one row per line of the form. */
export function gstr3bWorkbook(r: Gstr3bView): Workbook {
  const heads = (t: TaxHeads) => [t.igst, t.cgst, t.sgst, t.cess];
  const taxed = (t: Taxed) => [t.taxable, ...heads(t)];
  const columns: Column[] = [
    text('Table', 8),
    text('Nature of supplies', 60),
    money('Total Taxable value'),
    money('Integrated Tax'),
    money('Central Tax'),
    money('State/UT Tax'),
    money('Cess'),
  ];
  const zero = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const rows: CellValue[][] = [
    [
      '3.1(a)',
      'Outward taxable supplies (other than zero rated, nil rated and exempted)',
      ...taxed(r.outward.taxable),
    ],
    ['3.1(b)', 'Outward taxable supplies (zero rated)', ...taxed(r.outward.zeroRated)],
    ['3.1(c)', 'Other outward supplies (nil rated, exempted)', r.outward.nilExempt, ...heads(zero)],
    ['3.1(d)', 'Inward supplies (liable to reverse charge)', ...taxed(r.outward.reverseCharge)],
    ['3.1(e)', 'Non-GST outward supplies', r.outward.nonGst, ...heads(zero)],
    [
      '3.1.1(ii)',
      'Taxable supplies made through e-commerce operators who pay tax u/s 9(5)',
      r.ecoSupplies,
      ...heads(zero),
    ],
    ...r.interStateUnregistered.map((s) => [
      '3.2',
      `Inter-State supplies to unregistered persons: ${s.placeOfSupply}-${r.stateNames[s.placeOfSupply] ?? s.placeOfSupply}`,
      s.taxable,
      s.igst,
      0,
      0,
      0,
    ]),
    ['4(A)(5)', 'All other ITC', null, ...heads(r.itc.available)],
    [
      '4(C)',
      r.itc.allowed
        ? 'Net ITC available'
        : 'Net ITC available (not used: restaurant service at 5%)',
      null,
      ...heads(r.itc.allowed ? r.itc.available : zero),
    ],
    [
      '5',
      'Inward exempt, nil rated and non-GST supplies: inter-State',
      r.inwardNonGst.interState,
      ...heads(zero),
    ],
    [
      '5',
      'Inward exempt, nil rated and non-GST supplies: intra-State',
      r.inwardNonGst.intraState,
      ...heads(zero),
    ],
    ['6.1', 'Tax payable after input tax credit', null, ...heads(r.payable)],
    ['', 'Credit carried forward', null, ...heads(r.creditCarriedForward)],
  ];
  return {
    sheets: [
      {
        name: 'GSTR-3B',
        title: [
          `GSTR-3B · ${r.branchName} · GSTIN ${r.gstin ?? '(not registered)'}`,
          `${gstDate(r.from)} to ${gstDate(r.to)}`,
        ],
        columns,
        rows,
      },
    ],
  };
}

/** The liquor VAT sales register: bills, then the summary by rate. */
export function vatRegisterWorkbook(r: VatRegisterView): Workbook {
  const title = [
    `VAT sales register (liquor) · ${r.branchName} · VAT TIN ${r.vatTin ?? '—'}`,
    `${gstDate(r.from)} to ${gstDate(r.to)}`,
  ];
  return {
    sheets: [
      {
        name: 'Register',
        title,
        columns: [
          { header: 'Date', kind: 'date' },
          text('Bill', 24),
          text('Kind', 12),
          text('Customer'),
          rate('VAT rate'),
          money('Taxable value'),
          money('VAT'),
          money('Surcharge'),
          money('Total'),
        ],
        rows: r.rows.map((x) => [
          x.date,
          x.invoiceNo,
          x.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice',
          x.customerName,
          x.rateBp,
          x.taxable,
          x.vat,
          x.surcharge,
          x.total,
        ]),
        totals: [
          'Total',
          null,
          null,
          null,
          null,
          r.totals.taxable,
          r.totals.vat,
          r.totals.surcharge,
          r.totals.total,
        ],
      },
      {
        name: 'By rate',
        title,
        columns: [
          rate('VAT rate'),
          { header: 'Bills', kind: 'int' },
          money('Taxable value'),
          money('VAT'),
          money('Surcharge'),
          money('Total'),
        ],
        rows: r.byRate.map((x) => [x.rateBp, x.bills, x.taxable, x.vat, x.surcharge, x.total]),
      },
    ],
  };
}
