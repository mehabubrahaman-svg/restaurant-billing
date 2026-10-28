import type {
  GrnLineRecord,
  GrnRecord,
  PoLineRecord,
  PurchaseOrderRecord,
  PurchasingRepository,
  VendorPaymentRecord,
  VendorRecord,
} from '@restroos/application';
import type { InputTaxKind, PurchaseOrderStatus } from '@restroos/domain';
import type { SqliteDatabase } from '../db/connection';
import { nextDocumentNumber } from '../db/document-sequences';
import { assertVersionMatched } from '../db/optimistic';

const ORG = '(SELECT id FROM organizations ORDER BY created_at LIMIT 1)';
const VENDOR_COLUMNS = `id, code, name, contact_person AS contactPerson, phone, email, address, tax_id AS taxId,
                        payment_terms_days AS paymentTermsDays, (deleted_at IS NULL) AS isActive, version`;
type VendorRow = Omit<VendorRecord, 'isActive'> & { isActive: number };
const toVendor = (r: VendorRow): VendorRecord => ({ ...r, isActive: r.isActive === 1 });

export class SqlitePurchasingRepository implements PurchasingRepository {
  constructor(private readonly db: SqliteDatabase) {}

  vendor(id: string): VendorRecord | undefined {
    const r = this.db
      .prepare<[string], VendorRow>(`SELECT ${VENDOR_COLUMNS} FROM vendors WHERE id = ?`)
      .get(id);
    return r && toVendor(r);
  }

  vendorByCode(code: string): VendorRecord | undefined {
    const r = this.db
      .prepare<[string], VendorRow>(`SELECT ${VENDOR_COLUMNS} FROM vendors WHERE code = ?`)
      .get(code);
    return r && toVendor(r);
  }

  insertVendor(r: VendorRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO vendors (id, organization_id, code, name, contact_person, phone, email, address, tax_id,
                              payment_terms_days, created_at, created_by, updated_at, updated_by, version)
         VALUES (?, ${ORG}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.code,
        r.name,
        r.contactPerson,
        r.phone,
        r.email,
        r.address,
        r.taxId,
        r.paymentTermsDays,
        at.toISOString(),
        actorId,
        at.toISOString(),
        actorId,
        r.version,
      );
  }

