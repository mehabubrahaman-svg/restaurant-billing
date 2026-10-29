import type {
  GstReturnQueries,
  Gstr1View,
  Gstr3bView,
  HsnRow,
  ReturnHeader,
  TaxHeads,
  Taxed,
  VatRegisterView,
} from '@restroos/application';
import type { SqliteDatabase } from '../db/connection';

/** B2C invoices above this, to another state, are B2CL (GSTR-1 table 5). */
const B2CL_ABOVE = 1_00_000_00;
/** Restaurant service (SAC 996331): for lines without a code and for charges. */
const RESTAURANT_SAC = '996331';

/** One invoice line or charge of the period, with what GSTR-1 needs about its invoice. */
interface Row {
  invoiceId: string;
  invoiceNo: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  date: string;
  supplyType: 'B2B' | 'B2C';
  operator: number;
  gstin: string | null;
  customerName: string | null;
  pos: string;
  invoiceTotal: number;
  originalNo: string | null;
  originalPos: string | null;
  originalTotal: number | null;
  channelId: string | null;
  taxType: 'GST' | 'VAT' | 'NONE';
  category: 'TAXABLE' | 'NIL_RATED' | 'EXEMPT' | 'NON_GST';
  hsn: string | null;
  description: string;
  quantity: number;
  rateBp: number;
  taxable: number;
  taxes: string;
}

type Kind = 'GST' | 'NIL' | 'EXEMPT' | 'NON_GST' | 'ECO';

const zeroHeads = (): TaxHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const zeroTaxed = (): Taxed => ({ taxable: 0, ...zeroHeads() });

function addTaxed(into: Taxed, from: Taxed, sign = 1): void {
  into.taxable += sign * from.taxable;
  into.igst += sign * from.igst;
  into.cgst += sign * from.cgst;
  into.sgst += sign * from.sgst;
  into.cess += sign * from.cess;
}

/** GSTR-1, GSTR-3B and the liquor VAT register from the bills and the books (docs/05 §3 Reports). */
export class SqliteGstQueries implements GstReturnQueries {
  constructor(private readonly db: SqliteDatabase) {}

