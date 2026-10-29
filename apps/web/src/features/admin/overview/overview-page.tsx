import { Money } from '@restroos/domain';
import {
  Button,
  CalendarDays,
  Card,
  ChevronRight,
  cn,
  Package,
  RefreshCw,
  TriangleAlert,
  Truck,
} from '@restroos/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { api } from '../../../api/endpoints';
import { DashboardBody } from '../../../portals/reports/dashboard-page';
import { useSession } from '../../auth/auth-store';
import { hasPermission, usePermission } from '../../auth/permissions';
import { localDay, useReservations } from '../../floor/reservation-queries';
import { useStockAlerts } from '../../inventory/inventory-queries';
import { useDashboard } from '../../reports/report-queries';
import { useDayFormat } from '../../reports/use-day-format';
import { useFormat } from '../../../i18n/use-format';
import { ADMIN_SECTIONS, AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

/**
 * /admin: the owner's home (wireframes §8). Without dashboard.view (a captain
 * who opens Admin for the guest list) it goes to the first tab they may use.
 */
export function AdminOverviewPage() {
  const session = useSession();
  if (!hasPermission(session, 'dashboard.view')) {
    const first = ADMIN_SECTIONS.find((s) => s.path !== '' && hasPermission(session, s.permission));
    return <Navigate to={first === undefined ? '/' : `/admin/${first.path}`} replace />;
  }
  return <Overview />;
}

function Overview() {
  const { t } = useTranslation();
  const day = useDayFormat();
  const session = useSession();
  const dashboard = useDashboard();
  const sections = ADMIN_SECTIONS.filter(
    (s) => s.path !== '' && hasPermission(session, s.permission),
  );
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('admin.overview.title')}
        description={
          dashboard.data === undefined
            ? t('admin.overview.description')
            : t('reports.dashboard.businessDate', {
                date: day(dashboard.data.businessDate, { dateStyle: 'full' }),
              })
        }
        actions={
          <Button
            variant="outline"
            disabled={dashboard.isFetching}
            onClick={() => void dashboard.refetch()}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(dashboard.isFetching && 'motion-safe:animate-spin')}
            />
            {t('reports.refresh')}
          </Button>
        }
      />
      <Attention />
      <QueryState query={dashboard}>{(data) => <DashboardBody data={data} />}</QueryState>
      {sections.length > 0 && (
        <section aria-labelledby="overview-manage" className="flex flex-col gap-2">
          <h2 id="overview-manage" className="font-semibold">
            {t('admin.overview.manage')}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.path}>
                  <Link
                    to={`/admin/${s.path}`}
                    className="flex min-h-touch items-center gap-2 rounded-xl border bg-surface p-3 font-medium hover:bg-muted"
                  >
                    <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 break-words">{t(s.labelKey)}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** What needs the owner today: stock running out or expiring, and who has booked. */
function Attention() {
  const { t } = useTranslation();
  const format = useFormat();
  const canStock = usePermission('inventory.view');
  const canBookings = usePermission(['tables.view', 'reservations.manage']);
  const canDues = usePermission(['vendors.view', 'reports.financial']);
  const canPurchase = usePermission('vendors.view');
  const alerts = useStockAlerts(canStock);
  const reservations = useReservations(canBookings);
  const dues = useQuery({
    queryKey: ['purchasing', 'dues', 'today'],
    queryFn: () => api.purchasing.dues(),
    enabled: canDues,
  });
  const cards: ReactNode[] = [];

  if (canDues && dues.data !== undefined) {
    const { totals, rows } = dues.data;
    const overdue = totals.d1to30 + totals.d31to60 + totals.d61to90 + totals.over90;
    const late = rows.filter((r) => r.d1to30 + r.d31to60 + r.d61to90 + r.over90 > 0).length;
    cards.push(
      <AttentionCard
        key="dues"
        to={canPurchase ? '/purchase/dues' : null}
        icon={late > 0 ? TriangleAlert : Truck}
        tone={totals.over90 > 0 ? 'danger' : 'calm'}
        title={t('admin.overview.dues')}
        lines={[
          t('admin.overview.duesTotal', { amount: format.money(Money.ofPaise(totals.due)) }),
          late > 0
            ? t('admin.overview.duesOverdue', {
                amount: format.money(Money.ofPaise(overdue)),
                count: late,
              })
            : t('admin.overview.duesNoneOverdue'),
        ]}
        action={t('admin.overview.viewDues')}
      />,
    );
  }

  if (canStock && alerts.data !== undefined) {
    const out = alerts.data.levels.filter((l) => l.level === 'OUT').length;
    const low = alerts.data.levels.filter((l) => l.level === 'LOW').length;
    const expiring = alerts.data.expiring.length;
    const negative = alerts.data.negative.length;
    const worry = out + low + expiring + negative > 0;
    cards.push(
      <AttentionCard
        key="stock"
        to="/inventory/alerts"
        icon={worry ? TriangleAlert : Package}
        tone={worry ? 'danger' : 'calm'}
        title={t('admin.overview.stock')}
        lines={
          worry
            ? [
                t('admin.overview.stockLow', { out, low }),
                t('admin.overview.stockExpiring', { count: expiring }),
                ...(negative > 0 ? [t('admin.overview.stockNegative', { count: negative })] : []),
              ]
            : [t('admin.overview.stockFine')]
        }
        action={t('admin.overview.viewAlerts')}
      />,
    );
  }

  if (canBookings && reservations.data !== undefined) {
    const today = localDay(new Date().toISOString());
    const booked = reservations.data.data.filter(
      (r) => r.status === 'BOOKED' && localDay(r.reservedFor) === today,
    );
    const next = booked[0];
    cards.push(
      <AttentionCard
        key="bookings"
        to="/captain/reservations"
        icon={CalendarDays}
        tone="calm"
        title={t('admin.overview.bookings')}
        lines={[
          t('admin.overview.bookingsToday', {
            count: booked.length,
            guests: booked.reduce((sum, r) => sum + r.partySize, 0),
          }),
          ...(next === undefined
            ? []
            : [
                t('admin.overview.nextBooking', {
                  time: format.dateTime(next.reservedFor, { timeStyle: 'short' }),
                  name: next.guestName,
                }),
              ]),
        ]}
        action={t('admin.overview.viewBookings')}
      />,
    );
  }

  if (cards.length === 0) return null;
  return (
    <section aria-label={t('admin.overview.attention')}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <li key={i}>{card}</li>
        ))}
      </ul>
    </section>
  );
}

function AttentionCard({
  to,
  icon: Icon,
  tone,
  title,
  lines,
  action,
}: {
  /** `null`: no link (the user can't open that screen). */
  to: string | null;
  icon: typeof Package;
  tone: 'danger' | 'calm';
  title: string;
  lines: readonly string[];
  action: string;
}) {
  return (
    <Card
      className={cn(
        'flex h-full flex-col gap-2 p-4',
        tone === 'danger' && 'border-state-danger bg-state-danger-soft',
      )}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-5',
            tone === 'danger' ? 'text-state-danger-fg' : 'text-muted-foreground',
          )}
        />
        {title}
      </h2>
      <ul className="flex flex-1 flex-col gap-0.5 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {to !== null && (
        <Link
          to={to}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {action}
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      )}
    </Card>
  );
}
