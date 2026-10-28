import type { ShiftReport } from '@restroos/contracts';
import { Alert, Button, Dialog, Field, Input } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { usePermission } from '../../features/auth/permissions';
import { BILLING_KEYS } from '../../features/billing/billing-queries';
import { useShiftPrompt } from '../../features/billing/shift-prompt';
import { useErrorMessage } from '../../lib/errors';
import { rupeesToPaise } from '../../lib/units';

/** Opening float form; used on the shift page and in the "open a shift first" prompt. */
export function OpenShiftForm({
  onOpened,
  autoFocus = false,
}: {
  onOpened: (shift: ShiftReport) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [float, setFloat] = useState('');
  const [invalid, setInvalid] = useState(false);
  const key = useRef(newIdempotencyKey());

  const open = useMutation({
    mutationFn: async () => {
      const paise = rupeesToPaise(float === '' ? '0' : float);
      setInvalid(paise === null);
      if (paise === null) return null;
      try {
        return await api.cashShifts.open(paise, { idempotencyKey: key.current });
      } catch (error) {
        // Someone opened it a moment ago (another tab): use that one.
        if (isApiError(error, 'SHIFT_ALREADY_OPEN')) return api.cashShifts.current();
        throw error;
      }
    },
    onSuccess: (shift) => {
      if (shift === null) return;
      queryClient.setQueryData(BILLING_KEYS.currentShift, shift);
      queryClient.setQueryData(BILLING_KEYS.shift(shift.id), shift);
      key.current = newIdempotencyKey();
      onOpened(shift);
    },
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        open.mutate();
      }}
      noValidate
    >
      <Field
        label={t('pos.shift.openingFloat')}
        hint={t('pos.shift.openingFloatHint')}
        error={invalid ? t('validation.amount') : undefined}
      >
        {(p) => (
          <Input
            {...p}
            inputMode="decimal"
            autoComplete="off"
            value={float}
            placeholder="0"
            data-autofocus={autoFocus ? true : undefined}
            onChange={(e) => setFloat(e.target.value)}
          />
        )}
      </Field>
      {open.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(open.error)}
        </Alert>
      )}
      <Button type="submit" disabled={open.isPending}>
        {open.isPending ? t('common.saving') : t('pos.shift.open')}
      </Button>
    </form>
  );
}

/** Mounted once in the POS layout: opens when something calls `requestOpenShift()`. */
export function ShiftPromptDialog() {
  const { t } = useTranslation();
  const pending = useShiftPrompt((s) => s.pending);
  const canManage = usePermission('cash.shift_manage');
  if (pending === null) return null;
  return (
    <Dialog
      open
      size="sm"
      onClose={() => pending(false)}
      closeLabel={t('common.close')}
      title={t('pos.shift.promptTitle')}
      description={t('pos.shift.promptBody')}
    >
      {canManage ? (
        <OpenShiftForm autoFocus onOpened={() => pending(true)} />
      ) : (
        <Alert tone="warning">{t('pos.shift.askManager')}</Alert>
      )}
    </Dialog>
  );
}
