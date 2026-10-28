import type { Invoice } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  SegmentedControl,
  Stepper,
  Textarea,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api, type RefundBody, type RefundMethod } from '../../api/endpoints';
import { withApproval } from '../../features/approval/with-approval';
import { setInvoice } from '../../features/billing/billing-queries';
import { requestOpenShift } from '../../features/billing/shift-prompt';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { rupeesToPaise } from '../../lib/units';

const METHODS: readonly RefundMethod[] = ['CASH', 'CARD', 'UPI', 'WALLET'];

/** Units of each order item already returned on earlier credit notes. */
export function refundedUnits(creditNotes: readonly Invoice[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const cn of creditNotes) {
    for (const line of cn.lines) {
      if (line.orderItemId === null) continue;
      out.set(line.orderItemId, (out.get(line.orderItemId) ?? 0) + Math.abs(line.quantity));
    }
  }
  return out;
}

/**
 * Refund (credit note): some lines by quantity, or a flat amount, paid back
 * by cash, card, UPI or wallet. Needs billing.refund or a manager's approval;
 * cash needs an open shift.
 */
export function RefundDialog({
  invoice,
  creditNotes,
  onClose,
  onRefunded,
}: {
  invoice: Invoice;
  creditNotes: readonly Invoice[];
  onClose: () => void;
  onRefunded: (creditNote: Invoice) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const done = useMemo(() => refundedUnits(creditNotes), [creditNotes]);
  const [mode, setMode] = useState<'LINES' | 'AMOUNT'>('LINES');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RefundMethod>(() => {
    const biggest = [...invoice.payments]
      .filter((p) => p.amount > 0)
      .sort((a, b) => b.amount - a.amount)[0]?.method;
    return METHODS.includes(biggest as RefundMethod) ? (biggest as RefundMethod) : 'CASH';
  });
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ pick?: string; amount?: string; reason?: string }>({});
  const key = useRef<{ body: string; key: string } | null>(null);

  const left = (lineId: string, orderItemId: string | null, quantity: number) =>
    Math.max(0, quantity - (orderItemId === null ? 0 : (done.get(orderItemId) ?? 0)));
  const picked = invoice.lines.filter((l) => (qty[l.id] ?? 0) > 0);
  // What the picked lines come to with their share of discount and tax; the Hub has the final word.
  const estimate = picked.reduce((sum, l) => {
    const q = qty[l.id] ?? 0;
    return sum + Money.ofPaise(l.lineTotal).allocate([q, l.quantity - q])[0]!.paise;
  }, 0);
  const maxAmount = Math.max(0, invoice.paidTotal);

  const refund = useMutation({
    mutationFn: async (body: RefundBody) => {
      const text = JSON.stringify(body);
      if (key.current?.body !== text) key.current = { body: text, key: newIdempotencyKey() };
      const idempotencyKey = key.current.key;
      const send = () =>
        withApproval((approverToken) =>
          api.billing.refund(invoice.id, body, {
            idempotencyKey,
            ...(approverToken === undefined ? {} : { approverToken }),
          }),
        );
      try {
        return await send();
      } catch (error) {
        if (!isApiError(error, 'SHIFT_NOT_OPEN') || !(await requestOpenShift())) throw error;
        return send();
      }
    },
    onSuccess: ({ creditNote, invoice: updated }) => {
      setInvoice(queryClient, updated);
      setInvoice(queryClient, creditNote);
      onRefunded(creditNote);
    },
  });

  function submit() {
    const found: typeof errors = {};
    let body: RefundBody | null = null;
    const why = reason.trim();
    if (why.length < 3) found.reason = t('pos.discount.reasonRequired');
    const ref = reference.trim();
    const common = { method, reason: why, ...(ref === '' ? {} : { reference: ref }) };
    if (mode === 'LINES') {
      if (picked.length === 0) found.pick = t('pos.refund.pickLines');
      else
        body = {
          ...common,
          lines: picked.map((l) => ({ invoiceLineId: l.id, quantity: qty[l.id]! })),
        };
    } else {
      const paise = rupeesToPaise(amount);
      if (paise === null || paise <= 0 || paise > maxAmount) {
        found.amount = t('pos.refund.amountInvalid', { max: money(maxAmount) });
      } else body = { ...common, amount: paise };
    }
    setErrors(found);
    if (body !== null && Object.keys(found).length === 0) refund.mutate(body);
  }

  return (
    <Dialog
      open
      size="md"
      onClose={onClose}
      dismissible={!refund.isPending}
      closeLabel={t('common.close')}
      title={t('pos.refund.title', { number: invoice.invoiceNo })}
      description={t('pos.refund.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={refund.isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={refund.isPending}>
            {refund.isPending
              ? t('common.saving')
              : mode === 'LINES'
                ? t('pos.refund.confirmEstimate', { amount: money(estimate) })
                : t('pos.refund.confirm')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SegmentedControl<'LINES' | 'AMOUNT'>
          aria-label={t('pos.refund.mode')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'LINES', label: t('pos.refund.byLines') },
            { value: 'AMOUNT', label: t('pos.refund.byAmount') },
          ]}
        />
        {mode === 'LINES' ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('pos.refund.lines')}</legend>
            <ul className="flex flex-col divide-y">
              {invoice.lines.map((l) => {
                const max = left(l.id, l.orderItemId, l.quantity);
                const value = qty[l.id] ?? 0;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block">{l.description}</span>
                      <span className="block text-sm text-muted-foreground">
                        {max < l.quantity
                          ? t('pos.refund.lineLeft', { left: max, quantity: l.quantity })
                          : t('pos.refund.lineQty', {
                              quantity: l.quantity,
                              amount: money(l.lineTotal),
                            })}
                      </span>
                    </span>
                    <Stepper
                      value={value}
                      min={0}
                      max={max}
                      disabled={max === 0}
                      display={format.number(value)}
                      decrementLabel={t('pos.refund.less', { name: l.description })}
                      incrementLabel={t('pos.refund.more', { name: l.description })}
                      onValueChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                    />
                  </li>
                );
              })}
            </ul>
            {errors.pick !== undefined && (
              <p className="text-sm font-medium text-state-danger-fg" role="alert">
                {errors.pick}
              </p>
            )}
            {picked.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('pos.refund.estimate', { amount: money(estimate) })}
              </p>
            )}
          </fieldset>
        ) : (
          <Field
            label={t('pos.refund.amount')}
            hint={t('pos.refund.amountHint', { max: money(maxAmount) })}
            error={errors.amount}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id="refund-method">
            {t('pos.refund.method')}
          </span>
          <SegmentedControl<RefundMethod>
            aria-label={t('pos.refund.method')}
            className="flex-wrap"
            value={method}
            onValueChange={setMethod}
            options={METHODS.map((m) => ({ value: m, label: t(`pos.tenders.${m}`) }))}
          />
        </div>
        {method !== 'CASH' && (
          <Field label={t('pos.refund.reference')}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={40}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label={t('pos.refund.reason')} error={errors.reason} required>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {refund.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(refund.error)}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
