import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full min-w-0 rounded-lg border border-input bg-surface px-3 py-2 text-base text-surface-foreground',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
