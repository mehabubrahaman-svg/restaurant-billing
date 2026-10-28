import {
  assertPoTransition,
  BusinessDate,
  documentTotals,
  DomainError,
  inputTaxKind,
  isReceivable,
  lineAmounts,
  receivedStatus,
  toBaseMilli,
  type PurchaseOrderStatus,
} from '@restroos/domain';
import type { InventoryRepository } from '../inventory/ports';
import { addDays, StockLedger } from '../inventory/stock-ledger';
import type { BusinessCalendar } from '../ordering/ports';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type {
  BranchLookup,
  GrnLineRecord,
  GrnRecord,
  GrnView,
  PoLineRecord,
  PurchaseOrderRecord,
  PurchaseOrderView,
  PurchasingQueries,
  PurchasingRepository,
  VendorPaymentMethod,
  VendorPaymentView,
  VendorRecord,
  VendorView,
} from './ports';

export interface PurchasingServiceDeps {
  readonly purchasing: PurchasingRepository;
  readonly queries: PurchasingQueries;
  readonly inventory: InventoryRepository;
  readonly branches: BranchLookup;
  readonly calendar: BusinessCalendar;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export type VendorInput = Omit<VendorRecord, 'id' | 'isActive' | 'version'>;

type PoLineInput = Omit<PoLineRecord, 'id' | 'receivedQtyMilli'>;
type GrnLineInput = Omit<GrnLineRecord, 'id'>;

/**
 * Buying (docs/08 Phase 3): vendors, purchase orders that a manager
 * approves, goods received notes that put the accepted goods into stock and
 * the bill into the vendor's dues, and payments against bills or on account.
 */
export class PurchasingService {
  private readonly ledger: StockLedger;

  constructor(private readonly d: PurchasingServiceDeps) {
    this.ledger = new StockLedger({ inventory: d.inventory, ids: d.ids });
  }

  // ---- vendors --------------------------------------------------------------------
  vendors(branchId: string, includeRetired: boolean): VendorView[] {
    return this.d.queries.vendors(branchId, includeRetired);
  }

  vendor(branchId: string, id: string): VendorView {
    const view = this.d.queries.vendor(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'vendor not found');
    return view;
  }

  createVendor(input: VendorInput, ctx: CommandContext): VendorView {
    return this.write(ctx, (scope, now) => {
      if (this.d.purchasing.vendorByCode(input.code))
        throw new DomainError('VENDOR_CODE_TAKEN', `vendor code ${input.code} is already used`);
      const record: VendorRecord = { ...input, id: this.d.ids.next(), isActive: true, version: 1 };
      this.d.purchasing.insertVendor(record, ctx.actorId, now);
      scope.recordEvents([
        recordChanged(
          'VendorCreated',
          'Vendor',
          record.id,
          1,
          { code: record.code, name: record.name },
          now,
        ),
      ]);
      scope.audit({
        action: 'purchase.vendor.create',
        entityType: 'Vendor',
        entityId: record.id,
        after: record,
      });
      return this.vendor(ctx.branchId, record.id);
    });
  }

  updateVendor(
    id: string,
    patch: Patch<VendorInput & { isActive: boolean }> & { version: number },
    ctx: CommandContext,
  ): VendorView {
    return this.write(ctx, (scope, now) => {
      const current = this.d.purchasing.vendor(id);
      if (!current) throw new DomainError('NOT_FOUND', 'vendor not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this vendor changed; reload and try again');
      const next: VendorRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      if (next.code !== current.code && this.d.purchasing.vendorByCode(next.code))
        throw new DomainError('VENDOR_CODE_TAKEN', `vendor code ${next.code} is already used`);
      this.d.purchasing.updateVendor(next, ctx.actorId, now);
      scope.recordEvents([
        recordChanged(
          'VendorChanged',
          'Vendor',
          id,
          next.version,
          { code: next.code, name: next.name, isActive: next.isActive },
          now,
        ),
      ]);
      scope.audit({
        action: 'purchase.vendor.update',
        entityType: 'Vendor',
        entityId: id,
        before: current,
        after: next,
      });
      return this.vendor(ctx.branchId, id);
    });
  }

  statement(branchId: string, vendorId: string, from: string, to: string) {
    const view = this.d.queries.statement(branchId, vendorId, from, to);
    if (!view) throw new DomainError('NOT_FOUND', 'vendor not found');
    return view;
  }

