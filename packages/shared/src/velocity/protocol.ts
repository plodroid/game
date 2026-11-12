import { clamp } from '../vec';
import { RB_MASK, type RaceInput } from './car';
import { packDamage, PART_COUNT, unpackDamage } from './damage';
import { ITEMS } from './pickups';
import type { TrackDef } from './track';
import { RACE_PHASES, type RaceConfig, type RaceEvent, type RaceResult, type RacerInfo, type RaceSim, type Racer } from './race';

/** Sent instead of MatchStart when a VELOCITY race begins. */
export interface RaceStart {
  race: true;
  config: RaceConfig;
  racers: Omit<RacerInfo, 'uid'>[];
  you: number;
  /** A player-made track's definition, so guests can build it. */
  track?: TrackDef;
}

export interface RaceEnd {
  race: true;
  result: RaceResult;
  xp: Record<number, number>;
  recorded: boolean;
}

export interface RaceSnapshot {
  /** Tick, phase index, phase time ×10, race time ×100. */
  k: number;
  ph: number;
  pt: number;
  tm: number;
  c: number[][];
  e: RaceEvent[];
  /** Boxes currently missing (indices). */
  b: number[];
  /** Hazards: [id, kind (0 slick, 1 decoy), x, y, z (×100), age ×10]. */
  hz: number[][];
}

const q = (v: number, s: number) => Math.round(v * s);
const finite = (a: unknown[]) => a.every((x) => typeof x === 'number' && Number.isFinite(x));

export function packRaceInput(i: RaceInput): number[] {
  return [i.seq, q(i.steer, 100), q(i.throttle, 100), q(i.brake, 100), i.buttons];
}

/** Validates and clamps an untrusted input; false if malformed. */
export function unpackRaceInput(a: unknown, out: RaceInput): boolean {
  if (!Array.isArray(a) || a.length !== 5 || !finite(a)) return false;
  out.seq = a[0] | 0;
  out.steer = clamp(a[1] / 100, -1, 1);
  out.throttle = clamp(a[2] / 100, 0, 1);
  out.brake = clamp(a[3] / 100, 0, 1);
  out.buttons = a[4] & RB_MASK;
  return true;
}

const FLAG = { drift: 1, boost: 2, shield: 4, ghost: 8, wrong: 16, finished: 32, hand: 64, spun: 128, slip: 256, draft: 512 };

/** Everything a client needs to draw and predict one car. */
export function packRacer(r: Racer): number[] {
  const c = r.car, p = c.body.translation(), o = c.body.rotation(), v = c.body.linvel(), w = c.body.angvel();
  const flags =
    (c.drift > 0 ? FLAG.drift : 0) |
    (c.boosting ? FLAG.boost : 0) |
    (c.shieldT > 0 ? FLAG.shield : 0) |
    (c.ghostT > 0 ? FLAG.ghost : 0) |
    (r.wrong ? FLAG.wrong : 0) |
    (r.finished ? FLAG.finished : 0) |
    (c.handbrake ? FLAG.hand : 0) |
    (c.spunT > 0 ? FLAG.spun : 0) |
    (c.slipT > 0 ? FLAG.slip : 0) |
    (c.draftT > 0 ? FLAG.draft : 0);
  return [
    r.id, q(p.x, 1000), q(p.y, 1000), q(p.z, 1000), q(o.x, 1e4), q(o.y, 1e4), q(o.z, 1e4), q(o.w, 1e4),
    q(v.x, 100), q(v.y, 100), q(v.z, 100), q(w.x, 100), q(w.y, 100), q(w.z, 100),
    q(c.steer, 1000), q(c.comp[0], 100), q(c.comp[1], 100), q(c.comp[2], 100), q(c.comp[3], 100),
    flags, q(c.meter, 1000), q(c.drift, 100), r.lap, r.nextCp, q(r.prog, 10), r.position,
    r.item ? ITEMS.indexOf(r.item) : -1, q(c.rpm, 100), c.gear, q(c.throttle, 100), q(c.slip, 100), r.lastSeq,
    q(r.finishT, 100), q(r.best, 100), q(c.miniT + c.turboT, 100), r.sample,
    ...packDamage(c.damage),
  ];
}

/** A car as a client sees it. */
export interface CarView {
  id: number;
  p: { x: number; y: number; z: number };
  q: { x: number; y: number; z: number; w: number };
  v: { x: number; y: number; z: number };
  w: { x: number; y: number; z: number };
  steer: number;
  comp: number[];
  drift: boolean;
  boost: boolean;
  shield: boolean;
  ghost: boolean;
  wrong: boolean;
  finished: boolean;
  hand: boolean;
  spun: boolean;
  slipstream: boolean;
  draft: boolean;
  meter: number;
  driftT: number;
  lap: number;
  nextCp: number;
  prog: number;
  position: number;
  item: (typeof ITEMS)[number] | null;
  rpm: number;
  gear: number;
  throttle: number;
  slip: number;
  lastSeq: number;
  finishT: number;
  best: number;
  turbo: number;
  sample: number;
  damage: Float32Array;
}

