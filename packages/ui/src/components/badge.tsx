import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs leading-normal font-medium [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        primary: 'border-transparent bg-primary text-primary-foreground',
        outline: 'text-foreground',
        success: 'border-state-available bg-state-available-soft text-state-available-fg',
        warning: 'border-state-reserved bg-state-reserved-soft text-state-reserved-fg',
        danger: 'border-state-danger bg-state-danger-soft text-state-danger-fg',
        info: 'border-state-occupied bg-state-occupied-soft text-state-occupied-fg',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
