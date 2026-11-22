import { describe, expect, it } from 'vitest';
import type { ControlPoint } from './track';
import { clampSel, insertAfter, MIN_POINTS, patchAt, removeAt } from './trackEdit';

const pts = (n: number): ControlPoint[] => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: i, z: i * 5, w: 7, bank: 0, surf: 'asphalt' as const }));

describe('track editor point operations', () => {
  it('Add point after an undo no longer crashes (the selection was past the end)', () => {
    // Select the last of eight, add a point (nine, selection 8), then undo: eight points, selection still 8.
    const first = insertAfter(pts(8), 7);
    let points = first.points;
    const sel = first.sel;
    expect(points).toHaveLength(9);
    expect(sel).toBe(8);
    points = points.slice(0, 8); // what undo restores
    expect(() => insertAfter(points, sel)).not.toThrow();
    const again = insertAfter(points, sel);
    expect(again.points).toHaveLength(9);
    // The new point sits between the last point and the first (the loop closes round).
    expect(again.points[8].x).toBeCloseTo((points[7].x + points[0].x) / 2);
  });

  it('keeps the selection on a real point whatever the length', () => {
    expect(clampSel(8, 12)).toBe(7);
    expect(clampSel(8, -3)).toBe(0);
    expect(clampSel(8, NaN)).toBe(0);
    expect(clampSel(0, 5)).toBe(0);
  });

  it('removes the selected point, refuses to go under four, and survives a stale selection', () => {
    const r = removeAt(pts(8), 7)!;
    expect(r.points).toHaveLength(7);
    expect(r.sel).toBe(6);
    expect(removeAt(pts(MIN_POINTS), 0)).toBeNull();
    expect(removeAt(pts(6), 40)!.points).toHaveLength(5);
  });

  it('edits the selected point, or the last one if the selection is stale, never nothing', () => {
    const p = patchAt(pts(5), 2, { y: 9 });
    expect(p[2].y).toBe(9);
    expect(patchAt(pts(5), 99, { y: 9 })[4].y).toBe(9);
  });

  it('inserting never changes the other points and handles an empty list', () => {
    const base = pts(6);
    const { points } = insertAfter(base, 2);
    expect(points.filter((p) => base.includes(p))).toHaveLength(6);
    expect(insertAfter([], 3)).toEqual({ points: [], sel: 0 });
  });
});
