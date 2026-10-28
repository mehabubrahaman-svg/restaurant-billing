import { ChefHat, FileSpreadsheet, Plus, UtensilsCrossed } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks } from '../../components/tab-links';

/** Admin → Menu: items and categories, add-on groups, kitchen stations, CSV import. */
export function MenuLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <TabLinks
        label={t('menu.sections')}
        tabs={[
          { to: '/admin/menu', end: true, label: t('menu.tabs.items'), icon: UtensilsCrossed },
          { to: '/admin/menu/addons', label: t('menu.tabs.addons'), icon: Plus },
          { to: '/admin/menu/stations', label: t('menu.tabs.stations'), icon: ChefHat },
          { to: '/admin/menu/import', label: t('menu.tabs.import'), icon: FileSpreadsheet },
        ]}
      />
      <Outlet />
    </div>
  );
}
