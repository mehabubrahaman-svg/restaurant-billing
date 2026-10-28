import { cn } from '@restroos/ui';
import { useId } from 'react';

export interface Bar {
  readonly key: string;
  /** Any unit (paise); only the ratio to the largest bar is drawn. */
  readonly value: number;
  /** Short axis label under the bar ("28"). */
  readonly label: string;
  /** What a screen reader (and the hover tip) says: "28 Oct: ₹1,040.00, 2 bills". */
  readonly description: string;
  readonly highlight?: boolean;
}

/**
 * A plain CSS column chart: one bar per entry, scaled to the largest. The
 * numbers are in a list for screen readers; the bars themselves are decoration.
 */
export function BarChart({
  title,
  bars,
  className,
}: {
  title: string;
  bars: readonly Bar[];
  className?: string;
}) {
  const id = useId();
  const max = Math.max(0, ...bars.map((b) => b.value));
  // With one bar picked out (today), the rest are lighter; otherwise all are solid.
  const anyHighlight = bars.some((b) => b.highlight === true);
  return (
    <figure aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <figcaption id={id} className="font-semibold">
        {title}
      </figcaption>
      <ol className="flex h-40 items-stretch gap-0.5 border-b sm:gap-1">
        {bars.map((bar) => {
          const pct = max === 0 ? 0 : Math.max((bar.value / max) * 100, bar.value > 0 ? 2 : 0);
          return (
            <li key={bar.key} className="flex min-w-0 flex-1 flex-col justify-end">
              <span className="sr-only">{bar.description}</span>
              <span
                aria-hidden="true"
                title={bar.description}
                data-value={bar.value}
                className={cn(
                  'block w-full rounded-t-sm',
                  !anyHighlight || bar.highlight === true ? 'bg-primary' : 'bg-primary/45',
                )}
                style={{ height: `${pct}%` }}
              />
            </li>
          );
        })}
      </ol>
      <div aria-hidden="true" className="flex gap-0.5 sm:gap-1">
        {bars.map((bar) => (
          <span
            key={bar.key}
            className={cn(
              'min-w-0 flex-1 truncate text-center text-xs text-muted-foreground tabular-nums',
              bar.highlight === true && 'font-semibold text-foreground',
            )}
          >
            {bar.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
