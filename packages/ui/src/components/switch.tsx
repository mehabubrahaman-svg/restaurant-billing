import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../lib/cn';

export type SwitchProps = Omit<ComponentProps<'button'>, 'onChange' | 'children' | 'role'> & {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly description?: ReactNode;
};

/** On/off toggle with `role="switch"`. The label row is the hit target. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  ...props
}: SwitchProps) {
  const id = useId();
  return (
    <div className={cn('flex min-h-touch items-center justify-between gap-4', className)}>
      <label
        htmlFor={id}
        className={cn('flex min-w-0 flex-col gap-0.5', disabled === true && 'opacity-60')}
      >
        <span className="font-medium">{label}</span>
        {description !== undefined && (
          <span className="text-sm text-muted-foreground">{description}</span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors duration-150',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-primary bg-primary' : 'border-input bg-muted',
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-6 rounded-full bg-surface shadow transition-transform duration-150',
            checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-0.5 rtl:-translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
