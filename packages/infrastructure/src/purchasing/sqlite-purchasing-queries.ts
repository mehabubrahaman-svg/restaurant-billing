import type {
  GrnSummaryView,
  GrnView,
  PurchaseOrderSummaryView,
  PurchaseOrderView,
  PurchasingQueries,
  VendorDuesReportView,
  VendorDuesRowView,
  VendorPaymentView,
  VendorStatementView,
  VendorView,
} from '@restroos/application';
import { ageDues, lineAmounts, type PurchaseOrderStatus } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';

type VendorRow = Omit<VendorView, 'isActive'> & { isActive: number };
const VENDOR_SELECT = `
  SELECT v.id, v.code, v.name, v.contact_person AS contactPerson, v.phone, v.email, v.address, v.tax_id AS taxId,
         v.payment_terms_days AS paymentTermsDays, (v.deleted_at IS NULL) AS isActive, v.version,
         coalesce((SELECT sum(g.grand_total) FROM grns g
                    WHERE g.vendor_id = v.id AND g.branch_id = @branchId AND g.status = 'POSTED'), 0)
       - coalesce((SELECT sum(p.amount) FROM vendor_payments p
                    WHERE p.vendor_id = v.id AND p.branch_id = @branchId), 0) AS due
    FROM vendors v`;

const PO_SELECT = `
  SELECT po.id, po.po_no AS poNo, po.vendor_id AS vendorId, v.name AS vendorName, po.status,
         po.expected_on AS expectedOn, po.subtotal, po.tax_total AS taxTotal, po.grand_total AS grandTotal,
         po.created_at AS createdAt, cu.full_name AS createdByName, po.version
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN users cu ON cu.id = po.created_by`;

const GRN_SELECT = `
  SELECT g.id, g.grn_no AS grnNo, g.vendor_id AS vendorId, v.name AS vendorName,
         g.purchase_order_id AS purchaseOrderId, po.po_no AS poNo, g.vendor_invoice_no AS vendorInvoiceNo,
         g.vendor_invoice_date AS vendorInvoiceDate, g.business_date AS businessDate, g.due_on AS dueOn, g.status,
         g.subtotal, g.tax_total AS taxTotal, g.grand_total AS grandTotal,
         coalesce((SELECT sum(p.amount) FROM vendor_payments p WHERE p.grn_id = g.id), 0) AS paid, g.version
    FROM grns g
    JOIN vendors v ON v.id = g.vendor_id
    LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id`;

const PAYMENT_SELECT = `
  SELECT p.id, p.vendor_id AS vendorId, v.name AS vendorName, p.grn_id AS grnId, g.grn_no AS grnNo, p.method,
         p.amount, p.reference, p.paid_on AS paidOn, p.created_at AS createdAt, u.full_name AS createdByName
    FROM vendor_payments p
    JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN grns g ON g.id = p.grn_id
    LEFT JOIN users u ON u.id = p.created_by`;

/** What is still owed on a posted GRN; nothing on a draft or a cancelled one. */
const withBalance = <T extends Omit<GrnSummaryView, 'balance'>>(g: T): T & { balance: number } => ({
  ...g,
  balance: g.status === 'POSTED' ? g.grandTotal - g.paid : 0,
});

export class SqlitePurchasingQueries implements PurchasingQueries {
  constructor(private readonly db: SqliteDatabase) {}

  vendors(branchId: string, includeRetired: boolean): VendorView[] {
    return this.db
      .prepare<{ branchId: string; all: number }, VendorRow>(
        `${VENDOR_SELECT} WHERE (@all = 1 OR v.deleted_at IS NULL) ORDER BY v.name COLLATE NOCASE`,
      )
      .all({ branchId, all: includeRetired ? 1 : 0 })
      .map((v) => ({ ...v, isActive: v.isActive === 1 }));
  }

  vendor(branchId: string, id: string): VendorView | undefined {
    const v = this.db
      .prepare<{ branchId: string; id: string }, VendorRow>(`${VENDOR_SELECT} WHERE v.id = @id`)
      .get({ branchId, id });
    return v && { ...v, isActive: v.isActive === 1 };
  }

