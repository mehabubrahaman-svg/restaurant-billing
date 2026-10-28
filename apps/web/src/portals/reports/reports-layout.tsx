import { CalendarDays, LayoutDashboard, Spinner } from '@restroos/ui';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks } from '../../components/tab-links';

/** /reports/*: the owner's dashboard and the day-end report. */
export function ReportsLayout() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <TabLinks
        label={t('reports.sections')}
        tabs={[
          { to: '/reports', end: true, label: t('reports.tabs.dashboard'), icon: LayoutDashboard },
          { to: '/reports/day-end', label: t('reports.tabs.dayEnd'), icon: CalendarDays },
        ]}
      />
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
