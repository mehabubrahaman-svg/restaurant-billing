import { describe, expect, it } from 'vitest';
import {
  arrowStep,
  clampCell,
  findOverlaps,
  firstFreeCell,
  FOOTPRINT,
  layoutChanges,
  moveBy,
  snapDrag,
} from './layout-math';

const GRID = { columns: 48, rows: 32 };
const square = FOOTPRINT.SQUARE;

describe('snapDrag', () => {
  const cellPx = { w: 20, h: 20 };

  it('snaps to the nearest whole cell', () => {
    expect(snapDrag({ posX: 5, posY: 5 }, { dx: 29, dy: 31 }, cellPx, square)).toEqual({
      posX: 6,
      posY: 7,
    });
    expect(snapDrag({ posX: 5, posY: 5 }, { dx: 9, dy: -9 }, cellPx, square)).toEqual({
      posX: 5,
      posY: 5,
    });
    expect(snapDrag({ posX: 5, posY: 5 }, { dx: -50, dy: 11 }, cellPx, square)).toEqual({
      posX: 3,
      posY: 6,
    });
  });

  it('keeps the whole table inside the grid', () => {
    expect(snapDrag({ posX: 2, posY: 2 }, { dx: -500, dy: -500 }, cellPx, square)).toEqual({
      posX: 0,
      posY: 0,
    });
    // A 6×4 table can reach column 42 at most (42 + 6 = 48).
    expect(snapDrag({ posX: 40, posY: 20 }, { dx: 900, dy: 900 }, cellPx, FOOTPRINT.RECT)).toEqual({
      posX: 42,
      posY: 28,
    });
  });

  it('uses the real cell size, also when cells are not square', () => {
    expect(snapDrag({ posX: 0, posY: 0 }, { dx: 100, dy: 100 }, { w: 25, h: 10 }, square)).toEqual({
      posX: 4,
      posY: 10,
    });
  });

  it('ignores a canvas with no size yet', () => {
    expect(snapDrag({ posX: 3, posY: 4 }, { dx: 100, dy: 100 }, { w: 0, h: 0 }, square)).toEqual({
      posX: 3,
      posY: 4,
    });
  });
});

describe('keyboard moves', () => {
  it('steps one cell, or four with Shift, and stops at the edges', () => {
    expect(arrowStep('ArrowRight', false)).toEqual({ dx: 1, dy: 0 });
    expect(arrowStep('ArrowUp', true)).toEqual({ dx: 0, dy: -4 });
    expect(arrowStep('Enter', false)).toBeNull();
    expect(moveBy({ posX: 0, posY: 0 }, -1, 0, square)).toEqual({ posX: 0, posY: 0 });
    expect(moveBy({ posX: 44, posY: 28 }, 1, 1, square)).toEqual({ posX: 44, posY: 28 });
    expect(moveBy({ posX: 10, posY: 10 }, 4, -4, square)).toEqual({ posX: 14, posY: 6 });
  });

  it('pulls a table saved off the edge back inside', () => {
    expect(clampCell({ posX: 47, posY: 31 }, square, GRID)).toEqual({ posX: 44, posY: 28 });
  });
});

describe('overlaps and free spots', () => {
  const t1 = { id: 'a', posX: 1, posY: 1, shape: 'SQUARE' as const };
  const t2 = { id: 'b', posX: 4, posY: 4, shape: 'SQUARE' as const };
  const t3 = { id: 'c', posX: 6, posY: 0, shape: 'SQUARE' as const };

  it('finds tables sitting on each other', () => {
    expect(findOverlaps([t1, t2, t3])).toEqual(new Set(['a', 'b']));
    expect(findOverlaps([t1, t3])).toEqual(new Set());
  });

  it('places a new table clear of the others', () => {
    const spot = firstFreeCell([t1], 'SQUARE');
    expect(spot).toEqual({ posX: 6, posY: 1 });
    expect(findOverlaps([t1, { id: 'n', ...spot, shape: 'SQUARE' }])).toEqual(new Set());
  });
});

describe('layoutChanges', () => {
  it('sends only tables whose position really changed, with their version', () => {
    const tables = [
      { id: 'a', posX: 1, posY: 1, version: 3 },
      { id: 'b', posX: 8, posY: 2, version: 1 },
      { id: 'c', posX: 0, posY: 0, version: 7 },
    ];
    expect(layoutChanges(tables, { a: { posX: 2, posY: 1 }, b: { posX: 8, posY: 2 } })).toEqual([
      { id: 'a', posX: 2, posY: 1, version: 3 },
    ]);
  });
});
