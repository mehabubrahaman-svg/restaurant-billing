import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  /** Visible content (text and/or icon). */
  readonly label: ReactNode;
  /** Accessible name when `label` is an abbreviation or icon, e.g. "हिन्दी" for "हि". */
  readonly ariaLabel?: string;
  /** BCP-47 tag of the label's language, so screen readers pronounce it correctly. */
  readonly lang?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  /** Accessible name of the whole group. */
  readonly 'aria-label': string;
  readonly size?: 'sm' | 'touch';
  readonly className?: string;
}

/**
 * A single-choice button group (radio group semantics) for small sets such as
 * language or theme. Arrow keys move and select, like native radio buttons;
 * left/right are mirrored in right-to-left layouts.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = 'touch',
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function select(index: number) {
    const count = options.length;
    const next = ((index % count) + count) % count;
    const option = options[next];
    if (option === undefined) return;
    onValueChange(option.value);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = event.currentTarget.closest('[dir="rtl"]') !== null;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    switch (event.key) {
      case forward:
      case 'ArrowDown':
        select(selectedIndex + 1);
        break;
      case backward:
      case 'ArrowUp':
        select(selectedIndex - 1);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(options.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex shrink-0 rounded-lg border border-input bg-surface p-0.5',
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            lang={option.lang}
            tabIndex={checked ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 font-medium leading-none',
              'transition-colors duration-150 [&_svg]:size-5 [&_svg]:shrink-0',
              size === 'sm' ? 'min-h-8 min-w-8 text-sm' : 'min-h-touch min-w-touch text-base',
              checked
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
