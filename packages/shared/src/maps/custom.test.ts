import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '../config/cosmetics';
import { Simulation } from '../sim/simulation';
import { MAPS } from './index';
import { blankMap, customMapData, registerCustomMap, removeCustomMap, sanitizeCustomMap } from './custom';

describe('custom maps', () => {
  it('refuses junk and clamps wild numbers', () => {
    expect(sanitizeCustomMap(null)).toBeNull();
    expect(sanitizeCustomMap({ id: 'core', blocks: [] })).toBeNull();
    const m = blankMap();
    m.blocks[0].w = 1e9;
    m.blocks[0].mat = 'lava' as never;
    const c = sanitizeCustomMap(m)!;
    expect(c.blocks[0].w).toBe(120);
    expect(c.blocks[0].mat).toBe('wall');
  });

  it('builds a mirrored, playable map', async () => {
    const m = blankMap();
    m.blocks.push({ x: 5, y: 1, z: -8, w: 2, h: 2, d: 2, yaw: 0, pitch: 0, mat: 'crate', paint: true, solid: true, mirror: true });
    const c = registerCustomMap(m)!;
    expect(MAPS[c.id].blocks.length).toBe(3);
    expect(MAPS[c.id].spawns[1][0].z).toBe(-MAPS[c.id].spawns[0][0].z);
    const players = [0, 1].map((i) => ({ id: i + 1, name: `B${i}`, team: i as 0 | 1, weapon: 'pulse', special: 'burst', bot: true, difficulty: 'normal' as const, cosmetics: DEFAULT_COSMETICS }));
    const sim = await Simulation.create({ map: c.id, mode: 'turf', duration: 30, seed: 1 }, players as never);
    for (let i = 0; i < 600; i++) sim.step();
    expect(sim.players.every((p) => Number.isFinite(p.pos.x + p.pos.y + p.pos.z))).toBe(true);
    expect(customMapData(c.id)).toBeDefined();
    removeCustomMap(c.id);
    expect(MAPS[c.id]).toBeUndefined();
  });
});
