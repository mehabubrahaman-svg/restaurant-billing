import { DomainError } from '@restroos/domain';
import type { BillingQueries, InvoiceRepository } from '../billing/ports';
import type { CatalogRepository } from '../catalog/ports';
import type { KitchenQueries, OrderQueries } from '../ordering/ports';
import type { Clock } from '../ports/clock';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { BranchSettingsRecord, PrinterRecord, SettingsRepository } from '../settings/ports';
import { columnsFor, dotsFor, needsRaster, type PrintDocument } from './document';
import type { ReceiptLanguage } from './labels';
import type { EscPosEncoder, PrinterTransport, RasterRenderer } from './ports';
import { invoiceSlip, kotSlip, shiftSlip, testSlip, type SlipContext } from './templates';

export interface PrintServiceDeps {
  readonly settings: SettingsRepository;
  readonly billing: BillingQueries;
  readonly invoices: InvoiceRepository;
  readonly orders: OrderQueries;
  readonly kitchen: KitchenQueries;
  readonly catalog: CatalogRepository;
  readonly encoder: EscPosEncoder;
  readonly transport: PrinterTransport;
  /** Null when no renderer is available: slips are then English-only text. */
  readonly renderer: RasterRenderer | null;
  readonly organizationName: () => string;
  readonly timeZone: string;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

export interface PrintOutcome {
  printerId: string;
  printerName: string;
  /** TEXT: the printer's own font (fast). RASTER: drawn as an image (Hindi, Bengali). */
  mode: 'TEXT' | 'RASTER';
  bytes: number;
}

/** Thermal printing of bills, KOTs and shift reports (docs/09 WP 5.5, docs/01 §5.8). */
export class PrintService {
  constructor(private readonly d: PrintServiceDeps) {}

  /** The first print is the original; later ones say DUPLICATE and need billing.reprint. */
  async printInvoice(
    invoiceId: string,
    options: { printerId?: string | undefined; mayReprint: boolean },
    ctx: CommandContext,
  ): Promise<PrintOutcome> {
    const invoice = this.d.billing.invoice(ctx.branchId, invoiceId);
    if (!invoice) throw new DomainError('NOT_FOUND', 'invoice not found');
    const copy = invoice.printCount > 0 ? 'DUPLICATE' : 'ORIGINAL';
    if (copy === 'DUPLICATE' && !options.mayReprint) {
      throw new DomainError('APPROVAL_REQUIRED', 'reprinting a bill needs a manager', {
        permission: 'billing.reprint',
      });
    }
    const printer = this.pick(ctx.branchId, ['BILL'], options.printerId);
    const slip = await this.slipContext(ctx.branchId);
    const names = this.localNames(ctx.branchId, invoice.orderId, slip.languages);
    const doc = invoiceSlip(invoice, slip, { copy, localName: (id) => names.get(id) ?? null });
    const outcome = await this.send(printer, doc);
    this.d.unitOfWork.run(ctx, (scope) => {
      const aggregate = this.d.invoices.get(ctx.branchId, invoiceId)!;
      aggregate.markPrinted(copy, this.d.clock.now());
      this.d.invoices.save(aggregate);
      scope.audit({
        action: copy === 'ORIGINAL' ? 'billing.invoice.print' : 'billing.invoice.reprint',
        entityType: 'Invoice',
        entityId: invoiceId,
        after: { printer: printer.name, copy },
      });
      scope.recordEvents(aggregate.pullEvents());
    });
    return outcome;
  }

  /** The bill as a slip (English), for an on-screen preview or browser printing without a thermal printer. */
  invoicePreview(invoiceId: string, branchId: string): PrintDocument {
    const invoice = this.d.billing.invoice(branchId, invoiceId);
    if (!invoice) throw new DomainError('NOT_FOUND', 'invoice not found');
    const context = {
      organizationName: this.d.organizationName(),
      branch: this.branch(branchId),
      languages: ['en'] as ReceiptLanguage[],
      timeZone: this.d.timeZone,
      printedAt: this.d.clock.now(),
    };
    return invoiceSlip(invoice, context, {
      copy: invoice.printCount > 0 ? 'DUPLICATE' : 'ORIGINAL',
    });
  }

