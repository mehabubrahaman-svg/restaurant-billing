import type { StockCountSummary } from '@restroos/contracts';
import { Badge, cn } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useStockFormat } from '../../features/inventory/use-stock-format';

/** Starting a count and entering what was found. */
export const COUNT_PERMISSION = 'inventory.count';

/** Draft (still being counted) or Posted (booked as adjustments). */
export function CountStatus({ count }: { count: Pick<StockCountSummary, 'status'> }) {
  const { t } = useTranslation();
  return (
    <Badge variant={count.status === 'POSTED' ? 'success' : 'warning'}>
      {t(`inventory.counts.statuses.${count.status}`)}
    </Badge>
  );
}

/** A count's value difference: what was found minus what the books said, in money. */
export function CountValue({ paise }: { paise: number }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        paise < 0 && 'font-semibold text-state-danger-fg',
        paise > 0 && 'text-state-available-fg',
      )}
    >
      {paise === 0 ? t('inventory.counts.noDifference') : format.money(paise)}
    </span>
  );
}
