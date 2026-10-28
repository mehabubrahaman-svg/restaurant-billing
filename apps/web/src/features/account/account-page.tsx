import { PasswordSchema } from '@restroos/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@restroos/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { toast } from '../toast/toast-store';
import { useSession } from '../auth/auth-store';

/** My account: who I am, and change my own password. */
export function AccountPage() {
  const { t } = useTranslation();
  const session = useSession();
  const errorMessage = useErrorMessage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextError = !PasswordSchema.safeParse(next).success ? t('validation.passwordShort') : null;
  const confirmError = confirm !== next ? t('validation.passwordsDiffer') : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (current === '' || nextError !== null || confirmError !== null) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSubmitted(false);
      toast(t('account.passwordChanged'));
    } catch (e) {
      setError(isApiError(e, 'INVALID_CREDENTIALS') ? t('account.wrongCurrent') : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (session === null) return null;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <title>{t('user.account')}</title>
      <header>
        <h1 className="text-2xl font-bold">{t('user.account')}</h1>
        <p className="text-muted-foreground">
          {t('account.signedInAs', {
            name: session.user.fullName,
            username: session.user.username,
          })}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t('account.changePassword')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            {error !== null && (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            )}
            <Field
              label={t('account.currentPassword')}
              required
              error={submitted && current === '' ? t('validation.required') : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('account.newPassword')}
              hint={t('validation.passwordHint')}
              required
              error={submitted ? nextError : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('account.confirmPassword')}
              required
              error={submitted ? confirmError : undefined}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" disabled={busy} className="self-start">
              {busy ? t('common.saving') : t('account.changePassword')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
