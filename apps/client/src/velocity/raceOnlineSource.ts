import RAPIER from '@dimforge/rapier3d-compat';
import {
  DT, emptyCarView, emptyRaceInput, MSG, nearestSample, packRaceInput, RACE_PHASES, RaceSim, registerTrack, TICK_RATE, unpackRacer,
  type CarView, type RaceEnd, type RaceEvent, type RaceInput, type RacePhase, type RaceResult, type RaceSnapshot, type RaceStart,
} from '@chromashift/shared';
import type { NetRoom } from '../multiplayer/net';
import type { RaceSource } from './raceSource';

/*
 * A race hosted elsewhere. Every other car is drawn a moment in the past, between snapshots, so
 * they move smoothly. Your own car is driven here straight away (the same physics the host runs)
 * and nudged towards where the host says it is; if they disagree a lot (a respawn, a big hit) it
 * jumps to the host's position and replays the inputs the host hasn't seen yet.
 */

const INTERP_TICKS = 6;

interface Frame {
  k: number;
  cars: Map<number, CarView>;
}
interface Hist {
  seq: number;
  inp: RaceInput;
  p: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
}

export class OnlineRaceSource implements RaceSource {
  readonly online = true;
  readonly config;
  readonly path;
  readonly roster;
  readonly localIds: number[];
  readonly world: RAPIER.World;
  private sim: RaceSim;
  private you: number;
  private frames: Frame[] = [];
  private latestK = 0;
  private renderK = -1;
  private acc = 0;
  private seq = 0;
  private hist: Hist[] = [];
  private outBuf: number[][] = [];
  private sendT = 0;
  private events: RaceEvent[] = [];
  private ph: RacePhase = 'grid';
  private pt = 0;
  private tm = 0;
  private tmAt = performance.now();
  private boxList: { x: number; y: number; z: number; on: boolean }[] = [];
  private hz: { id: number; kind: 'slick' | 'decoy'; x: number; y: number; z: number; age: number }[] = [];
  private end: RaceEnd | null = null;
  private pingMs: number | null = null;
  private pingTimer: number;
  private offs: (() => void)[] = [];
  private server = new Map<number, CarView>();
  private views = new Map<number, CarView>();

