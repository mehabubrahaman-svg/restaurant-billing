import { Money } from '@restroos/domain';
import { Badge, Button, CreditCard, HandCoins, ReceiptText, Wallet } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { TabLinks, type TabLink } from '../../components/tab-links';
import { usePermission } from '../../features/auth/permissions';
import { useCurrentShift } from '../../features/billing/billing-queries';
import { requestOpenShift } from '../../features/billing/shift-prompt';
import { useFormat } from '../../i18n/use-format';
import { ShiftPromptDialog } from './open-shift-dialog';

/** The billing portal: counter, today's bills and the cash shift (wireframes §7). */
export function PosLayout() {
  const { t } = useTranslation();
  const canShift = usePermission('cash.shift_manage');
  const tabs: TabLink[] = [
    { to: '/pos', end: true, label: t('pos.tabs.counter'), icon: CreditCard },
    { to: '/pos/bills', label: t('pos.tabs.bills'), icon: ReceiptText },
    ...(canShift ? [{ to: '/pos/shift', label: t('pos.tabs.shift'), icon: Wallet }] : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2 print:hidden">
        <h1 className="sr-only">{t('portals.pos.title')}</h1>
        <div className="min-w-0 flex-1">
          <TabLinks label={t('pos.sections')} tabs={tabs} />
        </div>
        <ShiftStatus />
      </header>
      <Outlet />
      <ShiftPromptDialog />
    </div>
  );
}

/** "Shift open · Ravi · since 10:02", or a prompt to open one. */
function ShiftStatus() {
  const { t } = useTranslation();
  const format = useFormat();
  const shift = useCurrentShift();
  const canShift = usePermission('cash.shift_manage');
  if (shift.isPending || shift.isError) return null;
  if (shift.data === null) {
    return (
      <div className="flex items-center gap-2" role="status">
        <Badge variant="warning">{t('pos.shift.none')}</Badge>
        {canShift && (
          <Button size="sm" variant="outline" onClick={() => void requestOpenShift()}>
            <HandCoins aria-hidden="true" />
            {t('pos.shift.open')}
          </Button>
        )}
      </div>
    );
  }
  const label = t('pos.shift.status', {
    name: shift.data.openedByName ?? '',
    time: format.dateTime(shift.data.openedAt, { timeStyle: 'short' }),
    float: format.money(Money.ofPaise(shift.data.openingFloat)),
  });
  return canShift ? (
    <Link
      to="/pos/shift"
      className="rounded-full focus-visible:outline-2"
      aria-label={t('pos.shift.statusLink', { status: label })}
    >
      <Badge variant="success">{label}</Badge>
    </Link>
  ) : (
    <Badge variant="success">{label}</Badge>
  );
}