  dues(branchId: string, asOf: string | undefined) {
    return this.d.queries.dues(branchId, asOf ?? this.today(branchId));
  }

  // ---- purchase orders -----------------------------------------------------------------
  purchaseOrders(branchId: string, filter: Parameters<PurchasingQueries['purchaseOrders']>[1]) {
    return this.d.queries.purchaseOrders(branchId, filter);
  }

  purchaseOrder(branchId: string, id: string): PurchaseOrderView {
    const view = this.d.queries.purchaseOrder(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'purchase order not found');
    return view;
  }

  createPurchaseOrder(
    input: {
      vendorId: string;
      expectedOn: string | null;
      notes: string | null;
      lines: PoLineInput[];
    },
    ctx: CommandContext,
  ): PurchaseOrderView {
    return this.write(ctx, (scope, now) => {
      this.activeVendor(input.vendorId);
      const lines = this.poLines(input.lines);
      const record: PurchaseOrderRecord = {
        id: this.d.ids.next(),
        branchId: ctx.branchId,
        vendorId: input.vendorId,
        poNo: this.number(ctx.branchId, 'PO', now),
        status: 'DRAFT',
        expectedOn: input.expectedOn,
        notes: input.notes,
        ...totalsOf(lines),
        lines,
        version: 1,
      };
      this.d.purchasing.insertPurchaseOrder(record, ctx.actorId!, now);
      this.logPo(scope, 'PurchaseOrderCreated', 'create', record, now);
      return this.purchaseOrder(ctx.branchId, record.id);
    });
  }

  updatePurchaseOrder(
    id: string,
    patch: {
      version: number;
      vendorId?: string | undefined;
      expectedOn?: string | null | undefined;
      notes?: string | null | undefined;
      lines?: PoLineInput[] | undefined;
    },
    ctx: CommandContext,
  ): PurchaseOrderView {
    return this.write(ctx, (scope, now) => {
      const current = this.po(ctx.branchId, id, patch.version);
      if (current.status !== 'DRAFT')
        throw new DomainError(
          'INVALID_STATE_TRANSITION',
          'only a draft purchase order can be edited',
        );
      if (patch.vendorId !== undefined) this.activeVendor(patch.vendorId);
      const lines = patch.lines ? this.poLines(patch.lines) : current.lines;
      const next: PurchaseOrderRecord = {
        ...current,
        vendorId: patch.vendorId ?? current.vendorId,
        expectedOn: patch.expectedOn === undefined ? current.expectedOn : patch.expectedOn,
        notes: patch.notes === undefined ? current.notes : patch.notes,
        ...totalsOf(lines),
        lines,
        version: current.version + 1,
      };
      this.d.purchasing.updatePurchaseOrder(next, ctx.actorId, now);
      this.logPo(scope, 'PurchaseOrderChanged', 'update', next, now, current);
      return this.purchaseOrder(ctx.branchId, id);
    });
  }

  approvePurchaseOrder(id: string, input: { version: number }, ctx: CommandContext) {
    return this.movePo(id, input.version, 'APPROVED', 'approve', ctx, { approvedBy: ctx.actorId });
  }

  sendPurchaseOrder(id: string, input: { version: number }, ctx: CommandContext) {
    return this.movePo(id, input.version, 'SENT', 'send', ctx, { sentAt: this.d.clock.now() });
  }

  cancelPurchaseOrder(id: string, input: { version: number; reason: string }, ctx: CommandContext) {
    return this.movePo(id, input.version, 'CANCELLED', 'cancel', ctx, {
      cancelReason: input.reason,
    });
  }

  /** Nothing more is expected against it, though not everything arrived. */
  closePurchaseOrder(id: string, input: { version: number }, ctx: CommandContext) {
    return this.movePo(id, input.version, 'CLOSED', 'close', ctx, {});
  }

  // ---- goods received notes ------------------------------------------------------------
  grns(branchId: string, filter: Parameters<PurchasingQueries['grns']>[1]) {
    return this.d.queries.grns(branchId, filter);
  }

  grn(branchId: string, id: string): GrnView {
    const view = this.d.queries.grn(branchId, id);
    if (!view) throw new DomainError('NOT_FOUND', 'GRN not found');
    return view;
  }

