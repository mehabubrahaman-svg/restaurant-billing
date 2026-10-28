import { signedLine, splitGst, stockValueOfSum, type JournalLine } from '@restroos/domain';
import type { ProjectionLog, StoredEvent } from '../inventory/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { UnitOfWork } from '../ports/unit-of-work';
import type { BranchLookup } from '../purchasing/ports';
import { JournalWriter } from './journal-writer';
import type {
  AccountingRepository,
  PostingSources,
  StockMovementPosting,
  SystemAccount,
} from './ports';

export const ACCOUNTING_PROJECTION = 'accounting';
/** Its cursor over stock_movements (rowid), for cost of goods sold, wastage and adjustments. */
export const ACCOUNTING_STOCK_PROJECTION = 'accounting-stock';
/** Documents that are journaled. */
export const ACCOUNTING_EVENT_TYPES = [
  'InvoiceIssued',
  'CreditNoteIssued',
  'InvoiceCancelled',
  'PaymentRecorded',
  'RefundPaid',
  'GrnPosted',
  'VendorPaymentRecorded',
] as const;
/** Events after which stock may have moved; the projector then journals the new movements. */
export const STOCK_MOVING_EVENT_TYPES = [
  'KotFired',
  'OrderItemCancelled',
  'StockReceived',
  'OpeningStockEntered',
  'StockWasted',
  'StockAdjusted',
  'StockCountPosted',
] as const;
const BATCH = 200;
const STOCK_BATCH = 2_000;

const TENDER_ACCOUNT: Record<string, SystemAccount | null> = {
  CASH: 'CASH',
  CARD: 'CARD_UPI_CLEARING',
  UPI: 'CARD_UPI_CLEARING',
  WALLET: 'CARD_UPI_CLEARING',
  AGGREGATOR: 'AGGREGATOR_RECEIVABLE',
  // On credit the guest still owes: the receivable stays.
  CREDIT: null,
  COMPLIMENTARY: 'SALES_RETURNS',
  LOYALTY: 'SALES_RETURNS',
};

/** What a stock movement is booked against, opposite Inventory. */
function stockCounterpart(m: StockMovementPosting): SystemAccount | null {
  switch (m.type) {
    case 'SALE_CONSUMPTION':
    case 'SALE_REVERSAL':
      return 'COGS';
    case 'WASTAGE':
      return 'WASTAGE';
    case 'OPENING':
      return 'OPENING_EQUITY';
    // Goods on a GRN are booked by the GRN's own entry; a direct receipt was bought for cash.
    case 'PURCHASE':
      return m.referenceType === 'GRN_LINE' ? null : 'CASH';
    default:
      return 'STOCK_ADJUSTMENT';
  }
}

const STOCK_NARRATION: Partial<Record<SystemAccount, string>> = {
  COGS: 'Cost of goods sold',
  WASTAGE: 'Wastage',
  OPENING_EQUITY: 'Opening stock',
  CASH: 'Stock bought for cash',
  STOCK_ADJUSTMENT: 'Stock adjustments',
};

/**
 * Automatic journals (docs/03 §4.4). Bills and credit notes, payments and
 * refunds, cancelled bills, GRNs and vendor payments are posted from their
 * events, each in one transaction with the checkpoint so it is posted once.
 * Stock is posted from the movements themselves (a cursor over
 * stock_movements): cost of goods sold, wastage, adjustments, opening stock
 * and stock bought for cash, one entry per business day and kind each time
 * the projector runs.
 */
export class AccountingProjector {
  private readonly journal: JournalWriter;
  private running = false;

  constructor(
    private readonly d: {
      log: ProjectionLog;
      accounting: AccountingRepository;
      sources: PostingSources;
      branches: BranchLookup;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      onError: (error: unknown, event: StoredEvent | null) => void;
    },
  ) {
    this.journal = new JournalWriter({
      accounting: d.accounting,
      branches: d.branches,
      ids: d.ids,
    });
  }

  /** Posts everything committed since the checkpoints. Returns how many entries were written. */
  catchUp(): number {
    if (this.running) return 0;
    this.running = true;
    try {
      return this.catchUpDocuments() + this.catchUpStock();
    } finally {
      this.running = false;
    }
  }

  private catchUpDocuments(): number {
    const head = this.d.log.head();
    let posted = 0;
    for (;;) {
      const from = this.d.log.checkpoint(ACCOUNTING_PROJECTION);
      if (from >= head) break;
      const events = this.d.log.events(from, head, ACCOUNTING_EVENT_TYPES, BATCH);
      for (const event of events) {
        try {
          posted += this.inTransaction(event.branchId, event.seq, () => this.apply(event));
        } catch (error) {
          this.d.onError(error, event);
          this.inTransaction(event.branchId, event.seq, () => 0);
        }
      }
      if (events.length < BATCH) {
        this.inTransaction('system', head, () => 0);
        break;
      }
    }
    return posted;
  }