  updateVendor(r: VendorRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE vendors
            SET code = ?, name = ?, contact_person = ?, phone = ?, email = ?, address = ?, tax_id = ?,
                payment_terms_days = ?, updated_at = ?, updated_by = ?, version = ?,
                deleted_at = CASE WHEN ? THEN NULL ELSE coalesce(deleted_at, ?) END,
                deleted_by = CASE WHEN ? THEN NULL ELSE coalesce(deleted_by, ?) END
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.code,
        r.name,
        r.contactPerson,
        r.phone,
        r.email,
        r.address,
        r.taxId,
        r.paymentTermsDays,
        at.toISOString(),
        actorId,
        r.version,
        r.isActive ? 1 : 0,
        at.toISOString(),
        r.isActive ? 1 : 0,
        actorId,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'Vendor', r.id);
  }

  purchaseOrder(branchId: string, id: string): PurchaseOrderRecord | undefined {
    const head = this.db
      .prepare<[string, string], Omit<PurchaseOrderRecord, 'lines'>>(
        `SELECT id, branch_id AS branchId, vendor_id AS vendorId, po_no AS poNo, status, expected_on AS expectedOn,
                notes, subtotal, tax_total AS taxTotal, grand_total AS grandTotal, version
           FROM purchase_orders WHERE branch_id = ? AND id = ?`,
      )
      .get(branchId, id);
    if (!head) return undefined;
    const lines = this.db
      .prepare<[string], PoLineRecord>(
        `SELECT id, inventory_item_id AS inventoryItemId, unit_id AS unitId, quantity_milli AS quantityMilli,
                unit_price AS unitPrice, tax_rate_bp AS taxRateBp, received_qty_milli AS receivedQtyMilli
           FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY rowid`,
      )
      .all(id);
    return { ...head, lines };
  }

  insertPurchaseOrder(r: PurchaseOrderRecord, actorId: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO purchase_orders (id, branch_id, vendor_id, po_no, status, expected_on, subtotal, tax_total,
                                      grand_total, notes, created_at, created_by, updated_at, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.vendorId,
        r.poNo,
        r.status,
        r.expectedOn,
        r.subtotal,
        r.taxTotal,
        r.grandTotal,
        r.notes,
        at.toISOString(),
        actorId,
        at.toISOString(),
        actorId,
        r.version,
      );
    this.writePoLines(r);
  }

  updatePurchaseOrder(r: PurchaseOrderRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE purchase_orders
            SET vendor_id = ?, expected_on = ?, notes = ?, subtotal = ?, tax_total = ?, grand_total = ?,
                updated_at = ?, updated_by = ?, version = ?
          WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .run(
        r.vendorId,
        r.expectedOn,
        r.notes,
        r.subtotal,
        r.taxTotal,
        r.grandTotal,
        at.toISOString(),
        actorId,
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'PurchaseOrder', r.id);
    // A draft's lines are replaced as a whole; a trigger refuses this once the PO is approved.
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM purchase_order_lines WHERE purchase_order_id = ?').run(r.id);
    this.writePoLines(r);
  }

  private writePoLines(r: PurchaseOrderRecord): void {
    const insert = this.db.prepare(
      `INSERT INTO purchase_order_lines (id, purchase_order_id, inventory_item_id, unit_id, quantity_milli,
                                         unit_price, tax_rate_bp, received_qty_milli)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of r.lines)
      insert.run(
        l.id,
        r.id,
        l.inventoryItemId,
        l.unitId,
        l.quantityMilli,
        l.unitPrice,
        l.taxRateBp,
        l.receivedQtyMilli,
      );
  }

  setPurchaseOrderStatus(
    id: string,
    expectedVersion: number,
    change: {
      status: PurchaseOrderStatus;
      approvedBy?: string | null;
      sentAt?: Date;
      cancelReason?: string;
    },
    actorId: string | null,
    at: Date,
  ): void {
    const approving = change.approvedBy !== undefined;
    const result = this.db
      .prepare(
        `UPDATE purchase_orders
            SET status = ?,
                approved_by = CASE WHEN ? THEN ? ELSE approved_by END,
                approved_at = CASE WHEN ? THEN ? ELSE approved_at END,
                sent_at = coalesce(?, sent_at),
                cancel_reason = coalesce(?, cancel_reason),
                updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ?`,
      )
      .run(
        change.status,
        approving ? 1 : 0,
        change.approvedBy ?? null,
        approving ? 1 : 0,
        at.toISOString(),
        change.sentAt?.toISOString() ?? null,
        change.cancelReason ?? null,
        at.toISOString(),
        actorId,
        id,
        expectedVersion,
      );
    assertVersionMatched(result, 'PurchaseOrder', id);
  }

  addReceived(poLineId: string, quantityMilli: number): void {
    this.db
      .prepare(
        'UPDATE purchase_order_lines SET received_qty_milli = received_qty_milli + ? WHERE id = ?',
      )
      .run(quantityMilli, poLineId);
  }

  grn(branchId: string, id: string): GrnRecord | undefined {
    const head = this.db
      .prepare<[string, string], Omit<GrnRecord, 'lines'>>(
        `SELECT id, branch_id AS branchId, vendor_id AS vendorId, purchase_order_id AS purchaseOrderId,
                grn_no AS grnNo, vendor_invoice_no AS vendorInvoiceNo, vendor_invoice_date AS vendorInvoiceDate,
                business_date AS businessDate, notes, status, subtotal, tax_total AS taxTotal,
                grand_total AS grandTotal, version
           FROM grns WHERE branch_id = ? AND id = ?`,
      )
      .get(branchId, id);
    if (!head) return undefined;
    const lines = this.db
      .prepare<[string], GrnLineRecord>(
        `SELECT id, purchase_order_line_id AS purchaseOrderLineId, inventory_item_id AS inventoryItemId,
                unit_id AS unitId, quantity_milli AS quantityMilli, rejected_qty_milli AS rejectedQtyMilli,
                unit_price AS unitPrice, tax_rate_bp AS taxRateBp, batch_no AS batchNo, expires_on AS expiresOn
           FROM grn_lines WHERE grn_id = ? ORDER BY rowid`,
      )
      .all(id);
    return { ...head, lines };
  }

  insertGrn(r: GrnRecord, actorId: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO grns (id, branch_id, vendor_id, purchase_order_id, grn_no, vendor_invoice_no, vendor_invoice_date,
                           business_date, subtotal, tax_total, grand_total, status, notes, created_at, created_by,
                           updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.vendorId,
        r.purchaseOrderId,
        r.grnNo,
        r.vendorInvoiceNo,
        r.vendorInvoiceDate,
        r.businessDate,
        r.subtotal,
        r.taxTotal,
        r.grandTotal,
        r.status,
        r.notes,
        at.toISOString(),
        actorId,
        at.toISOString(),
        r.version,
      );
    this.writeGrnLines(r);
  }

  updateGrn(r: GrnRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE grns
            SET vendor_invoice_no = ?, vendor_invoice_date = ?, notes = ?, subtotal = ?, tax_total = ?,
                grand_total = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .run(
        r.vendorInvoiceNo,
        r.vendorInvoiceDate,
        r.notes,
        r.subtotal,
        r.taxTotal,
        r.grandTotal,
        at.toISOString(),
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'Grn', r.id);
    // A draft's lines are replaced as a whole; a trigger refuses this once the GRN is posted.
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM grn_lines WHERE grn_id = ?').run(r.id);
    this.writeGrnLines(r);
  }

  private writeGrnLines(r: GrnRecord): void {
    const insert = this.db.prepare(
      `INSERT INTO grn_lines (id, grn_id, purchase_order_line_id, inventory_item_id, unit_id, quantity_milli,
                              rejected_qty_milli, unit_price, tax_rate_bp, batch_no, expires_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of r.lines)
      insert.run(
        l.id,
        r.id,
        l.purchaseOrderLineId,
        l.inventoryItemId,
        l.unitId,
        l.quantityMilli,
        l.rejectedQtyMilli,
        l.unitPrice,
        l.taxRateBp,
        l.batchNo,
        l.expiresOn,
      );
  }

  postGrn(
    id: string,
    expectedVersion: number,
    posting: { businessDate: string; dueOn: string; inputTaxKind: InputTaxKind; by: string | null },
    at: Date,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE grns
            SET status = 'POSTED', business_date = ?, due_on = ?, input_tax_kind = ?, posted_at = ?, posted_by = ?,
                updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .run(
        posting.businessDate,
        posting.dueOn,
        posting.inputTaxKind,
        at.toISOString(),
        posting.by,
        at.toISOString(),
        id,
        expectedVersion,
      );
    assertVersionMatched(result, 'Grn', id);
  }

  cancelGrn(id: string, expectedVersion: number, reason: string, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE grns SET status = 'CANCELLED', cancel_reason = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND status = 'DRAFT'`,
      )
      .run(reason, at.toISOString(), id, expectedVersion);
    assertVersionMatched(result, 'Grn', id);
  }

  paidAgainst(grnId: string): number {
    return this.db
      .prepare<[string], number>(
        'SELECT coalesce(sum(amount), 0) FROM vendor_payments WHERE grn_id = ?',
      )
      .pluck()
      .get(grnId)!;
  }

  insertPayment(r: VendorPaymentRecord, actorId: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO vendor_payments (id, branch_id, vendor_id, grn_id, method, amount, reference, paid_on,
                                      created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.branchId,
        r.vendorId,
        r.grnId,
        r.method,
        r.amount,
        r.reference,
        r.paidOn,
        at.toISOString(),
        actorId,
      );
  }

  nextNumber(
    branchId: string,
    series: 'PO' | 'GRN',
    fiscalYear: string,
    branchCode: string,
  ): string {
    return nextDocumentNumber(
      this.db,
      branchId,
      series,
      fiscalYear,
      `${branchCode}/${series}/${fiscalYear}/`,
    );
  }
}
