import {
  cn,
  Spinner,
  LayoutDashboard,
  Percent,
  Printer,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from '@restroos/ui';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useSession } from '../auth/auth-store';
import { hasPermission, type PermissionRequirement } from '../auth/permissions';

export interface AdminSection {
  readonly path: string;
  readonly icon: LucideIcon;
  readonly labelKey:
    | 'admin.tabs.overview'
    | 'admin.tabs.users'
    | 'admin.tabs.roles'
    | 'admin.tabs.branch'
    | 'admin.tabs.taxes'
    | 'admin.tabs.charges'
    | 'admin.tabs.printers'
    | 'admin.tabs.audit';
  readonly permission: PermissionRequirement;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    path: '',
    icon: LayoutDashboard,
    labelKey: 'admin.tabs.overview',
    permission: 'dashboard.view',
  },
  { path: 'users', icon: Users, labelKey: 'admin.tabs.users', permission: 'users.manage' },
  {
    path: 'roles',
    icon: ShieldCheck,
    labelKey: 'admin.tabs.roles',
    permission: ['roles.manage', 'users.manage'],
  },
  { path: 'branch', icon: Settings, labelKey: 'admin.tabs.branch', permission: 'settings.manage' },
  { path: 'taxes', icon: Percent, labelKey: 'admin.tabs.taxes', permission: 'settings.manage' },
  { path: 'charges', icon: Receipt, labelKey: 'admin.tabs.charges', permission: 'settings.manage' },
  {
    path: 'printers',
    icon: Printer,
    labelKey: 'admin.tabs.printers',
    permission: 'settings.manage',
  },
  { path: 'audit', icon: ScrollText, labelKey: 'admin.tabs.audit', permission: 'audit.view' },
];

/** /admin/*: a scrollable tab strip of the sections this user may open. */
export function AdminLayout() {
  const { t } = useTranslation();
  const session = useSession();
  const sections = ADMIN_SECTIONS.filter((s) => hasPermission(session, s.permission));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <nav aria-label={t('admin.label')} className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.path}>
                <NavLink
                  to={s.path === '' ? '/admin' : `/admin/${s.path}`}
                  end={s.path === ''}
                  className={({ isActive }) =>
                    cn(
                      '-mb-px flex min-h-touch items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                      isActive
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {t(s.labelKey)}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

/** Page heading used by every admin section. */
export function AdminHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <title>{`${title} · ${t('app.name')}`}</title>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description !== undefined && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
