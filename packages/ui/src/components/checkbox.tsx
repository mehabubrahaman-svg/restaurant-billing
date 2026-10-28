import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** The "some but not all" state, e.g. a module-level select-all. */
  readonly indeterminate?: boolean;
};

/** A native checkbox whose whole label row is the (48 px tall) hit target. */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  className,
  disabled,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cn(
        'flex min-h-touch cursor-pointer items-start gap-3 rounded-lg py-2.5 select-none',
        disabled === true && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className="mt-0.5 size-5 shrink-0 cursor-[inherit] accent-primary"
        {...props}
      />
      <span className="flex min-w-0 flex-col gap-0.5 leading-snug">
        <span>{label}</span>
        {description !== undefined && (
          <span className="text-sm text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  );
}
