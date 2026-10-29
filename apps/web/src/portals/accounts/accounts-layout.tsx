import { BookOpen, ChartColumn, ListChecks, Receipt, ScrollText, Spinner } from '@restroos/ui';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';
import { BOOKS_PERMISSIONS, TRIAL_BALANCE_PERMISSIONS } from './accounts-ui';

/**
 * /accounts/*: chart of accounts, day book, ledgers, expenses and financial
 * statements. Someone who only records expenses sees the chart and expenses.
 */
export function AccountsLayout() {
  const { t } = useTranslation();
  const books = usePermission(BOOKS_PERMISSIONS);
  const statements = usePermission(TRIAL_BALANCE_PERMISSIONS);
  const tabs: TabLink[] = [
    { to: '/accounts/chart', label: t('accounts.tabs.chart'), icon: ListChecks },
    ...(books
      ? [
          { to: '/accounts/journal', label: t('accounts.tabs.journal'), icon: ScrollText },
          { to: '/accounts/ledgers', label: t('accounts.tabs.ledgers'), icon: BookOpen },
        ]
      : []),
    { to: '/accounts/expenses', label: t('accounts.tabs.expenses'), icon: Receipt },
    ...(statements
      ? [{ to: '/accounts/statements', label: t('accounts.tabs.statements'), icon: ChartColumn }]
      : []),
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <TabLinks label={t('accounts.sections')} tabs={tabs} />
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
