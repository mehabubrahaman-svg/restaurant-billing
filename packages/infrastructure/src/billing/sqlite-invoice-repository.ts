import type { InvoiceRepository } from '@restroos/application';
import { Invoice, type InvoiceState, type NewPayment } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';
import { uuidv7Generator } from '../system/uuidv7-generator';

interface InvoiceRow {
  id: string;
  branch_id: string;
  order_id: string;
  invoice_no: string;
  kind: InvoiceState['kind'];
  series: InvoiceState['series'];
  supply_type: InvoiceState['supplyType'];
  gst_paid_by_operator: number;
  original_invoice_id: string | null;
  business_date: string;
  fiscal_year: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  place_of_supply: string | null;
  subtotal: number;
  discount_total: number;
  charges_total: number;
  taxable_total: number;
  tax_total: number;
  round_off: number;
  grand_total: number;
  paid_total: number;
  refunded_total: number;
  status: InvoiceState['status'];
  print_count: number;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  approved_by: string | null;
  created_at: string;
  created_by: string;
  version: number;
}

type Bill = InvoiceState['bill'];

/** Invoices and credit notes. Lines, taxes and payments are append-only (triggers in 0001). */
export class SqliteInvoiceRepository implements InvoiceRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date,
    private readonly businessDate: (branchId: string, at: Date) => string,
  ) {}

  get(branchId: string, id: string): Invoice | undefined {
    const row = this.db
      .prepare<[string, string], InvoiceRow>(
        'SELECT * FROM invoices WHERE id = ? AND branch_id = ?',
      )
      .get(id, branchId);
    return row && this.restore(row);
  }

  forOrder(orderId: string): Invoice[] {
    return this.db
      .prepare<[string], InvoiceRow>(
        "SELECT * FROM invoices WHERE order_id = ? AND kind = 'INVOICE' ORDER BY created_at, invoice_no",
      )
      .all(orderId)
      .map((r) => this.restore(r));
  }

  refundedSoFar(invoiceId: string) {
    const rows = this.db
      .prepare<[string], { original_line_id: string | null; quantity: number }>(
        `SELECT l.original_line_id, l.quantity FROM invoice_lines l
           JOIN invoices cn ON cn.id = l.invoice_id
          WHERE cn.original_invoice_id = ? AND cn.kind = 'CREDIT_NOTE'`,
      )
      .all(invoiceId);
    const quantities = new Map<string, number>();
    let anyAmountRefunds = false;
    for (const r of rows) {
      if (r.quantity === 0) anyAmountRefunds = true;
      else if (r.original_line_id)
        quantities.set(r.original_line_id, (quantities.get(r.original_line_id) ?? 0) + r.quantity);
    }
    return { quantities, anyAmountRefunds };
  }

  paymentsOf(invoiceId: string): NewPayment[] {
    return this.db
      .prepare<
        [string],
        {
          id: string;
          method: NewPayment['method'];
          amount: number;
          tendered: number | null;
          change_due: number | null;
          reference: string | null;
          card_last4: string | null;
          terminal_label: string | null;
          shift_id: string | null;
          created_by: string;
        }
      >(
        `SELECT p.* FROM payments p
          WHERE p.invoice_id = ? AND p.amount > 0
            AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.refund_of_payment_id = p.id)
          ORDER BY p.created_at, p.rowid`,
      )
      .all(invoiceId)
      .map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        tendered: p.tendered,
        changeDue: p.change_due,
        reference: p.reference,
        cardLast4: p.card_last4,
        terminalLabel: p.terminal_label,
        refundOfPaymentId: null,
        shiftId: p.shift_id,
        createdBy: p.created_by,
      }));
  }

  insert(invoice: Invoice): void {
    const s = invoice.state;
    const b = s.bill;
    const at = s.createdAt.toISOString();
    this.db
      .prepare(
        `INSERT INTO invoices (id, branch_id, order_id, invoice_no, kind, series, supply_type, gst_paid_by_operator,
                               original_invoice_id, business_date, fiscal_year, customer_id, customer_name, customer_tax_id,
                               place_of_supply, subtotal, discount_total, charges_total, taxable_total, tax_total,
                               round_off, grand_total, paid_total, refunded_total, status, approved_by,
                               created_at, created_by, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invoice.id,
        s.branchId,
        s.orderId,
        s.invoiceNo,
        s.kind,
        s.series,
        s.supplyType,
        s.gstPaidByOperator ? 1 : 0,
        s.originalInvoiceId,
        s.businessDate,
        s.fiscalYear,
        s.customerId,
        s.customerName,
        s.customerTaxId,
        s.placeOfSupply,
        b.subtotal,
        b.discountTotal,
        b.chargesTotal,
        b.taxableTotal,
        b.taxTotal,
        b.roundOff,
        b.grandTotal,
        s.paidTotal,
        s.refundedTotal,
        s.status,
        s.approvedBy,
        at,
        s.createdBy,
        at,
        invoice.version,
      );
    const line = this.db.prepare(
      `INSERT INTO invoice_lines (id, invoice_id, order_item_id, description, hsn_sac_code, quantity, unit_price,
                                  discount, taxable_value, tax_amount, line_total, tax_group_id, tax_rate_bp,
                                  taxes_json, original_line_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of b.lines) {
      line.run(
        l.id,
        invoice.id,
        l.orderItemId,
        l.description,
        l.hsnSacCode,
        l.quantity,
        l.unitPrice,
        l.discount,
        l.taxableValue,
        l.taxAmount,
        l.lineTotal,
        l.taxGroupId,
        l.taxRateBp,
        JSON.stringify(l.taxes),
        l.originalLineId,
      );
    }
    const tax = this.db.prepare(
      'INSERT INTO invoice_taxes (id, invoice_id, tax_code, rate_bp, taxable_value, tax_amount) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const t of b.taxes)
      tax.run(uuidv7Generator.next(), invoice.id, t.code, t.rateBp, t.taxableValue, t.taxAmount);
    const discount = this.db.prepare(
      `INSERT INTO invoice_discounts (id, invoice_id, kind, coupon_id, coupon_code, value, amount, reason, approved_by,
                                      created_at, created_by)
       VALUES (?, ?, ?, (SELECT id FROM coupons WHERE code = ?), ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of b.discounts) {
      discount.run(
        uuidv7Generator.next(),
        invoice.id,
        d.kind,
        d.couponCode,
        d.couponCode,
        d.value,
        d.amount,
        d.reason,
        s.approvedBy,
        at,
        s.createdBy,
      );
    }
    const charge = this.db.prepare(
      `INSERT INTO invoice_charges (id, invoice_id, charge_rule_id, name, amount, tax_group_id, tax_amount, taxes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of b.charges) {
      charge.run(
        uuidv7Generator.next(),
        invoice.id,
        c.chargeRuleId,
        c.name,
        c.amount,
        c.taxGroupId,
        c.taxAmount,
        JSON.stringify(c.taxes),
      );
    }
    this.writePayments(invoice);
    invoice.markPersisted();
  }

  save(invoice: Invoice): void {
    const s = invoice.state;
    const result = this.db
      .prepare(
        `UPDATE invoices SET paid_total = ?, refunded_total = ?, status = ?, print_count = ?, cancel_reason = ?,
                cancelled_by = ?, cancelled_at = ?, approved_by = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        s.paidTotal,
        s.refundedTotal,
        s.status,
        s.printCount,
        s.cancelReason,
        s.cancelledBy,
        s.cancelledAt?.toISOString() ?? null,
        s.approvedBy,
        this.now().toISOString(),
        invoice.version,
        invoice.id,
        invoice.persistedVersion,
      );
    assertVersionMatched(result, 'Invoice', invoice.id);
    this.writePayments(invoice);
    invoice.markPersisted();
  }

  nextNumber(
    branchId: string,
    series: 'INV' | 'LIQ' | 'CN',
    fiscalYear: string,
    branchCode: string,
  ): string {
    const prefix =
      series === 'INV' ? `${branchCode}/${fiscalYear}/` : `${branchCode}/${series}/${fiscalYear}/`;
    // Gapless: the counter moves inside the invoice's own transaction (BEGIN IMMEDIATE).
    this.db
      .prepare(
        `INSERT INTO document_sequences (branch_id, series, fiscal_year, next_value, prefix) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (branch_id, series, fiscal_year) DO NOTHING`,
      )
      .run(branchId, series, fiscalYear, prefix);
    const row = this.db
      .prepare<[string, string, string], { next_value: number; prefix: string }>(
        `UPDATE document_sequences SET next_value = next_value + 1
          WHERE branch_id = ? AND series = ? AND fiscal_year = ?
          RETURNING next_value - 1 AS next_value, prefix`,
      )
      .get(branchId, series, fiscalYear)!;
    return `${row.prefix}${String(row.next_value).padStart(6, '0')}`;
  }

  private writePayments(invoice: Invoice): void {
    if (invoice.newPayments.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO payments (id, branch_id, invoice_id, method, amount, tendered, change_due, reference, card_last4,
                             terminal_label, refund_of_payment_id, business_date, shift_id, approved_by, created_at,
                             created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = this.now();
    const businessDate = this.businessDate(invoice.state.branchId, now);
    for (const p of invoice.newPayments.splice(0)) {
      insert.run(
        p.id,
        invoice.state.branchId,
        invoice.id,
        p.method,
        p.amount,
        p.tendered,
        p.changeDue,
        p.reference,
        p.cardLast4,
        p.terminalLabel,
        p.refundOfPaymentId,
        businessDate,
        p.shiftId,
        p.amount < 0 ? invoice.state.approvedBy : null,
        now.toISOString(),
        p.createdBy,
      );
    }
  }

  private restore(row: InvoiceRow): Invoice {
    const lines = this.db
      .prepare<
        [string],
        {
          id: string;
          order_item_id: string | null;
          description: string;
          hsn_sac_code: string | null;
          quantity: number;
          unit_price: number;
          discount: number;
          taxable_value: number;
          tax_amount: number;
          line_total: number;
          tax_group_id: string | null;
          tax_rate_bp: number;
          taxes_json: string;
          original_line_id: string | null;
        }
      >('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY rowid')
      .all(row.id);
    const taxes = this.db
      .prepare<
        [string],
        {
          code: Bill['taxes'][number]['code'];
          rateBp: number;
          taxableValue: number;
          taxAmount: number;
        }
      >(
        `SELECT tax_code AS code, rate_bp AS rateBp, taxable_value AS taxableValue, tax_amount AS taxAmount
           FROM invoice_taxes WHERE invoice_id = ? ORDER BY rowid`,
      )
      .all(row.id);
    const discounts = this.db
      .prepare<[string], Bill['discounts'][number]>(
        `SELECT kind, value, amount, coupon_code AS couponCode, reason FROM invoice_discounts
          WHERE invoice_id = ? ORDER BY rowid`,
      )
      .all(row.id);
    const charges = this.db
      .prepare<
        [string],
        {
          chargeRuleId: string | null;
          name: string;
          amount: number;
          taxGroupId: string | null;
          taxAmount: number;
          taxes: string;
        }
      >(
        `SELECT charge_rule_id AS chargeRuleId, name, amount, tax_group_id AS taxGroupId, tax_amount AS taxAmount,
                taxes_json AS taxes
           FROM invoice_charges WHERE invoice_id = ? ORDER BY rowid`,
      )
      .all(row.id);
    return Invoice.restore(row.id, row.version, {
      branchId: row.branch_id,
      orderId: row.order_id,
      invoiceNo: row.invoice_no,
      kind: row.kind,
      series: row.series,
      supplyType: row.supply_type,
      gstPaidByOperator: row.gst_paid_by_operator === 1,
      originalInvoiceId: row.original_invoice_id,
      businessDate: row.business_date,
      fiscalYear: row.fiscal_year,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerTaxId: row.customer_tax_id,
      placeOfSupply: row.place_of_supply,
      bill: {
        lines: lines.map((l) => ({
          id: l.id,
          orderItemId: l.order_item_id,
          description: l.description,
          hsnSacCode: l.hsn_sac_code,
          quantity: l.quantity,
          unitPrice: l.unit_price,
          taxGroupId: l.tax_group_id,
          discount: l.discount,
          taxableValue: l.taxable_value,
          taxRateBp: l.tax_rate_bp,
          taxes: JSON.parse(l.taxes_json) as Bill['lines'][number]['taxes'],
          taxAmount: l.tax_amount,
          lineTotal: l.line_total,
          originalLineId: l.original_line_id,
        })),
        charges: charges.map((c) => ({
          ...c,
          taxes: JSON.parse(c.taxes) as Bill['charges'][number]['taxes'],
        })),
        discounts,
        taxes,
        subtotal: row.subtotal,
        discountTotal: row.discount_total,
        chargesTotal: row.charges_total,
        taxableTotal: row.taxable_total,
        taxTotal: row.tax_total,
        roundOff: row.round_off,
        grandTotal: row.grand_total,
      },
      paidTotal: row.paid_total,
      refundedTotal: row.refunded_total,
      status: row.status,
      cancelReason: row.cancel_reason,
      cancelledBy: row.cancelled_by,
      cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
      approvedBy: row.approved_by,
      printCount: row.print_count,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by,
    });
  }
}
