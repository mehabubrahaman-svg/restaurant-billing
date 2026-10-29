import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';

/**
 * /accounts/statements/*: the trial balance for anyone with the books, and
 * the profit and loss, balance sheet, cash flow and GST summary for
 * reports.financial.
 */
export function StatementsLayout() {
  const { t } = useTranslation();
  const financial = usePermission('reports.financial');
  const tabs: TabLink[] = [
    { to: '/accounts/statements', end: true, label: t('accounts.statements.tabs.trialBalance') },
    ...(financial
      ? [
          {
            to: '/accounts/statements/profit-and-loss',
            label: t('accounts.statements.tabs.profitAndLoss'),
          },
          {
            to: '/accounts/statements/balance-sheet',
            label: t('accounts.statements.tabs.balanceSheet'),
          },
          { to: '/accounts/statements/cash-flow', label: t('accounts.statements.tabs.cashFlow') },
          { to: '/accounts/statements/gst', label: t('accounts.statements.tabs.gst') },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <TabLinks label={t('accounts.statements.sections')} tabs={tabs} />
      <Outlet />
    </div>
  );
}
