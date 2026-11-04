import { FEET_OFFSET } from '../constants';
import type { BotDifficulty } from '../config/modes';
import { WEAPONS, type WeaponDef } from '../config/weapons';
import { mulberry32 } from '../rng';
import { muzzle } from '../sim/combat';
import { BTN, emptyInput, type Input, type SimPlayer } from '../sim/player';
import type { Simulation } from '../sim/simulation';
import { clamp, dist, forwardXZ, rightXZ, set, UP, v3, wrapAngle, type Vec3 } from '../vec';
import { EDGE } from './nav';

interface Skill {
  /** Seconds a target must be visible before the bot reacts. */
  reaction: number;
  /** Std-dev of aim wobble in radians. */
  aimErr: number;
  /** Max view turn rate, rad/s. */
  turn: number;
  /** Seconds between strategic re-evaluations. */
  think: number;
  /** 0..1 how well the bot leads moving targets. */
  lead: number;
  /** Fire only when aim is within this many radians. */
  cone: number;
  dodge: number;
  strafe: number;
  special: number;
  retreat: number;
  sight: number;
  /** Candidate paint goals examined per decision (strategic depth). */
  samples: number;
  /** Team awareness: reacting to allies in trouble, valuing enemy paint. */
  awareness: number;
}

// Expert is sharp but human: it still reacts in ~0.2 s, wobbles ~2°, and turns at a capped rate.
const SKILL: Record<BotDifficulty, Skill> = {
  easy: { reaction: 0.7, aimErr: 0.16, turn: 3.2, think: 0.9, lead: 0.15, cone: 0.24, dodge: 0, strafe: 0.35, special: 0.35, retreat: 0.2, sight: 22, samples: 6, awareness: 0.3 },
  normal: { reaction: 0.45, aimErr: 0.09, turn: 5.5, think: 0.6, lead: 0.5, cone: 0.15, dodge: 0.12, strafe: 0.6, special: 0.7, retreat: 0.5, sight: 26, samples: 10, awareness: 0.6 },
  hard: { reaction: 0.3, aimErr: 0.055, turn: 8, think: 0.45, lead: 0.8, cone: 0.1, dodge: 0.3, strafe: 0.85, special: 0.9, retreat: 0.75, sight: 30, samples: 14, awareness: 0.85 },
  expert: { reaction: 0.22, aimErr: 0.035, turn: 10.5, think: 0.32, lead: 0.92, cone: 0.08, dodge: 0.5, strafe: 1, special: 1, retreat: 0.9, sight: 32, samples: 18, awareness: 1 },
};

export type BotState = 'paint' | 'fight' | 'refill' | 'retreat' | 'support' | 'zone';

const feet = v3(), wish = v3(), tmp = v3(), tmp2 = v3(), survey = [0, 0, 0];
const DOWN = Object.freeze(v3(0, -1, 0));

/** Per-bot decision maker. Produces the same Input a human would, so bots obey every game rule. */
export class BotBrain {
  state: BotState = 'paint';
  private skill: Skill;
  private dummy: boolean;
  private rnd: () => number;
  private input: Input = emptyInput();
  private path: number[] = [];
  private pathI = 0;
  private goal = v3();
  private hasGoal = false;
  private target = -1;
  private seenT = 0;
  private thinkT = 0;
  private yaw = 0;
  private pitch = 0;
  private awake = false;
  private errYaw = 0;
  private errPitch = 0;
  private errT = 0;
  private strafe = 1;
  private strafeT = 0;
  private stuckT = 0;
  private stuckAt = v3();
  private stuckN = 0;
  private sweepT = 0;
  private lastHp = 100;
  private flickT = 0;
  private airEdge = false;
  private pathWish = v3();

  constructor(
    readonly id: number,
    difficulty: BotDifficulty | 'dummy',
    seed: number,
  ) {
    this.dummy = difficulty === 'dummy';
    this.skill = SKILL[difficulty === 'dummy' ? 'easy' : difficulty];
    this.rnd = mulberry32(seed);
    this.sweepT = this.rnd() * 10;
  }

  private gauss() {
    return (this.rnd() + this.rnd() + this.rnd() - 1.5) * 1.15;
  }

