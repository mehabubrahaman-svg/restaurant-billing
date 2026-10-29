import type { GrnSummary, VendorPaymentMethod } from '@restroos/contracts';
import { Alert, Button, Dialog, Field, Input, SegmentedControl, Select } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { newIdempotencyKey } from '../../api/client';
import { api, type VendorPaymentBody } from '../../api/endpoints';
import { isCalendarDay } from '../../features/accounting/calendar-day';
import {
  invalidatePurchasing,
  useGrns,
  usePurchaseErrorMessage,
  useVendors,
} from '../../features/purchasing/purchasing-queries';
import { toast } from '../../features/toast/toast-store';
import { PriceField } from '../../features/menu/price-field';
import { paiseToRupees, rupeesToPaise } from '../../lib/units';
import { localIsoDate } from '../pos/bills-page';
import { PAYMENT_METHODS, useMoney } from './purchase-ui';

/** '' in the "against" picker: on account, settling the oldest bills first. */
const ON_ACCOUNT = '';

/**
 * Records a payment to a vendor: against one posted GRN (at most what it still
 * owes) or on account. Opened from a GRN, from a vendor, or on its own.
 */
export function PaymentDialog({
  vendorId: fixedVendor = null,
  grn = null,
  onClose,
}: {
  /** The vendor, when opened from their page. */
  vendorId?: string | null;
  /** The bill, when opened from a GRN: vendor and bill are then fixed. */
  grn?: GrnSummary | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = usePurchaseErrorMessage();
  const money = useMoney();
  const today = localIsoDate();
  const [vendorId, setVendorId] = useState(grn?.vendorId ?? fixedVendor ?? '');
  const [grnId, setGrnId] = useState(grn?.id ?? ON_ACCOUNT);
  const [method, setMethod] = useState<VendorPaymentMethod>('BANK');
  const [amount, setAmount] = useState(grn === null ? '' : paiseToRupees(grn.balance));
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [errors, setErrors] = useState<Partial<Record<'vendor' | 'amount' | 'date', string>>>({});
  const key = useRef<{ body: string; key: string } | null>(null);

  const vendors = useVendors();
  const bills = useGrns({ vendorId, status: 'POSTED' }, grn === null && vendorId !== '');
  const open = (bills.data?.data ?? []).filter((b) => b.balance > 0);
  const bill = grn ?? open.find((b) => b.id === grnId) ?? null;
  const vendorName =
    grn?.vendorName ?? vendors.data?.data.find((v) => v.id === vendorId)?.name ?? '';

  const pay = useMutation({
    mutationFn: async (body: VendorPaymentBody) => {
      const text = JSON.stringify(body);
      if (key.current?.body !== text) key.current = { body: text, key: newIdempotencyKey() };
      return api.purchasing.recordPayment(body, { idempotencyKey: key.current.key });
    },
    onSuccess: (payment) => {
      void invalidatePurchasing(queryClient);
      toast(
        t('purchase.payments.recorded', {
          amount: money(payment.amount),
          vendor: payment.vendorName,
        }),
      );
      onClose();
    },
  });

  function submit() {
    const found: typeof errors = {};
    const paise = rupeesToPaise(amount);
    if (vendorId === '') found.vendor = t('purchase.payments.vendorRequired');
    if (paise === null || paise <= 0) found.amount = t('validation.amount');
    else if (bill !== null && paise > bill.balance)
      found.amount = t('purchase.payments.overBalance', { amount: money(bill.balance) });
    if (!isCalendarDay(paidOn) || paidOn > today) found.date = t('purchase.payments.dateError');
    setErrors(found);
    if (Object.keys(found).length > 0 || paise === null) return;
    pay.mutate({
      vendorId,
      grnId: bill?.id ?? null,
      method,
      amount: paise,
      reference: reference.trim() === '' ? null : reference.trim(),
      paidOn,
    });
  }

  const referenceLabel = t(`purchase.payments.referenceFor.${method}`);

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!pay.isPending}
      closeLabel={t('common.close')}
      title={t('purchase.payments.record')}
      {...(vendorName === ''
        ? {}
        : {
            description:
              grn === null
                ? vendorName
                : t('purchase.payments.forBill', {
                    vendor: vendorName,
                    grn: grn.grnNo,
                    balance: money(grn.balance),
                  }),
          })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pay.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="vendor-payment-form" disabled={pay.isPending}>
            {pay.isPending ? t('common.saving') : t('purchase.payments.save')}
          </Button>
        </>
      }
    >
      <form
        id="vendor-payment-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {pay.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(pay.error)}
          </Alert>
        )}
        {grn === null && fixedVendor === null && (
          <Field label={t('purchase.payments.vendor')} required error={errors.vendor}>
            {(p) => (
              <Select
                {...p}
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  setGrnId(ON_ACCOUNT);
                }}
              >
                <option value="" disabled>
                  {t('purchase.payments.chooseVendor')}
                </option>
                {(vendors.data?.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.due > 0
                      ? t('purchase.payments.vendorOption', { name: v.name, due: money(v.due) })
                      : v.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {grn === null && (
          <Field label={t('purchase.payments.against')} hint={t('purchase.payments.againstHint')}>
            {(p) => (
              <Select
                {...p}
                value={grnId}
                disabled={vendorId === ''}
                onChange={(e) => {
                  setGrnId(e.target.value);
                  const picked = open.find((b) => b.id === e.target.value);
                  if (picked !== undefined) setAmount(paiseToRupees(picked.balance));
                }}
              >
                <option value={ON_ACCOUNT}>{t('purchase.payments.onAccount')}</option>
                {open.map((b) => (
                  <option key={b.id} value={b.id}>
                    {t('purchase.payments.billOption', {
                      grn: b.grnNo,
                      balance: money(b.balance),
                    })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('purchase.payments.method')}</span>
          <SegmentedControl<VendorPaymentMethod>
            aria-label={t('purchase.payments.method')}
            value={method}
            onValueChange={setMethod}
            options={PAYMENT_METHODS.map((m) => ({
              value: m,
              label: t(`purchase.paymentMethods.${m}`),
            }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PriceField
            label={t('purchase.payments.amount')}
            value={amount}
            onChange={setAmount}
            error={errors.amount}
            required
          />
          <Field label={t('purchase.payments.paidOn')} required error={errors.date}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={paidOn}
                max={today}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={referenceLabel} hint={t('common.optional')}>
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              maxLength={60}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
