import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type ?? 'text'}
      className={cn(
        'min-h-touch w-full min-w-0 rounded-lg border border-input bg-surface px-3 py-2 text-base text-surface-foreground',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
