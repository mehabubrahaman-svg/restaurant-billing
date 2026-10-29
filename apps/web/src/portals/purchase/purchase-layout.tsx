import { Banknote, Hourglass, Package, ScrollText, Spinner, Store } from '@restroos/ui';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks } from '../../components/tab-links';

/** /purchase/*: vendors, purchase orders, goods received, vendor payments and dues. */
export function PurchaseLayout() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <TabLinks
        label={t('purchase.sections')}
        tabs={[
          { to: '/purchase/vendors', label: t('purchase.tabs.vendors'), icon: Store },
          { to: '/purchase/orders', label: t('purchase.tabs.orders'), icon: ScrollText },
          { to: '/purchase/grns', label: t('purchase.tabs.grns'), icon: Package },
          { to: '/purchase/payments', label: t('purchase.tabs.payments'), icon: Banknote },
          { to: '/purchase/dues', label: t('purchase.tabs.dues'), icon: Hourglass },
        ]}
      />
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
