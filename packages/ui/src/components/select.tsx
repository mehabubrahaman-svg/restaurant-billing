import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** Native select (best on touch devices), styled like Input. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        className={cn(
          'min-h-touch w-full appearance-none rounded-lg border border-input bg-surface py-2 ps-3 pe-10 text-base text-surface-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
