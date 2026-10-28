import type { Dashboard } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Button,
  Card,
  ChefHat,
  cn,
  RefreshCw,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TriangleAlert,
  UtensilsCrossed,
} from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { QueryState } from '../../features/admin/query-state';
import { useDashboard } from '../../features/reports/report-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { tDynamic } from '../../lib/dynamic-t';
import { BarChart } from './bar-chart';

const SECTION = 'flex min-w-0 flex-col gap-3 p-4';

/** /reports: the owner's dashboard (wireframes §8). Money is integer paise throughout. */
export function DashboardPage() {
  const { t } = useTranslation();
  const day = useDayFormat();
  const dashboard = useDashboard();
  return (
    <div className="flex flex-col gap-4">
      <title>{`${t('reports.dashboard.title')} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{t('reports.dashboard.title')}</h1>
          {dashboard.data !== undefined && (
            <p className="text-muted-foreground">
              {t('reports.dashboard.businessDate', {
                date: day(dashboard.data.businessDate, { dateStyle: 'full' }),
              })}
            </p>
          )}
        </div>
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
      </header>
      <QueryState query={dashboard}>{(data) => <DashboardBody data={data} />}</QueryState>
    </div>
  );
}

export function DashboardBody({ data }: { data: Dashboard }) {
  const { t } = useTranslation();
  const format = useFormat();
  const day = useDayFormat();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const periods = [
    { key: 'today', title: t('reports.dashboard.today'), period: data.today },
    { key: 'month', title: t('reports.dashboard.month'), period: data.month },
    { key: 'year', title: t('reports.dashboard.year'), period: data.financialYear },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 sm:grid-cols-3">
        {periods.map(({ key, title, period }) => (
          <li key={key}>
            <Card className={cn(SECTION, 'h-full gap-2')} data-period={key}>
              <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
              <p className="text-[clamp(1.125rem,2.3vw,1.5rem)] leading-tight font-bold break-words tabular-nums">
                {money(period.sales)}
              </p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-muted-foreground">{t('reports.dashboard.invoices')}</dt>
                <dd className="text-end tabular-nums">{format.number(period.invoices)}</dd>
                <dt className="text-muted-foreground">{t('reports.dashboard.covers')}</dt>
                <dd className="text-end tabular-nums">{format.number(period.covers)}</dd>
                <dt className="text-muted-foreground">{t('reports.dashboard.averageBill')}</dt>
                <dd className="text-end tabular-nums">{money(period.averageBill)}</dd>
              </dl>
              {key !== 'today' && (
                <p className="text-xs text-muted-foreground">
                  {t('reports.dashboard.range', {
                    from: day(period.from, { day: 'numeric', month: 'short' }),
                    to: day(period.to, { day: 'numeric', month: 'short', year: 'numeric' }),
                  })}
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className={SECTION}>
          <BarChart
            title={t('reports.dashboard.daily')}
            bars={data.daily.map((d) => ({
              key: d.date,
              value: d.sales,
              label: day(d.date, { day: 'numeric' }),
              highlight: d.date === data.businessDate,
              description: t('reports.dashboard.dayBar', {
                date: day(d.date, { weekday: 'short', day: 'numeric', month: 'short' }),
                amount: money(d.sales),
                count: d.invoices,
              }),
            }))}
          />
        </Card>
        <Card className={SECTION}>
          <PaymentMix mix={data.paymentMix} />
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="dash-top-items" className="flex min-w-0 flex-col gap-2">
          <h2 id="dash-top-items" className="font-semibold">
            {t('reports.dashboard.topItems')}
          </h2>
          <TopItems items={data.topItems} />
        </section>
        <div className="flex min-w-0 flex-col gap-3">
          <Card className={SECTION}>
            <h2 className="flex items-center gap-2 font-semibold">
              <ChefHat aria-hidden="true" className="size-5 text-muted-foreground" />
              {t('reports.dashboard.kitchen')}
            </h2>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t('reports.dashboard.pending')}</dt>
              <dd className="text-end font-semibold tabular-nums">
                {format.number(data.kitchen.pending)}
              </dd>
              <dt
                className={cn(
                  'flex items-center gap-1',
                  data.kitchen.delayed > 0 ? 'text-state-danger-fg' : 'text-muted-foreground',
                )}
              >
                {data.kitchen.delayed > 0 && (
                  <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                )}
                {t('reports.dashboard.delayed')}
              </dt>
              <dd
                className={cn(
                  'text-end font-semibold tabular-nums',
                  data.kitchen.delayed > 0 && 'text-state-danger-fg',
                )}
              >
                {format.number(data.kitchen.delayed)}
              </dd>
              <dt className="text-muted-foreground">{t('reports.dashboard.avgCook')}</dt>
              <dd className="text-end font-semibold tabular-nums">
                <CookTime seconds={data.kitchen.avgCookSeconds} />
              </dd>
            </dl>
          </Card>
          <Card className={SECTION}>
            <h2 className="flex items-center gap-2 font-semibold">
              <UtensilsCrossed aria-hidden="true" className="size-5 text-muted-foreground" />
              {t('reports.dashboard.now')}
            </h2>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t('reports.dashboard.openOrders')}</dt>
              <dd className="text-end font-semibold tabular-nums">
                {format.number(data.openOrders)}
              </dd>
              <dt className="text-muted-foreground">{t('reports.dashboard.openTables')}</dt>
              <dd className="text-end font-semibold tabular-nums">
                {format.number(data.openTables)}
              </dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** "11 min", or "—" when nothing has been cooked yet. */
export function CookTime({ seconds }: { seconds: number | null }) {
  const { t } = useTranslation();
  if (seconds === null) return <>{t('reports.none')}</>;
  return <>{t('time.minutes', { minutes: Math.max(1, Math.round(seconds / 60)) })}</>;
}

/** Bar colour per payment method; the legend always carries the name and amount too. */
const METHOD_COLOURS: Readonly<Record<string, string>> = {
  CASH: 'bg-state-available',
  UPI: 'bg-primary',
  CARD: 'bg-state-billing',
  WALLET: 'bg-state-reserved',
  CREDIT: 'bg-state-cleaning',
  AGGREGATOR: 'bg-state-occupied',
};

export function useMethodLabel() {
  const { t } = useTranslation();
  return (method: string) => tDynamic(t, `pos.tenders.${method}`, method);
}

function PaymentMix({ mix }: { mix: Dashboard['paymentMix'] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const methodLabel = useMethodLabel();
  const rows = mix.filter((m) => m.amount > 0);
  const total = rows.reduce((sum, m) => sum + m.amount, 0);
  return (
    <>
      <h2 className="font-semibold">{t('reports.dashboard.paymentMix')}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('reports.dashboard.noPayments')}</p>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
            {rows.map((m) => (
              <span
                key={m.method}
                className={METHOD_COLOURS[m.method] ?? 'bg-muted-foreground'}
                style={{ width: `${(m.amount / total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="flex flex-col gap-1.5">
            {rows.map((m) => (
              <li key={m.method} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-3 shrink-0 rounded-sm',
                    METHOD_COLOURS[m.method] ?? 'bg-muted-foreground',
                  )}
                />
                <span className="min-w-0 flex-1 break-words">{methodLabel(m.method)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {format.number(m.amount / total, {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  })}
                </span>
                <span className="font-medium tabular-nums">
                  {format.money(Money.ofPaise(m.amount))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function TopItems({ items }: { items: Dashboard['topItems'] }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (items.length === 0) {
    return <p className="text-muted-foreground">{t('reports.dashboard.noItems')}</p>;
  }
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{t('reports.item')}</Th>
          <Th className="text-end">{t('reports.quantity')}</Th>
          <Th className="text-end">{t('reports.amount')}</Th>
        </Tr>
      </THead>
      <TBody>
        {items.map((item) => (
          <Tr key={item.name}>
            <Td className="break-words">{item.name}</Td>
            <Td className="text-end tabular-nums">{format.number(item.quantity)}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {format.money(Money.ofPaise(item.amount))}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
