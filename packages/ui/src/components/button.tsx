import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/**
 * Text may wrap rather than being clipped: Hindi and Bengali labels are often
 * 30–40% longer than English, and a wrapped label beats a truncated one.
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-center leading-tight font-medium',
    'transition-[color,background-color,border-color,transform] duration-150 motion-safe:active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        outline:
          'border border-input bg-surface text-surface-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        /** Dense desktop-only controls. Never use on touch screens. */
        sm: 'min-h-9 px-3 text-sm',
        /** Default: the 48 px minimum touch target. */
        touch: 'min-h-touch min-w-touch px-4 text-base',
        lg: 'min-h-14 px-6 text-lg',
        /** Kitchen display: 56 px, readable at arm's length. */
        kds: 'min-h-kds min-w-kds px-6 text-lg font-semibold',
        /** Square icon-only button; give it an aria-label. */
        icon: 'size-touch',
      },
    },
    defaultVariants: { variant: 'primary', size: 'touch' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (e.g. a router link) with button styling. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot className={classes} {...props} />;
  // Default to type="button" so a button inside a form never submits by accident.
  return <button type={type ?? 'button'} className={classes} {...props} />;
}