  update(sim: Simulation, p: SimPlayer, dt: number): Input {
    const inp = this.input;
    const s = this.skill;
    inp.seq++;
    inp.buttons = 0;
    inp.mx = inp.mz = 0;
    if (!p.alive) {
      this.awake = false;
      this.path.length = 0;
      this.hasGoal = false;
      this.target = -1;
      return inp;
    }
    if (!this.awake) {
      this.awake = true;
      this.yaw = p.yaw;
      this.pitch = 0;
      this.thinkT = this.rnd() * 0.3;
    }
    if (sim.phase !== 'playing') return this.finish(inp, p);

    const w = WEAPONS[p.weapon];
    set(feet, p.pos.x, p.pos.y - FEET_OFFSET, p.pos.z);
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = s.think * (0.8 + this.rnd() * 0.4);
      if (this.dummy) this.thinkDummy(sim, p);
      else this.think(sim, p, w);
    }

    let tgt = this.target >= 0 ? sim.byId(this.target) : undefined;
    if (tgt && !tgt.alive) {
      tgt = undefined;
      this.target = -1;
    }
    const visible = !!tgt && this.canSee(sim, p, tgt);
    this.seenT = visible ? this.seenT + dt : 0;

    const wantsDodge = p.hp < this.lastHp - 15 && this.rnd() < s.dodge;
    this.lastHp = p.hp;

    this.followPath(sim, p);

    let wantYaw = this.yaw, wantPitch = 0, fire = false;
    const moving = wish.x !== 0 || wish.z !== 0;
    const onOwn = p.grounded && sim.world.grid.ownerAt(feet, UP, 0.3) === p.team;

