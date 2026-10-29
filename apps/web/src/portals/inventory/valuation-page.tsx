import type { InventoryValuation } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  Download,
  Field,
  FileSpreadsheet,
  Input,
  Printer,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { api } from '../../api/endpoints';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  ITEM_LIST_PERMISSIONS,
  itemsById,
  useBusinessDate,
  useInventoryItems,
  useInventoryValuation,
} from '../../features/inventory/inventory-queries';
import { byCategory, useItemName } from '../../features/inventory/stock-controls';
import { useStockFormat } from '../../features/inventory/use-stock-format';
import { useDownload } from '../../features/reports/report-queries';
import {
  daysBetween,
  isCalendarDay,
  monthStart,
  useDayFormat,
} from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { localIsoDate } from '../pos/bills-page';
import { MAX_CONSUMPTION_DAYS } from './consumption-page';

type Row = InventoryValuation['rows'][number];

/** Stock that had no sales in the period but still holds value. */
const unused = (r: Row) => r.closingValue > 0 && r.soldMilli === 0;

/** The whole month before `today`'s. */
function lastMonth(today: string): { from: string; to: string } {
  const end = new Date(`${monthStart(today)}T00:00:00Z`);
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);
  return { from: monthStart(to), to };
}

/**
 * /inventory/valuation?from=&to= (also under Reports): what the stock is
 * worth at weighted average cost, how the value moved over the period, and
 * the books' Inventory account beside it.
 */
export function ValuationPage() {
  const { t } = useTranslation();
  const business = useBusinessDate();
  // "Today" is the Hub's business day: after midnight the device's date can be a day ahead.
  const today = business.date ?? (business.settled ? localIsoDate() : null);
  return today === null ? (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.valuation.title')}
        description={t('inventory.valuation.description')}
      />
      <Spinner label={t('common.loading')} />
    </div>
  ) : (
    <ValuationRange today={today} />
  );
}

