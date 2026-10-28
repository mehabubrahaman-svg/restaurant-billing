import type { Order, OrderItem } from '@restroos/contracts';
import { Alert, Button, Checkbox, Dialog, Field, Input } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError, newIdempotencyKey } from '../../../api/client';
import { api } from '../../../api/endpoints';
import { ApprovalCancelledError, withApproval } from '../../../features/approval/with-approval';
import { composeNote, QUICK_NOTES } from '../../../features/orders/item-options';
import { ORDER_KEYS, setOrder } from '../../../features/orders/order-queries';
import { useErrorMessage } from '../../../lib/errors';
import { NoteEditor } from './item-options-sheet';

/** Splits a saved note back into the quick-note toggles and the free text. */
function splitNote(note: string, quickTexts: readonly string[]) {
  const parts = note
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  return {
    quick: parts.filter((p) => quickTexts.includes(p)),
    free: parts.filter((p) => !quickTexts.includes(p)).join(', '),
  };
}

/** Edit the kitchen note of a line not yet sent. */
export function NoteDialog({
  name,
  note,
  onSave,
  onClose,
  busy = false,
  error = null,
}: {
  name: string;
  note: string | null;
  onSave: (note: string) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const quickTexts = QUICK_NOTES.map((k) => t(`order.note.quick.${k}`));
  const [initial] = useState(() => splitNote(note ?? '', quickTexts));
  const [quick, setQuick] = useState<readonly string[]>(initial.quick);
  const [free, setFree] = useState(initial.free);
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      closeLabel={t('common.close')}
      title={t('order.note.title', { name })}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => onSave(composeNote(quick, free))}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error !== null && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <NoteEditor quick={quick} onQuick={setQuick} free={free} onFree={setFree} />
      </div>
    </Dialog>
  );
}

const ITEM_REASONS = ['guestChanged', 'wrongItem', 'tooSlow', 'kitchenOut'] as const;
const ORDER_REASONS = ['guestLeft', 'duplicate', 'wrongTable'] as const;

/** Reason picker: quick reasons as toggles plus free text; at least 3 characters in all. */
function ReasonField<K extends string>({
  keys,
  labelOf,
  value,
  onChange,
}: {
  keys: readonly K[];
  labelOf: (key: K) => string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{t('order.cancel.reason')}</legend>
      <div className="flex flex-wrap gap-2">
        {keys.map((key) => {
          const text = labelOf(key);
          return (
            <Button
              key={key}
              variant="outline"
              aria-pressed={value === text}
              onClick={() => onChange(text)}
            >
              {text}
            </Button>
          );
        })}
      </div>
      <Field label={t('order.cancel.reasonOther')}>
        {(control) => (
          <Input
            {...control}
            value={value}
            maxLength={200}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
    </fieldset>
  );
}

/**
 * Cancel a line already sent to the kitchen: needs a reason, says whether the
 * food was made (wastage), and a manager's approval when the captain's role
 * lacks orders.item_cancel (403 APPROVAL_REQUIRED → PIN → retry).
 */
export function CancelItemDialog({
  order,
  item,
  name,
  onClose,
}: {
  order: Order;
  item: OrderItem;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const [wastage, setWastage] = useState(item.status === 'PREPARING' || item.status === 'READY');
  const valid = reason.trim().length >= 3;

  const cancel = useMutation({
    mutationFn: () =>
      withApproval((approverToken) =>
        api.orders.cancelItem(
          order.id,
          item.id,
          { version: item.version, reason: reason.trim(), isWastage: wastage },
          {
            // A fresh key per attempt: the approved retry is a new request.
            idempotencyKey: newIdempotencyKey(),
            ...(approverToken === undefined ? {} : { approverToken }),
          },
        ),
      ),
    onSuccess: (updated) => {
      setOrder(queryClient, updated);
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 'VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.detail(order.id) });
      }
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!cancel.isPending}
      closeLabel={t('common.close')}
      title={t('order.cancel.itemTitle', { name, quantity: item.quantity })}
      description={t('order.cancel.itemHint')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            {t('order.cancel.keep')}
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('order.cancel.itemConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {cancel.isError && (
          <Alert
            tone={cancel.error instanceof ApprovalCancelledError ? 'warning' : 'danger'}
            role="alert"
          >
            {errorMessage(cancel.error)}
          </Alert>
        )}
        <ReasonField
          keys={ITEM_REASONS}
          labelOf={(k) => t(`order.cancel.itemReasons.${k}`)}
          value={reason}
          onChange={setReason}
        />
        <Checkbox
          checked={wastage}
          onChange={(e) => setWastage(e.target.checked)}
          label={t('order.cancel.wastage')}
          description={t('order.cancel.wastageHint')}
        />
      </div>
    </Dialog>
  );
}

/** Cancel the whole order. Anything already sent needs orders.cancel or a manager's approval. */
export function CancelOrderDialog({
  order,
  onClose,
  onCancelled,
}: {
  order: Order;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  const sent = order.items.some((i) => i.status !== 'PENDING' && i.status !== 'CANCELLED');

  const cancel = useMutation({
    mutationFn: () =>
      withApproval((approverToken) =>
        api.orders.cancel(
          order.id,
          { version: order.version, reason: reason.trim() },
          {
            idempotencyKey: newIdempotencyKey(),
            ...(approverToken === undefined ? {} : { approverToken }),
          },
        ),
      ),
    onSuccess: (updated) => {
      setOrder(queryClient, updated);
      onCancelled();
    },
    onError: (error) => {
      if (isApiError(error, 'VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.detail(order.id) });
      }
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!cancel.isPending}
      closeLabel={t('common.close')}
      title={t('order.cancel.orderTitle', { orderNo: order.orderNo })}
      description={sent ? t('order.cancel.orderSentHint') : t('order.cancel.orderHint')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            {t('order.cancel.keepOrder')}
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('order.cancel.orderConfirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {cancel.isError && (
          <Alert
            tone={cancel.error instanceof ApprovalCancelledError ? 'warning' : 'danger'}
            role="alert"
          >
            {errorMessage(cancel.error)}
          </Alert>
        )}
        <ReasonField
          keys={ORDER_REASONS}
          labelOf={(k) => t(`order.cancel.orderReasons.${k}`)}
          value={reason}
          onChange={setReason}
        />
      </div>
    </Dialog>
  );
}
