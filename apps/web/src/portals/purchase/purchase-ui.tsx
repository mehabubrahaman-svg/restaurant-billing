import type { PurchaseOrderStatus, VendorPaymentMethod } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Badge, type BadgeProps } from '@restroos/ui';
import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrnStatus } from '../../api/endpoints';
import { useFormat } from '../../i18n/use-format';
import { tDynamic } from '../../lib/dynamic-t';

export const PO_STATUSES: readonly PurchaseOrderStatus[] = [
  'DRAFT',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
];
export const GRN_STATUSES: readonly GrnStatus[] = ['DRAFT', 'POSTED', 'CANCELLED'];
export const PAYMENT_METHODS: readonly VendorPaymentMethod[] = ['CASH', 'BANK', 'UPI', 'CHEQUE'];

const PO_VARIANT: Record<PurchaseOrderStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'neutral',
  APPROVED: 'info',
  SENT: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CLOSED: 'outline',
  CANCELLED: 'danger',
};
const GRN_VARIANT: Record<GrnStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'neutral',
  POSTED: 'success',
  CANCELLED: 'danger',
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useTranslation();
  return <Badge variant={PO_VARIANT[status]}>{t(`purchase.poStatus.${status}`)}</Badge>;
}

export function GrnStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const known = (GRN_STATUSES as readonly string[]).includes(status);
  return (
    <Badge variant={known ? GRN_VARIANT[status as GrnStatus] : 'neutral'}>
      {known ? t(`purchase.grnStatus.${status as GrnStatus}`) : status}
    </Badge>
  );
}

/** Paise → "₹1,890.00" in the user's language and digits. */
export function useMoney(): (paise: number) => string {
  const format = useFormat();
  return useCallback((paise: number) => format.money(Money.ofPaise(paise)), [format]);
}

/** "kg" → "kg" / "किलो" / "কেজি"; a unit the catalogue doesn't know shows its code. */
export function useUnitLabel(): (code: string) => string {
  const { t } = useTranslation();
  return useCallback((code: string) => tDynamic(t, `purchase.unitCodes.${code}`, code), [t]);
}

/** Milli-units of a unit → "2.5 kg", in the user's digits. */
export function useQuantity(): (milli: number, unitCode: string) => string {
  const { t } = useTranslation();
  const format = useFormat();
  const unit = useUnitLabel();
  return useCallback(
    (milli: number, unitCode: string) =>
      t('purchase.quantity', {
        qty: format.number(milli / 1000, { maximumFractionDigits: 3 }),
        unit: unit(unitCode),
      }),
    [t, format, unit],
  );
}

/** 500 → "5%". */
export function useTaxRate(): (bp: number) => string {
  const { t } = useTranslation();
  const format = useFormat();
  return useCallback(
    (bp: number) =>
      t('purchase.ratePercent', { rate: format.number(bp / 100, { maximumFractionDigits: 2 }) }),
    [t, format],
  );
}

/** "15 days" / "On delivery". */
export function useTerms(): (days: number) => string {
  const { t } = useTranslation();
  return useCallback(
    (days: number) =>
      days === 0 ? t('purchase.vendors.onDelivery') : t('purchase.vendors.termsDays', { days }),
    [t],
  );
}

/** A label → value list, for the facts at the top of a document. */
export function Facts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Subtotal, GST and total under a document's lines; `extra` rows (paid, balance) follow. */
export function TotalsBox({
  subtotal,
  tax,
  total,
  extra = [],
  live = false,
}: {
  subtotal: number;
  tax: number;
  total: number;
  extra?: readonly (readonly [string, number])[];
  /** Recomputed as the lines are typed: announced politely. */
  live?: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <dl
      className="ms-auto grid w-full max-w-sm grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-xl border bg-surface p-4 text-sm"
      {...(live ? { 'aria-live': 'polite' as const } : {})}
    >
      <dt className="text-muted-foreground">{t('purchase.totals.subtotal')}</dt>
      <dd className="text-end tabular-nums">{money(subtotal)}</dd>
      <dt className="text-muted-foreground">{t('purchase.totals.tax')}</dt>
      <dd className="text-end tabular-nums">{money(tax)}</dd>
      <dt className="font-semibold">{t('purchase.totals.total')}</dt>
      <dd className="text-end font-semibold tabular-nums">{money(total)}</dd>
      {extra.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-end tabular-nums">{money(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
