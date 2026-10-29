import type { PurchaseOrderStatus } from '@restroos/contracts';
import { Button, Field, Plus, Select, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { usePurchaseOrders, useVendors } from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { PO_STATUSES, PoStatusBadge, useMoney } from './purchase-ui';

/** /purchase/orders?status=&vendor=: purchase orders, newest first. */
export function OrdersPage() {
  const { t } = useTranslation();
  const money = useMoney();
  const format = useFormat();
  const day = useDayFormat();
  const canCreate = usePermission('po.create');
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = PO_STATUSES.includes(statusParam as PurchaseOrderStatus)
    ? (statusParam as PurchaseOrderStatus)
    : null;
  const vendorId = params.get('vendor') ?? '';
  const orders = usePurchaseOrders(status, vendorId === '' ? null : vendorId);
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
        title={t('purchase.orders.title')}
        description={t('purchase.orders.description')}
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/purchase/orders/new">
                <Plus aria-hidden="true" />
                {t('purchase.orders.new')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label={t('purchase.orders.status')}>
          {(p) => (
            <Select {...p} value={status ?? ''} onChange={(e) => update('status', e.target.value)}>
              <option value="">{t('purchase.orders.allStatuses')}</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`purchase.poStatus.${s}`)}
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
      <QueryState query={orders}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('purchase.orders.empty')}</p>
          ) : (
            <Table>
              <caption className="sr-only">
                {t('purchase.orders.caption', { count: data.length })}
              </caption>
              <THead>
                <Tr>
                  <Th>{t('purchase.orders.number')}</Th>
                  <Th>{t('purchase.orders.vendor')}</Th>
                  <Th>{t('purchase.orders.status')}</Th>
                  <Th>{t('purchase.orders.expectedOn')}</Th>
                  <Th className="text-end">{t('purchase.totals.total')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.map((po) => (
                  <Tr key={po.id}>
                    <Td>
                      <Link
                        to={`/purchase/orders/${po.id}`}
                        className="font-medium break-all text-primary underline-offset-2 hover:underline"
                      >
                        {po.poNo}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {[format.dateTime(po.createdAt, { dateStyle: 'medium' }), po.createdByName]
                          .filter((s) => s !== null)
                          .join(' · ')}
                      </span>
                    </Td>
                    <Td className="break-words">{po.vendorName}</Td>
                    <Td>
                      <PoStatusBadge status={po.status} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {po.expectedOn === null ? t('reports.none') : day(po.expectedOn)}
                    </Td>
                    <Td className="text-end whitespace-nowrap tabular-nums">
                      {money(po.grandTotal)}
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