  /** KOT printers for the ticket's station (or for every station). None configured: nothing printed. */
  async printKot(kotId: string, branchId: string, reprint: boolean): Promise<PrintOutcome[]> {
    const kot = this.d.kitchen.kot(branchId, kotId);
    if (!kot) throw new DomainError('NOT_FOUND', 'KOT not found');
    const printers = this.d.settings
      .printers(branchId)
      .filter((p) => p.isActive && p.purpose === 'KOT' && p.deviceId === null)
      .filter((p) => p.stationId === null || p.stationId === kot.kitchenStationId);
    const outcomes: PrintOutcome[] = [];
    for (const printer of printers) {
      const slip = await this.slipContext(branchId);
      const names = this.localNames(branchId, kot.orderId, slip.languages);
      outcomes.push(
        await this.send(
          printer,
          kotSlip(kot, slip, { reprint, localName: (id) => names.get(id) ?? null }),
        ),
      );
    }
    return outcomes;
  }

  async printShift(
    shiftId: string,
    options: { printerId?: string | undefined },
    ctx: CommandContext,
  ): Promise<PrintOutcome> {
    const report = this.d.billing.shiftReport(ctx.branchId, shiftId);
    if (!report) throw new DomainError('NOT_FOUND', 'shift not found');
    const printer = this.pick(ctx.branchId, ['REPORT', 'BILL'], options.printerId);
    return this.send(printer, shiftSlip(report, await this.slipContext(ctx.branchId)));
  }

  async testPage(printerId: string, branchId: string): Promise<PrintOutcome> {
    const printer = this.pick(branchId, ['BILL', 'KOT', 'REPORT', 'LABEL'], printerId);
    return this.send(
      printer,
      testSlip(printer.name, printer.paperWidthMm, await this.slipContext(branchId)),
    );
  }

  // ---- helpers -------------------------------------------------------------------------------
  private async send(printer: PrinterRecord, doc: PrintDocument): Promise<PrintOutcome> {
    const raster = this.d.renderer !== null && needsRaster(doc);
    const bytes = raster
      ? this.d.encoder.raster(
          await this.d.renderer!.render(doc, dotsFor(printer.paperWidthMm)),
          doc.cut,
        )
      : this.d.encoder.text(doc, columnsFor(printer.paperWidthMm));
    await this.d.transport.send(printer, bytes);
    return {
      printerId: printer.id,
      printerName: printer.name,
      mode: raster ? 'RASTER' : 'TEXT',
      bytes: bytes.length,
    };
  }

  private pick(
    branchId: string,
    purposes: readonly PrinterRecord['purpose'][],
    printerId?: string,
  ): PrinterRecord {
    const printers = this.d.settings
      .printers(branchId)
      .filter((p) => p.isActive && p.deviceId === null);
    if (printerId) {
      const chosen = printers.find((p) => p.id === printerId);
      if (!chosen) throw new DomainError('NOT_FOUND', 'printer not found');
      return chosen;
    }
    for (const purpose of purposes) {
      const found = printers.find((p) => p.purpose === purpose);
      if (found) return found;
    }
    throw new DomainError(
      'NO_PRINTER',
      `no active ${purposes[0]!.toLowerCase()} printer is set up`,
    );
  }

  private async slipContext(branchId: string): Promise<SlipContext> {
    const branch = this.branch(branchId);
    const extra = branch.receiptLanguages.filter(
      (l): l is ReceiptLanguage => l === 'hi' || l === 'bn',
    );
    // A second language needs the image renderer; without it, English only.
    const languages: ReceiptLanguage[] =
      this.d.renderer && extra.length > 0 ? ['en', extra[0]!] : ['en'];
    return {
      organizationName: this.d.organizationName(),
      branch,
      languages,
      timeZone: this.d.timeZone,
      printedAt: this.d.clock.now(),
    };
  }

  /** Order item id → its menu name in the receipt's second language. */
  private localNames(
    branchId: string,
    orderId: string,
    languages: readonly ReceiptLanguage[],
  ): Map<string, string> {
    const lang = languages.find((l) => l !== 'en');
    const names = new Map<string, string>();
    if (!lang) return names;
    for (const item of this.d.orders.order(branchId, orderId)?.items ?? []) {
      const menu = this.d.catalog.item(branchId, item.menuItemId);
      const local = menu?.nameTranslations[lang];
      if (local)
        names.set(
          item.id,
          item.variantName
            ? `${local} (${variantName(menu!, item.variantId, lang) ?? item.variantName})`
            : local,
        );
    }
    return names;
  }

  private branch(branchId: string): BranchSettingsRecord {
    const branch = this.d.settings.branch(branchId);
    if (!branch) throw new DomainError('NOT_FOUND', 'branch not found');
    return branch;
  }
}

function variantName(
  item: {
    variants: {
      id: string;
      nameTranslations: { hi?: string | undefined; bn?: string | undefined };
    }[];
  },
  id: string | null,
  lang: 'hi' | 'bn',
) {
  return item.variants.find((v) => v.id === id)?.nameTranslations[lang] ?? null;
}