  purchaseOrders(
    branchId: string,
    filter: { status?: PurchaseOrderStatus | undefined; vendorId?: string | undefined },
  ): PurchaseOrderSummaryView[] {
    return this.db
      .prepare<Record<string, string | null>, PurchaseOrderSummaryView>(
        `${PO_SELECT}
          WHERE po.branch_id = @branchId AND (@status IS NULL OR po.status = @status)
            AND (@vendorId IS NULL OR po.vendor_id = @vendorId)
          ORDER BY po.created_at DESC, po.id DESC LIMIT 200`,
      )
      .all({ branchId, status: filter.status ?? null, vendorId: filter.vendorId ?? null });
  }

  purchaseOrder(branchId: string, id: string): PurchaseOrderView | undefined {
    const head = this.db
      .prepare<
        { branchId: string; id: string },
        PurchaseOrderSummaryView &
          Pick<
            PurchaseOrderView,
            'notes' | 'approvedAt' | 'approvedByName' | 'sentAt' | 'cancelReason'
          >
      >(
        `SELECT po.id, po.po_no AS poNo, po.vendor_id AS vendorId, v.name AS vendorName, po.status,
                po.expected_on AS expectedOn, po.subtotal, po.tax_total AS taxTotal, po.grand_total AS grandTotal,
                po.created_at AS createdAt, cu.full_name AS createdByName, po.version, po.notes,
                po.approved_at AS approvedAt, au.full_name AS approvedByName, po.sent_at AS sentAt,
                po.cancel_reason AS cancelReason
           FROM purchase_orders po
           JOIN vendors v ON v.id = po.vendor_id
           LEFT JOIN users cu ON cu.id = po.created_by
           LEFT JOIN users au ON au.id = po.approved_by
          WHERE po.branch_id = @branchId AND po.id = @id`,
      )
      .get({ branchId, id });
    if (!head) return undefined;
    const lines = this.db
      .prepare<[string], Omit<PurchaseOrderView['lines'][number], 'value' | 'taxAmount' | 'total'>>(
        `SELECT l.id, l.inventory_item_id AS inventoryItemId, i.name AS itemName, i.base_unit_code AS baseUnit,
                l.unit_id AS unitId, u.code AS unitCode, l.quantity_milli AS quantityMilli, l.unit_price AS unitPrice,
                l.tax_rate_bp AS taxRateBp, l.received_qty_milli AS receivedQtyMilli
           FROM purchase_order_lines l
           JOIN inventory_items i ON i.id = l.inventory_item_id
           JOIN units u ON u.id = l.unit_id
          WHERE l.purchase_order_id = ? ORDER BY l.rowid`,
      )
      .all(id)
      .map((l) => {
        const a = lineAmounts(l.quantityMilli, l.unitPrice, l.taxRateBp);
        return { ...l, value: a.value, taxAmount: a.tax, total: a.total };
      });
    const grns = this.db
      .prepare<[string], PurchaseOrderView['grns'][number]>(
        `SELECT id, grn_no AS grnNo, status, grand_total AS grandTotal
           FROM grns WHERE purchase_order_id = ? ORDER BY created_at, id`,
      )
      .all(id);
    return { ...head, lines, grns };
  }

  grns(
    branchId: string,
    filter: {
      status?: 'DRAFT' | 'POSTED' | 'CANCELLED' | undefined;
      vendorId?: string | undefined;
      purchaseOrderId?: string | undefined;
    },
  ): GrnSummaryView[] {
    return this.db
      .prepare<Record<string, string | null>, Omit<GrnSummaryView, 'balance'>>(
        `${GRN_SELECT}
          WHERE g.branch_id = @branchId AND (@status IS NULL OR g.status = @status)
            AND (@vendorId IS NULL OR g.vendor_id = @vendorId)
            AND (@poId IS NULL OR g.purchase_order_id = @poId)
          ORDER BY g.created_at DESC, g.id DESC LIMIT 200`,
      )
      .all({
        branchId,
        status: filter.status ?? null,
        vendorId: filter.vendorId ?? null,
        poId: filter.purchaseOrderId ?? null,
      })
      .map(withBalance);
  }

