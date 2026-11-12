import RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../constants';
import type { BotDifficulty } from '../config/modes';
import { mulberry32 } from '../rng';
import { RaceBot } from './bot';
import { Car, emptyRaceInput, RB, rotate, type RaceInput } from './car';
import { sanitizeCarLoadout, type CarLoadout } from './catalog';
import { CAR_HALF, COUNTDOWN, DEFAULT_HANDLING, FINISH_GRACE, MAX_RACERS, sanitizeHandling, type DamageMode, type Handling, type RacePreset } from './config';
import { applyImpact, PART_INDEX } from './damage';
import { BOX_RESPAWN, DECOY_LIFE, rollItem, SHOCK_RADIUS, SLICK_LIFE, type ItemId } from './pickups';
import { lateralOffset, nearestSample, type TrackPath } from './track';
import { trackPath } from './tracks';
import { buildTrackColliders } from './trackWorld';

export interface RacerInfo {
  id: number;
  name: string;
  bot: boolean;
  difficulty?: BotDifficulty;
  car: CarLoadout;
  /** Racing identity colour 0–5. */
  identity: number;
  uid?: string;
  admin?: boolean;
}

export interface RaceConfig {
  track: string;
  laps: number;
  preset: RacePreset;
  damage: DamageMode;
  seed: number;
  /** Owner-tuned handling (everyone in the race shares it). */
  handling?: Partial<Handling>;
}

export type RacePhase = 'grid' | 'countdown' | 'racing' | 'ended';
export const RACE_PHASES: RacePhase[] = ['grid', 'countdown', 'racing', 'ended'];

export interface RacerStats {
  distance: number;
  collisions: number;
  overtakes: number;
  driftTime: number;
  boosts: number;
  topSpeed: number;
  respawns: number;
}

export interface Racer {
  id: number;
  info: RacerInfo;
  car: Car;
  input: RaceInput;
  bot: RaceBot | null;
  /** Laps completed. */
  lap: number;
  nextCp: number;
  /** Continuous progress in samples (lap × n + distance into the lap). */
  prog: number;
  sample: number;
  finished: boolean;
  /** Race time when they finished, seconds. */
  finishT: number;
  lapStart: number;
  lapTimes: number[];
  best: number;
  position: number;
  wrong: boolean;
  wrongT: number;
  offT: number;
  flipT: number;
  stuckT: number;
  resetCd: number;
  item: ItemId | null;
  prevButtons: number;
  stats: RacerStats;
  /** Seconds since the last impact event (to spread them out). */
  hitCd: number;
  lastSeq: number;
  prevBoost?: boolean;
  /** Furthest progress lately (for stuck detection). */
  bestProg: number;
  /** Place that has held for a while, for counting overtakes. */
  heldPos: number;
  heldT: number;
}

export type RaceEvent =
  | { t: 'count'; n: number }
  | { t: 'go' }
  | { t: 'cp'; id: number }
  | { t: 'lap'; id: number; lap: number; time: number; best: boolean }
  | { t: 'finish'; id: number; pos: number; time: number }
  | { t: 'impact'; id: number; x: number; y: number; z: number; dv: number; part: number }
  | { t: 'drift'; id: number; tier: number }
  | { t: 'item'; id: number; item: ItemId }
  | { t: 'use'; id: number; item: ItemId; x: number; y: number; z: number }
  | { t: 'respawn'; id: number }
  | { t: 'horn'; id: number }
  | { t: 'overtake'; id: number; pos: number }
  | { t: 'spin'; id: number }
  | { t: 'wrong'; id: number; on: boolean };

export interface Box {
  x: number;
  y: number;
  z: number;
  /** Seconds until it's back (0 = there). */
  t: number;
}
export interface Hazard {
  id: number;
  kind: 'slick' | 'decoy';
  x: number;
  y: number;
  z: number;
  life: number;
  owner: number;
  age: number;
}

export interface RaceResultRow {
  id: number;
  name: string;
  bot: boolean;
  identity: number;
  body: string;
  position: number;
  finished: boolean;
  /** Seconds, or null if they didn't finish. */
  time: number | null;
  best: number | null;
  laps: number[];
  stats: RacerStats;
  uid?: string;
}

