import type { GrnSummary, Vendor, VendorPayment, VendorStatement } from '@restroos/contracts';
import {
  Alert,
  ArrowLeft,
  Banknote,
  Button,
  Card,
  Pencil,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import {
  invalidatePurchasing,
  PURCHASING_KEYS,
  useGrns,
  usePurchaseErrorMessage,
  useVendor,
  useVendorPayments,
  useVendorStatement,
} from '../../features/purchasing/purchasing-queries';
import { monthStart, useDayFormat } from '../../features/reports/use-day-format';
import { toast } from '../../features/toast/toast-store';
import { localIsoDate } from '../pos/bills-page';
import { DateRangeFields, rangeValid } from '../accounts/date-range';
import { PaymentDialog } from './payment-dialog';
import { PaymentsTable } from './payments-page';
import { Facts, useMoney, useTerms } from './purchase-ui';
import { useInputTaxHint, VendorDialog } from './vendor-dialog';

/** /purchase/vendors/:vendorId: one vendor's details, open bills, statement and payments. */
export function VendorPage() {
  const { vendorId = '' } = useParams();
  const vendor = useVendor(vendorId);
  return <QueryState query={vendor}>{(v) => <VendorDetail vendor={v} />}</QueryState>;
}

function VendorDetail({ vendor }: { vendor: Vendor }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = usePurchaseErrorMessage();
  const money = useMoney();
  const terms = useTerms();
  const taxHint = useInputTaxHint();
  const canManage = usePermission('vendors.manage');
  const canPay = usePermission('vendor_payments.create');
  const [dialog, setDialog] = useState<'edit' | 'retire' | { pay: GrnSummary | null } | null>(null);

  const setActive = useMutation({
    mutationFn: (isActive: boolean) =>
      api.purchasing.updateVendor(vendor.id, { version: vendor.version, isActive }),
    onSuccess: (saved) => {
      queryClient.setQueryData(PURCHASING_KEYS.vendor(saved.id), saved);
      void invalidatePurchasing(queryClient);
      toast(
        saved.isActive
          ? t('purchase.vendors.restored', { name: saved.name })
          : t('purchase.vendors.retired', { name: saved.name }),
      );
      setDialog(null);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/purchase/vendors"
        className="flex min-h-touch items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('purchase.vendors.back')}
      </Link>
      <AdminHeader
        title={vendor.name}
        description={vendor.code}
        actions={
          <>
            {canPay && (
              <Button onClick={() => setDialog({ pay: null })}>
                <Banknote aria-hidden="true" />
                {t('purchase.payments.record')}
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Button>
            )}
            {canManage && (
              <Button
                variant={vendor.isActive ? 'outline' : 'secondary'}
                disabled={setActive.isPending}
                onClick={() => (vendor.isActive ? setDialog('retire') : setActive.mutate(true))}
              >
                {vendor.isActive ? t('common.retire') : t('common.restore')}
              </Button>
            )}
          </>
        }
      />
      {!vendor.isActive && <Alert tone="warning">{t('purchase.vendors.retiredNote')}</Alert>}
      {setActive.isError && dialog === null && (
        <Alert tone="danger" role="alert">
          {errorMessage(setActive.error)}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">
            {vendor.due < 0 ? t('purchase.vendors.advanceLabel') : t('purchase.vendors.owed')}
          </span>
          <span className="text-xl font-bold break-words tabular-nums">
            {money(Math.abs(vendor.due))}
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">{t('purchase.vendors.terms')}</span>
          <span className="text-xl font-bold break-words">{terms(vendor.paymentTermsDays)}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">{t('purchase.vendors.gstin')}</span>
          <span className="font-mono text-lg font-bold break-all">
            {vendor.taxId ?? t('purchase.vendors.unregistered')}
          </span>
          <span className="text-xs text-muted-foreground">{taxHint(vendor.taxId ?? '')}</span>
        </Card>
      </div>
      <Card className="p-4">
        <Facts
          rows={[
            [t('purchase.vendors.contact'), vendor.contactPerson ?? t('reports.none')],
            [t('purchase.vendors.phone'), vendor.phone ?? t('reports.none')],
            [t('purchase.vendors.email'), vendor.email ?? t('reports.none')],
            [t('purchase.vendors.address'), vendor.address ?? t('reports.none')],
          ]}
        />
      </Card>

      <OpenBills
        vendorId={vendor.id}
        due={vendor.due}
        canPay={canPay}
        onPay={(grn) => setDialog({ pay: grn })}
      />
      <Statement vendorId={vendor.id} />
      <section aria-labelledby="vendor-payments" className="flex flex-col gap-2">
        <h2 id="vendor-payments" className="text-lg font-semibold">
          {t('purchase.vendors.payments')}
        </h2>
        <VendorPayments vendorId={vendor.id} />
      </section>

      {dialog === 'edit' && <VendorDialog vendor={vendor} onClose={() => setDialog(null)} />}
      {dialog === 'retire' && (
        <ConfirmDialog
          title={t('purchase.vendors.retireTitle', { name: vendor.name })}
          body={t('purchase.vendors.retireBody')}
          confirmLabel={t('common.retire')}
          destructive
          busy={setActive.isPending}
          error={setActive.isError ? errorMessage(setActive.error) : null}
          onConfirm={() => setActive.mutate(false)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog !== null && typeof dialog === 'object' && (
        <PaymentDialog vendorId={vendor.id} grn={dialog.pay} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/**
 * Posted GRNs that still owe something, oldest due first. A bill's balance
 * counts only the payments made against it, so money paid on account is
 * shown under them, to add up to what is owed.
 */
function OpenBills({
  vendorId,
  due,
  canPay,
  onPay,
}: {
  vendorId: string;
  due: number;
  canPay: boolean;
  onPay: (grn: GrnSummary) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  const grns = useGrns({ vendorId, status: 'POSTED' });
  return (
    <section aria-labelledby="vendor-bills" className="flex flex-col gap-2">
      <h2 id="vendor-bills" className="text-lg font-semibold">
        {t('purchase.vendors.openBills')}
      </h2>
      <QueryState query={grns}>
        {({ data }) => {
          const open = data
            .filter((g) => g.balance > 0)
            .sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''));
          if (open.length === 0)
            return <p className="text-muted-foreground">{t('purchase.vendors.noOpenBills')}</p>;
          const onAccount = open.reduce((sum, g) => sum + g.balance, 0) - due;
          return (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('purchase.grns.number')}</Th>
                  <Th>{t('purchase.grns.vendorBill')}</Th>
                  <Th>{t('purchase.grns.dueOn')}</Th>
                  <Th className="text-end">{t('purchase.totals.total')}</Th>
                  <Th className="text-end">{t('purchase.totals.balance')}</Th>
                  {canPay && (
                    <Th>
                      <span className="sr-only">{t('purchase.actions')}</span>
                    </Th>
                  )}
                </Tr>
              </THead>
              <TBody>
                {open.map((g) => (
                  <Tr key={g.id}>
                    <Td>
                      <Link
                        to={`/purchase/grns/${g.id}`}
                        className="font-medium break-all text-primary underline-offset-2 hover:underline"
                      >
                        {g.grnNo}
                      </Link>
                    </Td>
                    <Td className="break-words">{g.vendorInvoiceNo ?? t('reports.none')}</Td>
                    <Td className="whitespace-nowrap">
                      {g.dueOn === null ? t('reports.none') : day(g.dueOn)}
                    </Td>
                    <Td className="text-end whitespace-nowrap tabular-nums">
                      {money(g.grandTotal)}
                    </Td>
                    <Td className="text-end font-semibold whitespace-nowrap tabular-nums">
                      {money(g.balance)}
                    </Td>
                    {canPay && (
                      <Td className="text-end">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t('purchase.payments.payBill', { grn: g.grnNo })}
                          onClick={() => onPay(g)}
                        >
                          {t('purchase.payments.pay')}
                        </Button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
              {onAccount > 0 && (
                <tfoot className="border-t-2 bg-muted">
                  <Tr>
                    <Th scope="row" colSpan={4} className="font-normal">
                      {t('purchase.vendors.onAccountCredit')}
                    </Th>
                    <Td className="text-end whitespace-nowrap tabular-nums">{money(-onAccount)}</Td>
                    {canPay && <Td />}
                  </Tr>
                  <Tr>
                    <Th scope="row" colSpan={4}>
                      {due < 0 ? t('purchase.vendors.advanceLabel') : t('purchase.vendors.owed')}
                    </Th>
                    <Td className="text-end font-semibold whitespace-nowrap tabular-nums">
                      {money(Math.abs(due))}
                    </Td>
                    {canPay && <Td />}
                  </Tr>
                </tfoot>
              )}
            </Table>
          );
        }}
      </QueryState>
    </section>
  );
}

function Statement({ vendorId }: { vendorId: string }) {
  const { t } = useTranslation();
  const today = localIsoDate();
  const [range, setRange] = useState({ from: monthStart(today), to: today });
  const valid = rangeValid(range.from, range.to);
  const statement = useVendorStatement(vendorId, range.from, range.to, valid);
  // The statement's own descriptions are the Hub's English; these give the words in the user's language.
  const payments = useVendorPayments({ vendorId });
  const bills = useGrns({ vendorId, status: 'POSTED' });
  return (
    <section aria-labelledby="vendor-statement" className="flex flex-col gap-3">
      <h2 id="vendor-statement" className="text-lg font-semibold">
        {t('purchase.statement.title')}
      </h2>
      <DateRangeFields from={range.from} to={range.to} onChange={setRange} />
      {valid && (
        <QueryState query={statement}>
          {(s) => (
            <StatementTable
              statement={s}
              payments={payments.data?.data ?? []}
              bills={bills.data?.data ?? []}
            />
          )}
        </QueryState>
      )}
    </section>
  );
}

function StatementTable({
  statement: s,
  payments,
  bills,
}: {
  statement: VendorStatement;
  payments: readonly VendorPayment[];
  bills: readonly GrnSummary[];
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const day = useDayFormat();
  const balance = (paise: number) =>
    paise < 0 ? t('purchase.vendors.advance', { amount: money(-paise) }) : money(paise);
  const particulars = (e: VendorStatement['entries'][number]) => {
    if (e.kind === 'BILL') {
      const bill = bills.find((b) => b.id === e.id);
      return (
        <>
          <Link
            to={`/purchase/grns/${e.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {t('purchase.statement.bill', { number: e.number ?? '' })}
          </Link>
          {bill !== undefined && bill.vendorInvoiceNo !== null && (
            <span className="block text-xs text-muted-foreground">
              {t('purchase.statement.vendorBill', { number: bill.vendorInvoiceNo })}
            </span>
          )}
        </>
      );
    }
    const payment = payments.find((p) => p.id === e.id);
    if (payment === undefined) return e.description;
    const method = t(`purchase.paymentMethods.${payment.method}`);
    return (
      <>
        {payment.grnNo === null
          ? t('purchase.statement.paidOnAccount', { method })
          : t('purchase.statement.paidAgainst', { method, grn: payment.grnNo })}
        {payment.reference !== null && (
          <span className="block text-xs text-muted-foreground">{payment.reference}</span>
        )}
      </>
    );
  };
  return (
    <Table>
      <caption className="sr-only">
        {t('purchase.statement.caption', { from: day(s.from), to: day(s.to) })}
      </caption>
      <THead>
        <Tr>
          <Th>{t('purchase.statement.date')}</Th>
          <Th>{t('purchase.statement.particulars')}</Th>
          <Th className="text-end">{t('purchase.statement.bills')}</Th>
          <Th className="text-end">{t('purchase.statement.paid')}</Th>
          <Th className="text-end">{t('purchase.statement.balance')}</Th>
        </Tr>
      </THead>
      <TBody>
        <Tr className="bg-muted/40">
          <Td className="whitespace-nowrap">{day(s.from)}</Td>
          <Td className="font-medium">{t('purchase.statement.opening')}</Td>
          <Td />
          <Td />
          <Td className="text-end font-medium whitespace-nowrap tabular-nums">
            {balance(s.openingBalance)}
          </Td>
        </Tr>
        {s.entries.map((e) => (
          <Tr key={`${e.kind}-${e.id}`}>
            <Td className="whitespace-nowrap">{day(e.date)}</Td>
            <Td className="break-words">{particulars(e)}</Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {e.credit === 0 ? '' : money(e.credit)}
            </Td>
            <Td className="text-end whitespace-nowrap tabular-nums">
              {e.debit === 0 ? '' : money(e.debit)}
            </Td>
            <Td className="text-end whitespace-nowrap tabular-nums">{balance(e.balance)}</Td>
          </Tr>
        ))}
        <Tr className="bg-muted/40">
          <Td className="whitespace-nowrap">{day(s.to)}</Td>
          <Td className="font-semibold">{t('purchase.statement.closing')}</Td>
          <Td />
          <Td />
          <Td className="text-end font-semibold whitespace-nowrap tabular-nums">
            {balance(s.closingBalance)}
          </Td>
        </Tr>
      </TBody>
    </Table>
  );
}

function VendorPayments({ vendorId }: { vendorId: string }) {
  const { t } = useTranslation();
  const payments = useVendorPayments({ vendorId });
  return (
    <QueryState query={payments}>
      {({ data }) =>
        data.length === 0 ? (
          <p className="text-muted-foreground">{t('purchase.payments.empty')}</p>
        ) : (
          <PaymentsTable payments={data} showVendor={false} />
        )
      }
    </QueryState>
  );
}