    if (tgt && visible && this.state === 'fight') {
      const d = dist(p.pos, tgt.pos);
      const tx = (tgt.pos.x - p.pos.x) / (d || 1), tz = (tgt.pos.z - p.pos.z) / (d || 1);
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafe = this.rnd() < 0.5 ? -1 : 1;
        this.strafeT = 0.5 + this.rnd() * 0.9;
      }
      // Rollers hold flick range and only charge in for the roll-over when close or the target is weak.
      const ideal = w.kind === 'roller' ? (d < 4 || tgt.hp < 45 ? 0 : 5.5) : w.range * 0.75;
      const approach = d > ideal * 1.15 + 1 ? 1 : d < ideal * 0.6 ? -0.8 : 0;
      if (d < 12 || !moving) {
        wish.x = tx * approach - tz * this.strafe * s.strafe;
        wish.z = tz * approach + tx * this.strafe * s.strafe;
        const l = Math.hypot(wish.x, wish.z);
        if (l > 0) {
          wish.x /= l;
          wish.z /= l;
        }
      }
      if (s.strafe > 0.8 && p.grounded && this.rnd() < 0.008) inp.buttons |= BTN.JUMP;
      // Never strafe off a ledge: try the other way, else hold position.
      if (!this.groundAhead(sim, p)) {
        this.strafe = -this.strafe;
        wish.x = tx * approach - tz * this.strafe * s.strafe;
        wish.z = tz * approach + tx * this.strafe * s.strafe;
        const l = Math.hypot(wish.x, wish.z);
        if (l > 0) {
          wish.x /= l;
          wish.z /= l;
        }
        if (!this.groundAhead(sim, p)) wish.x = wish.z = 0;
      }
    }

    if (tgt && visible && this.seenT > s.reaction && !this.dummy) {
      this.aimAt(p, tgt, w, tmp);
      wantYaw = tmp.x;
      wantPitch = tmp.y;
      const d = dist(p.pos, tgt.pos);
      const aligned = Math.abs(wrapAngle(wantYaw - this.yaw)) < s.cone + 0.04 * (8 / Math.max(2, d));
      const reach = w.kind === 'lobber' ? 19 : w.range * 1.3;
      if (aligned && d < reach) {
        if (w.kind === 'roller') {
          if (d < 3.5) fire = true;
          else if ((this.flickT -= dt) <= 0) {
            fire = true;
            this.flickT = w.fireInterval + 0.05;
          }
        } else fire = true;
      }
    } else if ((this.state === 'paint' || this.state === 'zone') && !this.dummy) {
      this.sweepT += dt;
      const base = moving ? Math.atan2(-wish.x, -wish.z) : this.yaw;
      wantYaw = base + Math.sin(this.sweepT * 2.3) * 0.45;
      wantPitch = w.kind === 'lobber' ? 0.12 : w.kind === 'roller' ? -0.5 : -0.3 + Math.sin(this.sweepT * 1.3) * 0.12;
      fire = p.ink > 22 || (w.kind === 'roller' && p.ink > 5);
    } else if (moving) {
      wantYaw = Math.atan2(-wish.x, -wish.z);
      wantPitch = -0.1;
    }

    // Final ledge guard for every state: only path edges that intend to leave the ground may do so.
    if (p.grounded && !this.airEdge && (wish.x !== 0 || wish.z !== 0) && !this.groundAhead(sim, p, 1.1)) {
      wish.x = this.pathWish.x;
      wish.z = this.pathWish.z;
      if (!this.groundAhead(sim, p, 1.1)) wish.x = wish.z = 0;
    }

    // Swim when travelling over our own paint, and always when refilling.
    const remaining = this.remaining(sim, p);
    let dive = false;
    if (this.state === 'refill') dive = onOwn || p.ink < 8;
    else if (!fire && onOwn && remaining > 6 && this.state !== 'fight') dive = true;
    else if (this.state === 'fight' && onOwn && p.ink < w.inkPerShot * 2) dive = true;
    if (this.state === 'refill' && onOwn && p.ink < 85) wish.x = wish.z = 0;
    if (dive) inp.buttons |= BTN.DIVE;
    else if (fire) inp.buttons |= BTN.FIRE;
    // Dodge only sideways onto solid ground (a dodge covers ~2.6 m).
    if (wantsDodge && !dive && (wish.x !== 0 || wish.z !== 0) && this.groundAhead(sim, p, 2.8)) inp.buttons |= BTN.DODGE;
    if (!fire && !dive && this.state !== 'fight' && remaining > 10 && p.grounded) inp.buttons |= BTN.SPRINT;

    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = 0.35 + this.rnd() * 0.5;
      this.errYaw = this.gauss() * s.aimErr;
      this.errPitch = this.gauss() * s.aimErr * 0.5;
    }
    const turn = s.turn * dt;
    this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(wantYaw + this.errYaw - this.yaw), -turn, turn));
    this.pitch += clamp(wantPitch + this.errPitch - this.pitch, -turn * 0.7, turn * 0.7);
    this.pitch = clamp(this.pitch, -1.2, 1.2);

    this.checkStuck(sim, p, dt);
    rightXZ(tmp, this.yaw);
    forwardXZ(tmp2, this.yaw);
    inp.mx = clamp(wish.x * tmp.x + wish.z * tmp.z, -1, 1);
    inp.mz = clamp(wish.x * tmp2.x + wish.z * tmp2.z, -1, 1);
    return this.finish(inp, p);
  }

  private finish(inp: Input, _p: SimPlayer) {
    inp.yaw = inp.aimYaw = this.yaw;
    inp.pitch = inp.aimPitch = this.pitch;
    return inp;
  }

  /** Is there floor within a short drop where `wish` is heading? */
  private groundAhead(sim: Simulation, p: SimPlayer, reach = 1.4) {
    if (!p.grounded || (wish.x === 0 && wish.z === 0)) return true;
    set(tmp, p.pos.x + wish.x * reach, feet.y + 0.6, p.pos.z + wish.z * reach);
    return !!sim.world.raycast(tmp, DOWN, 3.5);
  }

  private solidBetween(sim: Simulation, ax: number, az: number, bx: number, bz: number, y: number) {
    for (const t of [0.33, 0.66]) {
      set(tmp, ax + (bx - ax) * t, y + 0.6, az + (bz - az) * t);
      const h = sim.world.raycast(tmp, DOWN, 1.4);
      if (!h || Math.abs(h.point.y - y) > 0.45) return false;
    }
    return true;
  }

  private canSee(sim: Simulation, p: SimPlayer, e: SimPlayer) {
    const d = dist(p.pos, e.pos);
    if (d > this.skill.sight) return false;
    // Rivals hidden in their own paint are invisible unless close, firing or disrupted.
    if (e.swimming && d > 4 && e.sinceFire > 1 && e.disruptedT <= 0) return false;
    set(tmp, p.pos.x, p.pos.y + 0.5, p.pos.z);
    return sim.world.lineOfSight(tmp, e.pos);
  }

  /** Writes desired (yaw, pitch) into out.x / out.y. */
  private aimAt(p: SimPlayer, t: SimPlayer, w: WeaponDef, out: Vec3) {
    const m = muzzle(tmp2, p.pos, this.yaw, w, p.shots);
    const d = dist(m, t.pos);
    const ft = d / w.projectileSpeed;
    const lead = this.skill.lead;
    const tx = t.pos.x + t.vel.x * ft * lead - m.x;
    const ty = t.pos.y + 0.1 + (t.grounded ? 0 : t.vel.y * ft * lead * 0.5) - m.y;
    const tz = t.pos.z + t.vel.z * ft * lead - m.z;
    const horiz = Math.hypot(tx, tz);
    out.x = Math.atan2(-tx, -tz);
    if (w.kind === 'lobber') {
      const v2 = w.projectileSpeed ** 2, g = w.gravity;
      const disc = v2 * v2 - g * (g * horiz * horiz + 2 * ty * v2);
      const angle = disc < 0 ? Math.PI / 4 : Math.atan((v2 - Math.sqrt(disc)) / (g * horiz));
      out.y = angle - (w.aimUp * Math.PI) / 180;
    } else {
      out.y = Math.atan2(ty, horiz) + (horiz > w.range ? Math.min(0.35, (horiz - w.range) * 0.03) : 0);
    }
  }

  private think(sim: Simulation, p: SimPlayer, w: WeaponDef) {
    const s = this.skill;
    let best = -1, bestScore = -Infinity, bestD = 0;
    for (const e of sim.players) {
      if (e.team === p.team || !e.alive || !this.canSee(sim, p, e)) continue;
      const d = dist(p.pos, e.pos);
      const score = -d + (100 - e.hp) * 0.06 + (e.id === this.target ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e.id;
        bestD = d;
      }
    }

    const board = sim.boards[p.team];
    const prev = this.state;
    if (prev === 'refill' && p.ink < 80 && (best < 0 || bestD > 6)) {
      // keep refilling
    } else if (best >= 0) {
      if (p.hp < 40 && bestD > 4 && this.rnd() < s.retreat) this.state = 'retreat';
      else if (p.ink < w.inkPerShot * 1.5 && bestD > 5) this.state = 'refill';
      else {
        this.state = 'fight';
        this.target = best;
      }
    } else {
      this.target = -1;
      let ally: SimPlayer | undefined;
      if (this.rnd() < s.awareness)
        for (const [aid, t] of board.distress) {
          const a = aid !== p.id && sim.time - t < 2.5 ? sim.byId(aid) : undefined;
          if (a?.alive && dist(a.pos, p.pos) < 18) ally = a;
        }
      if (p.ink < 15) this.state = 'refill';
      else if (ally) {
        this.state = 'support';
        set(this.goal, ally.pos.x, ally.pos.y - FEET_OFFSET, ally.pos.z);
      } else if (sim.config.mode === 'zones' && sim.map.zones.length) this.state = 'zone';
      else this.state = 'paint';
    }

    const nav = sim.nav;
    switch (this.state) {
      case 'fight': {
        const t = sim.byId(this.target)!;
        if (bestD > 10) this.planTo(sim, p, nav.nearest(t.pos, 6));
        else this.path.length = 0;
        break;
      }
      case 'refill':
        if (prev !== 'refill' || this.pathI >= this.path.length) this.planTo(sim, p, this.findOwnPaint(sim, p));
        break;
      case 'retreat': {
        const sp = sim.map.spawns[p.team][0];
        this.planTo(sim, p, nav.nearest(v3(sp.x, sp.y, sp.z), 8));
        break;
      }
      case 'support':
        this.planTo(sim, p, nav.nearest(this.goal, 6));
        break;
      case 'zone': {
        const zones = sim.map.zones;
        let zi = sim.modeState.holders.findIndex((h) => h !== p.team);
        if (zi < 0 || this.rnd() < 0.25) zi = (this.rnd() * zones.length) | 0;
        const z = zones[zi];
        if (prev !== 'zone' || this.pathI >= this.path.length || this.rnd() < 0.1) {
          set(tmp, z.c.x + (this.rnd() - 0.5) * z.h.x * 1.6, z.c.y, z.c.z + (this.rnd() - 0.5) * z.h.z * 1.6);
          this.planTo(sim, p, nav.nearest(tmp, 8));
        }
        break;
      }
      case 'paint':
        if (prev !== 'paint' || this.pathI >= this.path.length || this.rnd() < 0.08) this.choosePaintGoal(sim, p);
        break;
    }

    if (p.charge >= 1 && this.rnd() < s.special) this.trySpecial(sim, p, best >= 0, bestD);
  }

  private thinkDummy(sim: Simulation, p: SimPlayer) {
    if (this.hasGoal && this.pathI < this.path.length) return;
    if (this.hasGoal && this.rnd() < 0.85) return;
    const nodes = sim.nav.nodes;
    const sp = sim.map.spawns[1 - p.team][0];
    for (let i = 0; i < 20; i++) {
      const n = nodes[(this.rnd() * nodes.length) | 0];
      const d = Math.hypot(n.x - sp.x, n.z - sp.z);
      if (d > 10 && d < 34) {
        this.planTo(sim, p, n.id);
        return;
      }
    }
  }

  private choosePaintGoal(sim: Simulation, p: SimPlayer) {
    const nodes = sim.nav.nodes;
    if (!nodes.length) return;
    const s = this.skill;
    const board = sim.boards[p.team];
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < s.samples; i++) {
      const n = nodes[(this.rnd() * nodes.length) | 0];
      const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      if (d < 4) continue;
      sim.world.grid.survey(n, 3.5, survey);
      const total = survey[0] + survey[1] + survey[2] || 1;
      const own = survey[1 + p.team], enemy = survey[2 - p.team], empty = survey[0];
      let score = ((empty + enemy * (1 + s.awareness * 0.8) - own * 0.5) / total) * 30 - d * 0.35 + this.rnd() * 6;
      for (const [id, c] of board.claims) if (id !== p.id && Math.hypot(c.x - n.x, c.z - n.z) < 9) score -= 10;
      if (score > bestScore) {
        bestScore = score;
        best = n.id;
      }
    }
    if (best >= 0) {
      const n = nodes[best];
      board.claims.set(p.id, v3(n.x, n.y, n.z));
      this.planTo(sim, p, best);
    }
  }

  private findOwnPaint(sim: Simulation, p: SimPlayer): number {
    const nodes = sim.nav.nodes;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < 40; i++) {
      const n = nodes[(this.rnd() * nodes.length) | 0];
      const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      if (d < bestD && sim.world.grid.ownerAt(n, UP, 0.3) === p.team) {
        bestD = d;
        best = n.id;
      }
    }
    if (best >= 0) return best;
    const sp = sim.map.spawns[p.team][0];
    return sim.nav.nearest(v3(sp.x, sp.y, sp.z), 8);
  }

  private planTo(sim: Simulation, p: SimPlayer, to: number) {
    const nav = sim.nav;
    this.pathI = 0;
    this.path.length = 0;
    this.hasGoal = to >= 0;
    if (to < 0) return;
    const n = nav.nodes[to];
    set(this.goal, n.x, n.y, n.z);
    const from = nav.nearest(feet, 6);
    if (from < 0) return;
    const team = p.team, grid = sim.world.grid;
    // Rival paint is slow and hurts: route around it when reasonable.
    const route = nav.path(from, to, (k) => (grid.ownerAt(k, UP, 0.3) === 1 - team ? 2.5 : 0));
    if (route) this.path = route;
  }

  private remaining(sim: Simulation, p: SimPlayer) {
    if (!this.hasGoal) return 0;
    return Math.hypot(this.goal.x - p.pos.x, this.goal.z - p.pos.z);
  }

  private followPath(sim: Simulation, p: SimPlayer) {
    wish.x = wish.z = 0;
    this.airEdge = false;
    const nav = sim.nav;
    const fy = feet.y;
    while (this.pathI < this.path.length) {
      const n = nav.nodes[this.path[this.pathI]];
      if (Math.hypot(n.x - p.pos.x, n.z - p.pos.z) < 0.8 && Math.abs(n.y - fy) < 1.6) this.pathI++;
      else break;
    }
    if (this.pathI < this.path.length) {
      // String-pull: skip a waypoint when the next one is directly walkable.
      if (this.pathI + 1 < this.path.length) {
        const a = nav.nodes[this.path[this.pathI]], b = nav.nodes[this.path[this.pathI + 1]];
        if (
          nav.edgeKind(a.id, b.id) === EDGE.WALK &&
          Math.abs(a.y - fy) < 0.2 &&
          Math.abs(b.y - fy) < 0.2 &&
          this.solidBetween(sim, p.pos.x, p.pos.z, b.x, b.z, fy) &&
          sim.world.lineOfSight(set(tmp, p.pos.x, fy + 0.5, p.pos.z), set(tmp2, b.x, b.y + 0.5, b.z))
        )
          this.pathI++;
      }
      const n = nav.nodes[this.path[this.pathI]];
      const prev = this.pathI > 0 ? this.path[this.pathI - 1] : -1;
      const kind = prev >= 0 ? nav.edgeKind(prev, n.id) : EDGE.WALK;
      // Follow the segment (carrot ahead on prev→next) so narrow bridges don't get corner-cut.
      let cx = n.x, cz = n.z;
      if (prev >= 0 && kind === EDGE.WALK) {
        const a = nav.nodes[prev];
        const abx = n.x - a.x, abz = n.z - a.z, l2 = abx * abx + abz * abz;
        if (l2 > 0.01) {
          const t = clamp(((p.pos.x - a.x) * abx + (p.pos.z - a.z) * abz) / l2, 0, 1);
          const tc = Math.min(1, t + 1.2 / Math.sqrt(l2));
          cx = a.x + abx * tc;
          cz = a.z + abz * tc;
        }
      }
      const dx = cx - p.pos.x, dz = cz - p.pos.z, d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      const dl = Math.hypot(dx, dz);
      if (dl > 0.01) {
        wish.x = dx / dl;
        wish.z = dz / dl;
      }
      this.airEdge = kind !== EDGE.WALK;
      if (kind === EDGE.JUMP) {
        if (p.grounded && d < 3 && (n.y - fy > 0.3 || d > 1.2)) this.input.buttons |= BTN.JUMP;
        else if (!p.grounded && p.vel.y < 1 && n.y - fy > 0.2) this.input.buttons |= BTN.JUMP;
      }
    } else if (this.hasGoal) {
      const dx = this.goal.x - p.pos.x, dz = this.goal.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.8 && d < 5) {
        wish.x = dx / d;
        wish.z = dz / d;
        if (!this.groundAhead(sim, p, 1.4)) wish.x = wish.z = 0;
      } else if (d <= 0.8) this.hasGoal = false;
    }

    this.pathWish.x = wish.x;
    this.pathWish.z = wish.z;
  }

  /** Stuck recovery on the final intent: hop, then re-plan, then pick something else entirely. */
  private checkStuck(sim: Simulation, p: SimPlayer, dt: number) {
    const nav = sim.nav;
    this.stuckT += dt;
    if (this.stuckT <= 0.9) return;
    const intent = wish.x !== 0 || wish.z !== 0;
    if (intent && dist(p.pos, this.stuckAt) < 0.6) {
      this.stuckN++;
      if (this.groundAhead(sim, p, 1.4)) this.input.buttons |= BTN.JUMP;
      if (this.stuckN === 2 && this.hasGoal) this.planTo(sim, p, nav.nearest(this.goal, 4));
      if (this.stuckN >= 4) {
        this.stuckN = 0;
        this.path.length = 0;
        this.hasGoal = false;
        this.thinkT = 0;
        const n = nav.nodes[(this.rnd() * nav.nodes.length) | 0];
        if (n) this.planTo(sim, p, n.id);
      }
    } else this.stuckN = 0;
    set(this.stuckAt, p.pos.x, p.pos.y, p.pos.z);
    this.stuckT = 0;
  }

  private trySpecial(sim: Simulation, p: SimPlayer, enemy: boolean, d: number) {
    let use = false;
    switch (p.special) {
      case 'surge':
        use = this.state === 'fight' || (this.state === 'paint' && this.remaining(sim, p) > 15);
        break;
      case 'nova':
        use = (enemy && d < 5.5) || (this.state === 'paint' && this.rnd() < 0.3);
        break;
      case 'shield':
        use = this.state === 'fight' && p.hp < 75;
        break;
      case 'beacon': {
        const sp = sim.map.spawns[p.team][0];
        use = this.state === 'paint' && Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) > 18;
        break;
      }
      case 'disrupt':
        use = enemy && d < 9;
        break;
    }
    if (use) this.input.buttons |= BTN.SPECIAL;
  }
}