export interface RaceResult {
  track: string;
  laps: number;
  preset: RacePreset;
  damage: DamageMode;
  players: RaceResultRow[];
  fastest: { id: number; time: number } | null;
}

/**
 * One race. The same class runs offline, on a browser host and on a dedicated server; it alone
 * decides positions, laps, collisions, damage, pickups and results.
 */
export class RaceSim {
  readonly world: RAPIER.World;
  readonly path: TrackPath;
  readonly handling: Handling;
  readonly racers: Racer[] = [];
  readonly boxes: Box[] = [];
  readonly hazards: Hazard[] = [];
  phase: RacePhase = 'grid';
  phaseT = 0;
  /** Seconds since the green light. */
  time = 0;
  tick = 0;
  result: RaceResult | null = null;
  private events: RaceEvent[] = [];
  private queue = new RAPIER.EventQueue(true);
  private rnd: () => number;
  private byCollider = new Map<number, Racer>();
  private finishers = 0;
  private graceT = -1;
  private hazardId = 1;

  /** Requires initPhysics() first. */
  constructor(
    readonly config: RaceConfig,
    infos: RacerInfo[],
  ) {
    this.path = trackPath(config.track);
    this.handling = config.handling ? sanitizeHandling({ ...DEFAULT_HANDLING, ...config.handling }) : DEFAULT_HANDLING;
    this.rnd = mulberry32(config.seed >>> 0);
    this.world = new RAPIER.World({ x: 0, y: -9.81 * 1.6, z: 0 });
    this.world.timestep = DT;
    buildTrackColliders(this.world, this.path);
    for (const info of infos.slice(0, MAX_RACERS)) this.addRacer(info);
    if (config.preset === 'arcade')
      for (const i of this.path.items) {
        const p = this.path;
        for (const f of [-0.62, -0.2, 0.2, 0.62]) {
          const o = f * p.w[i];
          this.boxes.push({ x: p.px[i] + p.lx[i] * o, y: p.py[i] + p.ly[i] * o + 1, z: p.pz[i] + p.lz[i] * o, t: 0 });
        }
      }
    this.world.step(this.queue);
  }

  /** Grid slot for a racer (in join order). */
  private slot(k: number) {
    return this.path.grid[k % this.path.grid.length];
  }

  addRacer(info: RacerInfo, slot = this.racers.length) {
    const g = this.slot(slot);
    const car = new Car(this.world, this.handling, g.x, g.y + 0.9, g.z, g.yaw);
    const r: Racer = {
      id: info.id,
      info: { ...info, car: sanitizeCarLoadout(info.car) },
      car,
      input: emptyRaceInput(),
      bot: info.bot ? new RaceBot(info.difficulty ?? 'normal', info.id) : null,
      lap: 0,
      nextCp: 1,
      prog: g.i - this.path.n,
      sample: g.i,
      finished: false,
      finishT: 0,
      lapStart: 0,
      lapTimes: [],
      best: 0,
      position: this.racers.length + 1,
      wrong: false,
      wrongT: 0,
      offT: 0,
      flipT: 0,
      stuckT: 0,
      resetCd: 0,
      item: null,
      prevButtons: 0,
      stats: { distance: 0, collisions: 0, overtakes: 0, driftTime: 0, boosts: 0, topSpeed: 0, respawns: 0 },
      hitCd: 0,
      lastSeq: 0,
      bestProg: g.i - this.path.n,
      heldPos: this.racers.length + 1,
      heldT: 0,
    };
    car.sample = g.i;
    car.refreshDamage(this.config.damage === 'full');
    this.racers.push(r);
    this.byCollider.set(car.collider.handle, r);
    return r;
  }

  byId(id: number) {
    return this.racers.find((r) => r.id === id);
  }

  /** A person takes over a bot's car, or leaves theirs to a bot. */
  setBot(id: number, difficulty: BotDifficulty | null) {
    const r = this.byId(id);
    if (!r) return;
    r.bot = difficulty ? new RaceBot(difficulty, id) : null;
    r.info = { ...r.info, bot: !!difficulty };
  }

  setInput(id: number, inp: RaceInput) {
    const r = this.byId(id);
    if (!r) return;
    r.input = inp;
    r.lastSeq = inp.seq;
  }

