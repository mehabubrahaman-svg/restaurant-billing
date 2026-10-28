import { Button, Field, Input } from '@restroos/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

export function PasswordLogin({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (username: string, password: string) => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (username.trim() === '' || password === '') return;
    onSubmit(username.trim(), password);
  }

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={submit} noValidate>
      <Field label={t('login.username')}>
        {(p) => (
          <Input
            {...p}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            data-autofocus
          />
        )}
      </Field>
      <Field label={t('login.password')}>
        {(p) => (
          <Input
            {...p}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        )}
      </Field>
      <Button type="submit" disabled={busy || username.trim() === '' || password === ''}>
        {busy ? t('login.signingIn') : t('login.submit')}
      </Button>
    </form>
  );
}
