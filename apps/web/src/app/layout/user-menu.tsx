import { Button } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ThemeSwitcher } from '../../features/theme/theme-switcher';
import { DigitsSwitcher } from '../../i18n/digits-switcher';
import { useSessionStore } from '../../stores/session-store';

const POPOVER_ID = 'user-menu';

/**
 * Placeholder account menu: who is signed in, display preferences and
 * "switch user". Uses the native popover API (light dismiss, Esc, top layer).
 */
export function UserMenu() {
  const { t } = useTranslation();
  const user = useSessionStore((s) => s.user);
  if (user === null) return null;

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="rounded-full font-semibold"
        popoverTarget={POPOVER_ID}
        aria-label={t('user.menu', { name: user.displayName })}
      >
        {user.initials}
      </Button>
      <div
        id={POPOVER_ID}
        popover="auto"
        className="fixed inset-auto end-3 top-18 m-0 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-surface p-4 text-surface-foreground shadow-lg"
      >
        <p className="font-semibold">{user.displayName}</p>
        <p className="text-sm text-muted-foreground">{t(`user.role.${user.role}`)}</p>
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm font-medium">{t('theme.label')}</p>
          <ThemeSwitcher />
          <DigitsSwitcher />
          <Button asChild variant="secondary" className="mt-2 w-full">
            <Link to="/login">{t('user.switch')}</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