  gstr1(branchId: string, from: string, to: string, now: Date): Gstr1View {
    const header = this.header(branchId, from, to, now);
    const rows = this.rows(branchId, from, to, header.stateCode);
    const inter = (pos: string) => pos !== header.stateCode;
    const view: Gstr1View = {
      ...header,
      b2b: [],
      b2cl: [],
      b2cs: [],
      cdnr: [],
      cdnur: [],
      exempt: [],
      hsn: { b2b: [], b2c: [] },
      docs: this.docs(branchId, from, to),
      eco: [],
    };
    // Grouped as it is read: per invoice and rate, per place and rate, per HSN and rate.
    const perDoc = new Map<string, Taxed & { row: Row }>();
    const b2cs = new Map<string, Taxed & { pos: string; rateBp: number }>();
    const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
    const exempt = new Map<Gstr1View['exempt'][number]['kind'], Gstr1View['exempt'][number]>();
    for (const kind of [
      'INTER_REGISTERED',
      'INTRA_REGISTERED',
      'INTER_UNREGISTERED',
      'INTRA_UNREGISTERED',
    ] as const) {
      exempt.set(kind, { kind, nilRated: 0, exempted: 0, nonGst: 0 });
    }
    const eco = new Map<string | null, number>();

    for (const row of rows) {
      const kind = kindOf(row);
      const sign = row.kind === 'CREDIT_NOTE' ? -1 : 1;
      const amounts = taxedOf(row);
      if (kind === 'ECO') {
        eco.set(row.channelId, (eco.get(row.channelId) ?? 0) + sign * row.taxable);
        continue;
      }
      if (kind !== 'GST') {
        const bucket = exempt.get(
          `${inter(row.pos) ? 'INTER' : 'INTRA'}_${row.supplyType === 'B2B' ? 'REGISTERED' : 'UNREGISTERED'}`,
        )!;
        const field = kind === 'NIL' ? 'nilRated' : kind === 'EXEMPT' ? 'exempted' : 'nonGst';
        bucket[field] += sign * row.taxable;
        if (kind === 'NON_GST') continue;
      }
      addHsn(row.supplyType === 'B2B' ? hsn.b2b : hsn.b2c, row, amounts, sign);
      if (kind !== 'GST') continue;

      const b2b = row.supplyType === 'B2B' && row.gstin !== null;
      const b2cl =
        !b2b &&
        (row.kind === 'INVOICE'
          ? inter(row.pos) && row.invoiceTotal > B2CL_ABOVE
          : row.originalPos !== null &&
            inter(row.originalPos) &&
            (row.originalTotal ?? 0) > B2CL_ABOVE);
      if (b2b || b2cl) {
        const key = `${row.invoiceId}|${row.rateBp}`;
        const doc = perDoc.get(key) ?? { ...zeroTaxed(), row };
        addTaxed(doc, amounts);
        perDoc.set(key, doc);
        continue;
      }
      const key = `${row.pos}|${row.rateBp}`;
      const place = b2cs.get(key) ?? { ...zeroTaxed(), pos: row.pos, rateBp: row.rateBp };
      addTaxed(place, amounts, sign);
      b2cs.set(key, place);
    }

    for (const { row, ...t } of perDoc.values()) {
      const b2b = row.supplyType === 'B2B' && row.gstin !== null;
      if (row.kind === 'INVOICE') {
        const common = {
          invoiceNo: row.invoiceNo,
          invoiceDate: row.date,
          invoiceValue: row.invoiceTotal,
          placeOfSupply: row.pos,
          rateBp: row.rateBp,
          ...t,
        };
        if (b2b) view.b2b.push({ gstin: row.gstin!, receiverName: row.customerName, ...common });
        else view.b2cl.push(common);
      } else {
        const common = {
          noteNo: row.invoiceNo,
          noteDate: row.date,
          noteValue: row.invoiceTotal,
          originalInvoiceNo: row.originalNo,
          placeOfSupply: row.pos,
          rateBp: row.rateBp,
          ...t,
        };
        if (b2b) view.cdnr.push({ gstin: row.gstin!, receiverName: row.customerName, ...common });
        else view.cdnur.push(common);
      }
    }
    view.b2cs = [...b2cs.values()]
      .filter((p) => p.taxable !== 0)
      .map(({ pos, rateBp, ...t }) => ({ placeOfSupply: pos, rateBp, ...t }))
      .sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rateBp - b.rateBp);
    view.hsn = {
      b2b: [...hsn.b2b.values()].sort(byHsn),
      b2c: [...hsn.b2c.values()].sort(byHsn),
    };
    view.exempt = [...exempt.values()];
    const channels = new Map(
      this.db
        .prepare<[], { id: string; name: string; operatorGstin: string | null }>(
          'SELECT id, name, operator_gstin AS operatorGstin FROM sales_channels',
        )
        .all()
        .map((c) => [c.id, c]),
    );
    view.eco = [...eco.entries()].map(([channelId, taxable]) => {
      const c = channelId === null ? undefined : channels.get(channelId);
      return { operator: c?.name ?? '—', operatorGstin: c?.operatorGstin ?? null, taxable };
    });
    for (const d of [...view.b2b, ...view.b2cl, ...view.b2cs, ...view.cdnr, ...view.cdnur]) {
      view.stateNames[d.placeOfSupply] ??= '';
    }
    return this.named(view);
  }

  gstr3b(branchId: string, from: string, to: string, now: Date): Gstr3bView {
    const header = this.header(branchId, from, to, now);
    const outward = zeroTaxed();
    let nilExempt = 0;
    let nonGst = 0;
    let ecoSupplies = 0;
    // Stays true while every GST line is at 5% (and when there is none).
    let onlyFivePercent = true;
    const interState = new Map<string, { taxable: number; igst: number }>();
    for (const row of this.rows(branchId, from, to, header.stateCode)) {
      const kind = kindOf(row);
      const sign = row.kind === 'CREDIT_NOTE' ? -1 : 1;
      if (kind === 'ECO') ecoSupplies += sign * row.taxable;
      else if (kind === 'NIL' || kind === 'EXEMPT') nilExempt += sign * row.taxable;
      else if (kind === 'NON_GST') nonGst += sign * row.taxable;
      else {
        const t = taxedOf(row);
        addTaxed(outward, t, sign);
        if (row.rateBp !== 500) onlyFivePercent = false;
        if (row.supplyType === 'B2C' && row.pos !== header.stateCode) {
          const p = interState.get(row.pos) ?? { taxable: 0, igst: 0 };
          p.taxable += sign * t.taxable;
          p.igst += sign * t.igst;
          interState.set(row.pos, p);
        }
      }
    }
    const tag = (name: string) =>
      this.db
        .prepare<[string, string, string, string], number>(
          `SELECT coalesce(sum(jl.debit - jl.credit), 0)
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
             JOIN accounts a ON a.id = jl.account_id
            WHERE je.branch_id = ? AND je.entry_date BETWEEN ? AND ? AND a.system_tag = ?`,
        )
        .pluck()
        .get(branchId, from, to, name)!;
    const available = {
      igst: tag('INPUT_IGST'),
      cgst: tag('INPUT_CGST'),
      sgst: tag('INPUT_SGST'),
      cess: 0,
    };
    // Restaurant service at 5% is without input tax credit; any other rate means credit applies.
    const allowed = !onlyFivePercent;
    const usable = allowed ? available : zeroHeads();
    const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
    const payable = zeroHeads();
    const creditCarriedForward = zeroHeads();
    for (const h of heads) {
      payable[h] = Math.max(0, outward[h] - usable[h]);
      creditCarriedForward[h] = Math.max(0, usable[h] - outward[h]);
    }
    const unregistered = this.db
      .prepare<[string, string, string], number>(
        `SELECT coalesce(sum(grand_total), 0) FROM grns
          WHERE branch_id = ? AND status = 'POSTED' AND input_tax_kind = 'NONE'
            AND business_date BETWEEN ? AND ?`,
      )
      .pluck()
      .get(branchId, from, to)!;
    const view: Gstr3bView = {
      ...header,
      outward: {
        taxable: outward,
        zeroRated: zeroTaxed(),
        nilExempt,
        reverseCharge: zeroTaxed(),
        nonGst,
      },
      ecoSupplies,
      interStateUnregistered: [...interState.entries()]
        .filter(([, p]) => p.taxable !== 0)
        .map(([placeOfSupply, p]) => ({ placeOfSupply, ...p }))
        .sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply)),
      itc: { available, allowed },
      // Unregistered vendors have no GSTIN to tell their state: counted as intra-state.
      inwardNonGst: { interState: 0, intraState: unregistered },
      payable,
      creditCarriedForward,
    };
    for (const s of view.interStateUnregistered) view.stateNames[s.placeOfSupply] ??= '';
    return this.named(view);
  }

  vatRegister(branchId: string, from: string, to: string, now: Date): VatRegisterView {
    const branch = this.db
      .prepare<[string], { name: string; vatTin: string | null }>(
        'SELECT name, vat_tin AS vatTin FROM branches WHERE id = ?',
      )
      .get(branchId) ?? { name: '', vatTin: null };
    const rows = new Map<string, VatRegisterView['rows'][number]>();
    for (const row of this.rows(branchId, from, to, '')) {
      if (row.taxType !== 'VAT') continue;
      const sign = row.kind === 'CREDIT_NOTE' ? -1 : 1;
      const taxes = JSON.parse(row.taxes) as { code: string; rateBp: number; amount: number }[];
      const vat = taxes.filter((t) => t.code === 'VAT');
      const rateBp = vat[0]?.rateBp ?? 0;
      const amount = (code: string) =>
        sign * taxes.filter((t) => t.code === code).reduce((s, t) => s + t.amount, 0);
      const key = `${row.invoiceId}|${rateBp}`;
      const r = rows.get(key) ?? {
        date: row.date,
        invoiceNo: row.invoiceNo,
        kind: row.kind,
        customerName: row.customerName,
        rateBp,
        taxable: 0,
        vat: 0,
        surcharge: 0,
        total: 0,
      };
      r.taxable += sign * row.taxable;
      r.vat += amount('VAT');
      r.surcharge += amount('SURCHARGE');
      r.total = r.taxable + r.vat + r.surcharge;
      rows.set(key, r);
    }
    const list = [...rows.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo),
    );
    const byRate = new Map<number, VatRegisterView['byRate'][number]>();
    const totals = { taxable: 0, vat: 0, surcharge: 0, total: 0 };
    for (const r of list) {
      const g = byRate.get(r.rateBp) ?? {
        rateBp: r.rateBp,
        bills: 0,
        taxable: 0,
        vat: 0,
        surcharge: 0,
        total: 0,
      };
      if (r.kind === 'INVOICE') g.bills += 1;
      for (const k of ['taxable', 'vat', 'surcharge', 'total'] as const) {
        g[k] += r[k];
        totals[k] += r[k];
      }
      byRate.set(r.rateBp, g);
    }
    return {
      from,
      to,
      branchName: branch.name,
      vatTin: branch.vatTin,
      generatedAt: now.toISOString(),
      rows: list,
      byRate: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp),
      totals,
    };
  }

  private header(branchId: string, from: string, to: string, now: Date): ReturnHeader {
    const b = this.db
      .prepare<
        [string],
        { branchName: string; gstin: string | null; stateCode: string; stateName: string }
      >(
        `SELECT b.name AS branchName, b.tax_id AS gstin, b.state_code AS stateCode, s.name AS stateName
           FROM branches b JOIN indian_states s ON s.gst_state_code = b.state_code WHERE b.id = ?`,
      )
      .get(branchId) ?? { branchName: '', gstin: null, stateCode: '', stateName: '' };
    return {
      from,
      to,
      ...b,
      generatedAt: now.toISOString(),
      stateNames: { [b.stateCode]: b.stateName },
    };
  }

  /** Fills in the names of the places of supply that were marked with ''. */
  private named<T extends ReturnHeader>(view: T): T {
    const missing = Object.keys(view.stateNames).filter((c) => view.stateNames[c] === '');
    if (missing.length === 0) return view;
    for (const s of this.db
      .prepare<string[], { code: string; name: string }>(
        `SELECT gst_state_code AS code, name FROM indian_states
          WHERE gst_state_code IN (${missing.map(() => '?').join(', ')})`,
      )
      .all(...missing)) {
      view.stateNames[s.code] = s.name;
    }
    return view;
  }

  /** Lines and charges of the period's bills and credit notes, cancelled ones left out. */
  private rows(branchId: string, from: string, to: string, state: string): Row[] {
    const invoice = `i.id AS invoiceId, i.invoice_no AS invoiceNo, i.kind, i.business_date AS date,
           i.supply_type AS supplyType, i.gst_paid_by_operator AS operator, i.customer_tax_id AS gstin,
           i.customer_name AS customerName, coalesce(i.place_of_supply, @state) AS pos,
           i.grand_total AS invoiceTotal, oi.invoice_no AS originalNo, oi.place_of_supply AS originalPos,
           oi.grand_total AS originalTotal, o.sales_channel_id AS channelId,
           coalesce(tg.tax_type, 'GST') AS taxType, coalesce(tg.tax_category, 'TAXABLE') AS category`;
    const joins = `JOIN orders o ON o.id = i.order_id LEFT JOIN invoices oi ON oi.id = i.original_invoice_id`;
    const where = `i.branch_id = @branchId AND i.business_date BETWEEN @from AND @to AND i.status <> 'CANCELLED'`;
    return this.db
      .prepare<{ branchId: string; from: string; to: string; state: string }, Row>(
        `SELECT ${invoice}, l.hsn_sac_code AS hsn, l.description, l.quantity, l.tax_rate_bp AS rateBp,
                l.taxable_value AS taxable, l.taxes_json AS taxes
           FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id ${joins}
           LEFT JOIN tax_groups tg ON tg.id = l.tax_group_id
          WHERE ${where}
         UNION ALL
         SELECT ${invoice}, NULL, c.name, 0,
                coalesce((SELECT sum(json_extract(t.value, '$.rateBp')) FROM json_each(c.taxes_json) t), 0),
                c.amount, c.taxes_json
           FROM invoice_charges c JOIN invoices i ON i.id = c.invoice_id ${joins}
           LEFT JOIN tax_groups tg ON tg.id = c.tax_group_id
          WHERE ${where}`,
      )
      .all({ branchId, from, to, state });
  }

  /** GSTR-1 table 13: the period's documents per series, cancelled ones included. */
  private docs(branchId: string, from: string, to: string): Gstr1View['docs'] {
    return this.db
      .prepare<
        [string, string, string],
        {
          kind: 'INVOICE' | 'CREDIT_NOTE';
          series: string;
          fromNo: string;
          toNo: string;
          total: number;
          cancelled: number;
        }
      >(
        `SELECT kind, series, min(invoice_no) AS fromNo, max(invoice_no) AS toNo, count(*) AS total,
                coalesce(sum(status = 'CANCELLED'), 0) AS cancelled
           FROM invoices WHERE branch_id = ? AND business_date BETWEEN ? AND ?
          GROUP BY kind, series ORDER BY kind DESC, series`,
      )
      .all(branchId, from, to)
      .map(({ kind, ...d }) => ({ nature: kind, ...d }));
  }
}

