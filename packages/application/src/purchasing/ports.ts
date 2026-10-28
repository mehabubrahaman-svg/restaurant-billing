import type { AgeingBuckets, InputTaxKind, PurchaseOrderStatus } from '@restroos/domain';
import type { BaseUnit } from '../inventory/ports';

export type VendorPaymentMethod = 'CASH' | 'BANK' | 'UPI' | 'CHEQUE';

export interface VendorRecord {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  paymentTermsDays: number;
  isActive: boolean;
  version: number;
}

export interface PoLineRecord {
  id: string;
  inventoryItemId: string;
  unitId: string;
  quantityMilli: number;
  unitPrice: number;
  taxRateBp: number;
  receivedQtyMilli: number;
}

export interface PurchaseOrderRecord {
  id: string;
  branchId: string;
  vendorId: string;
  poNo: string;
  status: PurchaseOrderStatus;
  expectedOn: string | null;
  notes: string | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: PoLineRecord[];
  version: number;
}

export interface GrnLineRecord {
  id: string;
  purchaseOrderLineId: string | null;
  inventoryItemId: string;
  unitId: string;
  quantityMilli: number;
  rejectedQtyMilli: number;
  unitPrice: number;
  taxRateBp: number;
  batchNo: string | null;
  expiresOn: string | null;
}

export interface GrnRecord {
  id: string;
  branchId: string;
  vendorId: string;
  purchaseOrderId: string | null;
  grnNo: string;
  vendorInvoiceNo: string | null;
  vendorInvoiceDate: string | null;
  businessDate: string;
  notes: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: GrnLineRecord[];
  version: number;
}

export interface VendorPaymentRecord {
  id: string;
  branchId: string;
  vendorId: string;
  grnId: string | null;
  method: VendorPaymentMethod;
  amount: number;
  reference: string | null;
  paidOn: string;
}

export interface PurchasingRepository {
  vendor(id: string): VendorRecord | undefined;
  vendorByCode(code: string): VendorRecord | undefined;
  insertVendor(record: VendorRecord, actorId: string | null, at: Date): void;
  /** Version-checked. */
  updateVendor(record: VendorRecord, actorId: string | null, at: Date): void;

  purchaseOrder(branchId: string, id: string): PurchaseOrderRecord | undefined;
  insertPurchaseOrder(record: PurchaseOrderRecord, actorId: string, at: Date): void;
  /** Version-checked: a DRAFT's header, totals and lines (replaced). */
  updatePurchaseOrder(record: PurchaseOrderRecord, actorId: string | null, at: Date): void;
  /** Version-checked status change, with who approved, when it was sent or why it was cancelled. */
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
  ): void;
  /** Adds an accepted quantity to a PO line. */
  addReceived(poLineId: string, quantityMilli: number): void;

  grn(branchId: string, id: string): GrnRecord | undefined;
  insertGrn(record: GrnRecord, actorId: string, at: Date): void;
  /** Version-checked: a DRAFT's header, totals and lines (replaced). */
  updateGrn(record: GrnRecord, at: Date): void;
  /** Version-checked: DRAFT → POSTED. */
  postGrn(
    id: string,
    expectedVersion: number,
    posting: { businessDate: string; dueOn: string; inputTaxKind: InputTaxKind; by: string | null },
    at: Date,
  ): void;
  /** Version-checked: DRAFT → CANCELLED. */
  cancelGrn(id: string, expectedVersion: number, reason: string, at: Date): void;
  /** Paid against one GRN so far. */
  paidAgainst(grnId: string): number;

  insertPayment(record: VendorPaymentRecord, actorId: string, at: Date): void;

  /** Gapless per branch, series and financial year: "KOL1/PO/2026-27/000012". */
  nextNumber(
    branchId: string,
    series: 'PO' | 'GRN',
    fiscalYear: string,
    branchCode: string,
  ): string;
}

