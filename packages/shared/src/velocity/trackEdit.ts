import type { ControlPoint } from './track';

/*
 * The track editor's point operations, kept apart from the screen so they can be tested. The editor
 * keeps "which point is selected" separate from the track itself, and the track can shrink under it
 * (undo of an added point, deleting, importing a shorter track), so every operation first clamps the
 * selection to a point that exists. An out-of-range selection used to crash "Add point".
 */

export const MIN_POINTS = 4;

/** A selection that always points at a real point (0 when there are none). */
export const clampSel = (length: number, sel: number) => Math.max(0, Math.min(Number.isFinite(sel) ? Math.floor(sel) : 0, length - 1));

/** A new point halfway between the selected one and the next, and the selection moved onto it. */
export function insertAfter(points: ControlPoint[], sel: number): { points: ControlPoint[]; sel: number } {
  if (!points.length) return { points, sel: 0 };
  const s = clampSel(points.length, sel);
  const a = points[s], b = points[(s + 1) % points.length];
  const mid: ControlPoint = { ...a, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: (a.y + b.y) / 2, items: false, obstacles: false };
  return { points: [...points.slice(0, s + 1), mid, ...points.slice(s + 1)], sel: s + 1 };
}

/** The track without the selected point, and the selection moved back one; null when it would be too few. */
export function removeAt(points: ControlPoint[], sel: number): { points: ControlPoint[]; sel: number } | null {
  if (points.length <= MIN_POINTS) return null;
  const s = clampSel(points.length, sel);
  return { points: points.filter((_, i) => i !== s), sel: Math.max(0, s - 1) };
}

/** Changes the selected point. A selection past the end changes the last point rather than nothing. */
export function patchAt(points: ControlPoint[], sel: number, patch: Partial<ControlPoint>): ControlPoint[] {
  const s = clampSel(points.length, sel);
  return points.map((p, i) => (i === s ? { ...p, ...patch } : p));
}
