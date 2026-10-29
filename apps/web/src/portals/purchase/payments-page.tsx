import type { VendorPayment } from '@restroos/contracts';
import { Banknote, Button, Field, Select, Table, TBody, Td, Th, THead, Tr } from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useVendorPayments, useVendors } from '../../features/purchasing/purchasing-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { DateRangeFields, useReportParams } from '../accounts/date-range';
import { PaymentDialog } from './payment-dialog';
import { useMoney } from './purchase-ui';

/** /purchase/payments?vendor=&from=&to=: what was paid to vendors, newest first. */
export function PaymentsPage() {
  const { t } = useTranslation();
  const canPay = usePermission('vendor_payments.create');
  const { params, from, to, valid, update } = useReportParams();
  const vendorId = params.get('vendor') ?? '';
  const vendors = useVendors(true);
  const payments = useVendorPayments({ ...(vendorId === '' ? {} : { vendorId }), from, to }, valid);
  const [recording, setRecording] = useState(false);
  const money = useMoney();

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('purchase.payments.title')}
        description={t('purchase.payments.description')}
        actions={
          canPay ? (
            <Button onClick={() => setRecording(true)}>
              <Banknote aria-hidden="true" />
              {t('purchase.payments.record')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-start gap-3">
        <Field label={t('purchase.payments.vendor')} className="w-full sm:w-64">
          {(p) => (
            <Select
              {...p}
              value={vendorId}
              onChange={(e) => update({ vendor: e.target.value === '' ? null : e.target.value })}
            >
              <option value="">{t('purchase.allVendors')}</option>
              {(vendors.data?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <DateRangeFields from={from} to={to} onChange={(r) => update(r)} />
      </div>
      {valid && (
        <QueryState query={payments}>
          {({ data }) =>
            data.length === 0 ? (
              <p className="text-muted-foreground">{t('purchase.payments.none')}</p>
            ) : (
              <>
                <PaymentsTable payments={data} showVendor />
                <p className="text-end text-sm">
                  {t('purchase.payments.total', {
                    count: data.length,
                    amount: money(data.reduce((s, p) => s + p.amount, 0)),
                  })}
                </p>
              </>
            )
          }
        </QueryState>
      )}
      {recording && <PaymentDialog onClose={() => setRecording(false)} />}
    </div>
  );
}

/** Payments with what each settled (a GRN or on account), method and reference. */
export function PaymentsTable({
  payments,
  showVendor,
}: {
  payments: readonly VendorPayment[];
  showVendor: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  return (
    <Table>
      <caption className="sr-only">
        {t('purchase.payments.caption', { count: payments.length })}
      </caption>
      <THead>
        <Tr>
          <Th>{t('purchase.payments.paidOn')}</Th>
          {showVendor && <Th>{t('purchase.payments.vendor')}</Th>}
          <Th>{t('purchase.payments.against')}</Th>
          <Th>{t('purchase.payments.method')}</Th>
          <Th>{t('purchase.payments.reference')}</Th>
          <Th className="text-end">{t('purchase.payments.amount')}</Th>
        </Tr>
      </THead>
      <TBody>
        {payments.map((p) => (
          <Tr key={p.id}>
            <Td className="whitespace-nowrap">
              {day(p.paidOn)}
              {p.createdByName !== null && (
                <span className="block text-xs text-muted-foreground">{p.createdByName}</span>
              )}
            </Td>
            {showVendor && (
              <Td>
                <Link
                  to={`/purchase/vendors/${p.vendorId}`}
                  className="break-words text-primary underline-offset-2 hover:underline"
                >
                  {p.vendorName}
                </Link>
              </Td>
            )}
            <Td>
              {p.grnId === null || p.grnNo === null ? (
                <span className="text-muted-foreground">{t('purchase.payments.onAccount')}</span>
              ) : (
                <Link
                  to={`/purchase/grns/${p.grnId}`}
                  className="break-all text-primary underline-offset-2 hover:underline"
                >
                  {p.grnNo}
                </Link>
              )}
            </Td>
            <Td className="whitespace-nowrap">{t(`purchase.paymentMethods.${p.method}`)}</Td>
            <Td className="break-all">{p.reference ?? t('reports.none')}</Td>
            <Td className="text-end font-medium whitespace-nowrap tabular-nums">
              {money(p.amount)}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