export const emptyCarView = (id: number): CarView => ({
  id, p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 },
  steer: 0, comp: [0, 0, 0, 0], drift: false, boost: false, shield: false, ghost: false, wrong: false, finished: false,
  hand: false, spun: false, slipstream: false, draft: false, meter: 0, driftT: 0, lap: 0, nextCp: 1, prog: 0, position: 1,
  item: null, rpm: 0, gear: 1, throttle: 0, slip: 0, lastSeq: 0, finishT: 0, best: 0, turbo: 0, sample: 0,
  damage: new Float32Array(PART_COUNT),
});

export function unpackRacer(a: number[], out: CarView): number {
  if (!Array.isArray(a) || a.length < 36) return -1;
  out.id = a[0];
  out.p.x = a[1] / 1000;
  out.p.y = a[2] / 1000;
  out.p.z = a[3] / 1000;
  out.q.x = a[4] / 1e4;
  out.q.y = a[5] / 1e4;
  out.q.z = a[6] / 1e4;
  out.q.w = a[7] / 1e4;
  const ql = Math.hypot(out.q.x, out.q.y, out.q.z, out.q.w) || 1;
  out.q.x /= ql;
  out.q.y /= ql;
  out.q.z /= ql;
  out.q.w /= ql;
  out.v.x = a[8] / 100;
  out.v.y = a[9] / 100;
  out.v.z = a[10] / 100;
  out.w.x = a[11] / 100;
  out.w.y = a[12] / 100;
  out.w.z = a[13] / 100;
  out.steer = a[14] / 1000;
  for (let k = 0; k < 4; k++) out.comp[k] = a[15 + k] / 100;
  const f = a[19];
  out.drift = !!(f & FLAG.drift);
  out.boost = !!(f & FLAG.boost);
  out.shield = !!(f & FLAG.shield);
  out.ghost = !!(f & FLAG.ghost);
  out.wrong = !!(f & FLAG.wrong);
  out.finished = !!(f & FLAG.finished);
  out.hand = !!(f & FLAG.hand);
  out.spun = !!(f & FLAG.spun);
  out.slipstream = !!(f & FLAG.slip);
  out.draft = !!(f & FLAG.draft);
  out.meter = a[20] / 1000;
  out.driftT = a[21] / 100;
  out.lap = a[22];
  out.nextCp = a[23];
  out.prog = a[24] / 10;
  out.position = a[25];
  out.item = a[26] >= 0 ? (ITEMS[a[26]] ?? null) : null;
  out.rpm = a[27] / 100;
  out.gear = a[28];
  out.throttle = a[29] / 100;
  out.slip = a[30] / 100;
  out.lastSeq = a[31];
  out.finishT = a[32] / 100;
  out.best = a[33] / 100;
  out.turbo = a[34] / 100;
  out.sample = a[35];
  unpackDamage(a.slice(36), out.damage);
  return a[0];
}

/** Reads a car straight from a local simulation (offline races use the same view type). */
export function viewOf(r: Racer, out: CarView): CarView {
  unpackRacer(packRacer(r), out);
  return out;
}

export function raceSnapshot(sim: RaceSim, events: RaceEvent[]): RaceSnapshot {
  const b: number[] = [];
  sim.boxes.forEach((x, i) => x.t > 0 && b.push(i));
  return {
    k: sim.tick,
    ph: RACE_PHASES.indexOf(sim.phase),
    pt: Math.round(sim.phaseT * 10),
    tm: Math.round(sim.time * 100),
    c: sim.racers.map(packRacer),
    e: events,
    b,
    hz: sim.hazards.map((h) => [h.id, h.kind === 'slick' ? 0 : 1, q(h.x, 100), q(h.y, 100), q(h.z, 100), q(h.age, 10)]),
  };
}

/** XP for a race: finishing, placing, the fastest lap and clean overtakes. Shared by hosts and offline play. */
export function xpForRace(result: RaceResult, id: number): number {
  const r = result.players.find((p) => p.id === id);
  if (!r) return 0;
  const field = result.players.length;
  const place = Math.max(0, field - r.position);
  let xp = 90 + place * 35 + (r.finished ? 70 : 0) + Math.min(10, r.stats.overtakes) * 6;
  if (r.position === 1 && field > 1) xp += 120;
  if (result.fastest?.id === id) xp += 50;
  xp *= Math.min(1.6, 0.7 + result.laps * 0.15);
  return Math.min(1200, Math.round(xp));
}
