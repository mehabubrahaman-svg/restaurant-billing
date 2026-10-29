import {
  CalendarDays,
  ChartColumn,
  Clock,
  Coins,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Spinner,
} from '@restroos/ui';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';
import { CONSUMPTION_PERMISSION } from '../inventory/inventory-layout';

/** /reports/*: the dashboard, day-end, sales, GST returns, scheduled reports, consumption and stock value. */
export function ReportsLayout() {
  const { t } = useTranslation();
  // The accountant reads consumption here: the store room itself needs inventory.view.
  const canConsumption = usePermission(CONSUMPTION_PERMISSION);
  const canGst = usePermission('reports.financial');
  const canSchedule = usePermission('reports.export');
  const tabs: TabLink[] = [
    { to: '/reports', end: true, label: t('reports.tabs.dashboard'), icon: LayoutDashboard },
    { to: '/reports/day-end', label: t('reports.tabs.dayEnd'), icon: CalendarDays },
    { to: '/reports/sales', label: t('reports.tabs.sales'), icon: ReceiptText },
    ...(canGst ? [{ to: '/reports/gst', label: t('reports.tabs.gst'), icon: Landmark }] : []),
    ...(canSchedule
      ? [{ to: '/reports/scheduled', label: t('reports.tabs.scheduled'), icon: Clock }]
      : []),
    ...(canConsumption
      ? [
          { to: '/reports/consumption', label: t('inventory.tabs.consumption'), icon: ChartColumn },
          { to: '/reports/valuation', label: t('inventory.tabs.valuation'), icon: Coins },
        ]
      : []),
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <TabLinks label={t('reports.sections')} tabs={tabs} />
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
