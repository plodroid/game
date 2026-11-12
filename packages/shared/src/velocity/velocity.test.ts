import { beforeAll, describe, expect, it } from 'vitest';
import { BOT_DIFFICULTIES } from '../config/modes';
import { initPhysics } from '../world/world';
import { emptyRaceInput, RB, rotate } from './car';
import { botCar, CAR_ITEMS, DEFAULT_CAR, CAR_FINISHES, sanitizeCarLoadout, WHEELS } from './catalog';
import { DEFAULT_HANDLING, MAX_RACERS, sanitizeHandling, sanitizeRaceSettings } from './config';
import { applyImpact, damageEffects, PART_COUNT, PART_INDEX } from './damage';
import { emptyCarView, packRaceInput, packRacer, unpackRaceInput, unpackRacer, xpForRace } from './protocol';
import { RaceSim, type RacerInfo } from './race';
import { buildPath, lateralOffset, validateTrack } from './track';
import { isTrack, registerTrack, TRACK_IDS, TRACKS } from './tracks';

const bots = (n = 6, diff: RacerInfo['difficulty'][] = ['easy', 'normal', 'hard', 'expert', 'normal', 'hard']): RacerInfo[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Bot${i}`, bot: true, difficulty: diff[i % diff.length], car: botCar(i + 1), identity: i }));

function run(sim: RaceSim, maxSeconds: number, each?: () => void) {
  for (let i = 0; i < maxSeconds * 60 && sim.phase !== 'ended'; i++) {
    each?.();
    sim.step();
  }
}

// An open test ring: two long straights and two wide bends, 120 m across.
const RING = { id: 'test-ring', name: 'Ring', description: '', theme: 'coast' as const, laps: 1, width: 60, verge: 'sand' as const, shoulder: 4, wall: 1, ground: 0, sea: null, segs: [{ len: 900 }, { turn: 180, r: 200 }, { len: 900 }, { turn: 180, r: 200 }], startAt: 50 };

beforeAll(async () => {
  await initPhysics();
  registerTrack(RING);
});

describe('tracks', () => {
  it('has ten distinct built-in circuits that all validate', () => {
    expect(TRACK_IDS).toHaveLength(10);
    const lengths = new Set<number>();
    for (const id of TRACK_IDS) {
      expect(validateTrack(TRACKS[id]), id).toEqual([]);
      const p = buildPath(TRACKS[id]);
      expect(p.checkpoints.length, id).toBeGreaterThanOrEqual(6);
      expect(p.grid, id).toHaveLength(MAX_RACERS);
      lengths.add(Math.round(p.length));
      // The grid sits on the road, behind the line.
      for (const g of p.grid) expect(Math.abs(lateralOffset(p, g.i, g.x, g.y, g.z))).toBeLessThan(p.w[g.i]);
    }
    expect(lengths.size).toBe(10);
  });

  it('includes bridges, tunnels, banking, elevation and loose surfaces across the set', () => {
    const all = TRACK_IDS.map((id) => buildPath(TRACKS[id]));
    expect(all.some((p) => p.tunnel.some((t) => t))).toBe(true);
    expect(all.some((p) => p.bounds.maxY - p.bounds.minY > 12)).toBe(true);
    const surf = new Set(all.flatMap((p) => [...p.surf]));
    expect(surf.size).toBeGreaterThanOrEqual(3);
  });

  it('rejects broken tracks', () => {
    const tiny = { ...RING, id: 'tiny', segs: [{ len: 40 }, { turn: 180, r: 12 }, { len: 40 }, { turn: 180, r: 12 }] };
    expect(validateTrack(tiny).length).toBeGreaterThan(0);
    const crossing = { ...TRACKS.skyline, id: 'flat8', segs: TRACKS.skyline.segs!.map((s) => ({ ...s, y: 0 })) };
    expect(validateTrack(crossing).some((p) => /run into each other/.test(p.text))).toBe(true);
  });
});

describe('driving', () => {
  const solo = () => new RaceSim({ track: RING.id, laps: 3, preset: 'classic', damage: 'full', seed: 1 }, [{ id: 1, name: 'Me', bot: false, car: DEFAULT_CAR, identity: 0 }]);
  const toGreen = (sim: RaceSim) => {
    while (sim.phase !== 'racing') sim.step();
  };
  const drive = (sim: RaceSim, s: number, inp: Partial<ReturnType<typeof emptyRaceInput>>) => {
    for (let i = 0; i < s * 60; i++) {
      sim.setInput(1, { ...emptyRaceInput(), seq: sim.tick + 1, ...inp });
      sim.step();
    }
  };

  it('holds cars on the grid during the countdown', () => {
    const sim = solo();
    for (let i = 0; i < 60 * 4; i++) {
      sim.setInput(1, { ...emptyRaceInput(), throttle: 1 });
      sim.step();
    }
    expect(sim.phase).not.toBe('racing');
    expect(sim.racers[0].car.speed).toBeLessThan(1);
  });

  it('accelerates, brakes and reverses like a car', () => {
    const sim = solo();
    toGreen(sim);
    drive(sim, 4.5, { throttle: 1 });
    const v = sim.racers[0].car.speed * 3.6;
    expect(v).toBeGreaterThan(100);
    expect(v).toBeLessThan(170);
    let t = 0;
    while (sim.racers[0].car.speed > 1 && t < 600) {
      sim.setInput(1, { ...emptyRaceInput(), brake: 1 });
      sim.step();
      t++;
    }
    expect(t / 60).toBeLessThan(3);
    drive(sim, 2, { brake: 1 });
    expect(sim.racers[0].car.forwardSpeed()).toBeLessThan(-2);
  });

  it('turns without rolling over, and drifts while keeping most of its speed', () => {
    const sim = solo();
    toGreen(sim);
    drive(sim, 4, { throttle: 1 });
    const before = sim.racers[0].car.speed;
    const up = { x: 0, y: 0, z: 0 }, fwd = { x: 0, y: 0, z: 0 };
    let maxSlip = 0, minUp = 1;
    for (let i = 0; i < 90; i++) {
      sim.setInput(1, { ...emptyRaceInput(), throttle: 1, steer: 0.8, buttons: RB.HANDBRAKE });
      sim.step();
      const c = sim.racers[0].car;
      rotate(c.body.rotation(), 0, 1, 0, up);
      rotate(c.body.rotation(), 0, 0, 1, fwd);
      const v = c.body.linvel();
      maxSlip = Math.max(maxSlip, Math.acos(Math.min(1, (v.x * fwd.x + v.z * fwd.z) / (Math.hypot(v.x, v.z) * Math.hypot(fwd.x, fwd.z)))));
      minUp = Math.min(minUp, up.y);
    }
    expect(minUp).toBeGreaterThan(0.85);
    expect(maxSlip * 57.3).toBeGreaterThan(15);
    expect(sim.racers[0].car.speed).toBeGreaterThan(before * 0.75);
    // Letting go after a long drift pays a mini-turbo.
    const events: string[] = [];
    sim.setInput(1, { ...emptyRaceInput(), throttle: 1 });
    sim.step();
    for (const e of sim.drainEvents()) events.push(e.t);
    expect(events).toContain('drift');
  });

  it('flags driving the wrong way and puts a car back on the road when asked', () => {
    const sim = solo();
    toGreen(sim);
    drive(sim, 4, { brake: 1 });
    const r = sim.racers[0];
    expect(r.wrong).toBe(true);
    sim.setInput(1, { ...emptyRaceInput(), buttons: RB.RESET });
    sim.step();
    expect(r.stats.respawns).toBe(1);
    expect(r.car.ghostT).toBeGreaterThan(0);
  });
});

describe('races', () => {
  it('every track: six bots finish a lap, through checkpoints in order, with valid places', () => {
    for (const track of TRACK_IDS) {
      const sim = new RaceSim({ track, laps: 1, preset: 'classic', damage: 'full', seed: 3 }, bots());
      let cps = 0;
      run(sim, 240, () => {
        for (const e of sim.drainEvents()) if (e.t === 'cp') cps++;
      });
      expect(sim.phase, track).toBe('ended');
      const res = sim.result!;
      expect(res.players.filter((p) => p.finished).length, track).toBeGreaterThanOrEqual(5);
      expect(res.players.map((p) => p.position).sort()).toEqual([1, 2, 3, 4, 5, 6]);
      expect(cps, track).toBeGreaterThanOrEqual((sim.path.checkpoints.length - 1) * 5);
      // Finishing times rise with the place.
      const times = res.players.filter((p) => p.finished).map((p) => p.time!);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      sim.dispose();
    }
  }, 300_000);

  it('better bots are faster (same physics, no cheating)', () => {
    let easy = 0, expert = 0;
    for (const track of ['coastal', 'neon', 'canyon']) {
      for (const d of ['easy', 'expert'] as const) {
        const sim = new RaceSim({ track, laps: 1, preset: 'classic', damage: 'off', seed: 9 }, bots(1, [d]));
        run(sim, 200);
        const t = sim.result!.players[0].time ?? 999;
        if (d === 'easy') easy += t;
        else expert += t;
        sim.dispose();
      }
    }
    expect(expert).toBeLessThan(easy * 0.92);
    expect(BOT_DIFFICULTIES).toEqual(['easy', 'normal', 'hard', 'expert']);
  }, 120_000);

  it('arcade races hand out pickups and use them', () => {
    const sim = new RaceSim({ track: 'coastal', laps: 2, preset: 'arcade', damage: 'full', seed: 4 }, bots());
    let got = 0, used = 0;
    run(sim, 200, () => {
      for (const e of sim.drainEvents()) {
        if (e.t === 'item') got++;
        if (e.t === 'use') used++;
      }
    });
    expect(sim.boxes.length).toBeGreaterThan(0);
    expect(got).toBeGreaterThan(3);
    expect(used).toBeGreaterThan(2);
    sim.dispose();
  }, 120_000);

  it('classic races have no pickups', () => {
    const sim = new RaceSim({ track: 'coastal', laps: 1, preset: 'classic', damage: 'off', seed: 4 }, bots(2));
    expect(sim.boxes).toHaveLength(0);
    sim.dispose();
  });
});

describe('damage', () => {
  it('builds up where the car was hit, harder hits doing more', () => {
    const d = new Float32Array(PART_COUNT);
    expect(applyImpact(d, 0, 2, 2, 0.95, 2.15)).toBeNull();
    applyImpact(d, 0, 2.1, 8, 0.95, 2.15);
    const once = d[PART_INDEX.frontBumper];
    expect(once).toBeGreaterThan(0);
    expect(d[PART_INDEX.rearBumper]).toBe(0);
    applyImpact(d, 0, 2.1, 8, 0.95, 2.15);
    expect(d[PART_INDEX.frontBumper]).toBeGreaterThan(once);
    applyImpact(d, 0.9, 1.4, 14, 0.95, 2.15);
    expect(d[PART_INDEX.headlightL]).toBeGreaterThan(d[PART_INDEX.headlightR]);
    expect(d[PART_INDEX.wheelFL]).toBeGreaterThan(0);
  });

  it('only changes handling with mechanical damage on, and gently', () => {
    const d = new Float32Array(PART_COUNT).fill(1);
    expect(damageEffects(d, false).power).toBe(1);
    const fx = damageEffects(d, true);
    expect(fx.power).toBeGreaterThan(0.6);
    expect(fx.steer).toBeGreaterThan(0.7);
    expect(Math.min(...fx.wheel)).toBeGreaterThan(0.6);
  });

  it('comes from real collisions in a race', () => {
    const sim = new RaceSim({ track: 'coastal', laps: 1, preset: 'classic', damage: 'full', seed: 1 }, [{ id: 1, name: 'Me', bot: false, car: DEFAULT_CAR, identity: 0 }]);
    while (sim.phase !== 'racing') sim.step();
    const r = sim.racers[0];
    // Flat out down the first straight, straight on into the wall at the corner.
    let impact = false;
    for (let i = 0; i < 60 * 15 && !impact; i++) {
      sim.setInput(1, { ...emptyRaceInput(), throttle: 1 });
      sim.step();
      impact = sim.drainEvents().some((e) => e.t === 'impact');
    }
    expect(impact).toBe(true);
    expect(r.car.damage.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    sim.dispose();
  });
});

describe('network and data', () => {
  it('round-trips inputs and cars, and rejects junk', () => {
    const inp = { seq: 7, steer: -0.5, throttle: 1, brake: 0, buttons: RB.HANDBRAKE | RB.BOOST };
    const out = emptyRaceInput();
    expect(unpackRaceInput(packRaceInput(inp), out)).toBe(true);
    expect(out).toEqual(inp);
    expect(unpackRaceInput([1, 2, 'x', 4, 5], out)).toBe(false);
    expect(unpackRaceInput([1, 900, 900, -5, 0xffff], out)).toBe(true);
    expect(out.steer).toBe(1);
    expect(out.brake).toBe(0);
    expect(out.buttons & ~63).toBe(0);
    const sim = new RaceSim({ track: 'coastal', laps: 1, preset: 'classic', damage: 'full', seed: 1 }, bots(2));
    for (let i = 0; i < 400; i++) sim.step();
    const v = emptyCarView(0);
    expect(unpackRacer(packRacer(sim.racers[1]), v)).toBe(2);
    const p = sim.racers[1].car.body.translation();
    expect(v.p.x).toBeCloseTo(p.x, 2);
    sim.dispose();
  });

  it('sanitises loadouts, settings and handling', () => {
    const l = sanitizeCarLoadout({ body: 'tank', paint: 'teal', number: 400, plateText: 'hi<script>' });
    expect(l.body).toBe(DEFAULT_CAR.body);
    expect(l.paint).toBe('teal');
    expect(l.number).toBe(DEFAULT_CAR.number);
    expect(l.plateText).toBe('HISCRIP');
    const s = sanitizeRaceSettings({ track: 'nope', laps: 99, bots: 40 }, isTrack);
    expect(s.track).toBe('coastal');
    expect(s.laps).toBe(3);
    expect(s.bots).toBe(5);
    expect(sanitizeHandling({ topSpeed: 1e9 }).topSpeed).toBeLessThanOrEqual(80);
    expect(sanitizeHandling(null)).toEqual(DEFAULT_HANDLING);
  });

  it('has a big, distinct catalogue', () => {
    expect(Object.keys(CAR_FINISHES).length).toBeGreaterThanOrEqual(50);
    expect(Object.keys(WHEELS).length).toBeGreaterThanOrEqual(20);
    const combos = new Set(Object.values(CAR_FINISHES).map((f) => `${f.model}/${f.pattern}`));
    expect(combos.size).toBe(Object.keys(CAR_FINISHES).length);
    expect(new Set(CAR_ITEMS.map((i) => i.key)).size).toBe(CAR_ITEMS.length);
  });

  it('pays more XP for better places', () => {
    const sim = new RaceSim({ track: 'coastal', laps: 1, preset: 'classic', damage: 'off', seed: 2 }, bots());
    run(sim, 200);
    const res = sim.result!;
    const first = res.players[0], last = res.players[res.players.length - 1];
    expect(xpForRace(res, first.id)).toBeGreaterThan(xpForRace(res, last.id));
    sim.dispose();
  }, 60_000);
});