/** What purchasing needs to know about the branch: its code for numbers, its state for GST. */
export interface BranchLookup {
  branch(branchId: string): { code: string; stateCode: string } | undefined;
}

// ---- read models (shapes match packages/contracts purchasing.ts) ---------------------
export interface VendorView extends VendorRecord {
  due: number;
}

interface LineAmountsView {
  value: number;
  taxAmount: number;
  total: number;
}

export interface PurchaseOrderSummaryView {
  id: string;
  poNo: string;
  vendorId: string;
  vendorName: string;
  status: PurchaseOrderStatus;
  expectedOn: string | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  createdAt: string;
  createdByName: string | null;
  version: number;
}

export interface PurchaseOrderView extends PurchaseOrderSummaryView {
  notes: string | null;
  lines: (PoLineRecord &
    LineAmountsView & { itemName: string; baseUnit: BaseUnit; unitCode: string })[];
  approvedAt: string | null;
  approvedByName: string | null;
  sentAt: string | null;
  cancelReason: string | null;
  grns: { id: string; grnNo: string; status: string; grandTotal: number }[];
}

export interface GrnSummaryView {
  id: string;
  grnNo: string;
  vendorId: string;
  vendorName: string;
  purchaseOrderId: string | null;
  poNo: string | null;
  vendorInvoiceNo: string | null;
  vendorInvoiceDate: string | null;
  businessDate: string;
  dueOn: string | null;
  status: GrnRecord['status'];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  paid: number;
  balance: number;
  version: number;
}

export interface GrnView extends GrnSummaryView {
  inputTaxKind: InputTaxKind;
  notes: string | null;
  lines: (GrnLineRecord &
    LineAmountsView & {
      itemName: string;
      baseUnit: BaseUnit;
      unitCode: string;
      acceptedQtyMilli: number;
    })[];
  cancelReason: string | null;
  postedAt: string | null;
  postedByName: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface VendorPaymentView extends Omit<VendorPaymentRecord, 'branchId'> {
  vendorName: string;
  grnNo: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface VendorStatementView {
  vendor: VendorView;
  from: string;
  to: string;
  openingBalance: number;
  entries: {
    date: string;
    kind: 'BILL' | 'PAYMENT';
    id: string;
    number: string | null;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  closingBalance: number;
}

export type VendorDuesRowView = AgeingBuckets & {
  vendorId: string;
  code: string;
  name: string;
  billed: number;
  paid: number;
  due: number;
  advance: number;
  oldestDueOn: string | null;
};

export interface VendorDuesReportView {
  asOf: string;
  rows: VendorDuesRowView[];
  totals: AgeingBuckets & { due: number; advance: number };
}

export interface PurchasingQueries {
  vendors(branchId: string, includeRetired: boolean): VendorView[];
  vendor(branchId: string, id: string): VendorView | undefined;
  purchaseOrders(
    branchId: string,
    filter: { status?: PurchaseOrderStatus | undefined; vendorId?: string | undefined },
  ): PurchaseOrderSummaryView[];
  purchaseOrder(branchId: string, id: string): PurchaseOrderView | undefined;
  grns(
    branchId: string,
    filter: {
      status?: GrnRecord['status'] | undefined;
      vendorId?: string | undefined;
      purchaseOrderId?: string | undefined;
    },
  ): GrnSummaryView[];
  grn(branchId: string, id: string): GrnView | undefined;
  payments(
    branchId: string,
    filter: { vendorId?: string | undefined; from?: string | undefined; to?: string | undefined },
  ): VendorPaymentView[];
  payment(branchId: string, id: string): VendorPaymentView | undefined;
  statement(
    branchId: string,
    vendorId: string,
    from: string,
    to: string,
  ): VendorStatementView | undefined;
  /** Posted bills with their balance (on-account payments not applied) and on-account totals, as at a day. */
  dues(branchId: string, asOf: string): VendorDuesReportView;
}
