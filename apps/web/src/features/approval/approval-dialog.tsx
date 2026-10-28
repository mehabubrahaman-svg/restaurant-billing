import type { PinUser } from '@restroos/contracts';
import { Alert, Button, cn, Dialog, Spinner } from '@restroos/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { PinPad } from '../auth/pin-pad';
import { usePinEntry } from '../auth/use-pin-entry';
import { permissionLabel } from '../admin/roles/permission-labels';
import { useApprovalStore } from './approval-store';

/** Mounted once at the root; opens whenever `requestApproval()` is pending. */
export function ApprovalDialog() {
  const pending = useApprovalStore((s) => s.pending);
  if (pending === null) return null;
  return (
    <ApprovalDialogBody
      key={pending.permission}
      permission={pending.permission}
      onDone={pending.resolve}
    />
  );
}

function ApprovalDialogBody({
  permission,
  onDone,
}: {
  permission: string;
  onDone: (approval: Awaited<ReturnType<typeof api.auth.approve>> | null) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const users = useQuery({ queryKey: ['auth', 'pin-users'], queryFn: api.auth.pinUsers });
  const [approver, setApprover] = useState<PinUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pin = usePinEntry();

  async function submit() {
    if (approver === null || !pin.complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.auth.approve({ userId: approver.id, pin: pin.pin, permission }));
    } catch (e) {
      setError(errorMessage(e));
      pin.clear();
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => onDone(null)}
      dismissible={!busy}
      closeLabel={t('common.close')}
      title={t('approval.title')}
      description={t('approval.description', { action: permissionLabel(t, permission) })}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('approval.chooseManager')}</h3>
          {users.isPending && <Spinner label={t('common.loading')} />}
          {users.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(users.error)}
            </Alert>
          )}
          <ul className="flex flex-wrap gap-2">
            {users.data?.data.map((u) => (
              <li key={u.id}>
                <Button
                  variant="outline"
                  aria-pressed={approver?.id === u.id}
                  className={cn(approver?.id === u.id && 'ring-2 ring-primary')}
                  onClick={() => {
                    setApprover(u);
                    pin.clear();
                  }}
                >
                  <span className="font-semibold">{u.initials}</span>
                  <span>{u.fullName}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
        {approver !== null && (
          <section className="flex flex-col items-center gap-3">
            <p className="font-medium">{t('login.pinFor', { name: approver.fullName })}</p>
            {error !== null && (
              <Alert tone="danger" role="alert" className="w-full">
                {error}
              </Alert>
            )}
            <PinPad
              entered={pin.pin.length}
              length={pin.length}
              canSubmit={pin.complete && !busy}
              onDigit={pin.press}
              onBackspace={pin.backspace}
              onSubmit={() => void submit()}
              submitLabel={t('approval.approve')}
              listenToKeyboard
            />
          </section>
        )}
      </div>
    </Dialog>
  );
}
