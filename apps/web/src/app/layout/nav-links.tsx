import { cn } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useSessionStore } from '../../stores/session-store';
import { navPortals } from '../portals';

/**
 * Portal links filtered by the signed-in user's permissions.
 * `side`: icon over label on tablets (rail), side by side from `lg` (desktop).
 * `bar`: the phone bottom bar. Labels wrap rather than truncate.
 */
export function NavLinks({ variant }: { variant: 'side' | 'bar' }) {
  const { t } = useTranslation();
  const user = useSessionStore((s) => s.user);

  return (
    <ul className={cn('flex', variant === 'bar' ? 'flex-row' : 'flex-col gap-1')}>
      {navPortals(user).map((p) => {
        const Icon = p.icon;
        return (
          <li key={p.id} className={cn(variant === 'bar' && 'min-w-18 flex-1')}>
            <NavLink
              to={p.path}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch rounded-lg font-medium transition-colors duration-150',
                  'flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs leading-tight',
                  variant === 'side' &&
                    'lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-start lg:text-base',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon aria-hidden="true" className="size-6 shrink-0" />
              <span className="break-words">{t(p.navKey)}</span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}
