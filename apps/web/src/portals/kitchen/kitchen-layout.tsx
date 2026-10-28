import { ChefHat, cn, PackageX } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet } from 'react-router';
import type { Portal } from '../../app/portals';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';
import { useDeviceStore } from '../../stores/device-store';
import { KdsBoard } from './kds-board';

export const AVAILABILITY_PERMISSIONS = ['menu.toggle_availability', 'menu.manage'] as const;

/** Kitchen portal: the KDS board and the "Out of stock" list. */
export function KitchenLayout() {
  const { t } = useTranslation();
  const canKds = usePermission('kds.view');
  const canToggle = usePermission(AVAILABILITY_PERMISSIONS);
  const fullScreen = useDeviceStore((s) => s.kind === 'KDS');
  const tabs: TabLink[] = [
    ...(canKds
      ? [{ to: '/kitchen', end: true, label: t('kitchen.tabs.orders'), icon: ChefHat }]
      : []),
    ...(canToggle
      ? [{ to: '/kitchen/availability', label: t('kitchen.tabs.availability'), icon: PackageX }]
      : []),
  ];
  return (
    // On a KDS the board fills the screen below the tabs; its columns scroll on their own.
    <div className={cn('flex flex-col gap-3', fullScreen && 'lg:h-[calc(100dvh-2rem)]')}>
      {tabs.length > 1 && <TabLinks label={t('kitchen.sections')} tabs={tabs} />}
      <Outlet />
    </div>
  );
}

/** /kitchen: the KDS board, or straight to the out-of-stock list for those without KDS. */
export function KitchenHome({ portal }: { portal: Portal }) {
  const canKds = usePermission('kds.view');
  if (!canKds) return <Navigate to="/kitchen/availability" replace />;
  return <KdsBoard portal={portal} />;
}
