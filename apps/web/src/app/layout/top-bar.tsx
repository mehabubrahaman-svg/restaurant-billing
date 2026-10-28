import { MapPin, Store } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ConnectionPill } from '../../features/connection/connection-pill';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { useSession } from '../../features/auth/auth-store';
import { useHomePath } from '../use-home-path';
import { UserMenu } from './user-menu';

/** Wireframes §2: brand, branch, connection pill, language, user. Wraps instead of overflowing. */
export function TopBar() {
  const { t } = useTranslation();
  const home = useHomePath();
  const session = useSession();

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-3 py-2 md:px-4">
      <Link
        to={home}
        className="flex min-h-touch items-center gap-2 rounded-lg pe-1 text-lg font-bold"
      >
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Store aria-hidden="true" className="size-5" />
        </span>
        <span className="max-sm:sr-only">{t('app.name')}</span>
      </Link>

      {/* The signed-in branch. People with several branches switch at sign-in. */}
      <p
        className="hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm lg:flex"
        title={t('app.branchLabel')}
      >
        <MapPin aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span>{session?.branch.name ?? t('app.branch')}</span>
      </p>

      <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
        <ConnectionPill />
        <LanguageSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