  private inTransaction(branchId: string, seq: number, work: () => number): number {
    const context = { branchId, actorId: null, correlationId: `projection:accounting:${seq}` };
    return this.d.unitOfWork.run(context, () => {
      const n = work();
      this.d.log.advance(ACCOUNTING_PROJECTION, seq, this.d.clock.now());
      return n;
    });
  }

  private apply(event: StoredEvent): number {
    const id = event.aggregateId;
    switch (event.type) {
      case 'InvoiceIssued':
      case 'CreditNoteIssued':
        return this.postInvoice(id, event.actorId);
      case 'InvoiceCancelled':
        return this.reverseInvoice(id, event.actorId) + this.postPayments(id, event.actorId);
      case 'PaymentRecorded':
      case 'RefundPaid':
        return this.postPayments(id, event.actorId);
      case 'GrnPosted':
        return this.postGrn(id, event.actorId);
      case 'VendorPaymentRecorded':
        return this.postVendorPayment(id, event.actorId);
      default:
        return 0;
    }
  }

  /** Bill: receivable = sales + service charge + output tax ± rounding. A credit note mirrors it against sales returns. */
  private postInvoice(id: string, actorId: string | null): number {
    const inv = this.d.sources.invoice(id);
    if (!inv || inv.grandTotal === 0 || this.d.accounting.originalEntry(inv.kind, id)) return 0;
    const sign = inv.kind === 'INVOICE' ? 1 : -1;
    const a = (tag: SystemAccount) => this.journal.account(tag);
    const party = inv.customerId
      ? { partyType: 'CUSTOMER' as const, partyId: inv.customerId }
      : undefined;
    const lines: JournalLine[] = [
      signedLine(a('AR'), sign * inv.grandTotal, party),
      ...inv.sales.map((s) =>
        signedLine(
          a(
            inv.kind === 'CREDIT_NOTE' ? 'SALES_RETURNS' : s.liquor ? 'SALES_LIQUOR' : 'SALES_FOOD',
          ),
          -sign * s.taxable,
        ),
      ),
      signedLine(a('SERVICE_CHARGE'), -sign * inv.chargesTotal),
      ...inv.taxes.map((t) => signedLine(a(`OUTPUT_${t.code}`), -sign * t.amount)),
      signedLine(a('ROUND_OFF'), -sign * inv.roundOff),
    ];
    this.journal.post(
      {
        branchId: inv.branchId,
        entryDate: inv.businessDate,
        sourceType: inv.kind,
        sourceId: id,
        narration: `${inv.kind === 'INVOICE' ? 'Bill' : 'Credit note'} ${inv.invoiceNo}`,
        createdBy: actorId,
      },
      lines,
      this.d.clock.now(),
    );
    return 1;
  }

  private reverseInvoice(id: string, actorId: string | null): number {
    const original = this.d.accounting.originalEntry('INVOICE', id);
    if (!original || this.d.accounting.reversalOf(original.id) !== undefined) return 0;
    const inv = this.d.sources.invoice(id);
    this.journal.reverse(
      original.id,
      {
        branchId: original.branchId,
        entryDate: inv?.businessDate ?? original.entryDate,
        narration: `Bill ${inv?.invoiceNo ?? ''} cancelled`.trim(),
        createdBy: actorId,
      },
      this.d.clock.now(),
    );
    return 1;
  }

  /** Each payment on a bill (refunds negative) moves the receivable to the till, the card/UPI clearing account or the aggregator. */
  private postPayments(invoiceId: string, actorId: string | null): number {
    let posted = 0;
    for (const p of this.d.sources.payments(invoiceId)) {
      const tender = TENDER_ACCOUNT[p.method] ?? 'CASH';
      if (tender === null || this.d.accounting.originalEntry('PAYMENT', p.id)) continue;
      const party = p.customerId
        ? { partyType: 'CUSTOMER' as const, partyId: p.customerId }
        : undefined;
      this.journal.post(
        {
          branchId: p.branchId,
          entryDate: p.businessDate,
          sourceType: 'PAYMENT',
          sourceId: p.id,
          narration: `${p.amount > 0 ? 'Payment' : 'Refund'} on ${p.invoiceNo} (${p.method})`,
          createdBy: actorId,
        },
        [
          signedLine(this.journal.account(tender), p.amount),
          signedLine(this.journal.account('AR'), -p.amount, party),
        ],
        this.d.clock.now(),
      );
      posted += 1;
    }
    return posted;
  }