  constructor(
    private room: NetRoom,
    start: RaceStart,
  ) {
    if (start.track) registerTrack(start.track);
    this.sim = new RaceSim(start.config, start.racers);
    this.config = this.sim.config;
    this.path = this.sim.path;
    this.roster = this.sim.racers.map((r) => r.info);
    this.world = this.sim.world;
    this.you = start.you;
    this.localIds = [start.you];
    // Everyone else is placed from snapshots, not simulated here.
    for (const r of this.sim.racers) if (r.id !== this.you) r.car.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.boxList = this.sim.boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, on: true }));
    this.offs.push(room.onMessage(MSG.SNAP, (s: RaceSnapshot) => this.onSnap(s)));
    this.offs.push(
      room.onMessage(MSG.END, (e: RaceEnd) => {
        if (e?.race) {
          this.end = e;
          this.ph = 'ended';
        }
      }),
    );
    this.pingTimer = window.setInterval(() => room.ping((ms) => (this.pingMs = Math.round(ms))), 2000);
  }

  private me() {
    return this.sim.byId(this.you)!;
  }

  private onSnap(s: RaceSnapshot) {
    const cars = new Map<number, CarView>();
    for (const a of s.c) {
      const v = emptyCarView(0);
      const id = unpackRacer(a, v);
      if (id >= 0) cars.set(id, v);
    }
    this.frames.push({ k: s.k, cars });
    if (this.frames.length > 40) this.frames.shift();
    this.latestK = Math.max(this.latestK, s.k);
    this.ph = this.end ? 'ended' : (RACE_PHASES[s.ph] ?? 'racing');
    this.pt = s.pt / 10;
    this.tm = s.tm / 100;
    this.tmAt = performance.now();
    if (Array.isArray(s.e)) this.events.push(...s.e);
    const missing = new Set(s.b ?? []);
    this.boxList.forEach((b, i) => (b.on = !missing.has(i)));
    this.hz = (s.hz ?? []).map((h) => ({ id: h[0], kind: h[1] ? 'decoy' : 'slick', x: h[2] / 100, y: h[3] / 100, z: h[4] / 100, age: h[5] / 10 }));
    for (const [id, v] of cars) this.server.set(id, v);
    // Reconcile our own car.
    const sv = cars.get(this.you);
    if (sv) this.reconcile(sv);
  }

  private reconcile(sv: CarView) {
    const me = this.me();
    const car = me.car;
    // Race state is the host's: damage (and its handling effects), ghosting, meter.
    car.damage.set(sv.damage);
    car.refreshDamage(this.config.damage === 'full');
    if (sv.ghost !== car.ghostT > 0) {
      car.ghostT = sv.ghost ? 1 : 0;
      car.setGhost(sv.ghost);
    }
    car.meter = sv.meter;
    car.shieldT = sv.shield ? 1 : 0;
    car.spunT = sv.spun ? 0.3 : 0;
    car.slipT = sv.slipstream ? 1 : 0;
    me.sample = sv.sample;
    car.sample = sv.sample;
    const h = this.hist.find((x) => x.seq === sv.lastSeq);
    this.hist = this.hist.filter((x) => x.seq > sv.lastSeq);
    if (!h) return;
    const ex = sv.p.x - h.p.x, ey = sv.p.y - h.p.y, ez = sv.p.z - h.p.z;
    const err = Math.hypot(ex, ey, ez);
    const b = car.body;
    if (err > 3) {
      // Way off (respawn, big crash): take the host's state and replay what it hasn't seen.
      b.setTranslation(sv.p, true);
      b.setRotation(sv.q, true);
      b.setLinvel(sv.v, true);
      b.setAngvel(sv.w, true);
      for (const x of this.hist) {
        car.drive(x.inp, DT, this.path, this.locked());
        this.world.step();
        const p = b.translation();
        x.p = { x: p.x, y: p.y, z: p.z };
      }
      return;
    }
    if (err < 0.02) return;
    // A little off: ease towards it.
    const k = 0.18;
    const t = b.translation();
    b.setTranslation({ x: t.x + ex * k, y: t.y + ey * k, z: t.z + ez * k }, true);
    const v = b.linvel();
    b.setLinvel({ x: v.x + (sv.v.x - h.v.x) * k, y: v.y + (sv.v.y - h.v.y) * k, z: v.z + (sv.v.z - h.v.z) * k }, true);
    for (const x of this.hist) {
      x.p.x += ex * k;
      x.p.y += ey * k;
      x.p.z += ez * k;
    }
  }

  private locked() {
    return this.ph === 'grid' || this.ph === 'countdown';
  }

  /** A remote car at render time, between the two snapshots around it. */
  private remoteAt(id: number, out: CarView): boolean {
    const f = this.frames;
    if (!f.length) return false;
    let a = f[0], c = f[f.length - 1];
    for (let j = 0; j < f.length - 1; j++)
      if (f[j].k <= this.renderK && f[j + 1].k >= this.renderK) {
        a = f[j];
        c = f[j + 1];
        break;
      }
    const va = a.cars.get(id), vc = c.cars.get(id);
    if (!va || !vc) {
      const any = vc ?? va;
      if (!any) return false;
      Object.assign(out, any);
      return true;
    }
    const t = c.k > a.k ? Math.min(1, Math.max(0, (this.renderK - a.k) / (c.k - a.k))) : 1;
    Object.assign(out, vc);
    out.p = { x: va.p.x + (vc.p.x - va.p.x) * t, y: va.p.y + (vc.p.y - va.p.y) * t, z: va.p.z + (vc.p.z - va.p.z) * t };
    const dot = va.q.x * vc.q.x + va.q.y * vc.q.y + va.q.z * vc.q.z + va.q.w * vc.q.w;
    const s = dot < 0 ? -1 : 1;
    const q = { x: va.q.x * s + (vc.q.x - va.q.x * s) * t, y: va.q.y * s + (vc.q.y - va.q.y * s) * t, z: va.q.z * s + (vc.q.z - va.q.z * s) * t, w: va.q.w * s + (vc.q.w - va.q.w * s) * t };
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    out.q = { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
    out.steer = va.steer + (vc.steer - va.steer) * t;
    return true;
  }

  update(dt: number, inputs: Map<number, RaceInput>): RaceEvent[] {
    const inp = inputs.get(this.you) ?? emptyRaceInput();
    this.renderK += dt * TICK_RATE;
    const target = this.latestK - INTERP_TICKS;
    if (Math.abs(this.renderK - target) > 30) this.renderK = target;
    else this.renderK += (target - this.renderK) * 0.05;
    // Move the other cars to where they were at render time (kinematic, so we bump into them).
    for (const r of this.sim.racers) {
      if (r.id === this.you) continue;
      const v = this.views.get(r.id) ?? emptyCarView(r.id);
      if (this.remoteAt(r.id, v)) {
        this.views.set(r.id, v);
        r.car.body.setNextKinematicTranslation(v.p);
        r.car.body.setNextKinematicRotation(v.q);
      }
    }
    this.acc = Math.min(this.acc + dt, 0.25);
    const me = this.me();
    while (this.acc >= DT) {
      const i: RaceInput = { ...inp, seq: ++this.seq };
      this.outBuf.push(packRaceInput(i));
      if (this.ph !== 'ended') {
        me.car.drive(i, DT, this.path, this.locked());
        this.world.step();
        const p = me.car.body.translation();
        me.sample = nearestSample(this.path, p.x, p.y, p.z, me.sample);
        me.car.sample = me.sample;
        const v = me.car.body.linvel();
        this.hist.push({ seq: i.seq, inp: i, p: { x: p.x, y: p.y, z: p.z }, v: { x: v.x, y: v.y, z: v.z } });
        if (this.hist.length > 240) this.hist.shift();
      }
      this.acc -= DT;
    }
    this.sendT += dt;
    if (this.sendT >= 1 / 30 && this.outBuf.length) {
      this.room.send(MSG.INPUT, this.outBuf.slice(-10));
      this.outBuf = [];
      this.sendT = 0;
    }
    const e = this.events;
    this.events = [];
    return e;
  }

  cars(): CarView[] {
    const out: CarView[] = [];
    for (const r of this.sim.racers) {
      if (r.id === this.you) {
        const sv = this.server.get(r.id) ?? emptyCarView(r.id);
        const v = this.views.get(r.id) ?? emptyCarView(r.id);
        Object.assign(v, sv);
        const c = r.car, b = c.body;
        const p = b.translation(), q = b.rotation(), lv = b.linvel(), w = b.angvel();
        v.id = r.id;
        v.p = { x: p.x, y: p.y, z: p.z };
        v.q = { x: q.x, y: q.y, z: q.z, w: q.w };
        v.v = { x: lv.x, y: lv.y, z: lv.z };
        v.w = { x: w.x, y: w.y, z: w.z };
        v.steer = c.steer;
        v.comp = [...c.comp];
        v.drift = c.drift > 0;
        v.driftT = c.drift;
        v.rpm = c.rpm;
        v.gear = c.gear;
        v.throttle = c.throttle;
        v.slip = c.slip;
        v.boost = c.boosting;
        v.meter = c.meter;
        this.views.set(r.id, v);
        out.push(v);
      } else {
        const v = this.views.get(r.id);
        if (v) out.push(v);
      }
    }
    return out;
  }

  phase() {
    return this.ph;
  }
  phaseT() {
    return this.pt + (this.ph === 'countdown' ? (performance.now() - this.tmAt) / 1000 : 0);
  }
  time() {
    return this.ph === 'racing' ? this.tm + (performance.now() - this.tmAt) / 1000 : this.tm;
  }
  boxes() {
    return this.boxList;
  }
  hazards() {
    return this.hz;
  }
  result(): RaceResult | null {
    return this.end?.result ?? null;
  }
  xp(id: number) {
    return this.end?.xp[id] ?? 0;
  }
  ping() {
    return this.pingMs;
  }
  dispose() {
    for (const off of this.offs) off();
    clearInterval(this.pingTimer);
    this.sim.dispose();
  }
}
