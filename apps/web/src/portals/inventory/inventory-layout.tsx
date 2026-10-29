import {
  ArrowRightLeft,
  Badge,
  BellRing,
  ChartColumn,
  Coins,
  ListChecks,
  Package,
  Spinner,
} from '@restroos/ui';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';
import { alertCount, useStockAlerts } from '../../features/inventory/inventory-queries';
import { useFormat } from '../../i18n/use-format';

/** Stock entries (receipts, opening, wastage, adjustments) and posting a count. */
export const ADJUST_PERMISSION = 'inventory.adjust';
/** Adding and changing items, recipes and add-on ingredients. */
export const MANAGE_PERMISSION = 'inventory.manage_items';
export const CONSUMPTION_PERMISSION = 'reports.inventory';

/** /inventory/*: items and levels, stock in and out, counts, alerts, consumption and stock value. */
export function InventoryLayout() {
  const { t } = useTranslation();
  const format = useFormat();
  const canAdjust = usePermission(ADJUST_PERMISSION);
  const canReport = usePermission(CONSUMPTION_PERMISSION);
  const alerts = useStockAlerts();
  const pending = alerts.data === undefined ? 0 : alertCount(alerts.data);

  const tabs: TabLink[] = [
    { to: '/inventory', end: true, label: t('inventory.tabs.items'), icon: Package },
    ...(canAdjust
      ? [{ to: '/inventory/stock', label: t('inventory.tabs.stock'), icon: ArrowRightLeft }]
      : []),
    { to: '/inventory/counts', label: t('inventory.tabs.counts'), icon: ListChecks },
    {
      to: '/inventory/alerts',
      label: t('inventory.tabs.alerts'),
      icon: BellRing,
      ...(pending > 0 && {
        badge: (
          <Badge variant="danger" className="tabular-nums">
            <span aria-hidden="true">{format.number(pending)}</span>
            <span className="sr-only">{t('inventory.alerts.badge', { count: pending })}</span>
          </Badge>
        ),
      }),
    },
    ...(canReport
      ? [
          {
            to: '/inventory/consumption',
            label: t('inventory.tabs.consumption'),
            icon: ChartColumn,
          },
          { to: '/inventory/valuation', label: t('inventory.tabs.valuation'), icon: Coins },
        ]
      : []),
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <TabLinks label={t('inventory.sections')} tabs={tabs} />
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
