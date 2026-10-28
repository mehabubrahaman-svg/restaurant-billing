import type { ConsumptionReport } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  Field,
  Input,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TriangleAlert,
} from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  ITEM_LIST_PERMISSIONS,
  itemsById,
  useBusinessDate,
  useConsumption,
  useInventoryItems,
} from '../../features/inventory/inventory-queries';
import { VARIANCE_LIMIT_BP } from '../../features/inventory/quantity';
import { byCategory, useItemName } from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { daysBetween, isCalendarDay, monthStart } from '../../features/reports/use-day-format';
import { localIsoDate } from '../pos/bills-page';

/** The longest range the Hub reports on at once. */
export const MAX_CONSUMPTION_DAYS = 366;

type Row = ConsumptionReport['rows'][number];

/**
 * /inventory/consumption?from=&to= (also under Reports): per item, what the
 * recipes say was used against what the counts found, with the variance that
 * Phase 2 holds to 5%.
 */
export function ConsumptionPage() {
  const { t } = useTranslation();
  const business = useBusinessDate();
  // "Today" is the Hub's business day: after midnight the device's date can be a day ahead.
  const today = business.date ?? (business.settled ? localIsoDate() : null);
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.consumption.title')}
        description={t('inventory.consumption.description')}
      />
      {today === null ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <ConsumptionRange today={today} />
      )}
    </div>
  );
}

function ConsumptionRange({ today }: { today: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? today;
  const to = params.get('to') ?? today;
  const days = isCalendarDay(from) && isCalendarDay(to) ? daysBetween(from, to) : -1;
  const valid = days >= 0 && days < MAX_CONSUMPTION_DAYS;
  const report = useConsumption(from, to, valid);
  const setRange = (next: { from: string; to: string }) => setParams(next, { replace: true });

  return (
    <>
      <form
        className="flex flex-wrap items-end gap-3 print:hidden"
        noValidate
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          label={t('reports.register.from')}
          className="w-full sm:w-48"
          error={valid ? undefined : t('reports.register.invalid', { max: MAX_CONSUMPTION_DAYS })}
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                if (e.target.value !== '') setRange({ from: e.target.value, to });
              }}
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
              max={today}
              onChange={(e) => {
                if (e.target.value !== '') setRange({ from, to: e.target.value });
              }}
            />
          )}
        </Field>
        <Button variant="outline" onClick={() => setRange({ from: today, to: today })}>
          {t('inventory.consumption.today')}
        </Button>
        <Button variant="outline" onClick={() => setRange({ from: monthStart(today), to: today })}>
          {t('inventory.consumption.thisMonth')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('inventory.consumption.legend', { limit: VARIANCE_LIMIT_BP / 100 })}
      </p>
      {valid && (
        <QueryState query={report}>{(data) => <ConsumptionTable report={data} />}</QueryState>
      )}
    </>
  );
}

/** Variance %, flagged when it is beyond the 5% the recipes are held to. */
function VarianceCell({ bp }: { bp: number | null }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  if (bp === null) return <span className="text-muted-foreground">{t('reports.none')}</span>;
  const high = Math.abs(bp) > VARIANCE_LIMIT_BP;
  return high ? (
    <Badge variant="danger" className="whitespace-nowrap" data-variance="high">
      <TriangleAlert aria-hidden="true" />
      {format.percent(bp, true)}
      <span className="sr-only">{t('inventory.consumption.overLimit')}</span>
    </Badge>
  ) : (
    <span className="whitespace-nowrap tabular-nums" data-variance="ok">
      {format.percent(bp, true)}
    </span>
  );
}

