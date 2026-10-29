import { InvoiceStatusSchema } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  ArrowLeft,
  Badge,
  Button,
  Card,
  Input,
  Search,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { usePermission } from '../../auth/permissions';
import {
  formatPhone,
  MIN_SEARCH,
  useCustomer,
  useCustomerSearch,
} from '../../customers/customer-queries';
import { TierBadge } from '../../customers/tier-badge';
import { InvoiceStatusBadge } from '../../../portals/pos/counter-page';
import { useDayFormat } from '../../reports/use-day-format';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';
import { LoyaltySection } from './loyalty-section';
import { TierSection } from './tier-section';

/** /admin/customers?q=: find guests by mobile number or name. */
export function CustomersPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const input = params.get('q') ?? '';
  const search = useCustomerSearch(input);
  const rows = search.enabled ? (search.data?.data ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title={t('customers.title')} description={t('customers.description')} />
      <label className="relative max-w-xl">
        <span className="sr-only">{t('customers.search')}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="ps-10"
          autoComplete="off"
          placeholder={t('customers.searchPlaceholder')}
          value={input}
          onChange={(e) =>
            setParams(e.target.value === '' ? {} : { q: e.target.value }, { replace: true })
          }
        />
      </label>
      {!search.enabled ? (
        <p className="text-muted-foreground">{t('customers.hint', { min: MIN_SEARCH })}</p>
      ) : search.isError ? (
        <p role="alert" className="text-state-danger-fg">
          {errorMessage(search.error)}
        </p>
      ) : search.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{t('customers.none', { q: search.q })}</p>
      ) : (
        <Table aria-label={t('customers.found', { count: rows.length })}>
          <THead>
            <Tr>
              <Th>{t('customers.name')}</Th>
              <Th>{t('customers.tier.column')}</Th>
              <Th>{t('customers.phone')}</Th>
              <Th className="text-end">{t('customers.visits')}</Th>
              <Th className="text-end">{t('customers.lifetimeValue')}</Th>
              <Th>{t('customers.lastVisit')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link
                    to={`/admin/customers/${c.id}`}
                    className="font-medium break-words text-primary underline-offset-2 hover:underline"
                  >
                    {c.name ?? formatPhone(c.phone)}
                  </Link>
                  {c.taxId !== null && (
                    <span className="block font-mono text-xs text-muted-foreground">{c.taxId}</span>
                  )}
                </Td>
                <Td>
                  <TierBadge tier={c.tier} />
                </Td>
                <Td className="whitespace-nowrap tabular-nums">{formatPhone(c.phone)}</Td>
                <Td className="text-end tabular-nums">{format.number(c.visitCount)}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {format.money(Money.ofPaise(c.lifetimeValue))}
                </Td>
                <Td className="whitespace-nowrap">
                  {c.lastVisitAt === null
                    ? t('reports.none')
                    : format.dateTime(c.lastVisitAt, { dateStyle: 'medium' })}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

/** /admin/customers/:customerId: one guest's visits, spend and favourite dishes. */
export function CustomerDetailPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const day = useDayFormat();
  const { customerId = '' } = useParams();
  const customer = useCustomer(customerId);
  const canOpenBills = usePermission('billing.create');
  const money = (paise: number) => format.money(Money.ofPaise(paise));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild variant="ghost">
          <Link to="/admin/customers">
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            {t('customers.back')}
          </Link>
        </Button>
      </div>
      <QueryState query={customer}>
        {(c) => (
          <>
            <AdminHeader
              title={c.name ?? formatPhone(c.phone)}
              description={formatPhone(c.phone)}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [t('customers.visits'), format.number(c.visitCount)],
                [t('customers.lifetimeValue'), money(c.lifetimeValue)],
                [
                  t('customers.lastVisit'),
                  c.lastVisitAt === null ? t('reports.none') : format.dateTime(c.lastVisitAt),
                ],
              ].map(([label, value]) => (
                <Card key={label} className="flex flex-col gap-1 p-4">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-xl font-bold break-words tabular-nums">{value}</span>
                </Card>
              ))}
            </div>
            <Card className="p-4">
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-muted-foreground">{t('customers.email')}</dt>
                <dd className="break-all">{c.email ?? t('reports.none')}</dd>
                <dt className="text-muted-foreground">{t('customers.gstin')}</dt>
                <dd className="font-mono">{c.taxId ?? t('reports.none')}</dd>
                <dt className="text-muted-foreground">{t('customers.language')}</dt>
                <dd>
                  {c.preferredLocale === null
                    ? t('reports.none')
                    : t(`customers.locales.${c.preferredLocale}`)}
                </dd>
                <dt className="text-muted-foreground">{t('customers.marketing')}</dt>
                <dd>
                  <Badge variant={c.marketingOptIn ? 'success' : 'neutral'}>
                    {c.marketingOptIn ? t('customers.optedIn') : t('customers.optedOut')}
                  </Badge>
                </dd>
              </dl>
            </Card>
            <TierSection customer={c} />
            <LoyaltySection customerId={c.id} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <section aria-labelledby="cust-bills" className="flex min-w-0 flex-col gap-2">
                <h2 id="cust-bills" className="font-semibold">
                  {t('customers.recent')}
                </h2>
                {c.recentInvoices.length === 0 ? (
                  <p className="text-muted-foreground">{t('customers.noBills')}</p>
                ) : (
                  <Table>
                    <THead>
                      <Tr>
                        <Th>{t('customers.bill')}</Th>
                        <Th>{t('customers.date')}</Th>
                        <Th className="text-end">{t('reports.amount')}</Th>
                        <Th>{t('pos.bills.status')}</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {c.recentInvoices.map((i) => (
                        <Tr key={i.id}>
                          <Td className="break-all tabular-nums">
                            {canOpenBills ? (
                              <Link
                                to={`/pos/bills/${i.id}`}
                                className="text-primary underline-offset-2 hover:underline"
                              >
                                {i.invoiceNo}
                              </Link>
                            ) : (
                              i.invoiceNo
                            )}
                          </Td>
                          <Td className="whitespace-nowrap">{day(i.businessDate)}</Td>
                          <Td className="text-end whitespace-nowrap tabular-nums">
                            {money(i.grandTotal)}
                          </Td>
                          <Td>
                            <StatusCell status={i.status} />
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                )}
              </section>
              <section aria-labelledby="cust-fav" className="flex min-w-0 flex-col gap-2">
                <h2 id="cust-fav" className="font-semibold">
                  {t('customers.favourites')}
                </h2>
                {c.favourites.length === 0 ? (
                  <p className="text-muted-foreground">{t('customers.noFavourites')}</p>
                ) : (
                  <ol className="flex flex-col divide-y rounded-xl border bg-surface">
                    {c.favourites.map((f) => (
                      <li
                        key={f.name}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span className="min-w-0 break-words">{f.name}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {t('customers.times', { count: f.quantity })}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

function StatusCell({ status }: { status: string }) {
  const known = InvoiceStatusSchema.safeParse(status);
  return known.success ? <InvoiceStatusBadge status={known.data} /> : <>{status}</>;
}
