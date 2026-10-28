import { InvoiceStatusSchema, type InvoiceStatus } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Badge, Field, Input, Search, Select, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { QueryState } from '../../features/admin/query-state';
import { useInvoices } from '../../features/billing/billing-queries';
import { useFormat } from '../../i18n/use-format';
import { InvoiceStatusBadge } from './counter-page';
import { useOrderLabel } from './order-queue';

/** Today's date on this device as YYYY-MM-DD (the business day by default). */
export function localIsoDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const STATUSES = InvoiceStatusSchema.options;

/** /pos/bills: the day's invoices and credit notes, filterable, newest first. */
export function BillsPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const label = useOrderLabel();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? localIsoDate();
  const statusParam = params.get('status');
  const status = STATUSES.includes(statusParam as InvoiceStatus)
    ? (statusParam as InvoiceStatus)
    : null;
  const q = params.get('q') ?? '';
  const invoices = useInvoices(date, status);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(invoices.data?.data ?? [])]
      .filter((i) => needle === '' || i.invoiceNo.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invoices.data, q]);
  const money = (paise: number) => format.money(Money.ofPaise(paise));

  return (
    <div className="flex flex-col gap-4">
      <title>{`${t('pos.tabs.bills')} · ${t('app.name')}`}</title>
      <h2 className="text-xl font-bold">{t('pos.bills.title')}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('pos.bills.date')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={date}
              max={localIsoDate()}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('pos.bills.status')}>
          {(p) => (
            <Select
              {...p}
              value={status ?? ''}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">{t('pos.bills.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`pos.invoiceStatus.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('pos.bills.search')}>
          {(p) => (
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                {...p}
                type="search"
                className="ps-9"
                placeholder={t('pos.bills.searchPlaceholder')}
                value={q}
                onChange={(e) => update({ q: e.target.value })}
              />
            </div>
          )}
        </Field>
      </div>
      <QueryState query={invoices}>
        {() =>
          rows.length === 0 ? (
            <p className="text-muted-foreground">{t('pos.bills.empty')}</p>
          ) : (
            <Table>
              <caption className="sr-only">
                {t('pos.bills.caption', { count: rows.length })}
              </caption>
              <THead>
                <Tr>
                  <Th>{t('pos.bills.number')}</Th>
                  <Th>{t('pos.bills.order')}</Th>
                  <Th className="text-end">{t('pos.bills.total')}</Th>
                  <Th className="text-end">{t('pos.bills.balance')}</Th>
                  <Th>{t('pos.bills.status')}</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link
                        to={`/pos/bills/${i.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {i.invoiceNo}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {format.dateTime(i.createdAt, { timeStyle: 'short' })}
                        {i.kind === 'CREDIT_NOTE' && (
                          <Badge variant="outline" className="ms-2">
                            {t('pos.bill.series.CN')}
                          </Badge>
                        )}
                      </span>
                    </Td>
                    <Td>
                      {label(i)}
                      <span className="block text-xs text-muted-foreground">
                        {t(`orderTypes.${i.orderType as 'DINE_IN'}`, i.orderType)}
                      </span>
                    </Td>
                    <Td className="text-end tabular-nums">{money(i.grandTotal)}</Td>
                    <Td className="text-end tabular-nums">
                      {i.kind === 'INVOICE' ? money(i.balance) : ''}
                    </Td>
                    <Td>
                      <InvoiceStatusBadge status={i.status} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )
        }
      </QueryState>
    </div>
  );
}
