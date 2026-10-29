import {
  CalendarDays,
  ChartColumn,
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

/** /reports/*: the owner's dashboard, the day-end report and stock consumption. */
export function ReportsLayout() {
  const { t } = useTranslation();
  // The accountant reads consumption here: the store room itself needs inventory.view.
  const canConsumption = usePermission(CONSUMPTION_PERMISSION);
  const canGst = usePermission('reports.financial');
  const tabs: TabLink[] = [
    { to: '/reports', end: true, label: t('reports.tabs.dashboard'), icon: LayoutDashboard },
    { to: '/reports/day-end', label: t('reports.tabs.dayEnd'), icon: CalendarDays },
    { to: '/reports/sales', label: t('reports.tabs.sales'), icon: ReceiptText },
    ...(canGst ? [{ to: '/reports/gst', label: t('reports.tabs.gst'), icon: Landmark }] : []),
    ...(canConsumption
      ? [{ to: '/reports/consumption', label: t('inventory.tabs.consumption'), icon: ChartColumn }]
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
