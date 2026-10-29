import type { Invoice, InvoiceDraft } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Button, cn, X } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';

type Bill = InvoiceDraft | Invoice;

/** "2.5" for 250 bp, in the user's digits. A rate, not money. */
export function useRate() {
  const format = useFormat();
  return (bp: number) => format.number(bp / 100, { maximumFractionDigits: 2 });
}

/**
 * One bill as printed (wireframes §7): lines, subtotal, discounts, charges,
 * the tax breakup per code and rate, round-off and the total. Used for the
 * live preview, issued invoices and credit notes.
 */
export function BillBreakdown({
  bill,
  removableCharges,
  onRemoveCharge,
  showLines = true,
  className,
}: {
  bill: Bill;
  /** Charge rule ids the guest may drop (optional service charge). */
  removableCharges?: ReadonlySet<string>;
  onRemoveCharge?: (chargeRuleId: string) => void;
  showLines?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const rate = useRate();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const plain = (paise: number) => format.money(Money.ofPaise(paise), { symbol: false });
  const invoice = 'invoiceNo' in bill ? bill : null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {showLines && (
        <ul className="flex flex-col divide-y" aria-label={t('pos.bill.lines')}>
          {bill.lines.map((line, index) => (
            <li
              key={'id' in line ? line.id : `${line.orderItemId ?? ''}-${index}`}
              className="flex items-baseline gap-3 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block">{line.description}</span>
                <span className="block text-sm text-muted-foreground tabular-nums">
                  {t('pos.bill.qtyTimes', {
                    quantity: line.quantity,
                    price: plain(line.unitPrice),
                  })}
                </span>
              </span>
              <span className="tabular-nums">
                {plain(Money.ofPaise(line.unitPrice).multiply(line.quantity).paise)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-t pt-2 text-sm">
        <Row label={t('pos.bill.subtotal')} value={plain(bill.subtotal)} />
        {bill.discounts.map((d, i) => (
          <Row
            key={`d${i}`}
            label={
              d.kind === 'PERCENT'
                ? t('pos.bill.discountPercent', { rate: rate(d.value) })
                : d.kind === 'COUPON'
                  ? t('pos.bill.coupon', { code: d.couponCode ?? '' })
                  : d.kind === 'LOYALTY'
                    ? t('pos.bill.member', { rate: rate(d.value) })
                    : d.kind === 'COMPLIMENTARY'
                      ? t('pos.bill.complimentary')
                      : t('pos.bill.discountFixed')
            }
            detail={d.reason ?? undefined}
            value={`−${plain(d.amount)}`}
            tone="discount"
          />
        ))}
        {bill.charges.map((c, i) => {
          const removable =
            c.chargeRuleId !== null &&
            onRemoveCharge !== undefined &&
            (removableCharges?.has(c.chargeRuleId) ?? false);
          return (
            <div key={`c${i}`} className="contents">
              <dt className="flex min-w-0 items-center gap-1 text-muted-foreground">
                <span>{c.name}</span>
                {removable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-8 px-2 text-xs"
                    onClick={() => onRemoveCharge(c.chargeRuleId!)}
                    aria-label={t('pos.bill.removeCharge', { name: c.name })}
                  >
                    <X aria-hidden="true" className="size-4!" />
                    {t('pos.bill.remove')}
                  </Button>
                )}
              </dt>
              <dd className="text-end tabular-nums">{plain(c.amount)}</dd>
            </div>
          );
        })}
        {bill.taxes.map((tax, i) => (
          <Row
            key={`t${i}`}
            label={t('pos.bill.tax', {
              code: t(`pos.taxCodes.${tax.code}`),
              rate: rate(tax.rateBp),
            })}
            detail={t('pos.bill.taxOn', { amount: plain(tax.taxableValue) })}
            value={plain(tax.taxAmount)}
          />
        ))}
        {bill.roundOff !== 0 && (
          <Row
            label={t('pos.bill.roundOff')}
            value={`${bill.roundOff > 0 ? '+' : '−'}${plain(Math.abs(bill.roundOff))}`}
          />
        )}
        <dt className="mt-1 border-t pt-2 text-base font-bold">{t('pos.bill.total')}</dt>
        <dd className="mt-1 border-t pt-2 text-end text-xl font-bold tabular-nums">
          {money(bill.grandTotal)}
        </dd>
        {invoice !== null && invoice.kind === 'INVOICE' && invoice.paidTotal !== 0 && (
          <>
            <Row label={t('pos.bill.paid')} value={plain(invoice.paidTotal)} />
            <Row
              label={t('pos.bill.balance')}
              value={money(invoice.balance)}
              tone={invoice.balance > 0 ? 'due' : undefined}
            />
          </>
        )}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: 'discount' | 'due' | undefined;
}) {
  return (
    <>
      <dt className="min-w-0 text-muted-foreground">
        {label}
        {detail !== undefined && detail !== '' && (
          <span className="ms-1.5 text-xs">({detail})</span>
        )}
      </dt>
      <dd
        className={cn(
          'text-end tabular-nums',
          tone === 'discount' && 'text-state-available-fg',
          tone === 'due' && 'font-semibold text-state-danger-fg',
        )}
      >
        {value}
      </dd>
    </>
  );
}
