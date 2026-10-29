import type { ReportGrouping, SalesReport } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Button,
  Card,
  Download,
  Field,
  FileSpreadsheet,
  Input,
  Printer,
  SegmentedControl,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useDownload, useSalesReport } from '../../features/reports/report-queries';
import {
  daysBetween,
  isCalendarDay,
  monthStart,
  useDayFormat,
} from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { tDynamic } from '../../lib/dynamic-t';
import { localIsoDate } from '../pos/bills-page';
import { BarChart } from './bar-chart';
import { useMethodLabel } from './dashboard-page';

/** The Hub reads at most five years at once. */
export const MAX_REPORT_DAYS = 1830;
const GROUPINGS: readonly ReportGrouping[] = ['day', 'week', 'month', 'year'];
type Preset = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';
const PRESETS: readonly Preset[] = [
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'lastYear',
];

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A preset's range and the grouping that reads best for it. */
export function presetRange(
  preset: Preset,
  today: string,
): { from: string; to: string; groupBy: ReportGrouping } {
  const monday = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const [y, m] = today.split('-').map(Number) as [number, number];
  const fyStart = m >= 4 ? y : y - 1;
  switch (preset) {
    case 'thisWeek':
      return { from: monday, to: today, groupBy: 'day' };
    case 'lastWeek':
      return { from: shift(monday, -7), to: shift(monday, -1), groupBy: 'day' };
    case 'thisMonth':
      return { from: monthStart(today), to: today, groupBy: 'day' };
    case 'lastMonth': {
      const end = shift(monthStart(today), -1);
      return { from: monthStart(end), to: end, groupBy: 'day' };
    }
    case 'thisYear':
      return { from: `${fyStart}-04-01`, to: today, groupBy: 'month' };
    case 'lastYear':
      return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31`, groupBy: 'month' };
  }
}

function rangeOk(from: string, to: string): boolean {
  if (!isCalendarDay(from) || !isCalendarDay(to)) return false;
  const days = daysBetween(from, to);
  return days >= 0 && days < MAX_REPORT_DAYS;
}

/** /reports/sales: the report engine. ?from=&to=&groupBy= so a report can be bookmarked. */
export function SalesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const today = localIsoDate();
  const fallback = presetRange('thisMonth', today);
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  const groupParam = params.get('groupBy');
  const groupBy = GROUPINGS.find((g) => g === groupParam) ?? fallback.groupBy;
  const valid = rangeOk(from, to);
  const query = { from, to, groupBy };
  const report = useSalesReport(query, valid);
  const canExport = usePermission('reports.export');
  const update = useCallback(
    (patch: Record<string, string>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [k, v] of Object.entries(patch)) next.set(k, v);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const download = useDownload(
    (format: 'xlsx' | 'csv') => api.reports.salesFile(query, format),
    (format) => `sales-${from}-to-${to}-by-${groupBy}.${format}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <title>{`${t('reports.sales.title')} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{t('reports.sales.title')}</h1>
          <p className="text-muted-foreground">{t('reports.sales.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {canExport && (
            <>
              <Button
                variant="outline"
                disabled={!valid || download.isPending}
                onClick={() => download.mutate('xlsx')}
              >
                <FileSpreadsheet aria-hidden="true" />
                {t('reports.export.excel')}
              </Button>
              <Button
                variant="outline"
                disabled={!valid || download.isPending}
                onClick={() => download.mutate('csv')}
              >
                <Download aria-hidden="true" />
                {t('reports.export.csv')}
              </Button>
            </>
          )}
          <Button variant="outline" disabled={!valid} onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t('reports.export.print')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label={t('reports.sales.preset')} className="w-full sm:w-52">
          {(p) => (
            <Select
              {...p}
              value=""
              onChange={(e) => {
                const preset = PRESETS.find((x) => x === e.target.value);
                if (preset) update(presetRange(preset, today));
              }}
            >
              <option value="">{t('reports.sales.choose')}</option>
              {PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {t(`reports.sales.presets.${preset}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('reports.sales.from')}
          className="w-full sm:w-44"
          error={valid ? undefined : t('reports.sales.invalid', { max: MAX_REPORT_DAYS })}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={from}
              max={to}
              onChange={(e) => update({ from: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('reports.sales.to')} className="w-full sm:w-44">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={to}
              min={from}
              onChange={(e) => update({ to: e.target.value })}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('reports.sales.groupBy')}</span>
          <SegmentedControl<ReportGrouping>
            aria-label={t('reports.sales.groupBy')}
            value={groupBy}
            onValueChange={(g) => update({ groupBy: g })}
            options={GROUPINGS.map((g) => ({ value: g, label: t(`reports.sales.groupings.${g}`) }))}
          />
        </div>
      </div>

      {valid && <QueryState query={report}>{(data) => <SalesBody report={data} />}</QueryState>}
    </div>
  );
}

function SalesBody({ report: r }: { report: SalesReport }) {
  const { t } = useTranslation();
  const format = useFormat();
  const day = useDayFormat();
  const methodLabel = useMethodLabel();
  const [allItems, setAllItems] = useState(false);
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const periodLabel = (key: string, long = false) => {
    switch (r.groupBy) {
      case 'day':
        return day(key, long ? { dateStyle: 'medium' } : { day: 'numeric', month: 'short' });
      case 'week':
        return t('reports.sales.weekOf', { date: day(key, { day: 'numeric', month: 'short' }) });
      case 'month':
        return day(`${key}-01`, { month: long ? 'long' : 'short', year: 'numeric' });
      case 'year':
        return t('reports.sales.financialYear', { year: key });
    }
  };
  const cards: [string, string][] = [
    [t('reports.sales.net'), money(r.totals.net)],
    [t('reports.dashboard.invoices'), format.number(r.totals.invoices)],
    [t('reports.dashboard.averageBill'), money(r.totals.averageBill)],
    [t('reports.dashboard.covers'), format.number(r.totals.covers)],
    [t('reports.sales.discounts'), money(r.totals.discounts)],
    [t('reports.sales.tax'), money(r.totals.tax)],
  ];
  const items = allItems ? r.items : r.items.slice(0, 20);

  return (
    <div className="flex flex-col gap-4">
      <p className="hidden text-sm print:block">
        {t('reports.sales.printed', {
          branch: r.branchName,
          from: day(r.from),
          to: day(r.to),
        })}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, value]) => (
          <li key={label}>
            <Card className="flex h-full flex-col gap-1 p-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-lg font-bold break-words tabular-nums">{value}</span>
            </Card>
          </li>
        ))}
      </ul>

      {r.periods.length > 1 && (
        <Card className="p-4">
          <BarChart
            title={t('reports.sales.chart')}
            bars={r.periods.map((p) => ({
              key: p.key,
              value: Math.max(0, p.net),
              label: periodLabel(p.key),
              description: t('reports.sales.bar', {
                period: periodLabel(p.key, true),
                amount: money(p.net),
                count: p.invoices,
              }),
            }))}
          />
        </Card>
      )}

      <Section title={t('reports.sales.byPeriod')}>
        <Table>
          <THead>
            <Tr>
              <Th>{t(`reports.sales.groupings.${r.groupBy}`)}</Th>
              <Th className="text-end">{t('reports.dashboard.invoices')}</Th>
              <Th className="text-end">{t('reports.dashboard.covers')}</Th>
              <Th className="text-end">{t('reports.sales.gross')}</Th>
              <Th className="text-end">{t('reports.sales.discounts')}</Th>
              <Th className="text-end">{t('reports.sales.tax')}</Th>
              <Th className="text-end">{t('reports.sales.refunds')}</Th>
              <Th className="text-end">{t('reports.sales.net')}</Th>
            </Tr>
          </THead>
          <TBody>
            {[...r.periods, { ...r.totals, key: '', from: r.from, to: r.to }].map((p) => {
              const total = p.key === '';
              return (
                <Tr key={p.key || 'total'} className={total ? 'font-semibold' : undefined}>
                  <Td className="whitespace-nowrap">
                    {total ? t('reports.sales.total') : periodLabel(p.key, true)}
                  </Td>
                  <Td className="text-end tabular-nums">{format.number(p.invoices)}</Td>
                  <Td className="text-end tabular-nums">{format.number(p.covers)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(p.gross)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(p.discounts)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(p.tax)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(p.refunds)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(p.net)}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown
          title={t('reports.sales.orderTypes')}
          head={[t('reports.sales.orderType'), t('reports.sales.orders'), t('reports.amount')]}
          rows={r.orderTypes.map((o) => [
            tDynamic(t, `orderTypes.${o.orderType}`, o.orderType),
            format.number(o.orders),
            money(o.sales),
          ])}
        />
        <Breakdown
          title={t('reports.dashboard.paymentMix')}
          head={[t('reports.sales.method'), t('reports.sales.payments'), t('reports.amount')]}
          rows={r.payments.map((p) => [
            methodLabel(p.method),
            format.number(p.count),
            money(p.amount),
          ])}
        />
        <Breakdown
          title={t('reports.sales.channels')}
          head={[
            t('reports.sales.channel'),
            t('reports.sales.orders'),
            t('reports.amount'),
            t('reports.sales.commission'),
            t('reports.sales.netRevenue'),
          ]}
          rows={r.channels.map((c) => [
            c.name,
            format.number(c.orders),
            money(c.sales),
            money(c.commission),
            money(c.netRevenue),
          ])}
        />
        <Breakdown
          title={t('reports.sales.categories')}
          head={[t('reports.sales.category'), t('reports.quantity'), t('reports.amount')]}
          rows={r.categories.map((c) => [c.name, format.number(c.quantity), money(c.amount)])}
        />
      </div>

      <Section title={t('reports.sales.items')}>
        <Breakdown
          head={[
            t('reports.item'),
            t('reports.sales.category'),
            t('reports.quantity'),
            t('reports.amount'),
          ]}
          rows={items.map((i) => [
            i.name,
            i.category ?? t('reports.none'),
            format.number(i.quantity),
            money(i.amount),
          ])}
        />
        {r.items.length > 20 && (
          <Button
            variant="ghost"
            className="self-start print:hidden"
            onClick={() => setAllItems((v) => !v)}
          >
            {allItems
              ? t('reports.sales.fewerItems')
              : t('reports.sales.allItems', { count: r.items.length })}
          </Button>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <BarChart
            title={t('reports.sales.hours')}
            bars={Array.from({ length: 24 }, (_, hour) => {
              const h = r.hourly.find((x) => x.hour === hour);
              return {
                key: String(hour),
                value: h?.total ?? 0,
                label: hour % 3 === 0 ? String(hour) : '',
                description: t('reports.sales.hourBar', {
                  hour: String(hour).padStart(2, '0'),
                  amount: money(h?.total ?? 0),
                  count: h?.invoices ?? 0,
                }),
              };
            })}
          />
        </Card>
        <Breakdown
          title={t('reports.sales.weekdays')}
          head={[t('reports.sales.weekday'), t('reports.dashboard.invoices'), t('reports.amount')]}
          rows={r.weekdays.map((d) => [
            // 2023-01-01 was a Sunday: weekday 0.
            day(`2023-01-0${d.weekday + 1}`, { weekday: 'long' }),
            format.number(d.invoices),
            money(d.total),
          ])}
        />
        <Breakdown
          title={t('reports.sales.staff')}
          head={[
            t('reports.sales.name'),
            t('reports.sales.ordersTaken'),
            t('reports.sales.ordersSales'),
            t('reports.sales.billsMade'),
            t('reports.sales.billed'),
          ]}
          rows={r.staff.map((s) => [
            s.name,
            format.number(s.orders),
            money(s.orderSales),
            format.number(s.bills),
            money(s.billed),
          ])}
        />
        <Breakdown
          title={t('reports.sales.taxes')}
          head={[
            t('reports.sales.taxCode'),
            t('reports.sales.rate'),
            t('reports.sales.taxable'),
            t('reports.sales.tax'),
          ]}
          rows={r.taxes.map((x) => [
            x.code,
            format.number(x.rateBp / 10_000, { style: 'percent', maximumFractionDigits: 2 }),
            money(x.taxable),
            money(x.tax),
          ])}
        />
        <Breakdown
          title={t('reports.sales.discountKinds')}
          head={[t('reports.sales.kind'), t('reports.sales.count'), t('reports.amount')]}
          rows={r.discounts.map((d) => [
            tDynamic(t, `reports.sales.discountKind.${d.kind}`, d.kind),
            format.number(d.count),
            money(d.amount),
          ])}
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 break-inside-avoid">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A small table: the first column is text, the rest are numbers. Empty: a dash. */
function Breakdown({
  title,
  head,
  rows,
}: {
  title?: string;
  head: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  const { t } = useTranslation();
  const table =
    rows.length === 0 ? (
      <p className="text-muted-foreground">{t('reports.sales.nothing')}</p>
    ) : (
      <Table>
        <THead>
          <Tr>
            {head.map((h, i) => (
              <Th key={h} className={i === 0 ? undefined : 'text-end'}>
                {h}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((row, r) => (
            <Tr key={`${row[0]}-${r}`}>
              {row.map((cell, i) => (
                <Td
                  key={i}
                  className={i === 0 ? 'break-words' : 'text-end whitespace-nowrap tabular-nums'}
                >
                  {cell}
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  return title === undefined ? table : <Section title={title}>{table}</Section>;
}