/** How a line is returned: GST tables, nil-rated, exempt, non-GST (liquor), or the operator's (9(5)). */
function kindOf(row: Row): Kind {
  if (row.taxType === 'VAT' || row.category === 'NON_GST') return 'NON_GST';
  if (row.operator === 1) return 'ECO';
  if (row.category === 'EXEMPT') return 'EXEMPT';
  if (row.category === 'NIL_RATED' || row.rateBp === 0) return 'NIL';
  return 'GST';
}

function taxedOf(row: Row): Taxed {
  const taxes = JSON.parse(row.taxes) as { code: string; amount: number }[];
  const sum = (code: string) =>
    taxes.filter((t) => t.code === code).reduce((s, t) => s + t.amount, 0);
  return {
    taxable: row.taxable,
    igst: sum('IGST'),
    cgst: sum('CGST'),
    sgst: sum('SGST'),
    cess: sum('CESS'),
  };
}

function addHsn(into: Map<string, HsnRow>, row: Row, t: Taxed, sign: number): void {
  const code = row.hsn?.trim() || RESTAURANT_SAC;
  const service = code.startsWith('99');
  const key = `${code}|${row.rateBp}`;
  const h = into.get(key) ?? {
    hsn: code,
    description: row.hsn ? row.description : 'Restaurant service',
    uqc: service ? 'NA' : 'NOS',
    quantity: 0,
    rateBp: row.rateBp,
    totalValue: 0,
    ...zeroTaxed(),
  };
  if (!service) h.quantity += sign * row.quantity;
  addTaxed(h, t, sign);
  h.totalValue = h.taxable + h.igst + h.cgst + h.sgst + h.cess;
  into.set(key, h);
}

const byHsn = (a: HsnRow, b: HsnRow) => a.hsn.localeCompare(b.hsn) || a.rateBp - b.rateBp;