  grn(branchId: string, id: string): GrnView | undefined {
    const head = this.db
      .prepare<
        { branchId: string; id: string },
        Omit<GrnSummaryView, 'balance'> &
          Pick<
            GrnView,
            | 'inputTaxKind'
            | 'notes'
            | 'cancelReason'
            | 'postedAt'
            | 'postedByName'
            | 'createdAt'
            | 'createdByName'
          >
      >(
        `SELECT g.id, g.grn_no AS grnNo, g.vendor_id AS vendorId, v.name AS vendorName,
                g.purchase_order_id AS purchaseOrderId, po.po_no AS poNo, g.vendor_invoice_no AS vendorInvoiceNo,
                g.vendor_invoice_date AS vendorInvoiceDate, g.business_date AS businessDate, g.due_on AS dueOn,
                g.status, g.subtotal, g.tax_total AS taxTotal, g.grand_total AS grandTotal,
                coalesce((SELECT sum(p.amount) FROM vendor_payments p WHERE p.grn_id = g.id), 0) AS paid, g.version,
                g.input_tax_kind AS inputTaxKind, g.notes, g.cancel_reason AS cancelReason, g.posted_at AS postedAt,
                pu.full_name AS postedByName, g.created_at AS createdAt, cu.full_name AS createdByName
           FROM grns g
           JOIN vendors v ON v.id = g.vendor_id
           LEFT JOIN purchase_orders po ON po.id = g.purchase_order_id
           LEFT JOIN users pu ON pu.id = g.posted_by
           LEFT JOIN users cu ON cu.id = g.created_by
          WHERE g.branch_id = @branchId AND g.id = @id`,
      )
      .get({ branchId, id });
    if (!head) return undefined;
    const lines = this.db
      .prepare<
        [string],
        Omit<GrnView['lines'][number], 'value' | 'taxAmount' | 'total' | 'acceptedQtyMilli'>
      >(
        `SELECT l.id, l.purchase_order_line_id AS purchaseOrderLineId, l.inventory_item_id AS inventoryItemId,
                i.name AS itemName, i.base_unit_code AS baseUnit, l.unit_id AS unitId, u.code AS unitCode,
                l.quantity_milli AS quantityMilli, l.rejected_qty_milli AS rejectedQtyMilli, l.unit_price AS unitPrice,
                l.tax_rate_bp AS taxRateBp, l.batch_no AS batchNo, l.expires_on AS expiresOn
           FROM grn_lines l
           JOIN inventory_items i ON i.id = l.inventory_item_id
           JOIN units u ON u.id = l.unit_id
          WHERE l.grn_id = ? ORDER BY l.rowid`,
      )
      .all(id)
      .map((l) => {
        const acceptedQtyMilli = l.quantityMilli - l.rejectedQtyMilli;
        const a = lineAmounts(acceptedQtyMilli, l.unitPrice, l.taxRateBp);
        return { ...l, acceptedQtyMilli, value: a.value, taxAmount: a.tax, total: a.total };
      });
    return { ...withBalance(head), lines };
  }

  payments(
    branchId: string,
    filter: { vendorId?: string | undefined; from?: string | undefined; to?: string | undefined },
  ): VendorPaymentView[] {
    return this.db
      .prepare<Record<string, string | null>, VendorPaymentView>(
        `${PAYMENT_SELECT}
          WHERE p.branch_id = @branchId AND (@vendorId IS NULL OR p.vendor_id = @vendorId)
            AND (@from IS NULL OR p.paid_on >= @from) AND (@to IS NULL OR p.paid_on <= @to)
          ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 500`,
      )
      .all({
        branchId,
        vendorId: filter.vendorId ?? null,
        from: filter.from ?? null,
        to: filter.to ?? null,
      });
  }

  payment(branchId: string, id: string): VendorPaymentView | undefined {
    return this.db
      .prepare<[string, string], VendorPaymentView>(
        `${PAYMENT_SELECT} WHERE p.branch_id = ? AND p.id = ?`,
      )
      .get(branchId, id);
  }

