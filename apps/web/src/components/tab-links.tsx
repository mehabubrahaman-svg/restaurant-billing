import { cn, type LucideIcon } from '@restroos/ui';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface TabLink {
  readonly to: string;
  readonly label: string;
  readonly icon?: LucideIcon;
  /** Match the path exactly (for an index tab). */
  readonly end?: boolean;
  /** Shown after the label, e.g. a count of what needs attention. */
  readonly badge?: ReactNode;
}

/** A scrollable strip of route tabs, styled like the admin section tabs. */
export function TabLinks({ label, tabs }: { label: string; tabs: readonly TabLink[] }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 print:hidden">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end ?? false}
                className={({ isActive }) =>
                  cn(
                    '-mb-px flex min-h-touch items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {Icon !== undefined && <Icon aria-hidden="true" className="size-4" />}
                {tab.label}
                {tab.badge}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
