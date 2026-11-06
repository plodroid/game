import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '../config/cosmetics';
import type { ModeId } from '../config/modes';
import { SPECIAL_IDS } from '../config/specials';
import { WEAPON_IDS, WEAPONS } from '../config/weapons';
import { forEachPellet } from './combat';
import { MAP_IDS, type MapId } from '../maps';
import { xpForMatch } from '../progression';
import { PLAYER_GAP } from './movement';
import type { PlayerInfo } from './player';
import { Simulation } from './simulation';

function roster(difficulty: PlayerInfo['difficulty'] = 'normal'): PlayerInfo[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    name: `Bot ${i + 1}`,
    team: (i % 2) as 0 | 1,
    weapon: WEAPON_IDS[i % WEAPON_IDS.length],
    special: SPECIAL_IDS[i % SPECIAL_IDS.length],
    bot: true,
    difficulty,
    cosmetics: DEFAULT_COSMETICS,
  }));
}

async function playOut(map: MapId, mode: ModeId, duration: number) {
  const sim = await Simulation.create({ map, mode, duration, seed: 1234 }, roster());
  const start = new Map(sim.players.map((p) => [p.id, { ...p.pos }]));
  const travelled = new Map<number, number>();
  let kills = 0, specials = 0, samples = 0, overlaps = 0;
  for (let i = 0; i < (duration + 10) * 60 && sim.phase !== 'ended'; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.t === 'kill') kills++;
      if (e.t === 'special') specials++;
    }
    for (const p of sim.players) {
      const s = start.get(p.id)!;
      const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
      travelled.set(p.id, Math.max(travelled.get(p.id) ?? 0, d));
      expect(Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).toBe(true);
    }
    // Bodies standing inside each other: alive, level with each other, well under the gap.
    const ps = sim.players;
    for (let a = 0; a < ps.length; a++)
      for (let b = a + 1; b < ps.length; b++) {
        if (!ps[a].alive || !ps[b].alive || ps[a].climbing || ps[b].climbing || Math.abs(ps[a].pos.y - ps[b].pos.y) > 0.9) continue;
        samples++;
        if (Math.hypot(ps[a].pos.x - ps[b].pos.x, ps[a].pos.z - ps[b].pos.z) < PLAYER_GAP * 0.75) overlaps++;
      }
  }
  return { sim, kills, specials, travelled, overlap: overlaps / Math.max(1, samples) };
}

describe('full bot matches', () => {
  for (const map of MAP_IDS) {
    it(`completes a Turf Control match on ${map}`, async () => {
      const { sim, kills, specials, travelled, overlap } = await playOut(map, 'turf', 90);
      expect(sim.phase).toBe('ended');
      const r = sim.result!;
      expect(r).toBeTruthy();
      // Both teams claim real territory.
      expect(r.coverage[0]).toBeGreaterThan(8);
      expect(r.coverage[1]).toBeGreaterThan(8);
      expect(r.coverage[0] + r.coverage[1]).toBeLessThanOrEqual(100.001);
      expect(kills).toBeGreaterThan(0);
      expect(specials).toBeGreaterThan(0);
      // Nobody stays parked in spawn.
      for (const [, d] of travelled) expect(d).toBeGreaterThan(8);
      expect(r.players.every((p) => p.paint > 0)).toBe(true);
      // Players push apart instead of standing inside each other.
      expect(overlap).toBe(0);
      expect(xpForMatch(r, r.players[0].id)).toBeGreaterThan(100);
      sim.dispose();
    });
  }

  it('fires every weapon without errors', () => {
    for (const id of WEAPON_IDS) {
      let n = 0,
        side = 0;
      forEachPellet(WEAPONS[id], 0, 0, 99, (dir) => {
        n++;
        side += Math.atan2(-dir.x, -dir.z);
        expect(Number.isFinite(dir.x + dir.y + dir.z)).toBe(true);
      });
      expect(n).toBe(WEAPONS[id].pellets);
      // Spreads are centred on the aim, not lopsided.
      if (WEAPONS[id].kind === 'lobber') expect(Math.abs(side / n)).toBeLessThan(0.01);
    }
  });

  it('runs Zone Control and Knockout to completion', async () => {
    for (const mode of ['zones', 'knockout'] as ModeId[]) {
      const { sim } = await playOut('core', mode, 60);
      expect(sim.phase).toBe('ended');
      expect([-1, 0, 1]).toContain(sim.result!.winner);
      sim.dispose();
    }
  });
});