  createGrn(
    input: {
      purchaseOrderId: string | null;
      vendorId: string | null;
      vendorInvoiceNo: string | null;
      vendorInvoiceDate: string | null;
      notes: string | null;
      lines: GrnLineInput[];
    },
    ctx: CommandContext,
  ): GrnView {
    return this.write(ctx, (scope, now) => {
      let vendorId = input.vendorId;
      if (input.purchaseOrderId !== null) {
        const po = this.d.purchasing.purchaseOrder(ctx.branchId, input.purchaseOrderId);
        if (!po) throw new DomainError('NOT_FOUND', 'purchase order not found');
        if (vendorId !== null && vendorId !== po.vendorId)
          throw new DomainError(
            'VALIDATION_FAILED',
            'the GRN’s vendor must be the purchase order’s',
          );
        vendorId = po.vendorId;
      }
      if (vendorId === null)
        throw new DomainError('VALIDATION_FAILED', 'give the vendor or the purchase order');
      this.activeVendor(vendorId);
      const lines = this.grnLines(ctx.branchId, input.purchaseOrderId, input.lines);
      const record: GrnRecord = {
        id: this.d.ids.next(),
        branchId: ctx.branchId,
        vendorId,
        purchaseOrderId: input.purchaseOrderId,
        grnNo: this.number(ctx.branchId, 'GRN', now),
        vendorInvoiceNo: input.vendorInvoiceNo,
        vendorInvoiceDate: input.vendorInvoiceDate,
        businessDate: this.today(ctx.branchId),
        notes: input.notes,
        status: 'DRAFT',
        ...grnTotals(lines),
        lines,
        version: 1,
      };
      this.d.purchasing.insertGrn(record, ctx.actorId!, now);
      this.logGrn(scope, 'GrnCreated', 'create', record, now);
      return this.grn(ctx.branchId, record.id);
    });
  }

  updateGrn(
    id: string,
    patch: {
      version: number;
      vendorInvoiceNo?: string | null | undefined;
      vendorInvoiceDate?: string | null | undefined;
      notes?: string | null | undefined;
      lines?: GrnLineInput[] | undefined;
    },
    ctx: CommandContext,
  ): GrnView {
    return this.write(ctx, (scope, now) => {
      const current = this.draftGrn(ctx.branchId, id, patch.version);
      const lines = patch.lines
        ? this.grnLines(ctx.branchId, current.purchaseOrderId, patch.lines)
        : current.lines;
      const next: GrnRecord = {
        ...current,
        vendorInvoiceNo:
          patch.vendorInvoiceNo === undefined ? current.vendorInvoiceNo : patch.vendorInvoiceNo,
        vendorInvoiceDate:
          patch.vendorInvoiceDate === undefined
            ? current.vendorInvoiceDate
            : patch.vendorInvoiceDate,
        notes: patch.notes === undefined ? current.notes : patch.notes,
        ...grnTotals(lines),
        lines,
        version: current.version + 1,
      };
      this.d.purchasing.updateGrn(next, now);
      this.logGrn(scope, 'GrnChanged', 'update', next, now, current);
      return this.grn(ctx.branchId, id);
    });
  }

