import { cn, Keyboard } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** A key cap, e.g. F9. Key names are the same in every language. */
export function Kbd({ children, inverted = false }: { children: ReactNode; inverted?: boolean }) {
  return (
    <kbd
      className={cn(
        'rounded border px-1 font-mono text-[0.7rem] leading-4 font-medium',
        inverted
          ? 'border-primary-foreground/50 text-primary-foreground'
          : 'border-input bg-muted text-muted-foreground',
      )}
    >
      {children}
    </kbd>
  );
}

const SHORTCUTS = [
  ['F2', 'search'],
  ['F4', 'discount'],
  ['F6', 'card'],
  ['F7', 'upi'],
  ['F8', 'cash'],
  ['F9', 'settle'],
  ['Enter', 'confirm'],
  ['Esc', 'back'],
] as const;

/** The counter's keyboard shortcuts, always on screen (wireframes §7). */
export function ShortcutBar({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('pos.keys.title')}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground print:hidden',
        className,
      )}
    >
      <Keyboard aria-hidden="true" className="size-4" />
      <ul className="contents">
        {SHORTCUTS.map(([key, action]) => (
          <li key={key} className="flex items-center gap-1">
            <Kbd>{key}</Kbd>
            <span>{t(`pos.keys.${action}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Key names are not translated. */
export const SETTLE_KEY = 'F9';
