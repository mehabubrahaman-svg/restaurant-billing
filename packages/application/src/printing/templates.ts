import type { InvoiceView, ShiftReportView } from '../billing/ports';
import type { KotView } from '../ordering/ports';
import type { BranchSettingsRecord } from '../settings/ports';
import type { PrintBlock, PrintDocument } from './document';
import { formatPaise, formatRate, label, type ReceiptLanguage } from './labels';

export interface SlipContext {
  readonly organizationName: string;
  readonly branch: BranchSettingsRecord;
  /** English first; a second language only when the slip will be printed as an image. */
  readonly languages: readonly ReceiptLanguage[];
  readonly timeZone: string;
  readonly printedAt: Date;
}

const when = (iso: string | Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

const orderTypeKey = (t: string) =>
  t === 'TAKEAWAY' ? 'takeaway' : t === 'DELIVERY' ? 'delivery' : 'dineIn';

/**
 * The customer's bill (GST tax invoice / liquor bill / credit note):
 * registration numbers, items, discounts, charges, the tax breakup per rate,
 * round-off, total and payments. `localName` gives an item's name in the
 * second receipt language, when there is one.
 */
export function invoiceSlip(
  invoice: InvoiceView,
  ctx: SlipContext,
  options: { copy: 'ORIGINAL' | 'DUPLICATE'; localName?: (orderItemId: string) => string | null },
): PrintDocument {
  const L = (k: Parameters<typeof label>[0]) => label(k, ctx.languages);
  const b = ctx.branch;
  const blocks: PrintBlock[] = [];
  const header = b.receiptHeader.trim() || ctx.organizationName;
  for (const line of header.split('\n'))
    blocks.push({ kind: 'text', text: line, align: 'center', bold: true, size: 2 });
  blocks.push({ kind: 'text', text: b.name, align: 'center' });
  if (b.address) blocks.push({ kind: 'text', text: b.address, align: 'center' });
  if (b.phone) blocks.push({ kind: 'text', text: `Ph: ${b.phone}`, align: 'center' });
  if (
    invoice.series === 'LIQ' ||
    (invoice.series === 'CN' && invoice.taxes.some((t) => t.code === 'VAT'))
  ) {
    if (b.vatTin) blocks.push({ kind: 'text', text: `VAT TIN: ${b.vatTin}`, align: 'center' });
    if (b.exciseLicenceNo)
      blocks.push({ kind: 'text', text: `Excise Lic: ${b.exciseLicenceNo}`, align: 'center' });
  } else if (b.gstin) {
    blocks.push({ kind: 'text', text: `GSTIN: ${b.gstin}`, align: 'center' });
  }
  blocks.push({ kind: 'rule', char: '=' });
  blocks.push({
    kind: 'text',
    text: invoice.kind === 'CREDIT_NOTE' ? L('creditNote') : L('taxInvoice'),
    align: 'center',
    bold: true,
  });
  if (options.copy === 'DUPLICATE')
    blocks.push({ kind: 'text', text: `*** ${L('duplicate')} ***`, align: 'center', bold: true });
  if (invoice.status === 'CANCELLED')
    blocks.push({ kind: 'text', text: `*** ${L('cancelled')} ***`, align: 'center', bold: true });
  blocks.push({ kind: 'row', left: `${L('billNo')}: ${invoice.invoiceNo}`, right: '' });
  blocks.push({
    kind: 'row',
    left: `${L('date')}: ${when(invoice.createdAt, ctx.timeZone)}`,
    right: '',
  });
  const where = invoice.tableLabel
    ? `${L('table')} ${invoice.tableLabel}`
    : invoice.tokenNo !== null
      ? `${L('token')} ${invoice.tokenNo}`
      : '';
  blocks.push({
    kind: 'row',
    left: `${L(orderTypeKey(invoice.orderType))} ${where}`.trim(),
    right: `${L('order')} #${invoice.orderNo}`,
  });
  if (invoice.createdByName)
    blocks.push({ kind: 'row', left: `${L('cashier')}: ${invoice.createdByName}`, right: '' });
  if (invoice.customerTaxId) {
    blocks.push({ kind: 'row', left: `${invoice.customerName ?? ''}`, right: '' });
    blocks.push({ kind: 'row', left: `GSTIN: ${invoice.customerTaxId}`, right: '' });
  }
  blocks.push({ kind: 'rule' });
  blocks.push({ kind: 'row', left: L('item'), right: L('amount'), bold: true });
  blocks.push({ kind: 'rule' });
  for (const line of invoice.lines) {
    const qty = line.quantity > 0 ? `${line.quantity} x ` : '';
    blocks.push({
      kind: 'row',
      left: `${qty}${line.description}`,
      right: formatPaise(line.quantity > 0 ? line.unitPrice * line.quantity : line.lineTotal),
    });
    const local = line.orderItemId && options.localName?.(line.orderItemId);
    if (local) blocks.push({ kind: 'text', text: `   ${local}` });
    if (line.quantity > 1)
      blocks.push({ kind: 'text', text: `   @ ${formatPaise(line.unitPrice)}` });
  }
  blocks.push({ kind: 'rule' });
  blocks.push({ kind: 'row', left: L('subtotal'), right: formatPaise(invoice.subtotal) });
  for (const d of invoice.discounts) {
    const what =
      d.couponCode ??
      (d.kind === 'PERCENT'
        ? `${formatRate(d.value)}%`
        : d.kind === 'COMPLIMENTARY'
          ? 'Complimentary'
          : '');
    blocks.push({
      kind: 'row',
      left: `${L('discount')} ${what}`.trim(),
      right: `-${formatPaise(d.amount)}`,
    });
  }
  for (const c of invoice.charges)
    blocks.push({ kind: 'row', left: c.name, right: formatPaise(c.amount) });
  for (const t of invoice.taxes) {
    blocks.push({
      kind: 'row',
      left: `${t.code} @ ${formatRate(t.rateBp)}% on ${formatPaise(t.taxableValue)}`,
      right: formatPaise(t.taxAmount),
    });
  }
  if (invoice.roundOff !== 0)
    blocks.push({ kind: 'row', left: L('roundOff'), right: formatPaise(invoice.roundOff) });
  blocks.push({ kind: 'rule', char: '=' });
  blocks.push({
    kind: 'row',
    left: L('total'),
    right: `₹${formatPaise(invoice.grandTotal)}`,
    bold: true,
    size: 2,
  });
  blocks.push({ kind: 'rule', char: '=' });
  for (const p of invoice.payments) {
    const ref = p.reference ? ` (${p.reference})` : '';
    blocks.push({
      kind: 'row',
      left: `${p.amount < 0 ? L('refunded') : L('paid')} ${p.method}${ref}`,
      right: formatPaise(Math.abs(p.amount)),
    });
    if (p.changeDue)
      blocks.push({ kind: 'row', left: L('change'), right: formatPaise(p.changeDue) });
  }
  if (b.receiptFooter.trim())
    for (const line of b.receiptFooter.split('\n'))
      blocks.push({ kind: 'text', text: line, align: 'center' });
  blocks.push({ kind: 'text', text: L('thanks'), align: 'center' });
  return { blocks, cut: true };
}

/** The kitchen ticket: big number, where it goes, items with notes in capitals. */
export function kotSlip(
  kot: KotView,
  ctx: SlipContext,
  options: { reprint: boolean; localName?: (itemId: string) => string | null },
): PrintDocument {
  const L = (k: Parameters<typeof label>[0]) => label(k, ctx.languages);
  const blocks: PrintBlock[] = [
    { kind: 'text', text: `${L('kot')} ${kot.kotNo}`, align: 'center', bold: true, size: 2 },
  ];
  if (options.reprint)
    blocks.push({ kind: 'text', text: `*** ${L('duplicate')} ***`, align: 'center', bold: true });
  if (kot.stationName)
    blocks.push({ kind: 'text', text: kot.stationName, align: 'center', bold: true });
  const where = kot.tableLabel
    ? `${L('table')} ${kot.tableLabel}`
    : kot.tokenNo !== null
      ? `${L('token')} ${kot.tokenNo}`
      : '';
  blocks.push({
    kind: 'row',
    left: `${L(orderTypeKey(kot.orderType))} ${where}`.trim(),
    right: `#${kot.orderNo}`,
    bold: true,
    size: 2,
  });
  blocks.push({
    kind: 'row',
    left: when(kot.firedAt, ctx.timeZone),
    right: kot.captainName ? `${L('captain')}: ${kot.captainName}` : '',
  });
  blocks.push({ kind: 'rule' });
  for (const item of kot.items) {
    const cancelled = item.status === 'CANCELLED';
    const name = item.variantName ? `${item.name} (${item.variantName})` : item.name;
    blocks.push({
      kind: 'text',
      text: `${cancelled ? 'XX ' : ''}${item.quantity} x ${name}`,
      bold: true,
      size: 2,
    });
    const local = options.localName?.(item.id);
    if (local) blocks.push({ kind: 'text', text: `   ${local}`, size: 2 });
    for (const a of item.addons)
      blocks.push({
        kind: 'text',
        text: `   + ${a.quantity > 1 ? `${a.quantity} x ` : ''}${a.name}`,
      });
    if (item.specialNote)
      blocks.push({
        kind: 'text',
        text: `   ** ${L('note')}: ${item.specialNote.toUpperCase()} **`,
        bold: true,
      });
  }
  blocks.push({ kind: 'rule' });
  return { blocks, cut: true };
}

/** X report (shift still open) or Z report (closed). */
export function shiftSlip(report: ShiftReportView, ctx: SlipContext): PrintDocument {
  const blocks: PrintBlock[] = [
    {
      kind: 'text',
      text: report.status === 'OPEN' ? 'X REPORT' : 'Z REPORT',
      align: 'center',
      bold: true,
      size: 2,
    },
    { kind: 'text', text: `${ctx.organizationName} - ${ctx.branch.name}`, align: 'center' },
    {
      kind: 'row',
      left: `Opened ${when(report.openedAt, ctx.timeZone)}`,
      right: report.openedByName ?? '',
    },
  ];
  if (report.closedAt)
    blocks.push({
      kind: 'row',
      left: `Closed ${when(report.closedAt, ctx.timeZone)}`,
      right: report.closedByName ?? '',
    });
  blocks.push({ kind: 'row', left: `Printed ${when(ctx.printedAt, ctx.timeZone)}`, right: '' });
  blocks.push({ kind: 'rule' });
  blocks.push({ kind: 'row', left: 'Bills paid', right: String(report.invoiceCount) });
  blocks.push({ kind: 'row', left: 'Sales', right: formatPaise(report.sales) });
  blocks.push({ kind: 'row', left: 'Refunds', right: formatPaise(report.refunds) });
  blocks.push({ kind: 'row', left: 'Opening float', right: formatPaise(report.openingFloat) });
  blocks.push({ kind: 'rule' });
  blocks.push({
    kind: 'row',
    left: 'Tender',
    right: report.status === 'OPEN' ? 'Expected' : 'Exp / Counted / Diff',
    bold: true,
  });
  for (const t of report.tenders) {
    const name = t.terminalLabel ? `${t.method} ${t.terminalLabel}` : t.method;
    const right =
      t.reported === null
        ? formatPaise(t.expected)
        : `${formatPaise(t.expected)} / ${formatPaise(t.reported)} / ${formatPaise(t.variance ?? 0)}`;
    blocks.push({ kind: 'row', left: name, right });
  }
  if (report.cashVariance !== null) {
    blocks.push({ kind: 'rule', char: '=' });
    blocks.push({
      kind: 'row',
      left: 'Cash difference',
      right: formatPaise(report.cashVariance),
      bold: true,
    });
  }
  return { blocks, cut: true };
}

export function testSlip(
  printerName: string,
  paperWidthMm: number,
  ctx: SlipContext,
): PrintDocument {
  return {
    blocks: [
      { kind: 'text', text: 'RestroOS test print', align: 'center', bold: true, size: 2 },
      { kind: 'text', text: printerName, align: 'center' },
      { kind: 'text', text: `${paperWidthMm} mm paper`, align: 'center' },
      { kind: 'rule' },
      { kind: 'row', left: 'Left', right: 'Right' },
      { kind: 'text', text: '₹ 1,23,456.78', align: 'center' },
      ...(ctx.languages.includes('hi')
        ? [{ kind: 'text' as const, text: 'हिंदी: चिकन बिरयानी', align: 'center' as const }]
        : []),
      ...(ctx.languages.includes('bn')
        ? [{ kind: 'text' as const, text: 'বাংলা: চিকেন বিরিয়ানি', align: 'center' as const }]
        : []),
      { kind: 'rule' },
      { kind: 'text', text: when(ctx.printedAt, ctx.timeZone), align: 'center' },
    ],
    cut: true,
  };
}
