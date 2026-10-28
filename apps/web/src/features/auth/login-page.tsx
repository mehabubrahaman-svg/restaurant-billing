import { Button, Card, cn, Input, Plus, Store } from '@restroos/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { homePath } from '../../app/portals';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { ConnectionPill } from '../connection/connection-pill';
import { useDeviceStore } from '../../stores/device-store';
import { MOCK_USERS, useSessionStore } from '../../stores/session-store';
import { PinPad } from './pin-pad';
import { usePinEntry } from './use-pin-entry';

const OTHER = 'other';

/**
 * Shared-device PIN login (wireframes §3). UI only for now: the PIN is not
 * checked and "signing in" switches the mock session. The real call
 * (`POST /api/v1/auth/pin`) replaces `signInAs` in Sprint 2.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const device = useDeviceStore((s) => s.name);
  const kind = useDeviceStore((s) => s.kind);
  const signInAs = useSessionStore((s) => s.signInAs);
  const codeId = useId();

  const [selected, setSelected] = useState<string>(MOCK_USERS[0]?.id ?? OTHER);
  const [employeeCode, setEmployeeCode] = useState('');
  const [unknownCode, setUnknownCode] = useState(false);
  const { pin, length, complete, press, backspace, clear } = usePinEntry();

  const selectedUser = MOCK_USERS.find((u) => u.id === selected);
  const canSubmit = complete && (selectedUser !== undefined || employeeCode.trim() !== '');

  function choose(id: string) {
    setSelected(id);
    setUnknownCode(false);
    clear();
  }

  function submit() {
    if (!canSubmit) return;
    const user = selectedUser ?? MOCK_USERS.find((u) => u.employeeCode === employeeCode.trim());
    if (user === undefined || !signInAs(user.id)) {
      setUnknownCode(true);
      clear();
      return;
    }
    void navigate(homePath(user, kind), { replace: true });
  }

  // Physical keyboards and USB keypads: digits, Backspace, Enter.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') backspace();
      else if (event.key === 'Enter') submit();
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <title>{`${t('login.title')} · ${t('app.name')}`}</title>
      <Card className="flex w-full max-w-md flex-col items-center gap-6 p-6">
        <header className="flex flex-col items-center gap-1 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Store aria-hidden="true" className="size-6" />
          </span>
          <h1 className="text-2xl font-bold">{t('app.name')}</h1>
          <p className="text-muted-foreground">{t('login.device', { name: device, kind })}</p>
          <ConnectionPill className="mt-2" />
        </header>

        <section className="flex w-full flex-col items-center gap-2">
          <h2 className="sr-only">{t('login.recentUsers')}</h2>
          <ul className="flex flex-wrap justify-center gap-3">
            {MOCK_USERS.slice(0, 3).map((u) => (
              <li key={u.id}>
                <Button
                  variant="outline"
                  className={cn(
                    'size-16 rounded-full text-lg font-semibold',
                    selected === u.id && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                  )}
                  aria-pressed={selected === u.id}
                  aria-label={u.displayName}
                  onClick={() => choose(u.id)}
                >
                  {u.initials}
                </Button>
              </li>
            ))}
            <li>
              <Button
                variant="outline"
                className={cn(
                  'size-16 flex-col gap-0 rounded-full text-xs',
                  selected === OTHER && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                )}
                aria-pressed={selected === OTHER}
                onClick={() => choose(OTHER)}
              >
                <Plus aria-hidden="true" />
                {t('login.otherUser')}
              </Button>
            </li>
          </ul>
        </section>

        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {selectedUser !== undefined ? (
            <p className="font-medium">{t('login.pinFor', { name: selectedUser.shortName })}</p>
          ) : (
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <label htmlFor={codeId} className="text-sm font-medium">
                {t('login.employeeCode')}
              </label>
              <Input
                id={codeId}
                inputMode="numeric"
                autoComplete="off"
                value={employeeCode}
                aria-invalid={unknownCode}
                onChange={(e) => {
                  setEmployeeCode(e.target.value);
                  setUnknownCode(false);
                }}
              />
            </div>
          )}
          <LanguageSwitcher />
        </div>

        {unknownCode && (
          <p role="alert" className="w-full text-sm text-state-danger-fg">
            {t('login.unknownCode')}
          </p>
        )}

        <PinPad
          entered={pin.length}
          length={length}
          canSubmit={canSubmit}
          onDigit={press}
          onBackspace={backspace}
          onSubmit={submit}
        />
      </Card>
    </main>
  );
}
