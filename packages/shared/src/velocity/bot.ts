import type { BotDifficulty } from '../config/modes';
import { mulberry32 } from '../rng';
import { emptyRaceInput, RB, rotate, type RaceInput } from './car';
import type { RaceSim, Racer } from './race';

/*
 * Racing bots. They drive with the same four controls a person has (steer, throttle, brake,
 * handbrake, plus boost and items), through the same physics: no extra speed, no teleporting.
 * They follow the track's racing line, brake for what's ahead by reading its curvature, drift the
 * long corners, pull out to pass, back out of walls, and use their items when they make sense.
 * Difficulty changes how close to the limit they drive, how cleanly and how quickly they react.
 */

interface Skill {
  /** Share of the reference cornering speed they dare to carry. */
  pace: number;
  /** How far off the racing line they wander, metres. */
  wobble: number;
  /** Reaction delay, seconds. */
  react: number;
  /** Chance per corner of braking too late or too early. */
  mistakes: number;
  drift: boolean;
  boost: number;
  itemSense: number;
}

const SKILL: Record<BotDifficulty, Skill> = {
  easy: { pace: 0.74, wobble: 1.6, react: 0.38, mistakes: 0.18, drift: false, boost: 0.25, itemSense: 0.3 },
  normal: { pace: 0.85, wobble: 0.9, react: 0.22, mistakes: 0.08, drift: true, boost: 0.6, itemSense: 0.6 },
  hard: { pace: 0.93, wobble: 0.45, react: 0.13, mistakes: 0.03, drift: true, boost: 0.85, itemSense: 0.85 },
  expert: { pace: 0.99, wobble: 0.2, react: 0.07, mistakes: 0.01, drift: true, boost: 1, itemSense: 1 },
};

const fwd = { x: 0, y: 0, z: 0 }, left = { x: 0, y: 0, z: 0 };

export class RaceBot {
  private s: Skill;
  private rnd: () => number;
  private seq = 0;
  /** Lateral offset for passing, and how long to hold it. */
  private pass = 0;
  private passT = 0;
  private wob = 0;
  private wobT = 0;
  private reverseT = 0;
  private stuckT = 0;
  private bestProg = -Infinity;
  private driftT = 0;
  private itemT = 0;
  private mistakeT = 0;
  private mistake = 1;
  private delayed: RaceInput[] = [];

  constructor(
    readonly difficulty: BotDifficulty,
    seed: number,
  ) {
    this.s = SKILL[difficulty];
    this.rnd = mulberry32(seed * 2654435761);
  }

  reset() {
    this.reverseT = this.stuckT = this.driftT = 0;
    this.bestProg = -Infinity;
    this.pass = this.passT = 0;
  }