  /**
   * Receives the goods: each accepted line goes into stock at its price (with
   * the tax when the vendor gives no input credit), in a batch for FEFO, and
   * the PO's received quantities and status move on. The bill falls due after
   * the vendor's payment terms.
   */
  postGrn(id: string, input: { version: number }, ctx: CommandContext): GrnView {
    return this.write(ctx, (scope, now) => {
      const grn = this.draftGrn(ctx.branchId, id, input.version);
      const vendor = this.d.purchasing.vendor(grn.vendorId)!;
      let po: PurchaseOrderRecord | undefined;
      if (grn.purchaseOrderId !== null) {
        po = this.d.purchasing.purchaseOrder(ctx.branchId, grn.purchaseOrderId);
        if (!po || !isReceivable(po.status)) {
          throw new DomainError(
            'INVALID_STATE_TRANSITION',
            'goods can’t be received against this purchase order any more',
          );
        }
      }
      const businessDate = this.today(ctx.branchId);
      const taxKind = inputTaxKind(vendor.taxId, this.branch(ctx.branchId).stateCode);
      for (const line of grn.lines) {
        const accepted = line.quantityMilli - line.rejectedQtyMilli;
        if (accepted <= 0) continue;
        const item = this.d.inventory.item(line.inventoryItemId)!;
        const unit = this.d.inventory.unit(line.unitId)!;
        const amounts = lineAmounts(accepted, line.unitPrice, line.taxRateBp);
        this.ledger.receive(
          {
            branchId: ctx.branchId,
            businessDate,
            actorId: ctx.actorId,
            referenceType: 'GRN_LINE',
            referenceId: line.id,
            reason: null,
            at: now,
          },
          item,
          {
            qtyMilli: toBaseMilli(accepted, unit.toBaseMilli),
            totalCost: taxKind === 'NONE' ? amounts.total : amounts.value,
            batchNo: line.batchNo,
            expiresOn: line.expiresOn,
            grnLineId: line.id,
          },
          'PURCHASE',
        );
        if (line.purchaseOrderLineId !== null)
          this.d.purchasing.addReceived(line.purchaseOrderLineId, accepted);
      }
      const dueOn = addDays(grn.vendorInvoiceDate ?? businessDate, vendor.paymentTermsDays);
      this.d.purchasing.postGrn(
        id,
        grn.version,
        { businessDate, dueOn, inputTaxKind: taxKind, by: ctx.actorId },
        now,
      );
      const events = [
        recordChanged(
          'GrnPosted',
          'Grn',
          id,
          grn.version + 1,
          {
            grnNo: grn.grnNo,
            vendorId: grn.vendorId,
            purchaseOrderId: grn.purchaseOrderId,
            subtotal: grn.subtotal,
            taxTotal: grn.taxTotal,
            grandTotal: grn.grandTotal,
            inputTaxKind: taxKind,
          },
          now,
        ),
      ];
      if (po) {
        const after = this.d.purchasing.purchaseOrder(ctx.branchId, po.id)!;
        const status = receivedStatus(
          after.lines.map((l) => ({
            orderedMilli: l.quantityMilli,
            receivedMilli: l.receivedQtyMilli,
          })),
        );
        assertPoTransition(po.status, status);
        this.d.purchasing.setPurchaseOrderStatus(po.id, po.version, { status }, ctx.actorId, now);
        events.push(
          recordChanged(
            'PurchaseOrderReceived',
            'PurchaseOrder',
            po.id,
            po.version + 1,
            { status, grnId: id },
            now,
          ),
        );
      }
      scope.recordEvents(events);
      scope.audit({
        action: 'purchase.grn.post',
        entityType: 'Grn',
        entityId: id,
        after: { grnNo: grn.grnNo, grandTotal: grn.grandTotal, dueOn, inputTaxKind: taxKind },
      });
      return this.grn(ctx.branchId, id);
    });
  }

  cancelGrn(id: string, input: { version: number; reason: string }, ctx: CommandContext): GrnView {
    return this.write(ctx, (scope, now) => {
      const grn = this.draftGrn(ctx.branchId, id, input.version);
      this.d.purchasing.cancelGrn(id, grn.version, input.reason, now);
      scope.recordEvents([
        recordChanged('GrnCancelled', 'Grn', id, grn.version + 1, { reason: input.reason }, now),
      ]);
      scope.audit({
        action: 'purchase.grn.cancel',
        entityType: 'Grn',
        entityId: id,
        reason: input.reason,
      });
      return this.grn(ctx.branchId, id);
    });
  }

  // ---- vendor payments ------------------------------------------------------------------
  payments(branchId: string, filter: Parameters<PurchasingQueries['payments']>[1]) {
    return this.d.queries.payments(branchId, filter);
  }

