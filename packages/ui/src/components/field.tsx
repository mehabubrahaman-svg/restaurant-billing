import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Props a form control needs so its label, hint and error are announced with it. */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly required?: true;
}

export interface FieldProps {
  readonly label: ReactNode;
  /** Help text under the control. */
  readonly hint?: ReactNode;
  /** Validation message; also marks the control `aria-invalid`. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  /** Renders the control with the wiring props spread onto it. */
  readonly children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label + control + hint + error, with ids wired up for screen readers.
 * Errors are shown as text (with the control's red border), never by colour alone.
 */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const describedBy = [hint !== undefined ? hintId : null, hasError ? errorId : null]
    .filter((v) => v !== null)
    .join(' ');

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required === true && (
          <span aria-hidden="true" className="ms-0.5 text-state-danger-fg">
            *
          </span>
        )}
      </label>
      {children({
        id,
        ...(describedBy !== '' ? { 'aria-describedby': describedBy } : {}),
        ...(hasError ? { 'aria-invalid': true as const } : {}),
        ...(required === true ? { required: true as const } : {}),
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-sm font-medium text-state-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
