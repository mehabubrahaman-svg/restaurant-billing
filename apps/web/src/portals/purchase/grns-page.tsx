import { Button, Field, Package, Select, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { GrnStatus } from '../../api/endpoints';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useGrns, useVendors } from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { GRN_STATUSES, GrnStatusBadge, useMoney } from './purchase-ui';

/** /purchase/grns?status=&vendor=: goods received notes, newest first. */
export function GrnsPage() {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  const canReceive = usePermission('grn.post');
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = GRN_STATUSES.includes(statusParam as GrnStatus)
    ? (statusParam as GrnStatus)
    : undefined;
  const vendorId = params.get('vendor') ?? '';
  const grns = useGrns({
    ...(status === undefined ? {} : { status }),
    ...(vendorId === '' ? {} : { vendorId }),
  });
  const vendors = useVendors(true);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('purchase.grns.title')}
        description={t('purchase.grns.description')}
        actions={
          canReceive ? (
            <Button asChild variant="outline">
              <Link to="/purchase/grns/new">
                <Package aria-hidden="true" />
                {t('purchase.grns.direct')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label={t('purchase.grns.status')}>
          {(p) => (
            <Select {...p} value={status ?? ''} onChange={(e) => update('status', e.target.value)}>
              <option value="">{t('purchase.orders.allStatuses')}</option>
              {GRN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`purchase.grnStatus.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('purchase.orders.vendor')}>
          {(p) => (
            <Select {...p} value={vendorId} onChange={(e) => update('vendor', e.target.value)}>
              <option value="">{t('purchase.allVendors')}</option>
              {(vendors.data?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <QueryState query={grns}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('purchase.grns.empty')}</p>
          ) : (
            <Table>
              <caption className="sr-only">
                {t('purchase.grns.caption', { count: data.length })}
              </caption>
              <THead>
                <Tr>
                  <Th>{t('purchase.grns.number')}</Th>
                  <Th>{t('purchase.orders.vendor')}</Th>
                  <Th>{t('purchase.grns.order')}</Th>
                  <Th>{t('purchase.grns.status')}</Th>
                  <Th className="text-end">{t('purchase.totals.total')}</Th>
                  <Th className="text-end">{t('purchase.totals.balance')}</Th>
                  <Th>{t('purchase.grns.dueOn')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.map((g) => (
                  <Tr key={g.id}>
                    <Td>
                      <Link
                        to={`/purchase/grns/${g.id}`}
                        className="font-medium break-all text-primary underline-offset-2 hover:underline"
                      >
                        {g.grnNo}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {day(g.businessDate)}
                        {g.vendorInvoiceNo !== null &&
                          ` · ${t('purchase.statement.vendorBill', { number: g.vendorInvoiceNo })}`}
                      </span>
                    </Td>
                    <Td className="break-words">{g.vendorName}</Td>
                    <Td className="break-all">
                      {g.purchaseOrderId === null || g.poNo === null ? (
                        <span className="text-muted-foreground">{t('purchase.grns.noOrder')}</span>
                      ) : (
                        <Link
                          to={`/purchase/orders/${g.purchaseOrderId}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {g.poNo}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <GrnStatusBadge status={g.status} />
                    </Td>
                    <Td className="text-end whitespace-nowrap tabular-nums">
                      {money(g.grandTotal)}
                    </Td>
                    <Td className="text-end whitespace-nowrap tabular-nums">
                      {g.status === 'POSTED' ? money(g.balance) : ''}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {g.dueOn === null ? t('reports.none') : day(g.dueOn)}
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