function ValuationRange({ today }: { today: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? monthStart(today);
  const to = params.get('to') ?? today;
  const days = isCalendarDay(from) && isCalendarDay(to) ? daysBetween(from, to) : -1;
  const valid = days >= 0 && days < MAX_CONSUMPTION_DAYS;
  const report = useInventoryValuation(from, to, valid);
  const canExport = usePermission('reports.export');
  const setRange = (next: { from: string; to: string }) => setParams(next, { replace: true });
  const download = useDownload(
    (format: 'xlsx' | 'csv') => api.reports.inventoryValuationFile(from, to, format),
    (format) => `stock-value-${from}-to-${to}.${format}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.valuation.title')}
        description={t('inventory.valuation.description')}
        actions={
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
        }
      />
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
          {t('inventory.valuation.today')}
        </Button>
        <Button variant="outline" onClick={() => setRange({ from: monthStart(today), to: today })}>
          {t('inventory.valuation.thisMonth')}
        </Button>
        <Button variant="outline" onClick={() => setRange(lastMonth(today))}>
          {t('inventory.valuation.lastMonth')}
        </Button>
      </form>
      {valid && <QueryState query={report}>{(data) => <ValuationBody report={data} />}</QueryState>}
    </div>
  );
}

function ValuationBody({ report: r }: { report: InventoryValuation }) {
  const { t } = useTranslation();
  const format = useStockFormat();
  const { number } = useFormat();
  const day = useDayFormat();
  const itemName = useItemName();
  // Reports staff may not see the store room: then names stay in English.
  const canList = usePermission(ITEM_LIST_PERMISSIONS);
  const items = itemsById(useInventoryItems(true, canList).data?.data ?? []);
  const name = (row: Row) => {
    const item = items.get(row.inventoryItemId);
    return item === undefined ? row.name : itemName(item);
  };

  if (r.rows.length === 0) {
    return <p className="text-muted-foreground">{t('inventory.valuation.empty')}</p>;
  }
  const inStock = r.rows.filter((row) => row.closingMilli > 0).length;
  const belowZero = r.rows.filter((row) => row.closingMilli < 0);
  const idle = r.rows.filter(unused);
  const idleValue = idle.reduce((s, row) => s + row.closingValue, 0);
  const tot = r.totals;

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
  const signedMoney = (paise: number) =>
    paise > 0 ? `+${format.money(paise)}` : format.money(paise);
  // Opening, what came in and went out, and the closing it adds up to.
  const movement = [
    { label: t('inventory.valuation.openingOn', { date: day(r.from) }), paise: tot.openingValue },
    { label: t('inventory.valuation.received'), paise: tot.receivedValue, signed: true },
    { label: t('inventory.valuation.sold'), paise: -tot.soldValue, signed: true },
    { label: t('inventory.valuation.wastage'), paise: -tot.wastageValue, signed: true },
    { label: t('inventory.valuation.adjusted'), paise: tot.adjustedValue, signed: true },
    ...(tot.differenceValue === 0
      ? []
      : [
          {
            label: t('inventory.valuation.difference'),
            paise: tot.differenceValue,
            signed: true,
          },
        ]),
    {
      label: t('inventory.valuation.closingRow', { date: day(r.to) }),
      paise: tot.closingValue,
      total: true,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="hidden text-sm print:block">
        {t('inventory.valuation.printed', {
          branch: r.branchName,
          from: day(r.from),
          to: day(r.to),
        })}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            [
              t('inventory.valuation.closingOn', { date: day(r.to) }),
              format.money(tot.closingValue),
              null,
            ],
            [t('inventory.valuation.inStock'), number(inStock), null],
            [
              t('inventory.valuation.idle'),
              format.money(idleValue),
              t('inventory.valuation.idleItems', { count: idle.length }),
            ],
            [
              t('inventory.valuation.booksDifference'),
              signedMoney(r.books.difference),
              t('inventory.valuation.booksAre', { amount: format.money(r.books.inventoryAccount) }),
            ],
          ] as const
        ).map(([label, value, note]) => (
          <Card key={label} className="flex flex-col gap-1 p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="flex flex-col gap-0.5">
              <span className="text-xl font-bold break-words tabular-nums">{value}</span>
              {note !== null && <span className="text-sm text-muted-foreground">{note}</span>}
            </dd>
          </Card>
        ))}
      </dl>
      {belowZero.length > 0 && (
        <Alert tone="warning" role="status">
          {t('inventory.valuation.belowZero', { count: belowZero.length })}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="valuation-movement" className="flex min-w-0 flex-col gap-2">
          <h2 id="valuation-movement" className="font-semibold">
            {t('inventory.valuation.movement')}
          </h2>
          <Table aria-labelledby="valuation-movement">
            <TBody>
              {movement.map(({ label, paise, signed, total }) => (
                <Tr key={label} className={cn(total && 'border-t-2 font-semibold')}>
                  <Th scope="row" className={cn(!total && 'font-normal')}>
                    {label}
                  </Th>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {signed ? signedMoney(paise) : format.money(paise)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <p className="text-sm text-muted-foreground">
            {tot.differenceValue === 0
              ? t('inventory.valuation.legend')
              : t('inventory.valuation.differenceHint')}
          </p>
        </section>

        <section aria-labelledby="valuation-categories" className="flex min-w-0 flex-col gap-2">
          <h2 id="valuation-categories" className="font-semibold">
            {t('inventory.valuation.byCategory')}
          </h2>
          <Table aria-labelledby="valuation-categories">
            <THead>
              <Tr>
                <Th>{t('inventory.fields.category')}</Th>
                <Th className="text-end">{t('inventory.valuation.items')}</Th>
                <Th className="text-end">{t('inventory.fields.value')}</Th>
                <Th className="text-end">{t('inventory.valuation.share')}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.categories.map((c) => (
                <Tr key={c.category ?? ''}>
                  <Td className="break-words">{c.category ?? t('inventory.uncategorised')}</Td>
                  <Td className="text-end tabular-nums">{number(c.items)}</Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {format.money(c.value)}
                  </Td>
                  <Td className="text-end whitespace-nowrap tabular-nums">
                    {c.shareBp === null ? t('reports.none') : format.percent(c.shareBp)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      </div>

      <Table aria-label={t('inventory.valuation.title')}>
        <THead>
          <Tr>
            <Th>{t('inventory.fields.item')}</Th>
            <Th className="text-end">{t('inventory.consumption.opening')}</Th>
            <Th className="text-end">{t('inventory.consumption.received')}</Th>
            <Th className="text-end">{t('inventory.consumption.sold')}</Th>
            <Th className="text-end">{t('inventory.consumption.wastage')}</Th>
            <Th className="text-end">{t('inventory.consumption.adjusted')}</Th>
            <Th className="text-end">{t('inventory.consumption.closing')}</Th>
            <Th className="text-end">{t('inventory.fields.avgCost')}</Th>
            <Th className="text-end">{t('inventory.fields.value')}</Th>
          </Tr>
        </THead>
        {byCategory(r.rows).map((group) => (
          <TBody key={group.category ?? ''}>
            <Tr className="bg-muted/50">
              <Th scope="rowgroup" colSpan={9} className="text-sm">
                {group.category ?? t('inventory.uncategorised')}
              </Th>
            </Tr>
            {group.items.map((row) => (
              <Tr
                key={row.inventoryItemId}
                className={cn(row.closingMilli < 0 && 'bg-state-danger-soft')}
              >
                <Td>
                  <span className="font-medium break-words">{name(row)}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{row.sku}</span>
                  {row.closingMilli < 0 && (
                    <Badge variant="danger" className="mt-1">
                      {t('inventory.valuation.belowZeroBadge')}
                    </Badge>
                  )}
                  {unused(row) && (
                    <Badge variant="warning" className="mt-1">
                      {t('inventory.valuation.idleBadge')}
                    </Badge>
                  )}
                </Td>
                <Td className="text-end">
                  {withValue(qty(row, row.openingMilli), row.openingValue)}
                </Td>
                <Td className="text-end">
                  {withValue(qty(row, row.receivedMilli), row.receivedValue)}
                </Td>
                <Td className="text-end">{withValue(qty(row, row.soldMilli), row.soldValue)}</Td>
                <Td className="text-end">
                  {withValue(qty(row, row.wastageMilli), row.wastageValue)}
                </Td>
                <Td className="text-end">
                  {withValue(qty(row, row.adjustedMilli, true), row.adjustedValue)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {qty(row, row.closingMilli)}
                </Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {row.closingCostPerBase === 0 ? (
                    <span className="text-muted-foreground">{t('reports.none')}</span>
                  ) : (
                    format.perUnit(row.closingCostPerBase, row.baseUnit)
                  )}
                </Td>
                <Td className="text-end font-medium whitespace-nowrap tabular-nums">
                  {format.money(row.closingValue)}
                </Td>
              </Tr>
            ))}
          </TBody>
        ))}
        <tfoot className="border-t-2 bg-muted font-semibold">
          <Tr>
            <Th scope="row">{t('inventory.valuation.total')}</Th>
            {[tot.openingValue, tot.receivedValue, tot.soldValue, tot.wastageValue].map((v, i) => (
              <Td key={i} className="text-end whitespace-nowrap tabular-nums">
                {format.money(v)}
              </Td>
            ))}
            <Td className="text-end whitespace-nowrap tabular-nums">
              {signedMoney(tot.adjustedValue)}
            </Td>
            <Td />
            <Td />
            <Td className="text-end whitespace-nowrap tabular-nums">
              {format.money(tot.closingValue)}
            </Td>
          </Tr>
        </tfoot>
      </Table>
    </div>
  );
}
