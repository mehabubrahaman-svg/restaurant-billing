import type { Invoice } from '@restroos/contracts';
import { Alert, Button, Dialog, Field, Textarea } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { withApproval } from '../../features/approval/with-approval';
import { setInvoice } from '../../features/billing/billing-queries';
import { ORDER_KEYS } from '../../features/orders/order-queries';
import { useErrorMessage } from '../../lib/errors';

const QUICK = ['changeItems', 'wrongBill', 'discount', 'guestLeft'] as const;

/**
 * Cancels bills (with a manager's approval unless the cashier holds
 * billing.cancel). An unpaid bill reopens its order so items can change and
 * it can be billed again; the numbers stay used, marked cancelled.
 */
export function CancelBillDialog({
  invoices,
  onClose,
  onCancelled,
}: {
  /** One invoice, or the INV + LIQ pair of one order. */
  invoices: readonly Invoice[];
  onClose: () => void;
  onCancelled: (invoices: Invoice[]) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const cancel = useMutation({
    mutationFn: async () => {
      // Cancelling either bill of an INV + LIQ pair cancels both on the Hub.
      const first = invoices[0]!;
      const cancelled = await withApproval((approverToken) =>
        api.billing.cancel(
          first.id,
          { version: first.version, reason: reason.trim() },
          approverToken === undefined ? {} : { approverToken },
        ),
      );
      setInvoice(queryClient, cancelled);
      return [cancelled];
    },
    onSuccess: (results) => {
      for (const id of new Set(invoices.map((i) => i.orderId))) {
        void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.detail(id) });
      }
      void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.open });
      void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.billed });
      onCancelled(results);
    },
  });

  function submit() {
    const ok = reason.trim().length >= 3;
    setInvalid(!ok);
    if (ok) cancel.mutate();
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!cancel.isPending}
      closeLabel={t('common.close')}
      title={t('pos.cancelBill.title', { count: invoices.length })}
      description={t('pos.cancelBill.description', {
        numbers: invoices.map((i) => i.invoiceNo).join(', '),
      })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            {t('pos.cancelBill.keep')}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending ? t('common.saving') : t('pos.cancelBill.confirm')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t('pos.cancelBill.reason')}
          error={invalid ? t('pos.discount.reasonRequired') : undefined}
          required
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('pos.discount.quick')}>
          {QUICK.map((q) => (
            <Button
              key={q}
              size="sm"
              variant="outline"
              aria-pressed={reason === t(`pos.cancelBill.reasons.${q}`)}
              onClick={() => setReason(t(`pos.cancelBill.reasons.${q}`))}
            >
              {t(`pos.cancelBill.reasons.${q}`)}
            </Button>
          ))}
        </div>
        {invoices.some((i) => i.paidTotal > 0) && (
          <Alert tone="warning">{t('pos.cancelBill.paidWarning')}</Alert>
        )}
        {cancel.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(cancel.error)}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
