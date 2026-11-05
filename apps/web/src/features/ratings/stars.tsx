import { cn, Star } from '@restroos/ui';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * One to five stars, as a radio group: arrow keys move between them, and a
 * screen reader says "4 stars". Tapping the chosen star again keeps it.
 */
export function StarInput({
  legend,
  value,
  onChange,
  size = 'md',
}: {
  legend: ReactNode;
  value: number | null;
  onChange: (stars: number) => void;
  size?: 'md' | 'lg';
}) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-medium break-words">{legend}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={cn(
              'grid cursor-pointer place-items-center rounded-lg has-focus-visible:ring-2 has-focus-visible:ring-ring',
              size === 'lg' ? 'size-12' : 'size-touch',
            )}
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
              aria-label={t('ratings.stars', { count: n })}
            />
            <Star
              aria-hidden="true"
              className={cn(
                size === 'lg' ? 'size-9' : 'size-7',
                value !== null && n <= value
                  ? 'fill-state-reserved text-state-reserved'
                  : 'text-muted-foreground/50',
              )}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "★ 4.6 (12)": a dish's counted stars, as the menu shows them. */
export function StarScore({
  average,
  count,
  className,
}: {
  average: number;
  count: number;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      className={cn('inline-flex items-center gap-1 text-sm font-semibold', className)}
      aria-label={t('ratings.score', { average, count })}
    >
      <Star aria-hidden="true" className="size-4 fill-state-reserved text-state-reserved" />
      <span aria-hidden="true" className="tabular-nums">
        {average.toFixed(1)}
      </span>
      <span aria-hidden="true" className="font-normal text-muted-foreground tabular-nums">
        ({count})
      </span>
    </span>
  );
}

/** A guest's stars, shown: five marks with the given number filled. */
export function StarRow({ stars, className }: { stars: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('ratings.stars', { count: stars })}
      className={cn('inline-flex shrink-0 gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={cn(
            'size-4',
            n <= stars ? 'fill-state-reserved text-state-reserved' : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}
