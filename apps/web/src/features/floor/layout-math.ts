import { LAYOUT_GRID } from '@restroos/contracts';
import type { LayoutMove, TableShape } from '../../api/endpoints';

/**
 * Pure geometry for the floor plan. Positions are whole cells on the
 * LAYOUT_GRID (48 × 32); a table's top-left cell is (posX, posY).
 */
export interface Grid {
  readonly columns: number;
  readonly rows: number;
}
export interface Cell {
  readonly posX: number;
  readonly posY: number;
}
export interface Size {
  readonly w: number;
  readonly h: number;
}

/** How many cells each shape covers. Only the editor and floor views use this. */
export const FOOTPRINT: Readonly<Record<TableShape, Size>> = {
  SQUARE: { w: 4, h: 4 },
  ROUND: { w: 4, h: 4 },
  RECT: { w: 6, h: 4 },
  BOOTH: { w: 6, h: 3 },
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Keeps the whole table inside the grid. */
export function clampCell(cell: Cell, size: Size, grid: Grid = LAYOUT_GRID): Cell {
  return {
    posX: clamp(Math.round(cell.posX), 0, Math.max(0, grid.columns - size.w)),
    posY: clamp(Math.round(cell.posY), 0, Math.max(0, grid.rows - size.h)),
  };
}

/**
 * Where a drag lands: the start cell plus the pointer's movement in whole
 * cells (rounded to the nearest cell = snap), kept inside the grid.
 */
export function snapDrag(
  start: Cell,
  deltaPx: { readonly dx: number; readonly dy: number },
  cellPx: { readonly w: number; readonly h: number },
  size: Size,
  grid: Grid = LAYOUT_GRID,
): Cell {
  if (cellPx.w <= 0 || cellPx.h <= 0) return clampCell(start, size, grid);
  return clampCell(
    {
      posX: start.posX + Math.round(deltaPx.dx / cellPx.w),
      posY: start.posY + Math.round(deltaPx.dy / cellPx.h),
    },
    size,
    grid,
  );
}

/** Keyboard move by whole cells. */
export function moveBy(cell: Cell, dx: number, dy: number, size: Size, grid: Grid = LAYOUT_GRID) {
  return clampCell({ posX: cell.posX + dx, posY: cell.posY + dy }, size, grid);
}

/** Arrow key → cell step (Shift moves 4 cells); null for any other key. */
export function arrowStep(key: string, shift: boolean): { dx: number; dy: number } | null {
  const n = shift ? 4 : 1;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -n, dy: 0 };
    case 'ArrowRight':
      return { dx: n, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -n };
    case 'ArrowDown':
      return { dx: 0, dy: n };
    default:
      return null;
  }
}

export interface Placed extends Cell {
  readonly id: string;
  readonly shape: TableShape;
}

export function overlaps(a: Placed, b: Placed): boolean {
  const sa = FOOTPRINT[a.shape];
  const sb = FOOTPRINT[b.shape];
  return (
    a.posX < b.posX + sb.w &&
    b.posX < a.posX + sa.w &&
    a.posY < b.posY + sb.h &&
    b.posY < a.posY + sa.h
  );
}

/** Ids of tables that sit on top of another table in the same area. */
export function findOverlaps(tables: readonly Placed[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      if (overlaps(tables[i]!, tables[j]!)) {
        out.add(tables[i]!.id);
        out.add(tables[j]!.id);
      }
    }
  }
  return out;
}

/** The first spot, row by row, where a new table fits with a one-cell gap around it. */
export function firstFreeCell(
  tables: readonly Placed[],
  shape: TableShape,
  grid: Grid = LAYOUT_GRID,
): Cell {
  const size = FOOTPRINT[shape];
  const padded = (t: Placed) => ({ ...t, posX: t.posX - 1, posY: t.posY - 1 });
  for (let y = 1; y + size.h <= grid.rows; y += 1) {
    for (let x = 1; x + size.w <= grid.columns; x += 1) {
      const candidate: Placed = { id: '', posX: x, posY: y, shape };
      const blocked = tables.some((t) => {
        const s = FOOTPRINT[t.shape];
        const p = padded(t);
        return (
          candidate.posX < p.posX + s.w + 2 &&
          p.posX < candidate.posX + size.w &&
          candidate.posY < p.posY + s.h + 2 &&
          p.posY < candidate.posY + size.h
        );
      });
      if (!blocked) return { posX: x, posY: y };
    }
  }
  return { posX: 0, posY: 0 };
}

/** The moves to send to PUT /floor/layout: draft positions that differ from the saved ones. */
export function layoutChanges(
  tables: readonly (Cell & { readonly id: string; readonly version: number })[],
  draft: Readonly<Record<string, Cell>>,
): LayoutMove[] {
  const moves: LayoutMove[] = [];
  for (const table of tables) {
    const moved = draft[table.id];
    if (moved === undefined) continue;
    if (moved.posX === table.posX && moved.posY === table.posY) continue;
    moves.push({ id: table.id, posX: moved.posX, posY: moved.posY, version: table.version });
  }
  return moves;
}
