import type {
  BillingQueries,
  InvoiceRepository,
  InvoiceSummaryView,
  InvoiceView,
  ShiftReportView,
} from '@restroos/application';
import type { Invoice, PaymentMethod } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';

interface Extra {
  order_no: string;
  order_type: string;
  table_label: string | null;
  token_no: number | null;
  created_by_name: string | null;
}

/** Invoices as the POS shows them, and the X/Z shift report. */
export class SqliteBillingQueries implements BillingQueries {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly invoices: InvoiceRepository,
  ) {}

  invoice(branchId: string, id: string): InvoiceView | undefined {
    const invoice = this.invoices.get(branchId, id);
    return invoice && this.view(invoice);
  }

  forOrder(branchId: string, orderId: string): InvoiceView[] {
    return this.invoices
      .forOrder(orderId)
      .filter((i) => i.state.branchId === branchId)
      .map((i) => this.view(i));
  }

  creditNotes(branchId: string, invoiceId: string): InvoiceView[] {
    return this.db
      .prepare<[string, string], string>(
        `SELECT id FROM invoices WHERE original_invoice_id = ? AND branch_id = ? AND kind = 'CREDIT_NOTE'
          ORDER BY created_at, invoice_no`,
      )
      .pluck()
      .all(invoiceId, branchId)
      .map((id) => this.invoice(branchId, id)!);
  }

  summary(branchId: string, id: string): InvoiceSummaryView | undefined {
    return this.list(branchId, null, undefined, id)[0];
  }

  list(
    branchId: string,
    businessDate: string | null,
    status?: string,
    id?: string,
  ): InvoiceSummaryView[] {
    return this.db
      .prepare<
        [
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
        ],
        InvoiceSummaryView
      >(
        `SELECT i.id, i.invoice_no AS invoiceNo, i.kind, i.series, i.order_id AS orderId, o.order_no AS orderNo,
                o.order_type AS orderType, t.label AS tableLabel, o.token_no AS tokenNo, i.business_date AS businessDate,
                i.grand_total AS grandTotal, i.paid_total AS paidTotal,
                CASE WHEN i.kind = 'INVOICE' AND i.status NOT IN ('CANCELLED') THEN i.grand_total - i.paid_total ELSE 0 END AS balance,
                i.status, i.created_at AS createdAt, i.version
           FROM invoices i JOIN orders o ON o.id = i.order_id LEFT JOIN dining_tables t ON t.id = o.dining_table_id
          WHERE i.branch_id = ? AND (? IS NULL OR i.business_date = ?) AND (? IS NULL OR i.status = ?)
            AND (? IS NULL OR i.id = ?)
          ORDER BY i.created_at DESC, i.invoice_no DESC`,
      )
      .all(
        branchId,
        businessDate,
        businessDate,
        status ?? null,
        status ?? null,
        id ?? null,
        id ?? null,
      );
  }

  shiftReport(branchId: string, id: string): ShiftReportView | undefined {
    const shift = this.db
      .prepare<
        [string, string],
        {
          id: string;
          status: 'OPEN' | 'CLOSED';
          opened_at: string;
          opened_by_name: string | null;
          closed_at: string | null;
          closed_by_name: string | null;
          opening_float: number;
          expected_cash: number | null;
          counted_cash: number | null;
          variance: number | null;
          version: number;
        }
      >(
        `SELECT s.id, s.status, s.opened_at, ou.full_name AS opened_by_name, s.closed_at, cu.full_name AS closed_by_name,
                s.opening_float, s.expected_cash, s.counted_cash, s.variance, s.version
           FROM cash_shifts s LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users cu ON cu.id = s.closed_by
          WHERE s.id = ? AND s.branch_id = ?`,
      )
      .get(id, branchId);
    if (!shift) return undefined;
    const totals = this.db
      .prepare<[string], { sales: number; refunds: number; invoices: number }>(
        `SELECT coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0) AS sales,
                coalesce(-sum(CASE WHEN amount < 0 THEN amount END), 0) AS refunds,
                count(DISTINCT CASE WHEN amount > 0 THEN invoice_id END) AS invoices
           FROM payments WHERE shift_id = ?`,
      )
      .get(id)!;
    let tenders: ShiftReportView['tenders'];
    let expectedCash: number;
    if (shift.status === 'CLOSED') {
      tenders = this.db
        .prepare<[string], ShiftReportView['tenders'][number]>(
          `SELECT method, terminal_label AS terminalLabel, expected_amount AS expected, reported_amount AS reported,
                  variance FROM shift_tender_counts WHERE cash_shift_id = ? ORDER BY method = 'CASH' DESC, method, terminal_label`,
        )
        .all(id);
      expectedCash = shift.expected_cash ?? shift.opening_float;
    } else {
      const live = this.db
        .prepare<[string], { method: PaymentMethod; terminalLabel: string; amount: number }>(
          `SELECT method, coalesce(terminal_label, '') AS terminalLabel, sum(amount) AS amount FROM payments
            WHERE shift_id = ? GROUP BY method, coalesce(terminal_label, '') ORDER BY method, terminalLabel`,
        )
        .all(id);
      const cash = live.filter((t) => t.method === 'CASH').reduce((s, t) => s + t.amount, 0);
      expectedCash = shift.opening_float + cash;
      tenders = [
        {
          method: 'CASH',
          terminalLabel: '',
          expected: expectedCash,
          reported: null,
          variance: null,
        },
        ...live
          .filter((t) => t.method !== 'CASH')
          .map((t) => ({
            method: t.method,
            terminalLabel: t.terminalLabel,
            expected: t.amount,
            reported: null,
            variance: null,
          })),
      ];
    }
    return {
      id: shift.id,
      status: shift.status,
      openedAt: shift.opened_at,
      openedByName: shift.opened_by_name,
      closedAt: shift.closed_at,
      closedByName: shift.closed_by_name,
      openingFloat: shift.opening_float,
      expectedCash,
      countedCash: shift.counted_cash,
      cashVariance: shift.variance,
      invoiceCount: totals.invoices,
      sales: totals.sales,
      refunds: totals.refunds,
      tenders,
      version: shift.version,
    };
  }

  private view(invoice: Invoice): InvoiceView {
    const s = invoice.state;
    const extra = this.db
      .prepare<[string, string], Extra>(
        `SELECT o.order_no, o.order_type, t.label AS table_label, o.token_no, u.full_name AS created_by_name
           FROM orders o LEFT JOIN dining_tables t ON t.id = o.dining_table_id LEFT JOIN users u ON u.id = ?
          WHERE o.id = ?`,
      )
      .get(s.createdBy, s.orderId)!;
    const payments = this.db
      .prepare<[string], InvoiceView['payments'][number]>(
        `SELECT p.id, p.method, p.amount, p.tendered, p.change_due AS changeDue, p.reference, p.card_last4 AS cardLast4,
                p.terminal_label AS terminalLabel, p.created_at AS createdAt, u.full_name AS createdByName
           FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.invoice_id = ? ORDER BY p.created_at, p.rowid`,
      )
      .all(invoice.id);
    const b = s.bill;
    return {
      id: invoice.id,
      invoiceNo: s.invoiceNo,
      kind: s.kind,
      series: s.series,
      orderId: s.orderId,
      orderNo: extra.order_no,
      orderType: extra.order_type,
      tableLabel: extra.table_label,
      tokenNo: extra.token_no,
      businessDate: s.businessDate,
      supplyType: s.supplyType,
      customerId: s.customerId,
      customerName: s.customerName,
      customerTaxId: s.customerTaxId,
      gstPaidByOperator: s.gstPaidByOperator,
      originalInvoiceId: s.originalInvoiceId,
      lines: b.lines.map((l) => ({
        id: l.id,
        orderItemId: l.orderItemId,
        description: l.description,
        hsnSacCode: l.hsnSacCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxableValue: l.taxableValue,
        taxRateBp: l.taxRateBp,
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
      })),
      taxes: b.taxes.map((t) => ({ ...t })),
      discounts: b.discounts.map((d) => ({ ...d })),
      charges: b.charges.map((c) => ({
        chargeRuleId: c.chargeRuleId,
        name: c.name,
        amount: c.amount,
        taxAmount: c.taxAmount,
      })),
      subtotal: b.subtotal,
      discountTotal: b.discountTotal,
      chargesTotal: b.chargesTotal,
      taxableTotal: b.taxableTotal,
      taxTotal: b.taxTotal,
      roundOff: b.roundOff,
      grandTotal: b.grandTotal,
      paidTotal: s.paidTotal,
      balance: s.kind === 'INVOICE' && s.status !== 'CANCELLED' ? invoice.balance : 0,
      status: s.status,
      payments,
      printCount: s.printCount,
      cancelReason: s.cancelReason,
      createdAt: s.createdAt.toISOString(),
      createdByName: extra.created_by_name,
      version: invoice.version,
    };
  }
}
