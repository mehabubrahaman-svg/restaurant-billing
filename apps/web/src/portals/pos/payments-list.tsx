import type { Payment } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { cn } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';

/** Payments on an invoice: method, slip details, amount. Refunds are negative. */
export function PaymentsList({
  payments,
  level = 4,
}: {
  payments: readonly Payment[];
  /** Heading level under the surrounding section. */
  level?: 3 | 4;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <section className="flex flex-col gap-1">
      {level === 3 ? (
        <h3 className="text-sm font-semibold">{t('pos.payments.title')}</h3>
      ) : (
        <h4 className="text-sm font-semibold">{t('pos.payments.title')}</h4>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {payments.map((p) => {
          const details = [
            p.terminalLabel,
            p.reference === null ? null : t('pos.payments.ref', { ref: p.reference }),
            p.cardLast4 === null ? null : t('pos.payments.last4', { last4: p.cardLast4 }),
            p.changeDue !== null && p.changeDue > 0
              ? t('pos.payments.change', { amount: format.money(Money.ofPaise(p.changeDue)) })
              : null,
          ].filter((x): x is string => x !== null && x !== '');
          return (
            <li key={p.id} className="flex items-baseline gap-2" data-method={p.method}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {p.amount < 0
                    ? t('pos.payments.refund', { method: t(`pos.tenders.${p.method}`) })
                    : t(`pos.tenders.${p.method}`)}
                </span>
                {details.length > 0 && (
                  <span className="ms-2 text-muted-foreground">{details.join(' · ')}</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {format.dateTime(p.createdAt, { timeStyle: 'short' })}
                  {p.createdByName !== null && ` · ${p.createdByName}`}
                </span>
              </span>
              <span className={cn('tabular-nums', p.amount < 0 && 'text-state-danger-fg')}>
                {format.money(Money.ofPaise(p.amount))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
