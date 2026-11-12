import type RAPIER from '@dimforge/rapier3d-compat';
import {
  DT, emptyCarView, RACE_PHASES, viewOf, xpForRace, type CarView, type RaceConfig, type RaceEvent, type RaceInput, type RacePhase,
  type RaceResult, type RaceSim, type RacerInfo, type TrackPath,
} from '@chromashift/shared';

/** What the race view draws from: a race on this device, or one hosted elsewhere. */
export interface RaceSource {
  readonly online: boolean;
  readonly config: RaceConfig;
  readonly path: TrackPath;
  readonly roster: RacerInfo[];
  /** Cars driven on this device (one, or two in split screen). */
  readonly localIds: number[];
  /** Physics world with the track in it (camera collision). */
  readonly world: RAPIER.World;
  /** Advances by real time with this frame's inputs; returns what happened. */
  update(dt: number, inputs: Map<number, RaceInput>): RaceEvent[];
  /** Every car, smoothed for drawing. */
  cars(): CarView[];
  phase(): RacePhase;
  phaseT(): number;
  time(): number;
  /** Pickup boxes and whether each is there. */
  boxes(): { x: number; y: number; z: number; on: boolean }[];
  hazards(): { id: number; kind: 'slick' | 'decoy'; x: number; y: number; z: number; age: number }[];
  result(): RaceResult | null;
  xp(id: number): number;
  ping(): number | null;
  /** Offline only: stop the race now (everyone keeps their place). */
  finishNow?(): void;
  dispose(): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Copies a view, interpolating pose between two ticks. */
function blend(prev: CarView, cur: CarView, t: number, out: CarView) {
  Object.assign(out, cur);
  out.p = { x: lerp(prev.p.x, cur.p.x, t), y: lerp(prev.p.y, cur.p.y, t), z: lerp(prev.p.z, cur.p.z, t) };
  // Quaternion nlerp (short way).
  const dot = prev.q.x * cur.q.x + prev.q.y * cur.q.y + prev.q.z * cur.q.z + prev.q.w * cur.q.w;
  const s = dot < 0 ? -1 : 1;
  const q = { x: lerp(prev.q.x * s, cur.q.x, t), y: lerp(prev.q.y * s, cur.q.y, t), z: lerp(prev.q.z * s, cur.q.z, t), w: lerp(prev.q.w * s, cur.q.w, t) };
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  out.q = { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
  out.steer = lerp(prev.steer, cur.steer, t);
  out.comp = cur.comp.map((c, i) => lerp(prev.comp[i] ?? c, c, t));
  return out;
}

/** A race run entirely on this device (against bots, or split screen). */
export class OfflineRaceSource implements RaceSource {
  readonly online = false;
  readonly config: RaceConfig;
  readonly path: TrackPath;
  readonly roster: RacerInfo[];
  readonly world: RAPIER.World;
  private acc = 0;
  private prev = new Map<number, CarView>();
  private cur = new Map<number, CarView>();
  private out = new Map<number, CarView>();

  constructor(
    readonly sim: RaceSim,
    readonly localIds: number[],
  ) {
    this.config = sim.config;
    this.path = sim.path;
    this.roster = sim.racers.map((r) => r.info);
    this.world = sim.world;
    this.snap();
    this.snap();
  }

  private snap() {
    for (const r of this.sim.racers) {
      const c = this.cur.get(r.id) ?? emptyCarView(r.id);
      const p = this.prev.get(r.id) ?? emptyCarView(r.id);
      // prev <- cur, cur <- sim
      Object.assign(p, c, { p: { ...c.p }, q: { ...c.q }, comp: [...c.comp] });
      this.prev.set(r.id, p);
      this.cur.set(r.id, viewOf(r, c));
    }
  }

  update(dt: number, inputs: Map<number, RaceInput>): RaceEvent[] {
    const events: RaceEvent[] = [];
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT) {
      for (const [id, inp] of inputs) this.sim.setInput(id, inp);
      this.sim.step();
      events.push(...this.sim.drainEvents());
      this.snap();
      this.acc -= DT;
    }
    return events;
  }

  cars(): CarView[] {
    const t = this.acc / DT;
    return this.sim.racers.map((r) => blend(this.prev.get(r.id)!, this.cur.get(r.id)!, t, this.out.get(r.id) ?? (this.out.set(r.id, emptyCarView(r.id)), this.out.get(r.id)!)));
  }

  phase() {
    return this.sim.phase;
  }
  phaseT() {
    return this.sim.phaseT;
  }
  time() {
    return this.sim.time;
  }
  boxes() {
    return this.sim.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, on: b.t <= 0 }));
  }
  hazards() {
    return this.sim.hazards;
  }
  result() {
    return this.sim.result;
  }
  xp(id: number) {
    return this.sim.result ? xpForRace(this.sim.result, id) : 0;
  }
  ping() {
    return null;
  }
  finishNow() {
    this.sim.end();
  }
  dispose() {
    this.sim.dispose();
  }
}

export const phaseIndex = (p: RacePhase) => RACE_PHASES.indexOf(p);
