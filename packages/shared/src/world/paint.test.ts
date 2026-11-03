import { beforeAll, describe, expect, it } from 'vitest';
import { MAPS } from '../maps';
import { v3 } from '../vec';
import { GameWorld, initPhysics } from './world';

describe('paint grid', () => {
  let w: GameWorld;
  beforeAll(async () => {
    await initPhysics();
    w = new GameWorld(MAPS.skyline);
  });

  it('claims roughly a disc of floor and flips ownership', () => {
    w.grid.reset();
    const at = v3(0, 0, -16);
    const area = w.grid.paintSphere(at, 1.5, 0);
    expect(area).toBeGreaterThan(Math.PI * 1.5 * 1.5 * 0.75);
    expect(area).toBeLessThan(Math.PI * 1.5 * 1.5 * 1.3);
    expect(w.grid.ownerAt(at, v3(0, 1, 0))).toBe(0);
    const before = w.grid.teamArea[0];
    w.grid.paintSphere(at, 1.5, 1);
    expect(w.grid.ownerAt(at, v3(0, 1, 0))).toBe(1);
    expect(w.grid.teamArea[0]).toBeLessThan(before);
    expect(w.grid.teamArea[0] + w.grid.teamArea[1]).toBeLessThanOrEqual(w.grid.totalScoringArea);
  });

  it('never paints through to the far side of a wall', () => {
    w.grid.reset();
    // Cover wall at x∈[-7.6,-3.4], z∈[-17.85,-17.15]; hit its south face.
    w.grid.paintSphere(v3(-5.5, 1, -17.85), 0.6, 0);
    expect(w.grid.ownerAt(v3(-5.5, 1, -17.85), v3(0, 0, -1))).toBe(0);
    expect(w.grid.ownerAt(v3(-5.5, 1, -17.15), v3(0, 0, 1))).toBe(-1);
  });

  it('excludes occluded floor under solid blocks from scoring', () => {
    w.grid.reset();
    // Centre of the crate footprint: the floor below must be blocked, not paintable.
    w.grid.paintSphere(v3(9, 0, -9), 0.5, 0);
    expect(w.grid.ownerAt(v3(9, 0, -9), v3(0, 1, 0))).toBe(-1);
  });

  it('round-trips through run-length sync', () => {
    w.grid.reset();
    w.grid.paintSphere(v3(3, 0, -12), 3, 0);
    w.grid.paintSphere(v3(-6, 0, 10), 2, 1);
    const cov = w.grid.coverage();
    const rle = w.grid.encode();
    const other = new GameWorld(MAPS.skyline);
    other.grid.decode(rle);
    expect(other.grid.coverage()[0]).toBeCloseTo(cov[0], 6);
    expect(other.grid.coverage()[1]).toBeCloseTo(cov[1], 6);
    other.dispose();
  });

  it('packs every map into a WebGL2-safe atlas', () => {
    for (const map of Object.values(MAPS)) {
      const g = new GameWorld(map).grid;
      expect(g.totalScoringArea).toBeGreaterThan(500);
      // 8 texels per cell must fit the 4096 limit most desktop GPUs report (2048 at 4 texels).
      expect(g.atlasRows * 8).toBeLessThanOrEqual(4096);
    }
  });
});
