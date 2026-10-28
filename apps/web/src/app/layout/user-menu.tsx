import { Button, CircleUserRound, LogOut } from '@restroos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useAuthStore, useSession } from '../../features/auth/auth-store';
import { ThemeSwitcher } from '../../features/theme/theme-switcher';
import { DigitsSwitcher } from '../../i18n/digits-switcher';
import { initialsOf } from '../../lib/initials';

const POPOVER_ID = 'user-menu';

function closeMenu() {
  document.getElementById(POPOVER_ID)?.hidePopover?.();
}

/**
 * Who is signed in, display preferences, my account and switch user.
 * Native popover API: light dismiss, Esc, top layer.
 */
export function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  if (session === null) return null;

  async function switchUser() {
    closeMenu();
    await useAuthStore.getState().logout();
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'setup' });
    void navigate('/login', { replace: true });
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="rounded-full font-semibold"
        popoverTarget={POPOVER_ID}
        aria-label={t('user.menu', { name: session.user.fullName })}
      >
        {initialsOf(session.user.fullName)}
      </Button>
      <div
        id={POPOVER_ID}
        popover="auto"
        className="fixed inset-auto end-3 top-18 m-0 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-surface p-4 text-surface-foreground shadow-lg"
      >
        <p className="font-semibold">{session.user.fullName}</p>
        <p className="text-sm text-muted-foreground">{session.branch.name}</p>
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm font-medium">{t('theme.label')}</p>
          <ThemeSwitcher />
          <DigitsSwitcher />
          <Button asChild variant="outline" className="mt-2 w-full">
            <Link to="/account" onClick={closeMenu}>
              <CircleUserRound aria-hidden="true" />
              {t('user.account')}
            </Link>
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => void switchUser()}>
            <LogOut aria-hidden="true" />
            {t('user.switch')}
          </Button>
        </div>
      </div>
    </>
  );
}