  drainEvents(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: RaceEvent) {
    this.events.push(e);
  }

  step() {
    this.tick++;
    this.phaseT += DT;
    if (this.phase === 'grid' && this.phaseT >= 2.2) {
      this.phase = 'countdown';
      this.phaseT = 0;
      this.emit({ t: 'count', n: COUNTDOWN });
    } else if (this.phase === 'countdown') {
      const before = Math.ceil(COUNTDOWN - (this.phaseT - DT));
      const now = Math.ceil(COUNTDOWN - this.phaseT);
      if (now !== before && now > 0) this.emit({ t: 'count', n: now });
      if (this.phaseT >= COUNTDOWN) {
        this.phase = 'racing';
        this.phaseT = 0;
        this.emit({ t: 'go' });
      }
    }
    const racing = this.phase === 'racing';
    if (racing) this.time += DT;
    const locked = this.phase === 'grid' || this.phase === 'countdown';

    for (const r of this.racers) {
      const car = r.car;
      if (r.bot || (r.finished && !r.bot)) {
        // Finished people cruise home on autopilot.
        const bot = r.bot ?? (r.bot = new RaceBot('easy', r.id));
        r.input = bot.think(this, r);
        if (r.finished && !r.info.bot) r.input.throttle *= 0.6;
      }
      const inp = r.input;
      const pressed = inp.buttons & ~r.prevButtons;
      r.prevButtons = inp.buttons;
      if (pressed & RB.HORN) this.emit({ t: 'horn', id: r.id });
      if (racing && pressed & RB.ITEM && r.item) this.useItem(r);
      r.resetCd = Math.max(0, r.resetCd - DT);
      if (!locked && inp.buttons & RB.RESET && r.resetCd === 0) this.respawn(r);
      const meterBefore = car.meter;
      const out = car.drive(inp, DT, this.path, locked);
      if (inp.buttons & RB.BOOST && car.meter < meterBefore && meterBefore > 0.01 && !(r.prevBoost ?? false)) r.stats.boosts++;
      r.prevBoost = (inp.buttons & RB.BOOST) !== 0 && car.meter > 0.01;
      if (out.released) this.emit({ t: 'drift', id: r.id, tier: out.released });
      if (car.drift > 0) r.stats.driftTime += DT;
      car.shieldT = Math.max(0, car.shieldT - DT);
      car.spunT = Math.max(0, car.spunT - DT);
      car.slipT = Math.max(0, car.slipT - DT);
      car.draftT = Math.max(0, car.draftT - DT);
      if (car.ghostT > 0) {
        car.ghostT -= DT;
        if (car.ghostT <= 0) car.setGhost(false);
      }
      r.hitCd = Math.max(0, r.hitCd - DT);
    }

    this.world.step(this.queue);
    this.queue.drainContactForceEvents((e) => this.contact(e.collider1(), e.collider2(), e.totalForceMagnitude()));

    const n = this.path.n;
    const cps = this.path.checkpoints;
    for (const r of this.racers) {
      const car = r.car;
      const p = car.body.translation();
      const v = car.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (racing && !r.finished) {
        r.stats.distance += speed * DT;
        r.stats.topSpeed = Math.max(r.stats.topSpeed, speed);
      }
      // Progress along the lap.
      const i = nearestSample(this.path, p.x, p.y, p.z, r.sample);
      let d = i - r.sample;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      r.prog += d;
      r.sample = i;
      car.sample = i;
      if (racing && !r.finished) {
        for (let guard = 0; guard < 4; guard++) {
          const target = r.nextCp < cps.length ? r.lap * n + cps[r.nextCp] : (r.lap + 1) * n;
          if (r.prog < target) break;
          if (r.nextCp < cps.length) {
            r.nextCp++;
            this.emit({ t: 'cp', id: r.id });
          } else this.completeLap(r);
        }
      }
      // Wrong way.
      const along = v.x * this.path.tx[i] + v.y * this.path.ty[i] + v.z * this.path.tz[i];
      r.wrongT = along < -4 ? r.wrongT + DT : Math.max(0, r.wrongT - DT * 2);
      const wrong = r.wrongT > 1.2;
      if (wrong !== r.wrong) {
        r.wrong = wrong;
        this.emit({ t: 'wrong', id: r.id, on: wrong });
      }
      if (locked) continue;
      // Off the track, upside down, fallen or stuck: back on the road.
      const off = lateralOffset(this.path, i, p.x, p.y, p.z);
      const away = Math.abs(off) > this.path.w[i] + this.path.def.shoulder + 2.5 || Math.abs(p.y - this.path.py[i]) > 5;
      r.offT = away ? r.offT + DT : 0;
      r.flipT = car.upsideDown() ? r.flipT + DT : 0;
      // Stuck: trying to drive but getting nowhere along the lap (pinned, or scraping a wall).
      const trying = r.input.throttle > 0.4 || r.input.brake > 0.4;
      if (r.prog > r.bestProg + 2 || r.finished) {
        r.bestProg = r.prog;
        r.stuckT = 0;
      } else if (trying) r.stuckT += DT;
      if (p.y < this.path.bounds.minY - 14 || r.offT > 2.2 || r.flipT > 1.8 || r.stuckT > 8) this.respawn(r);
    }

    if (!locked) {
      this.drafting();
      this.pickups();
    }
    this.rank();

    if (racing) {
      if (this.graceT >= 0) this.graceT += DT;
      const done = this.racers.every((r) => r.finished);
      const humans = this.racers.filter((r) => !r.info.bot);
      const humansDone = humans.length > 0 && humans.every((r) => r.finished);
      const cap = this.config.laps * 300 + 60;
      if (done || this.graceT >= FINISH_GRACE || (humansDone && this.graceT >= 12) || this.time > cap) this.end();
    }
  }

