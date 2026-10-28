import type { PinUser } from '@restroos/contracts';
import { Button, cn, Spinner } from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PinPad } from './pin-pad';
import { usePinEntry } from './use-pin-entry';

/** Wireframes §3: tiles of the people who use this Hub, then their PIN. */
export function PinLogin({
  users,
  loading,
  busy,
  onSubmit,
}: {
  users: readonly PinUser[];
  loading: boolean;
  busy: boolean;
  onSubmit: (userId: string, pin: string, reset: () => void) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const pin = usePinEntry();
  const user = users.find((u) => u.id === selected) ?? (users.length === 1 ? users[0] : undefined);

  if (loading) return <Spinner label={t('common.loading')} />;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <section className="flex w-full flex-col items-center gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('login.whoIsThis')}</h2>
        <ul className="flex max-h-56 flex-wrap justify-center gap-3 overflow-y-auto p-1">
          {users.map((u) => (
            <li key={u.id} className="flex w-20 flex-col items-center gap-1">
              <Button
                variant="outline"
                className={cn(
                  'size-16 rounded-full text-lg font-semibold',
                  user?.id === u.id && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                )}
                aria-pressed={user?.id === u.id}
                aria-label={u.fullName}
                onClick={() => {
                  setSelected(u.id);
                  pin.clear();
                }}
              >
                {u.initials}
              </Button>
              <span aria-hidden="true" className="text-center text-xs leading-tight break-words">
                {u.fullName}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {user === undefined ? (
        <p className="text-muted-foreground">{t('login.chooseUser')}</p>
      ) : (
        <>
          <p className="font-medium">{t('login.pinFor', { name: user.fullName })}</p>
          <PinPad
            entered={pin.pin.length}
            length={pin.length}
            canSubmit={pin.complete && !busy}
            onDigit={pin.press}
            onBackspace={pin.backspace}
            onSubmit={() => {
              if (pin.complete && !busy) onSubmit(user.id, pin.pin, pin.clear);
            }}
            listenToKeyboard
          />
        </>
      )}
    </div>
  );
}