  /** Goods received: inventory and input GST (inventory alone without credit) against the vendor. */
  private postGrn(id: string, actorId: string | null): number {
    if (this.d.accounting.originalEntry('GRN', id)) return 0;
    const g = this.d.sources.grn(id);
    if (!g || g.grandTotal === 0) return 0;
    const a = (tag: SystemAccount) => this.journal.account(tag);
    const lines: JournalLine[] = [];
    if (g.inputTaxKind === 'NONE') lines.push(signedLine(a('INVENTORY'), g.grandTotal));
    else {
      lines.push(signedLine(a('INVENTORY'), g.subtotal));
      if (g.inputTaxKind === 'IGST') lines.push(signedLine(a('INPUT_IGST'), g.taxTotal));
      else {
        const { cgst, sgst } = splitGst(g.taxTotal);
        lines.push(signedLine(a('INPUT_CGST'), cgst), signedLine(a('INPUT_SGST'), sgst));
      }
    }
    lines.push(signedLine(a('AP'), -g.grandTotal, { partyType: 'VENDOR', partyId: g.vendorId }));
    this.journal.post(
      {
        branchId: g.branchId,
        entryDate: g.businessDate,
        sourceType: 'GRN',
        sourceId: id,
        narration: `GRN ${g.grnNo}${g.vendorInvoiceNo ? `, bill ${g.vendorInvoiceNo}` : ''}`,
        createdBy: actorId,
      },
      lines,
      this.d.clock.now(),
    );
    return 1;
  }

  private postVendorPayment(id: string, actorId: string | null): number {
    if (this.d.accounting.originalEntry('VENDOR_PAYMENT', id)) return 0;
    const p = this.d.sources.vendorPayment(id);
    if (!p) return 0;
    this.journal.post(
      {
        branchId: p.branchId,
        entryDate: p.paidOn,
        sourceType: 'VENDOR_PAYMENT',
        sourceId: id,
        narration: `Paid ${p.vendorName} (${p.method})`,
        createdBy: actorId,
      },
      [
        signedLine(this.journal.account('AP'), p.amount, {
          partyType: 'VENDOR',
          partyId: p.vendorId,
        }),
        signedLine(this.journal.account(p.method === 'CASH' ? 'CASH' : 'BANK'), -p.amount),
      ],
      this.d.clock.now(),
    );
    return 1;
  }

  /** New stock movements, one entry per branch, business day and kind, with the cursor in the same transaction. */
  private catchUpStock(): number {
    let posted = 0;
    for (;;) {
      const after = this.d.log.checkpoint(ACCOUNTING_STOCK_PROJECTION);
      const movements = this.d.sources.stockMovementsAfter(after, STOCK_BATCH);
      if (movements.length === 0) break;
      const last = movements.at(-1)!;
      try {
        posted += this.d.unitOfWork.run(
          {
            branchId: last.branchId,
            actorId: null,
            correlationId: `projection:accounting-stock:${last.seq}`,
          },
          () => {
            const n = this.postStock(movements);
            this.d.log.advance(ACCOUNTING_STOCK_PROJECTION, last.seq, this.d.clock.now());
            return n;
          },
        );
      } catch (error) {
        this.d.onError(error, null);
        break;
      }
      if (movements.length < STOCK_BATCH) break;
    }
    return posted;
  }

  private postStock(movements: readonly StockMovementPosting[]): number {
    const groups = new Map<
      string,
      { m: StockMovementPosting; counterpart: SystemAccount; raw: number }
    >();
    for (const m of movements) {
      const counterpart = stockCounterpart(m);
      if (counterpart === null) continue;
      const key = `${m.branchId}|${m.businessDate}|${counterpart}`;
      const g = groups.get(key);
      groups.set(key, { m, counterpart, raw: (g?.raw ?? 0) + m.rawValue });
    }
    let posted = 0;
    for (const { m, counterpart, raw } of groups.values()) {
      const value = stockValueOfSum(raw);
      if (value === 0) continue;
      this.journal.post(
        {
          branchId: m.branchId,
          entryDate: m.businessDate,
          sourceType: 'STOCK',
          sourceId: m.id,
          narration: STOCK_NARRATION[counterpart] ?? null,
          createdBy: null,
        },
        [
          signedLine(this.journal.account('INVENTORY'), value),
          signedLine(this.journal.account(counterpart), -value),
        ],
        this.d.clock.now(),
      );
      posted += 1;
    }
    return posted;
  }
}
