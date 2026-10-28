import { cn } from '@restroos/ui';

/** Order-pad tile colours offered for categories: distinct, and readable behind dark text. */
export const CATEGORY_COLOURS = [
  '#F97316',
  '#EAB308',
  '#84CC16',
  '#22C55E',
  '#14B8A6',
  '#0EA5E9',
  '#6366F1',
  '#A855F7',
  '#EC4899',
  '#EF4444',
  '#A16207',
  '#64748B',
] as const;

/** A category's colour dot; a dashed ring when it has none. Decorative (the name is shown). */
export function CategorySwatch({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-4 shrink-0 rounded-full border',
        color === null && 'border-dashed border-muted-foreground',
        className,
      )}
      style={color === null ? undefined : { backgroundColor: color, borderColor: color }}
    />
  );
}