  recordPayment(
    input: {
      vendorId: string;
      grnId: string | null;
      method: VendorPaymentMethod;
      amount: number;
      reference: string | null;
      paidOn?: string | undefined;
    },
    ctx: CommandContext,
  ): VendorPaymentView {
    return this.write(ctx, (scope, now) => {
      if (!this.d.purchasing.vendor(input.vendorId))
        throw new DomainError('NOT_FOUND', 'vendor not found');
      const today = this.today(ctx.branchId);
      const paidOn = input.paidOn ?? today;
      if (paidOn > today)
        throw new DomainError('VALIDATION_FAILED', 'a payment can’t be dated in the future');
      if (input.grnId !== null) {
        const grn = this.d.purchasing.grn(ctx.branchId, input.grnId);
        if (!grn || grn.vendorId !== input.vendorId)
          throw new DomainError('NOT_FOUND', 'GRN not found for this vendor');
        if (grn.status !== 'POSTED')
          throw new DomainError('INVALID_STATE_TRANSITION', 'only a posted GRN can be paid');
        const balance = grn.grandTotal - this.d.purchasing.paidAgainst(grn.id);
        if (input.amount > balance)
          throw new DomainError('OVERPAYMENT', `only ${balance} paise is owed on this GRN`);
      }
      const record = {
        id: this.d.ids.next(),
        branchId: ctx.branchId,
        vendorId: input.vendorId,
        grnId: input.grnId,
        method: input.method,
        amount: input.amount,
        reference: input.reference,
        paidOn,
      };
      this.d.purchasing.insertPayment(record, ctx.actorId!, now);
      const summary = {
        vendorId: record.vendorId,
        grnId: record.grnId,
        method: record.method,
        amount: record.amount,
        paidOn,
      };
      scope.recordEvents([
        recordChanged('VendorPaymentRecorded', 'VendorPayment', record.id, 1, summary, now),
      ]);
      scope.audit({
        action: 'purchase.vendor_payment.create',
        entityType: 'VendorPayment',
        entityId: record.id,
        after: { ...summary, reference: record.reference },
      });
      return this.d.queries.payment(ctx.branchId, record.id)!;
    });
  }

  // ---- helpers ----------------------------------------------------------------------------
  private write<T>(ctx: CommandContext, work: (scope: TransactionScope, now: Date) => T): T {
    return this.d.unitOfWork.run(ctx, (scope) => work(scope, this.d.clock.now()));
  }

  private today(branchId: string): string {
    return this.d.calendar.businessDate(branchId, this.d.clock.now());
  }

  private branch(branchId: string) {
    const branch = this.d.branches.branch(branchId);
    if (!branch) throw new DomainError('NOT_FOUND', 'branch not found');
    return branch;
  }

  private number(branchId: string, series: 'PO' | 'GRN', now: Date): string {
    const fiscalYear = BusinessDate.parse(this.d.calendar.businessDate(branchId, now)).fiscalYear();
    return this.d.purchasing.nextNumber(branchId, series, fiscalYear, this.branch(branchId).code);
  }

  private activeVendor(id: string): VendorRecord {
    const vendor = this.d.purchasing.vendor(id);
    if (!vendor) throw new DomainError('NOT_FOUND', 'vendor not found');
    if (!vendor.isActive) throw new DomainError('VALIDATION_FAILED', `${vendor.name} is retired`);
    return vendor;
  }

  /** An item that can be bought in a unit of its own kind. */
  private assertBuyable(itemId: string, unitId: string): void {
    const item = this.d.inventory.item(itemId);
    if (!item) throw new DomainError('NOT_FOUND', 'inventory item not found');
    if (!item.isActive) throw new DomainError('VALIDATION_FAILED', `${item.name} is retired`);
    const unit = this.d.inventory.unit(unitId);
    if (!unit) throw new DomainError('NOT_FOUND', 'unit not found');
    if (unit.baseCode !== item.baseUnit) {
      throw new DomainError(
        'UNIT_MISMATCH',
        `${item.name} is kept in ${item.baseUnit}; ${unit.code} doesn’t measure that`,
      );
    }
  }

  private poLines(lines: readonly PoLineInput[]): PoLineRecord[] {
    return lines.map((l) => {
      this.assertBuyable(l.inventoryItemId, l.unitId);
      return { ...l, id: this.d.ids.next(), receivedQtyMilli: 0 };
    });
  }