  think(sim: RaceSim, me: Racer): RaceInput {
    const out = emptyRaceInput();
    out.seq = ++this.seq;
    const p = sim.path, n = p.n, car = me.car, s = this.s;
    const dt = 1 / 60;
    const pos = car.body.translation();
    const vel = car.body.linvel();
    const q = car.body.rotation();
    rotate(q, 0, 0, 1, fwd);
    rotate(q, 1, 0, 0, left);
    const speed = Math.hypot(vel.x, vel.z);
    const vf = vel.x * fwd.x + vel.y * fwd.y + vel.z * fwd.z;
    const step = p.length / n;

    // Wander a little around the line (less the better they are).
    this.wobT -= dt;
    if (this.wobT <= 0) {
      this.wobT = 1.5 + this.rnd() * 2.5;
      this.wob = (this.rnd() * 2 - 1) * s.wobble;
    }

    // Passing: a slower car close ahead on our line → pull out to the side with more room.
    this.passT -= dt;
    if (this.passT <= 0) this.pass *= 0.95;
    for (const o of sim.racers) {
      if (o === me) continue;
      const op = o.car.body.translation();
      const dx = op.x - pos.x, dz = op.z - pos.z;
      const ahead = dx * fwd.x + dz * fwd.z;
      const side = dx * left.x + dz * left.z;
      if (ahead < 0 || ahead > 16 + speed * 0.4 || Math.abs(side) > 3.2 || Math.abs(op.y - pos.y) > 3) continue;
      const ov = o.car.body.linvel();
      const closing = vf - (ov.x * fwd.x + ov.z * fwd.z);
      if (closing < 0.5 && ahead > 8) continue;
      const room = p.w[me.sample] - 2;
      const want = side > 0 ? -1 : 1;
      const cur = p.line[me.sample];
      this.pass = Math.max(-room - cur, Math.min(room - cur, want * 3.4));
      this.passT = 1.6;
      break;
    }

    // Target: a point on the racing line ahead, further at speed.
    // Look less far ahead in tight corners so the line doesn't cut into the inside wall.
    const tight = Math.min(1, Math.abs(p.curv[(me.sample + Math.round(8 / step)) % n]) * 30);
    const look = Math.round((6 + speed * (0.4 - 0.18 * tight)) / step);
    const ti = (me.sample + look) % n;
    const off = Math.max(-p.w[ti] + 1.2, Math.min(p.w[ti] - 1.2, p.line[ti] + this.wob + this.pass));
    const tx = p.px[ti] + p.lx[ti] * off, tz = p.pz[ti] + p.lz[ti] * off;
    const dx = tx - pos.x, dz = tz - pos.z;
    const lx = dx * left.x + dz * left.z, lz = dx * fwd.x + dz * fwd.z;
    let steer = Math.atan2(lx, Math.max(0.1, lz)) * 2.3;

    // Speed: the slowest corner within braking distance ahead, shaded by skill.
    let target = 80;
    // Far enough ahead to stop from this speed (v² / 2a), plus a margin.
    const brakeLook = Math.round((12 + (speed * speed) / 16) / step);
    for (let k = 0; k <= brakeLook; k += 2) {
      const i = (me.sample + k) % n;
      const v = p.speed[i] * s.pace * this.surfaceFactor(sim, i);
      // What we can still slow down to over the distance.
      const reach = Math.sqrt(v * v + 2 * 10 * k * step);
      target = Math.min(target, reach);
    }
    this.mistakeT -= dt;
    if (this.mistakeT <= 0) {
      this.mistakeT = 3 + this.rnd() * 4;
      this.mistake = this.rnd() < s.mistakes ? 0.85 + this.rnd() * 0.3 : 1;
    }
    target *= this.mistake;
    target = Math.min(target, car.h.topSpeed * 1.05);
    let throttle = 0, brake = 0;
    if (vf < target - 1.5) throttle = 1;
    else if (vf < target) throttle = 0.55;
    else if (vf > target + 2.5) brake = Math.min(1, (vf - target) / 7);

    // Drift through long, tight corners at speed.
    // Only long, open corners are worth drifting: judge by the sharpest point of the next 35 m.
    let curv = 0;
    for (let k = 0; k <= Math.round(35 / step); k += 2) curv = Math.max(curv, Math.abs(p.curv[(me.sample + k) % n]));
    let buttons = 0;
    if (s.drift && speed > 17 && curv > 1 / 75 && curv < 1 / 30) this.driftT = Math.min(this.driftT + dt, 2.8);
    else if (this.driftT > 0) this.driftT = 0;
    if (this.driftT > 0.15 && this.driftT < 2.6) buttons |= RB.HANDBRAKE;

    // Boost on straights.
    const straight = Math.abs(p.curv[(me.sample + Math.round(40 / step)) % n]) < 1 / 260 && Math.abs(p.curv[me.sample]) < 1 / 200;
    if (straight && car.meter > 0.3 && this.rnd() < s.boost * 0.2) buttons |= RB.BOOST;
    if (car.boosting && straight && car.meter > 0.05) buttons |= RB.BOOST;

    // Items.
    this.itemT -= dt;
    if (me.item && this.itemT <= 0) {
      this.itemT = 0.5 + (1 - s.itemSense) * 2;
      if (this.wantsItem(sim, me, straight)) buttons |= RB.ITEM;
    }

    // Stuck against a wall or facing the wrong way: back out, then go again.
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      steer = -Math.sign(steer || 1);
      throttle = 0;
      brake = 1;
      buttons &= ~RB.HANDBRAKE;
    } else {
      // Stuck, or scraping along a wall without getting anywhere: back out.
      if (me.prog > this.bestProg + 1) {
        this.bestProg = me.prog;
        this.stuckT = 0;
      } else if (sim.phase === 'racing') this.stuckT += dt;
      if (this.stuckT > (speed < 1.5 ? 1.1 : 2.2)) {
        this.stuckT = 0;
        this.bestProg = me.prog;
        this.reverseT = 1.2;
      }
      if (me.wrong) steer = Math.sign(lx || 1);
    }
    if (me.stuckT > 5) buttons |= RB.RESET;

    out.steer = Math.max(-1, Math.min(1, steer));
    out.throttle = throttle;
    out.brake = brake;
    out.buttons = buttons;
    // Reaction time: act on what they decided a moment ago.
    this.delayed.push(out);
    const lag = Math.round(s.react / dt);
    const now = this.delayed.length > lag ? this.delayed.shift()! : this.delayed[0];
    // Steering reacts quickly at every level; only decisions (throttle, brake) lag.
    return { ...now, steer: out.steer, seq: out.seq };
  }

  private surfaceFactor(sim: RaceSim, i: number) {
    const s = sim.path.surf[i];
    // dirt, grass, sand, ice, snow are slower
    return [1, 0.86, 0.8, 0.78, 0.6, 0.74, 0.97][s] ?? 1;
  }

  private wantsItem(sim: RaceSim, me: Racer, straight: boolean) {
    const pos = me.car.body.translation();
    const near = (d: number, behind?: boolean) =>
      sim.racers.some((o) => {
        if (o === me) return false;
        const op = o.car.body.translation();
        const dist = Math.hypot(op.x - pos.x, op.z - pos.z);
        if (dist > d) return false;
        if (behind === undefined) return true;
        return behind ? o.prog < me.prog : o.prog > me.prog;
      });
    switch (me.item) {
      case 'turbo':
        return straight;
      case 'shield':
        return near(10);
      case 'slick':
      case 'decoy':
        return near(25, true);
      case 'shock':
        return sim.racers.filter((o) => o !== me && Math.hypot(o.car.body.translation().x - pos.x, o.car.body.translation().z - pos.z) < 11).length >= 1;
      case 'repair': {
        let sum = 0;
        for (const v of me.car.damage) sum += v;
        return sum / me.car.damage.length > 0.25;
      }
      case 'slipstream':
        return near(30, false);
      default:
        return false;
    }
  }
}