  private completeLap(r: Racer) {
    const lapTime = this.time - r.lapStart;
    r.lapTimes.push(lapTime);
    r.lapStart = this.time;
    r.lap++;
    r.nextCp = 1;
    const isBest = !r.best || lapTime < r.best;
    if (isBest) r.best = lapTime;
    this.emit({ t: 'lap', id: r.id, lap: r.lap, time: lapTime, best: isBest });
    if (r.lap >= this.config.laps) {
      r.finished = true;
      r.finishT = this.time;
      // Finished cars pass through the rest of the field, so they never block anyone.
      r.car.ghostT = 1e9;
      r.car.setGhost(true);
      this.finishers++;
      r.position = this.finishers;
      if (this.graceT < 0) this.graceT = 0;
      this.emit({ t: 'finish', id: r.id, pos: r.position, time: r.finishT });
    }
  }

  /** Ends the race now (everyone still driving keeps their place by progress). */
  end() {
    if (this.phase === 'ended') return;
    this.rank();
    this.phase = 'ended';
    this.phaseT = 0;
    let fastest: RaceResult['fastest'] = null;
    for (const r of this.racers) if (r.best && (!fastest || r.best < fastest.time)) fastest = { id: r.id, time: r.best };
    this.result = {
      track: this.config.track,
      laps: this.config.laps,
      preset: this.config.preset,
      damage: this.config.damage,
      fastest,
      players: [...this.racers]
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          id: r.id,
          name: r.info.name,
          bot: r.info.bot,
          identity: r.info.identity,
          body: r.info.car.body,
          position: r.position,
          finished: r.finished,
          time: r.finished ? r.finishT : null,
          best: r.best || null,
          laps: r.lapTimes,
          stats: { ...r.stats },
          ...(r.info.uid ? { uid: r.info.uid } : {}),
        })),
    };
  }

  /** Places by finish order, then by progress. Counts overtakes. */
  private rank() {
    const order = [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishT - b.finishT;
      return b.prog - a.prog;
    });
    order.forEach((r, k) => {
      const pos = k + 1;
      if (!r.finished) r.position = pos;
      // An overtake counts once the new place has held for a second (side-by-side jostling doesn't).
      if (pos === r.heldPos) r.heldT = 0;
      else if ((r.heldT += DT) > 1 || this.phase !== 'racing') {
        if (this.phase === 'racing' && !r.finished && pos < r.heldPos && r.car.ghostT <= 0) {
          r.stats.overtakes += r.heldPos - pos;
          this.emit({ t: 'overtake', id: r.id, pos });
        }
        r.heldPos = pos;
        r.heldT = 0;
      }
    });
  }

  /** Back onto the road a little behind where the car was, facing the right way, briefly a ghost. */
  respawn(r: Racer) {
    const p = this.path, n = p.n;
    const i = (r.sample - 3 + n) % n;
    const yaw = Math.atan2(p.tx[i], p.tz[i]);
    const o = Math.max(-p.w[i] * 0.5, Math.min(p.w[i] * 0.5, p.line[i]));
    r.car.place(p.px[i] + p.lx[i] * o, p.py[i] + p.ly[i] * o + 1.1, p.pz[i] + p.lz[i] * o, yaw);
    r.car.ghostT = 2.2;
    r.car.setGhost(true);
    r.resetCd = 2;
    r.offT = r.flipT = r.stuckT = 0;
    r.bestProg = r.prog;
    r.wrongT = 0;
    r.sample = i;
    r.car.sample = i;
    r.stats.respawns++;
    r.bot?.reset();
    this.emit({ t: 'respawn', id: r.id });
  }

  /** Real impact data → damage (and the shield's shove). */
  private contact(h1: number, h2: number, force: number) {
    const a = this.byCollider.get(h1), b = this.byCollider.get(h2);
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (!me) continue;
      const otherCol = other ? other.car.collider : this.world.getCollider(me === a ? h2 : h1);
      if (!otherCol) continue;
      const dv = (force * DT) / this.handling.mass;
      let lx = 0, lz = 0, found = false;
      this.world.contactPair(me.car.collider, otherCol, (m, flipped) => {
        if (found || m.numContacts() === 0) return;
        const c = flipped ? m.localContactPoint2(0) : m.localContactPoint1(0);
        if (!c) return;
        lx = c.x;
        lz = c.z;
        found = true;
      });
      if (!found) continue;
      const t = me.car.body.translation();
      const q = me.car.body.rotation();
      const w = rotate(q, lx, 0.12, lz, { x: 0, y: 0, z: 0 });
      const wx = t.x + w.x;
      const wy = t.y + w.y;
      const wz = t.z + w.z;
      if (dv > 3 && this.phase === 'racing') me.stats.collisions++;
      if (me.car.shieldT > 0) {
        if (other && other.car.shieldT <= 0) {
          const ot = other.car.body.translation();
          const dx = ot.x - t.x, dz = ot.z - t.z, l = Math.hypot(dx, dz) || 1;
          const k = this.handling.mass * 5;
          other.car.body.applyImpulse({ x: (dx / l) * k, y: this.handling.mass * 1.2, z: (dz / l) * k }, true);
        }
        continue;
      }
      let part = -1;
      if (this.config.damage !== 'off' && this.phase !== 'grid' && this.phase !== 'countdown') {
        const hit = applyImpact(me.car.damage, lx, lz, dv, CAR_HALF.x, CAR_HALF.z);
        if (hit) {
          part = PART_INDEX[hit];
          me.car.refreshDamage(this.config.damage === 'full');
        }
      }
      if ((dv > 3 || part >= 0) && me.hitCd === 0) {
        me.hitCd = 0.25;
        this.emit({ t: 'impact', id: me.id, x: wx, y: wy, z: wz, dv, part });
      }
    }
  }

  /** Following close behind another car cuts drag and fills the boost meter. */
  private drafting() {
    for (const a of this.racers) {
      const va = a.car.body.linvel();
      const sa = Math.hypot(va.x, va.z);
      if (sa < 16) continue;
      const pa = a.car.body.translation();
      const fx = va.x / sa, fz = va.z / sa;
      for (const b of this.racers) {
        if (a === b) continue;
        const pb = b.car.body.translation();
        const dx = pb.x - pa.x, dz = pb.z - pa.z;
        const ahead = dx * fx + dz * fz;
        if (ahead < 3 || ahead > 22) continue;
        const side = Math.abs(dx * fz - dz * fx);
        if (side > 2.4 || Math.abs(pb.y - pa.y) > 2) continue;
        a.car.draftT = 0.25;
        a.car.meter = Math.min(1, a.car.meter + DT * 0.05);
        break;
      }
    }
  }

  private place(r: Racer) {
    return this.racers.length > 1 ? (r.position - 1) / (this.racers.length - 1) : 0;
  }

  private pickups() {
    for (const b of this.boxes) {
      if (b.t > 0) {
        b.t = Math.max(0, b.t - DT);
        continue;
      }
      for (const r of this.racers) {
        const p = r.car.body.translation();
        if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 > 2.6 ** 2 || Math.abs(p.y - b.y) > 2.5) continue;
        b.t = BOX_RESPAWN;
        if (!r.item && !r.finished) {
          r.item = rollItem(this.place(r), this.rnd());
          this.emit({ t: 'item', id: r.id, item: r.item });
        }
        break;
      }
    }
    for (let k = this.hazards.length - 1; k >= 0; k--) {
      const hz = this.hazards[k];
      hz.age += DT;
      if (hz.age >= hz.life) {
        this.hazards.splice(k, 1);
        continue;
      }
      for (const r of this.racers) {
        if (r.id === hz.owner && hz.age < 1.5) continue;
        if (r.car.shieldT > 0 || r.car.ghostT > 0) continue;
        const p = r.car.body.translation();
        const rad = hz.kind === 'slick' ? 3.4 : 2.4;
        if ((p.x - hz.x) ** 2 + (p.z - hz.z) ** 2 > rad * rad || Math.abs(p.y - hz.y) > 2.5) continue;
        if (hz.kind === 'slick') {
          if (r.car.spunT <= 0) {
            r.car.spunT = 1.3;
            const s = (this.rnd() < 0.5 ? -1 : 1) * this.handling.mass * 2.6;
            r.car.body.applyTorqueImpulse({ x: 0, y: s, z: 0 }, true);
            this.emit({ t: 'spin', id: r.id });
          }
        } else {
          const v = r.car.body.linvel();
          const m = this.handling.mass;
          r.car.body.applyImpulse({ x: -v.x * m * 0.45, y: m * 5.5, z: -v.z * m * 0.45 }, true);
          r.item = null;
          this.hazards.splice(k, 1);
          this.emit({ t: 'spin', id: r.id });
          break;
        }
      }
    }
  }

  private behind(r: Racer, dist: number) {
    const p = this.path;
    const i = (r.sample - Math.round(dist / (p.length / p.n)) + p.n) % p.n;
    return { x: p.px[i], y: p.py[i] + 0.4, z: p.pz[i], i };
  }

  private useItem(r: Racer) {
    const item = r.item!;
    r.item = null;
    const car = r.car;
    const at = car.body.translation();
    switch (item) {
      case 'turbo':
        car.turboT = 2.2;
        r.stats.boosts++;
        break;
      case 'shield':
        car.shieldT = 5;
        break;
      case 'slick':
      case 'decoy': {
        const b = this.behind(r, item === 'slick' ? 6 : 7);
        const off = lateralOffset(this.path, b.i, at.x, at.y, at.z);
        const p = this.path;
        this.hazards.push({
          id: this.hazardId++,
          kind: item,
          x: b.x + p.lx[b.i] * off,
          y: b.y + p.ly[b.i] * off + (item === 'decoy' ? 0.6 : 0),
          z: b.z + p.lz[b.i] * off,
          life: item === 'slick' ? SLICK_LIFE : DECOY_LIFE,
          owner: r.id,
          age: 0,
        });
        break;
      }
      case 'shock':
        for (const o of this.racers) {
          if (o === r || o.car.shieldT > 0 || o.car.ghostT > 0) continue;
          const p = o.car.body.translation();
          const dx = p.x - at.x, dz = p.z - at.z, d = Math.hypot(dx, dz);
          if (d > SHOCK_RADIUS || d < 0.01) continue;
          const k = this.handling.mass * (9 - d * 0.45);
          o.car.body.applyImpulse({ x: (dx / d) * k, y: this.handling.mass * 2.2, z: (dz / d) * k }, true);
        }
        break;
      case 'repair':
        for (let i = 0; i < car.damage.length; i++) car.damage[i] *= 0.45;
        car.refreshDamage(this.config.damage === 'full');
        break;
      case 'slipstream':
        car.slipT = 6;
        break;
    }
    this.emit({ t: 'use', id: r.id, item, x: at.x, y: at.y, z: at.z });
  }

  dispose() {
    this.queue.free();
    this.world.free();
  }
}

