import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Checks the manifest the import script wrote for the supplied car models. The models are not in the
 * repository, so on a machine without them this is skipped.
 */
const file = resolve(__dirname, '../../../../assets-src/cars-manifest.json');
interface Entry {
  id: string;
  problems: string[];
  tyre: { runtimeScale: number; physicsRadius: number };
  wheels: Record<string, { radius: number; centre: number[] }>;
  licence: { status: string };
}
const manifest = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { cars: Entry[] }) : null;

describe.skipIf(!manifest)('supplied car models', () => {
  const cars = manifest?.cars ?? [];

  it('lists every car and every car is garage-ready', () => {
    expect(cars.length).toBeGreaterThanOrEqual(7);
    for (const c of cars) expect(c.problems, c.id).toEqual([]);
  });

  it('keeps the tyre scale within 1.170 to 1.200', () => {
    for (const c of cars) {
      expect(c.tyre.runtimeScale, c.id).toBeGreaterThanOrEqual(1.17 - 1e-3);
      expect(c.tyre.runtimeScale, c.id).toBeLessThanOrEqual(1.2 + 1e-3);
    }
  });

  it('has four wheels per car, with front and rear radii close to the physics wheel', () => {
    for (const c of cars) {
      expect(Object.keys(c.wheels).sort(), c.id).toEqual(['FL', 'FR', 'RL', 'RR']);
      for (const w of Object.values(c.wheels)) expect(Math.abs(w.radius - c.tyre.physicsRadius), c.id).toBeLessThan(0.03);
      expect(c.wheels.FL.centre[0], c.id).toBeGreaterThan(0); // left is +x
      expect(c.wheels.FL.centre[2], c.id).toBeGreaterThan(0); // front is +z: the nose faces +z
      expect(c.wheels.RL.centre[2], c.id).toBeLessThan(0);
    }
  });

  it('records that the owner confirmed the licence', () => {
    for (const c of cars) expect(c.licence.status, c.id).toBe('owner-confirmed');
  });
});
