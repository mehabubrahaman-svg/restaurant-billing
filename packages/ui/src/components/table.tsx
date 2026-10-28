import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/**
 * Scrolls sideways inside its own box on narrow screens instead of widening the page.
 * `relative` matters: it contains absolutely positioned children (e.g. sr-only
 * header text), which would otherwise escape the scroll box and widen the page.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-x-auto rounded-xl border bg-surface">
      <table className={cn('w-full border-collapse text-start text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted text-muted-foreground', className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&>tr]:border-t', className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('align-top', className)} {...props} />;
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('px-3 py-2.5 text-start text-xs font-semibold whitespace-nowrap', className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5', className)} {...props} />;
}
