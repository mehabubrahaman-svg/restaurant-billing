import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface StepperProps {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  /** Shown between the buttons; defaults to the number (pass formatted digits for hi/bn). */
  readonly display?: ReactNode;
  /** Accessible names, e.g. "One less Butter Naan" / "One more Butter Naan". */
  readonly decrementLabel: string;
  readonly incrementLabel: string;
  /** Lowest value the − button goes to. 0 lets − remove a line (the caller decides). */
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
  readonly size?: 'touch' | 'lg';
  readonly className?: string;
}

/**
 * − n + quantity control with 48 px (56 px for `lg`) buttons. Name the
 * buttons after the line ("One more Butter Naan") so they make sense on
 * their own to a screen reader.
 */
export function Stepper({
  value,
  onValueChange,
  display,
  decrementLabel,
  incrementLabel,
  min = 1,
  max = 99,
  disabled = false,
  size = 'touch',
  className,
}: StepperProps) {
  const button = cn(
    'grid shrink-0 place-items-center rounded-lg border border-input bg-surface text-surface-foreground',
    'transition-colors duration-150 hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
    size === 'lg' ? 'size-14' : 'size-touch',
  );
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <button
        type="button"
        aria-label={decrementLabel}
        className={button}
        disabled={disabled || value <= min}
        onClick={() => onValueChange(Math.max(min, value - 1))}
      >
        <Minus aria-hidden="true" className="size-5" />
      </button>
      <span
        className={cn(
          'min-w-8 text-center font-semibold tabular-nums',
          size === 'lg' ? 'text-xl' : 'text-lg',
        )}
      >
        {display ?? value}
      </span>
      <button
        type="button"
        aria-label={incrementLabel}
        className={button}
        disabled={disabled || value >= max}
        onClick={() => onValueChange(Math.min(max, value + 1))}
      >
        <Plus aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