  statement(
    branchId: string,
    vendorId: string,
    from: string,
    to: string,
  ): VendorStatementView | undefined {
    const vendor = this.vendor(branchId, vendorId);
    if (!vendor) return undefined;
    const openingBalance = this.db
      .prepare<{ branchId: string; vendorId: string; from: string }, number>(
        `SELECT coalesce((SELECT sum(grand_total) FROM grns WHERE branch_id = @branchId AND vendor_id = @vendorId
                            AND status = 'POSTED' AND business_date < @from), 0)
              - coalesce((SELECT sum(amount) FROM vendor_payments WHERE branch_id = @branchId
                            AND vendor_id = @vendorId AND paid_on < @from), 0)`,
      )
      .pluck()
      .get({ branchId, vendorId, from })!;
    const rows = this.db
      .prepare<
        { branchId: string; vendorId: string; from: string; to: string },
        Omit<VendorStatementView['entries'][number], 'balance'> & { at: string }
      >(
        `SELECT * FROM (
           SELECT g.business_date AS date, 'BILL' AS kind, g.id, g.grn_no AS number,
                  coalesce('Bill ' || g.vendor_invoice_no, 'Goods received') AS description,
                  0 AS debit, g.grand_total AS credit, g.posted_at AS at
             FROM grns g
            WHERE g.branch_id = @branchId AND g.vendor_id = @vendorId AND g.status = 'POSTED'
              AND g.business_date BETWEEN @from AND @to
           UNION ALL
           SELECT p.paid_on, 'PAYMENT', p.id, p.reference,
                  p.method || coalesce(' against ' || g.grn_no, ' on account'),
                  p.amount, 0, p.created_at
             FROM vendor_payments p LEFT JOIN grns g ON g.id = p.grn_id
            WHERE p.branch_id = @branchId AND p.vendor_id = @vendorId AND p.paid_on BETWEEN @from AND @to)
         ORDER BY date, at, id`,
      )
      .all({ branchId, vendorId, from, to });
    let balance = openingBalance;
    const entries = rows.map(({ at: _at, ...e }) => {
      balance += e.credit - e.debit;
      return { ...e, balance };
    });
    return { vendor, from, to, openingBalance, entries, closingBalance: balance };
  }

  dues(branchId: string, asOf: string): VendorDuesReportView {
    const bills = this.db
      .prepare<
        { branchId: string; asOf: string },
        { vendorId: string; dueOn: string; grandTotal: number; paid: number }
      >(
        `SELECT g.vendor_id AS vendorId, coalesce(g.due_on, g.business_date) AS dueOn, g.grand_total AS grandTotal,
                coalesce((SELECT sum(p.amount) FROM vendor_payments p
                           WHERE p.grn_id = g.id AND p.paid_on <= @asOf), 0) AS paid
           FROM grns g
          WHERE g.branch_id = @branchId AND g.status = 'POSTED' AND g.business_date <= @asOf`,
      )
      .all({ branchId, asOf });
    const onAccount = new Map(
      this.db
        .prepare<{ branchId: string; asOf: string }, { vendorId: string; amount: number }>(
          `SELECT vendor_id AS vendorId, sum(amount) AS amount FROM vendor_payments
            WHERE branch_id = @branchId AND grn_id IS NULL AND paid_on <= @asOf GROUP BY vendor_id`,
        )
        .all({ branchId, asOf })
        .map((r) => [r.vendorId, r.amount]),
    );
    const vendors = this.db
      .prepare<[], { id: string; code: string; name: string }>(
        'SELECT id, code, name FROM vendors ORDER BY name COLLATE NOCASE',
      )
      .all();
    const rows: VendorDuesRowView[] = [];
    for (const v of vendors) {
      const own = bills.filter((b) => b.vendorId === v.id);
      const credit = onAccount.get(v.id) ?? 0;
      if (own.length === 0 && credit === 0) continue;
      const aged = ageDues(
        own.map((b) => ({ dueOn: b.dueOn, balance: b.grandTotal - b.paid })),
        credit,
        asOf,
      );
      const billed = own.reduce((s, b) => s + b.grandTotal, 0);
      rows.push({
        vendorId: v.id,
        code: v.code,
        name: v.name,
        billed,
        paid: own.reduce((s, b) => s + b.paid, 0) + credit,
        ...aged,
      });
    }
    const sum = (
      key: 'due' | 'advance' | 'current' | 'd1to30' | 'd31to60' | 'd61to90' | 'over90',
    ) => rows.reduce((s, r) => s + r[key], 0);
    return {
      asOf,
      rows,
      totals: {
        due: sum('due'),
        advance: sum('advance'),
        current: sum('current'),
        d1to30: sum('d1to30'),
        d31to60: sum('d31to60'),
        d61to90: sum('d61to90'),
        over90: sum('over90'),
      },
    };
  }
}
