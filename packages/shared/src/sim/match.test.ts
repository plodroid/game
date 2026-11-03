import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '../config/cosmetics';
import type { ModeId } from '../config/modes';
import { SPECIAL_IDS } from '../config/specials';
import { WEAPON_IDS } from '../config/weapons';
import { MAP_IDS, type MapId } from '../maps';
import { xpForMatch } from '../progression';
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
  let kills = 0, specials = 0;
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
  }
  return { sim, kills, specials, travelled };
}

describe('full bot matches', () => {
  for (const map of MAP_IDS) {
    it(`completes a Turf Control match on ${map}`, async () => {
      const { sim, kills, specials, travelled } = await playOut(map, 'turf', 90);
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
      expect(xpForMatch(r, r.players[0].id)).toBeGreaterThan(100);
      sim.dispose();
    });
  }

  it('runs Zone Control and Knockout to completion', async () => {
    for (const mode of ['zones', 'knockout'] as ModeId[]) {
      const { sim } = await playOut('core', mode, 60);
      expect(sim.phase).toBe('ended');
      expect([-1, 0, 1]).toContain(sim.result!.winner);
      sim.dispose();
    }
  });
});
