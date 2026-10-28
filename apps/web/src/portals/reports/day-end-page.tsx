import type { DayEndReport } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Button,
  Card,
  Download,
  Field,
  FileSpreadsheet,
  Input,
  Printer,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useDayEndReport, useDownload } from '../../features/reports/report-queries';
import { daysBetween, monthStart, useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { tDynamic } from '../../lib/dynamic-t';
import { useErrorMessage } from '../../lib/errors';
import { localIsoDate } from '../pos/bills-page';
import { useRate } from '../pos/bill-breakdown';
import { Variance } from '../pos/shift-report';
import { BarChart } from './bar-chart';
import { CookTime, TopItems, useMethodLabel } from './dashboard-page';

/** The longest sales register the Hub exports at once. */
export const MAX_REGISTER_DAYS = 366;

/** /reports/day-end?date=: the day-end report for one business day, printable and exportable. */
export function DayEndPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const asked = params.get('date');
  const report = useDayEndReport(asked);
  const date = asked ?? report.data?.businessDate ?? '';
  const canExport = usePermission('reports.export');

  return (
    <div className="flex flex-col gap-4">
      <title>{`${t('reports.dayEnd.title')} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{t('reports.dayEnd.title')}</h1>
          {report.data !== undefined && <Subtitle report={report.data} />}
        </div>
        <div className="w-full sm:w-52 print:hidden">
          <Field label={t('reports.dayEnd.date')}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={date}
                max={localIsoDate()}
                onChange={(e) => {
                  if (e.target.value !== '') setParams({ date: e.target.value }, { replace: true });
                }}
              />
            )}
          </Field>
        </div>
      </header>
      {date !== '' && <DayEndActions date={date} canExport={canExport} />}
      <QueryState query={report}>{(data) => <DayEndBody report={data} />}</QueryState>
      {canExport && <SalesRegister date={date === '' ? localIsoDate() : date} />}
    </div>
  );
}

function Subtitle({ report }: { report: DayEndReport }) {
  const { t } = useTranslation();
  const format = useFormat();
  const day = useDayFormat();
  return (
    <p className="text-muted-foreground">
      {t('reports.dayEnd.subtitle', {
        branch: report.branchName,
        date: day(report.businessDate, { dateStyle: 'full' }),
        time: format.dateTime(report.generatedAt, { timeStyle: 'short' }),
      })}
    </p>
  );
}

function DayEndActions({ date, canExport }: { date: string; canExport: boolean }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [problem, setProblem] = useState<string | null>(null);
  const print = useMutation({
    mutationFn: () => api.reports.printDayEnd(date),
    onSuccess: (outcome) => {
      setProblem(null);
      toast(t('pos.print.sent', { printer: outcome.printerName }));
    },
    onError: (error) => setProblem(errorMessage(error)),
  });
  const csv = useDownload(
    (day: string) => api.reports.dayEndCsv(day),
    (day) => `day-end-${day}.csv`,
  );
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={print.isPending} onClick={() => print.mutate()}>
          <Printer aria-hidden="true" />
          {print.isPending ? t('pos.print.printing') : t('pos.print.onPrinter')}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t('pos.print.browser')}
        </Button>
        {canExport && (
          <Button variant="outline" disabled={csv.isPending} onClick={() => csv.mutate(date)}>
            <Download aria-hidden="true" />
            {t('reports.dayEnd.csv')}
          </Button>
        )}
      </div>
      {problem !== null && (
        <Alert tone="warning" role="alert">
          {problem} {t('pos.print.fallback')}
        </Alert>
      )}
    </div>
  );
}

/** The business day starts in the early morning: 4 am sorts first, 3 am last. */
const DAY_STARTS_AT_HOUR = 4;
const slotOf = (hour: number) => (hour - DAY_STARTS_AT_HOUR + 24) % 24;
/** Usual opening hours (11 am to 11 pm) are always shown, so one busy hour is not a lone block. */
const USUAL_FIRST = slotOf(11);
const USUAL_LAST = slotOf(23);

/** Every hour from the first to the last sale (at least the usual opening hours), in day order. */
export function hourSlots(hourly: DayEndReport['hourly']): DayEndReport['hourly'] {
  const busy = hourly.filter((h) => h.invoices > 0).map((h) => slotOf(h.hour));
  if (busy.length === 0) return [];
  const first = Math.min(USUAL_FIRST, ...busy);
  const last = Math.max(USUAL_LAST, ...busy);
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const hour = (first + i + DAY_STARTS_AT_HOUR) % 24;
    return hourly.find((h) => h.hour === hour) ?? { hour, invoices: 0, total: 0 };
  });
}

/** A labelled card of label → value rows. */
function FactCard({
  title,
  rows,
  children,
}: {
  title: string;
  rows: readonly (readonly [ReactNode, ReactNode, boolean?])[];
  children?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4 break-inside-avoid">
      <h2 className="font-semibold">{title}</h2>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value, strong], i) => (
          <div key={i} className="contents">
            <dt className={strong === true ? 'font-semibold' : 'text-muted-foreground'}>{label}</dt>
            <dd
              className={
                strong === true
                  ? 'text-end font-semibold whitespace-nowrap tabular-nums'
                  : 'text-end whitespace-nowrap tabular-nums'
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </Card>
  );
}

function DayEndBody({ report: r }: { report: DayEndReport }) {
  const { t } = useTranslation();
  const format = useFormat();
  const rate = useRate();
  const methodLabel = useMethodLabel();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const minus = (paise: number) => money(paise === 0 ? 0 : -paise);
  const n = (value: number) => format.number(value);
  const discountLabel = (kind: string) => tDynamic(t, `reports.discountKinds.${kind}`, kind);
  const hourly = hourSlots(r.hourly);
  const hourLabel = (hour: number) =>
    format.dateTime(`2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`, {
      hour: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <div className="flex flex-col gap-3">
      {r.sales.invoiceCount === 0 && r.orders.count === 0 && (
        <Alert tone="info">{t('reports.dayEnd.empty')}</Alert>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FactCard
          title={t('reports.dayEnd.sales')}
          rows={[
            [t('reports.dayEnd.invoiceCount'), n(r.sales.invoiceCount)],
            [t('reports.dayEnd.gross'), money(r.sales.gross)],
            [t('reports.dayEnd.discounts'), minus(r.sales.discounts)],
            [t('reports.dayEnd.charges'), money(r.sales.charges)],
            [t('reports.dayEnd.taxable'), money(r.sales.taxable)],
            [t('reports.dayEnd.tax'), money(r.sales.tax)],
            [t('reports.dayEnd.roundOff'), money(r.sales.roundOff)],
            [t('reports.dayEnd.total'), money(r.sales.total), true],
            [t('reports.dayEnd.refunds'), minus(r.refunds.amount)],
            [t('reports.dayEnd.net'), money(r.sales.net), true],
            [t('reports.dayEnd.averageBill'), money(r.sales.averageBill)],
          ]}
        />
        <FactCard
          title={t('reports.dayEnd.orders')}
          rows={[
            [t('reports.dayEnd.orderCount'), n(r.orders.count), true],
            [t('orderTypes.DINE_IN'), n(r.orders.dineIn)],
            [t('orderTypes.TAKEAWAY'), n(r.orders.takeaway)],
            [t('orderTypes.DELIVERY'), n(r.orders.delivery)],
            [t('reports.dashboard.covers'), n(r.orders.covers)],
            [t('reports.dayEnd.openOrders'), n(r.orders.open)],
            [t('reports.dayEnd.cancelledOrders'), n(r.orders.cancelled)],
          ]}
        />
        <FactCard
          title={t('reports.dayEnd.payments')}
          rows={
            r.payments.length === 0
              ? [[t('reports.dashboard.noPayments'), '']]
              : r.payments.map((p) => [
                  t('reports.dayEnd.methodCount', {
                    method: methodLabel(p.method),
                    count: p.count,
                  }),
                  money(p.amount),
                ])
          }
        />
        <FactCard
          title={t('reports.dayEnd.refundsAndVoids')}
          rows={[
            [
              t('reports.dayEnd.creditNotes', { count: r.refunds.creditNotes }),
              money(r.refunds.amount),
            ],
            [
              t('reports.dayEnd.cancelledInvoices', { count: r.cancellations.invoices }),
              money(r.cancellations.invoiceValue),
            ],
            [
              t('reports.dayEnd.voidedItems', { count: r.cancellations.voidedItems }),
              money(r.cancellations.voidedValue),
            ],
            [t('reports.dayEnd.wastage'), money(r.cancellations.wastageValue)],
          ]}
        />
        <FactCard
          title={t('reports.dayEnd.discountsGiven')}
          rows={
            r.discountsGiven.length === 0
              ? [[t('reports.dayEnd.noDiscounts'), '']]
              : r.discountsGiven.map((d) => [
                  t('reports.dayEnd.discountCount', {
                    kind: discountLabel(d.kind),
                    count: d.count,
                  }),
                  money(d.amount),
                ])
          }
        />
        <FactCard
          title={t('reports.dayEnd.liquor')}
          rows={[
            [t('reports.dayEnd.invoiceCount'), n(r.liquor.invoiceCount)],
            [t('reports.dayEnd.total'), money(r.liquor.total)],
            [t('reports.dayEnd.vat'), money(r.liquor.vat)],
          ]}
        />
        <FactCard
          title={t('reports.dayEnd.kitchen')}
          rows={[
            [t('reports.dayEnd.kots'), n(r.kitchen.kots)],
            [
              t('reports.dashboard.avgCook'),
              <CookTime key="c" seconds={r.kitchen.avgCookSeconds} />,
            ],
            [t('reports.dashboard.delayed'), n(r.kitchen.delayed)],
          ]}
        />
      </div>

      <section aria-labelledby="de-taxes" className="flex flex-col gap-2 break-inside-avoid">
        <h2 id="de-taxes" className="font-semibold">
          {t('reports.dayEnd.taxes')}
        </h2>
        {r.taxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reports.dayEnd.noTaxes')}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('reports.dayEnd.taxCode')}</Th>
                <Th className="text-end">{t('reports.dayEnd.rate')}</Th>
                <Th className="text-end">{t('reports.dayEnd.taxable')}</Th>
                <Th className="text-end">{t('reports.dayEnd.tax')}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.taxes.map((x) => (
                <Tr key={`${x.code}-${x.rateBp}`}>
                  <Td>{tDynamic(t, `pos.taxCodes.${x.code}`, x.code)}</Td>
                  <Td className="text-end tabular-nums">
                    {t('reports.dayEnd.ratePercent', { rate: rate(x.rateBp) })}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(x.taxable)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(x.tax)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {r.channels.length > 0 && (
        <section aria-labelledby="de-channels" className="flex flex-col gap-2 break-inside-avoid">
          <h2 id="de-channels" className="font-semibold">
            {t('reports.dayEnd.channels')}
          </h2>
          <Table>
            <THead>
              <Tr>
                <Th>{t('reports.dayEnd.channel')}</Th>
                <Th className="text-end">{t('reports.dayEnd.orderCount')}</Th>
                <Th className="text-end">{t('reports.dayEnd.channelSales')}</Th>
                <Th className="text-end">{t('reports.dayEnd.commission')}</Th>
                <Th className="text-end">{t('reports.dayEnd.netRevenue')}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.channels.map((c) => (
                <Tr key={c.name}>
                  <Td className="break-words">{c.name}</Td>
                  <Td className="text-end tabular-nums">{n(c.orders)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(c.sales)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{minus(c.commission)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">{money(c.netRevenue)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      <section aria-labelledby="de-shifts" className="flex flex-col gap-2 break-inside-avoid">
        <h2 id="de-shifts" className="font-semibold">
          {t('reports.dayEnd.shifts')}
        </h2>
        {r.shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reports.dayEnd.noShifts')}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('reports.dayEnd.openedBy')}</Th>
                <Th>{t('reports.dayEnd.shiftStatus')}</Th>
                <Th className="text-end">{t('pos.shift.expectedCash')}</Th>
                <Th className="text-end">{t('pos.shift.countedCash')}</Th>
                <Th>{t('pos.shift.cashVariance')}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.shifts.map((s, i) => (
                <Tr key={i}>
                  <Td className="break-words">{s.openedBy ?? t('reports.none')}</Td>
                  <Td>{t(`reports.dayEnd.shiftStates.${s.status}`)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {money(s.expectedCash)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {s.countedCash === null ? t('reports.none') : money(s.countedCash)}
                  </Td>
                  <Td>
                    <Variance value={s.variance} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section
          aria-labelledby="de-top"
          className="flex min-w-0 flex-col gap-2 break-inside-avoid"
        >
          <h2 id="de-top" className="font-semibold">
            {t('reports.dashboard.topItems')}
          </h2>
          <TopItems items={r.topItems} />
        </section>
        {hourly.length > 0 && (
          <Card className="flex min-w-0 flex-col p-4 break-inside-avoid">
            <BarChart
              title={t('reports.dayEnd.hourly')}
              bars={hourly.map((h) => ({
                key: String(h.hour),
                value: h.total,
                label: String(h.hour),
                description: t('reports.dayEnd.hourBar', {
                  hour: hourLabel(h.hour),
                  amount: money(h.total),
                  count: h.invoices,
                }),
              }))}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

/** Every invoice and credit note between two dates, as a CSV for the accountant. */
function SalesRegister({ date }: { date: string }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(() => monthStart(date));
  const [to, setTo] = useState(date);
  const days = from === '' || to === '' ? -1 : daysBetween(from, to);
  const valid = days >= 0 && days < MAX_REGISTER_DAYS;
  const download = useDownload(
    ({ from: f, to: tt }: { from: string; to: string }) => api.reports.salesRegisterCsv(f, tt),
    ({ from: f, to: tt }) => `sales-register-${f}-to-${tt}.csv`,
  );
  return (
    <Card className="flex flex-col gap-3 p-4 print:hidden">
      <h2 className="flex items-center gap-2 font-semibold">
        <FileSpreadsheet aria-hidden="true" className="size-5 text-muted-foreground" />
        {t('reports.register.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('reports.register.description')}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) download.mutate({ from, to });
        }}
      >
        <Field
          label={t('reports.register.from')}
          className="w-full sm:w-48"
          error={valid ? undefined : t('reports.register.invalid', { max: MAX_REGISTER_DAYS })}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={from}
              max={to === '' ? localIsoDate() : to}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('reports.register.to')} className="w-full sm:w-48">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={to}
              min={from}
              max={localIsoDate()}
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" disabled={!valid || download.isPending}>
          <Download aria-hidden="true" />
          {t('reports.register.download')}
        </Button>
      </form>
    </Card>
  );
}
