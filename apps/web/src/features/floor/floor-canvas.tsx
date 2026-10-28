import { LAYOUT_GRID } from '@restroos/contracts';
import { cn } from '@restroos/ui';
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { FOOTPRINT, type Cell } from './layout-math';
import type { TableShape } from '../../api/endpoints';

/** Percent box for a table at `cell` (the canvas keeps the grid's 3:2 aspect ratio). */
export function tileStyle(cell: Cell, shape: TableShape): CSSProperties {
  const size = FOOTPRINT[shape];
  return {
    left: `${(cell.posX / LAYOUT_GRID.columns) * 100}%`,
    top: `${(cell.posY / LAYOUT_GRID.rows) * 100}%`,
    width: `${(size.w / LAYOUT_GRID.columns) * 100}%`,
    height: `${(size.h / LAYOUT_GRID.rows) * 100}%`,
  };
}

/** Rounded corners per shape: round tables are circles, booths have a straight back. */
export const SHAPE_CLASSES: Readonly<Record<TableShape, string>> = {
  SQUARE: 'rounded-lg',
  ROUND: 'rounded-full',
  RECT: 'rounded-lg',
  BOOTH: 'rounded-b-lg rounded-t-3xl',
};

/**
 * The floor plan surface: a LAYOUT_GRID-proportioned box with faint cell
 * lines (`showGrid`), tiles absolutely positioned in percent so the plan
 * scales with the screen.
 */
export const FloorCanvas = forwardRef<
  HTMLDivElement,
  { label: string; showGrid?: boolean; children: ReactNode; className?: string; id?: string }
>(function FloorCanvas({ label, showGrid = false, children, className, id }, ref) {
  return (
    <div
      ref={ref}
      id={id}
      role="group"
      aria-label={label}
      className={cn(
        'relative w-full overflow-hidden rounded-xl border bg-surface select-none',
        className,
      )}
      style={{
        aspectRatio: `${LAYOUT_GRID.columns} / ${LAYOUT_GRID.rows}`,
        ...(showGrid
          ? {
              backgroundImage:
                'linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)',
              backgroundSize: `calc(100% / ${LAYOUT_GRID.columns}) calc(100% / ${LAYOUT_GRID.rows})`,
            }
          : {}),
      }}
    >
      {children}
    </div>
  );
});
