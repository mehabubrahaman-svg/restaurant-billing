import { PasswordSchema, PinSchema, type User } from '@restroos/contracts';
import { Alert, Button, Field, Input, KeyRound, LockOpen, RotateCcw } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useErrorMessage } from '../../../lib/errors';
import { isWeakPin } from '../../../lib/pin';
import { toast } from '../../toast/toast-store';
import { isLocked } from './user-status';

type Panel = 'password' | 'pin' | null;

/** Reset password / PIN, unlock, deactivate / reactivate. */
export function UserActions({ user, onDone }: { user: User; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [panel, setPanel] = useState<Panel>(null);
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const action = useMutation({
    mutationFn: async (kind: 'password' | 'pin' | 'unlock' | 'deactivate' | 'reactivate') => {
      if (kind === 'password') await api.users.resetPassword(user.id, secret);
      if (kind === 'pin') await api.users.resetPin(user.id, secret);
      if (kind === 'unlock') await api.users.unlock(user.id);
      if (kind === 'deactivate') await api.users.deactivate(user.id);
      if (kind === 'reactivate') await api.users.reactivate(user.id);
      return kind;
    },
    onSuccess: (kind) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      const messages = {
        password: t('users.done.password'),
        pin: t('users.done.pin'),
        unlock: t('users.done.unlock'),
        deactivate: t('users.done.deactivate'),
        reactivate: t('users.done.reactivate'),
      };
      toast(messages[kind]);
      onDone();
    },
  });

  const secretError =
    panel === 'password'
      ? PasswordSchema.safeParse(secret).success
        ? null
        : t('validation.passwordShort')
      : !PinSchema.safeParse(secret).success
        ? t('validation.pinFormat')
        : isWeakPin(secret)
          ? t('validation.pinWeak')
          : null;
  const confirmError =
    confirm === secret
      ? null
      : panel === 'pin'
        ? t('validation.pinsDiffer')
        : t('validation.passwordsDiffer');

  function open(p: Panel) {
    setPanel(p);
    setSecret('');
    setConfirm('');
    setSubmitted(false);
  }

  function submitSecret() {
    setSubmitted(true);
    if (panel !== null && secretError === null && confirmError === null) action.mutate(panel);
  }

  const isPin = panel === 'pin';
  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{t('users.accountActions')}</h3>
      {action.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(action.error)}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => open('password')}
          aria-expanded={panel === 'password'}
        >
          <KeyRound aria-hidden="true" />
          {t('users.resetPassword')}
        </Button>
        <Button variant="outline" onClick={() => open('pin')} aria-expanded={panel === 'pin'}>
          <RotateCcw aria-hidden="true" />
          {t('users.resetPin')}
        </Button>
        {isLocked(user) && (
          <Button
            variant="outline"
            onClick={() => action.mutate('unlock')}
            disabled={action.isPending}
          >
            <LockOpen aria-hidden="true" />
            {t('users.unlock')}
          </Button>
        )}
        {user.isActive ? (
          <Button
            variant="destructive"
            onClick={() => action.mutate('deactivate')}
            disabled={action.isPending}
          >
            {t('users.deactivate')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => action.mutate('reactivate')}
            disabled={action.isPending}
          >
            {t('users.reactivate')}
          </Button>
        )}
      </div>
      {panel !== null && (
        <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-2">
          <Field
            label={isPin ? t('users.newPin') : t('account.newPassword')}
            hint={isPin ? t('validation.pinFormat') : t('validation.passwordHint')}
            error={submitted ? secretError : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete={isPin ? 'off' : 'new-password'}
                inputMode={isPin ? 'numeric' : 'text'}
                maxLength={isPin ? 6 : 256}
                value={secret}
                onChange={(e) =>
                  setSecret(isPin ? e.target.value.replace(/\D/g, '') : e.target.value)
                }
              />
            )}
          </Field>
          <Field
            label={isPin ? t('setup.admin.pinConfirm') : t('account.confirmPassword')}
            error={submitted ? confirmError : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="off"
                inputMode={isPin ? 'numeric' : 'text'}
                maxLength={isPin ? 6 : 256}
                value={confirm}
                onChange={(e) =>
                  setConfirm(isPin ? e.target.value.replace(/\D/g, '') : e.target.value)
                }
              />
            )}
          </Field>
          <div className="flex gap-2 md:col-span-2">
            <Button onClick={submitSecret} disabled={action.isPending}>
              {isPin ? t('users.resetPin') : t('users.resetPassword')}
            </Button>
            <Button variant="ghost" onClick={() => open(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
