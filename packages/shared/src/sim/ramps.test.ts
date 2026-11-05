import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '../config/cosmetics';
import { FEET_OFFSET } from '../constants';
import { MAP_IDS, MAPS } from '../maps';
import { blockQuat } from '../vec';
import { initPhysics } from '../world/world';
import { MOVE } from './movement';
import { INTRO_TIME, Simulation } from './simulation';

type V = { x: number; y: number; z: number };
function rotate(q: { x: number; y: number; z: number; w: number }, v: V): V {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** The low and high ends of every ramp's walking surface. */
function ramps(map: (typeof MAPS)[keyof typeof MAPS]) {
  return map.blocks
    .filter((b) => b.pitch !== 0 && b.solid)
    .map((b) => {
      const q = blockQuat(b.yaw, b.pitch);
      const end = (s: number) => {
        const p = rotate(q, { x: 0, y: b.h.y, z: s * b.h.z });
        return { x: b.c.x + p.x, y: b.c.y + p.y, z: b.c.z + p.z };
      };
      const [a, c] = [end(-1), end(1)];
      return a.y < c.y ? { lo: a, hi: c, w: b.h.x * 2 } : { lo: c, hi: a, w: b.h.x * 2 };
    });
}

beforeAll(async () => {
  await initPhysics();
});

/** Walks one player from `from` towards `to` (holding forward) and reports how it went. */
function walk(sim: Simulation, from: V, to: V) {
  const p = sim.byId(1)!;
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz);
  p.pos.x = from.x - (dx / dist) * 1.2;
  p.pos.z = from.z - (dz / dist) * 1.2;
  p.pos.y = from.y + FEET_OFFSET + 0.05;
  p.vel.x = p.vel.y = p.vel.z = 0;
  p.hp = 100;
  p.spawnProtect = 999; // spawn zones damage (and slow) rivals; not what this measures
  p.collider.setTranslation(p.pos);
  const input = { seq: 0, mx: 0, mz: 0, yaw, pitch: 0, aimYaw: yaw, aimPitch: 0, buttons: 0 };
  for (let i = 0; i < 20; i++) {
    sim.setInput(1, { ...input, seq: ++input.seq });
    sim.step();
  }
  const total = dist + 2.4;
  let travelled = 0,
    ticks = 0,
    minSpeed = Infinity,
    minAt = '';
  const start = { x: p.pos.x, z: p.pos.z };
  while (ticks < 60 * 6) {
    sim.setInput(1, { ...input, mz: 1, seq: ++input.seq });
    const bx = p.pos.x,
      bz = p.pos.z;
    sim.step();
    ticks++;
    const step = Math.hypot(p.pos.x - bx, p.pos.z - bz) * 60;
    // Judge the ramp and its lips, not whatever stands beyond them.
    const onRamp = travelled > 0.9 && travelled < dist + 1.6;
    if (ticks > 20 && onRamp && step < minSpeed) {
      minSpeed = step;
      minAt = `${travelled.toFixed(2)}/${total.toFixed(2)} y${(p.pos.y - FEET_OFFSET).toFixed(2)}`;
    }
    travelled = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
    if (travelled >= total) break;
  }
  return {
    reached: travelled >= total,
    avg: travelled / (ticks / 60),
    minSpeed,
    minAt,
    endY: p.pos.y - FEET_OFFSET,
  };
}

describe('ramps', () => {
  for (const id of MAP_IDS) {
    it(`can be walked up and down at nearly full speed on ${id}`, async () => {
      const sim = await Simulation.create({ map: id, mode: 'turf', duration: 120, seed: 1 }, [
        {
          id: 1,
          name: 'Probe',
          team: 0,
          weapon: 'pulse',
          special: 'surge',
          bot: false,
          cosmetics: DEFAULT_COSMETICS,
        },
      ]);
      for (let i = 0; i < (INTRO_TIME + 0.2) * 60; i++) sim.step();
      for (const r of ramps(MAPS[id])) {
        const up = walk(sim, r.lo, r.hi);
        const down = walk(sim, r.hi, r.lo);
        const line = `${id} ramp lo(${r.lo.x.toFixed(1)},${r.lo.y.toFixed(1)},${r.lo.z.toFixed(1)}) hi y ${r.hi.y.toFixed(1)}: up ${up.reached ? 'ok' : 'STUCK'} avg ${up.avg.toFixed(2)} min ${up.minSpeed.toFixed(2)} @${up.minAt} | down ${down.reached ? 'ok' : 'STUCK'} avg ${down.avg.toFixed(2)} min ${down.minSpeed.toFixed(2)} @${down.minAt}`;
        expect.soft(up.reached, line).toBe(true);
        expect.soft(down.reached, line).toBe(true);
        // Climbing may cost a little speed, never most of it.
        expect.soft(up.minSpeed, line).toBeGreaterThan(MOVE.walk * 0.7);
        expect.soft(down.minSpeed, line).toBeGreaterThan(MOVE.walk * 0.7);
      }
      sim.dispose();
    });
  }
});