  private grnLines(
    branchId: string,
    purchaseOrderId: string | null,
    lines: readonly GrnLineInput[],
  ): GrnLineRecord[] {
    const po =
      purchaseOrderId === null
        ? undefined
        : this.d.purchasing.purchaseOrder(branchId, purchaseOrderId);
    if (po && !isReceivable(po.status)) {
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        po.status === 'DRAFT'
          ? 'approve the purchase order before receiving against it'
          : 'goods can’t be received against this purchase order any more',
      );
    }
    return lines.map((l) => {
      this.assertBuyable(l.inventoryItemId, l.unitId);
      if (l.rejectedQtyMilli > l.quantityMilli)
        throw new DomainError('VALIDATION_FAILED', 'more was rejected than delivered');
      if (l.purchaseOrderLineId !== null) {
        const poLine = po?.lines.find((p) => p.id === l.purchaseOrderLineId);
        if (!poLine)
          throw new DomainError('VALIDATION_FAILED', 'that line isn’t on the purchase order');
        if (poLine.inventoryItemId !== l.inventoryItemId || poLine.unitId !== l.unitId) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'a received line must be the PO line’s item, in the same unit',
          );
        }
      }
      return { ...l, id: this.d.ids.next() };
    });
  }

  private po(branchId: string, id: string, version: number): PurchaseOrderRecord {
    const po = this.d.purchasing.purchaseOrder(branchId, id);
    if (!po) throw new DomainError('NOT_FOUND', 'purchase order not found');
    if (po.version !== version)
      throw new DomainError(
        'VERSION_CONFLICT',
        'this purchase order changed; reload and try again',
      );
    return po;
  }

  private draftGrn(branchId: string, id: string, version: number): GrnRecord {
    const grn = this.d.purchasing.grn(branchId, id);
    if (!grn) throw new DomainError('NOT_FOUND', 'GRN not found');
    if (grn.status !== 'DRAFT')
      throw new DomainError('INVALID_STATE_TRANSITION', `this GRN is ${grn.status.toLowerCase()}`);
    if (grn.version !== version)
      throw new DomainError('VERSION_CONFLICT', 'this GRN changed; reload and try again');
    return grn;
  }

  private movePo(
    id: string,
    version: number,
    to: PurchaseOrderStatus,
    verb: 'approve' | 'send' | 'cancel' | 'close',
    ctx: CommandContext,
    change: { approvedBy?: string | null; sentAt?: Date; cancelReason?: string },
  ): PurchaseOrderView {
    return this.write(ctx, (scope, now) => {
      const po = this.po(ctx.branchId, id, version);
      assertPoTransition(po.status, to);
      this.d.purchasing.setPurchaseOrderStatus(
        id,
        version,
        { status: to, ...change },
        ctx.actorId,
        now,
      );
      const type = {
        approve: 'PurchaseOrderApproved',
        send: 'PurchaseOrderSent',
        cancel: 'PurchaseOrderCancelled',
        close: 'PurchaseOrderClosed',
      }[verb];
      scope.recordEvents([
        recordChanged(type, 'PurchaseOrder', id, version + 1, { from: po.status, to }, now),
      ]);
      scope.audit({
        action: `purchase.po.${verb}`,
        entityType: 'PurchaseOrder',
        entityId: id,
        before: { status: po.status },
        after: { status: to },
        reason: change.cancelReason ?? null,
      });
      return this.purchaseOrder(ctx.branchId, id);
    });
  }

  private logPo(
    scope: TransactionScope,
    type: string,
    verb: 'create' | 'update',
    record: PurchaseOrderRecord,
    at: Date,
    before?: PurchaseOrderRecord,
  ): void {
    scope.recordEvents([
      recordChanged(
        type,
        'PurchaseOrder',
        record.id,
        record.version,
        { poNo: record.poNo, vendorId: record.vendorId, grandTotal: record.grandTotal },
        at,
      ),
    ]);
    scope.audit({
      action: `purchase.po.${verb}`,
      entityType: 'PurchaseOrder',
      entityId: record.id,
      before,
      after: record,
    });
  }

  private logGrn(
    scope: TransactionScope,
    type: string,
    verb: 'create' | 'update',
    record: GrnRecord,
    at: Date,
    before?: GrnRecord,
  ): void {
    scope.recordEvents([
      recordChanged(
        type,
        'Grn',
        record.id,
        record.version,
        { grnNo: record.grnNo, vendorId: record.vendorId, grandTotal: record.grandTotal },
        at,
      ),
    ]);
    scope.audit({
      action: `purchase.grn.${verb}`,
      entityType: 'Grn',
      entityId: record.id,
      before,
      after: record,
    });
  }
}

function totalsOf(lines: readonly PoLineInput[]) {
  return documentTotals(lines.map((l) => lineAmounts(l.quantityMilli, l.unitPrice, l.taxRateBp)));
}

/** A GRN is billed on what was accepted. */
function grnTotals(lines: readonly GrnLineInput[]) {
  return documentTotals(
    lines.map((l) => lineAmounts(l.quantityMilli - l.rejectedQtyMilli, l.unitPrice, l.taxRateBp)),
  );
}
