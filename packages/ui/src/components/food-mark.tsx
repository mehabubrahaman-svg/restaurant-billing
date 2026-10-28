import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** Food types that carry a mark. Items with no declaration ("NA") show none. */
export type FoodMarkType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';

/*
 * The marks Indian menus and packs use (FSSAI): a square outline with a
 * green dot for vegetarian and a brown triangle for non-vegetarian. Egg has
 * no statutory mark; the common convention is an amber egg shape. Vegan
 * gets a green "V". Every mark differs in shape as well as colour, so they
 * are told apart without colour, and always carry a text label.
 *
 * The colours are fixed (they are regulatory marks, not theme colours) and
 * the mark sits on its own white tile so it reads on dark themes too.
 */
const COLOURS: Record<FoodMarkType, string> = {
  VEG: '#0f7b0f',
  NON_VEG: '#7b3f00',
  EGG: '#b7791f',
  VEGAN: '#0f7b0f',
};

export type FoodMarkProps = Omit<ComponentProps<'svg'>, 'children'> & {
  readonly type: FoodMarkType;
  /** Translated name, e.g. "Veg". Read out by screen readers and shown as a tooltip. */
  readonly label: string;
  readonly size?: 'sm' | 'md' | 'lg';
};

export function FoodMark({ type, label, size = 'md', className, ...props }: FoodMarkProps) {
  const colour = COLOURS[type];
  return (
    <svg
      role="img"
      aria-label={label}
      data-food={type}
      viewBox="0 0 16 16"
      className={cn(
        'inline-block shrink-0',
        size === 'sm' && 'size-3.5',
        size === 'md' && 'size-4',
        size === 'lg' && 'size-6',
        className,
      )}
      {...props}
    >
      <title>{label}</title>
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="2"
        fill="#fff"
        stroke={colour}
        strokeWidth="1.6"
      />
      {type === 'VEG' && <circle cx="8" cy="8" r="3.6" fill={colour} />}
      {type === 'NON_VEG' && <path d="M8 3.6 12.4 11.8H3.6Z" fill={colour} />}
      {type === 'EGG' && <ellipse cx="8" cy="8.3" rx="3" ry="4" fill={colour} />}
      {type === 'VEGAN' && (
        <path
          d="M4.6 4.4 8 11.8l3.4-7.4"
          fill="none"
          stroke={colour}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
