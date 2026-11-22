import { describe, expect, it } from 'vitest';
import { nearest } from './tv';

const box = (left: number, top: number, w = 100, h = 40) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h }) as DOMRect;
const el = (r: DOMRect) => ({ getBoundingClientRect: () => r }) as unknown as HTMLElement;

describe('TV menu focus movement', () => {
  // A 2 x 2 grid and one far item.
  const a = el(box(0, 0)), b = el(box(200, 0)), c = el(box(0, 100)), d = el(box(200, 100)), far = el(box(1000, 500));
  const all = [a, b, c, d, far];

  it('moves to the neighbour in the direction pressed', () => {
    expect(nearest(box(0, 0), all, 1, 0, a)).toBe(b);
    expect(nearest(box(0, 0), all, 0, 1, a)).toBe(c);
    expect(nearest(box(200, 100), all, -1, 0, d)).toBe(c);
    expect(nearest(box(200, 100), all, 0, -1, d)).toBe(b);
  });

  it('stays put at an edge instead of jumping somewhere unrelated', () => {
    expect(nearest(box(0, 0), all, -1, 0, a)).toBeNull();
    expect(nearest(box(0, 0), all, 0, -1, a)).toBeNull();
  });

  it('prefers the item in line over a nearer one off to the side', () => {
    const inLine = el(box(0, 200)), offside = el(box(180, 90));
    expect(nearest(box(0, 0), [inLine, offside], 0, 1)).toBe(inLine);
  });
});
