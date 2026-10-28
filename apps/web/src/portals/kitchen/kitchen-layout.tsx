import { ChefHat, PackageX } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import type { Portal } from '../../app/portals';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';
import { PortalPlaceholder } from '../portal-placeholder';

export const AVAILABILITY_PERMISSIONS = ['menu.toggle_availability', 'menu.manage'] as const;

/** Kitchen portal: the KDS (Sprint 4) and the "Out of stock" list. */
export function KitchenLayout() {
  const { t } = useTranslation();
  const canKds = usePermission('kds.view');
  const canToggle = usePermission(AVAILABILITY_PERMISSIONS);
  const tabs: TabLink[] = [
    ...(canKds
      ? [{ to: '/kitchen', end: true, label: t('kitchen.tabs.orders'), icon: ChefHat }]
      : []),
    ...(canToggle
      ? [{ to: '/kitchen/availability', label: t('kitchen.tabs.availability'), icon: PackageX }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 1 && <TabLinks label={t('kitchen.sections')} tabs={tabs} />}
      <Outlet />
    </div>
  );
}

/** /kitchen: the KDS placeholder, or straight to the out-of-stock list for those without KDS. */
export function KitchenHome({ portal }: { portal: Portal }) {
  const canKds = usePermission('kds.view');
  if (!canKds) return <Navigate to="/kitchen/availability" replace />;
  return <PortalPlaceholder portal={portal} />;
}