function ConsumptionTable({ report }: { report: ConsumptionReport }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const itemName = useItemName();
  // Reports staff may not see the store room: then names stay in English.
  const canList = usePermission(ITEM_LIST_PERMISSIONS);
  const items = itemsById(useInventoryItems(true, canList).data?.data ?? []);
  const flagged = report.rows.filter(
    (r) => r.varianceBp !== null && Math.abs(r.varianceBp) > VARIANCE_LIMIT_BP,
  );

  if (report.rows.length === 0) {
    return <p className="text-muted-foreground">{t('inventory.consumption.empty')}</p>;
  }
  const qty = (row: Row, milli: number, signed = false) =>
    milli === 0 ? (
      <span className="text-muted-foreground">{t('reports.none')}</span>
    ) : (
      format.qty(milli, row.baseUnit, signed)
    );
  const withValue = (main: ReactNode, paise: number) => (
    <span className="flex flex-col items-end">
      <span className="whitespace-nowrap tabular-nums">{main}</span>
      {paise !== 0 && (
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {format.money(paise)}
        </span>
      )}
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            [t('inventory.consumption.soldValue'), format.money(report.totals.soldValue)],
            [t('inventory.consumption.wastageValue'), format.money(report.totals.wastageValue)],
            [
              t('inventory.consumption.countVarianceValue'),
              format.money(report.totals.countVarianceValue),
            ],
            [
              t('inventory.consumption.variance'),
              <VarianceCell key="v" bp={report.totals.varianceBp} />,
            ],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1 p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-xl font-bold break-words tabular-nums">{value}</dd>
          </Card>
        ))}
      </dl>
      {flagged.length > 0 && (
        <Alert tone="warning" role="status">
          {t('inventory.consumption.flagged', {
            count: flagged.length,
            limit: VARIANCE_LIMIT_BP / 100,
          })}
        </Alert>
      )}
      <Table aria-label={t('inventory.consumption.title')}>
        <THead>
          <Tr>
            <Th>{t('inventory.fields.item')}</Th>
            <Th className="text-end">{t('inventory.consumption.opening')}</Th>
            <Th className="text-end">{t('inventory.consumption.received')}</Th>
            <Th className="text-end">{t('inventory.consumption.sold')}</Th>
            <Th className="text-end">{t('inventory.consumption.wastage')}</Th>
            <Th className="text-end">{t('inventory.consumption.adjusted')}</Th>
            <Th className="text-end">{t('inventory.consumption.countVariance')}</Th>
            <Th className="text-end">{t('inventory.consumption.closing')}</Th>
            <Th className="text-end">{t('inventory.consumption.variance')}</Th>
          </Tr>
        </THead>
        {byCategory(report.rows).map((group) => (
          <TBody key={group.category ?? ''}>
            <Tr className="bg-muted/50">
              <Th scope="rowgroup" colSpan={9} className="text-sm">
                {group.category ?? t('inventory.uncategorised')}
              </Th>
            </Tr>
            {group.items.map((row) => {
              const item = items.get(row.inventoryItemId);
              const high = row.varianceBp !== null && Math.abs(row.varianceBp) > VARIANCE_LIMIT_BP;
              return (
                <Tr key={row.inventoryItemId} className={cn(high && 'bg-state-danger-soft')}>
                  <Td>
                    <span className="font-medium break-words">
                      {item === undefined ? row.name : itemName(item)}
                    </span>
                    <span className="block font-mono text-xs text-muted-foreground">{row.sku}</span>
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {qty(row, row.openingMilli)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {qty(row, row.receivedMilli)}
                  </Td>
                  <Td className="text-end">{withValue(qty(row, row.soldMilli), row.soldValue)}</Td>
                  <Td className="text-end">
                    {withValue(qty(row, row.wastageMilli), row.wastageValue)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {qty(row, row.adjustedMilli, true)}
                  </Td>
                  <Td className="text-end">
                    {withValue(qty(row, row.countVarianceMilli, true), row.countVarianceValue)}
                  </Td>
                  <Td className="text-end">
                    {withValue(qty(row, row.closingMilli), row.closingValue)}
                  </Td>
                  <Td className="text-end">
                    <VarianceCell bp={row.varianceBp} />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        ))}
        <tfoot className="border-t-2 bg-muted font-semibold">
          <Tr>
            <Th scope="row">{t('inventory.consumption.total')}</Th>
            <Td />
            <Td />
            <Td className="text-end whitespace-nowrap tabular-nums">
              {format.money(report.totals.soldValue)}
            </Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {format.money(report.totals.wastageValue)}
            </Td>
            <Td />
            <Td className="text-end whitespace-nowrap tabular-nums">
              {format.money(report.totals.countVarianceValue)}
            </Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {format.money(report.totals.closingValue)}
            </Td>
            <Td className="text-end">
              <VarianceCell bp={report.totals.varianceBp} />
            </Td>
          </Tr>
        </tfoot>
      </Table>
    </div>
  );
}
