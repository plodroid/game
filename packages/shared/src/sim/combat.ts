import { FEET_OFFSET, MAX_HP, MAX_INK, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, type Team } from '../constants';
import {
  BEACON_LAUNCH,
  NOVA_DAMAGE_MAX,
  NOVA_DAMAGE_MIN,
  SHIELD_HP,
  SPECIALS,
  type SpecialId,
} from '../config/specials';
import { straightTime, WEAPONS, type WeaponDef, type WeaponId } from '../config/weapons';
import { hash2, mulberry32 } from '../rng';
import { copy, dirFromAngles, forwardXZ, lerp, rightXZ, set, v3, type Vec3 } from '../vec';
import { PAINT_KIND } from './events';
import type { Launcher } from './movement';
import { BTN, type Input, type SimPlayer } from './player';
import type { Simulation } from './simulation';

const DEG = Math.PI / 180;

export interface Projectile {
  id: number;
  owner: number;
  team: Team;
  weapon: WeaponId;
  pos: Vec3;
  vel: Vec3;
  age: number;
  dripT: number;
}

export interface Effect {
  id: number;
  kind: 'shield' | 'beacon' | 'nova' | 'disrupt';
  team: Team;
  owner: number;
  pos: Vec3;
  /** Seconds left (windup for nova/disrupt). */
  t: number;
  hp: number;
}

const tmpA = v3(), tmpB = v3(), dirs = [v3(), v3(), v3(), v3(), v3(), v3(), v3(), v3()];
const DOWN = Object.freeze(v3(0, -1, 0));

/** World position the weapon fires from. `shot` alternates dual-stream muzzles. */
export function muzzle(out: Vec3, pos: Vec3, yaw: number, w: WeaponDef, shot: number): Vec3 {
  const side = w.kind === 'dual' ? (shot % 2 ? -0.36 : 0.36) : 0.34;
  rightXZ(tmpA, yaw);
  forwardXZ(tmpB, yaw);
  return set(out, pos.x + tmpA.x * side + tmpB.x * 0.5, pos.y + 0.32, pos.z + tmpA.z * side + tmpB.z * 0.5);
}

/** Deterministic pellet pattern: the server and every client derive the same shots from (seed, angles). */
export function forEachPellet(
  w: WeaponDef,
  yaw: number,
  pitch: number,
  seed: number,
  cb: (dir: Vec3, speed: number, i: number) => void,
) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < w.pellets; i++) {
    let py = yaw, pp = pitch + w.aimUp * DEG, speed = w.projectileSpeed;
    if (w.kind === 'roller') {
      py += ((i / (w.pellets - 1)) * 2 - 1) * w.spread * DEG + (rnd() - 0.5) * 0.04;
      pp += (rnd() - 0.3) * 0.08;
      speed *= 0.85 + rnd() * 0.3;
    } else if (w.kind === 'lobber') {
      py += (i - 1) * w.spread * DEG;
      speed *= i === 1 ? 1.06 : 0.94;
    } else {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * w.spread * DEG;
      py += Math.cos(a) * r;
      pp += Math.sin(a) * r * 0.6;
    }
    cb(dirFromAngles(dirs[i], py, pp), speed, i);
  }
}

/** Fire/roll/special handling. Runs before movement each tick so edge detection sees last tick's buttons. */
export function updateCombat(sim: Simulation, p: SimPlayer, inp: Input, dt: number) {
  const w = WEAPONS[p.weapon];
  const pressed = inp.buttons & ~p.prevButtons;
  const held = (inp.buttons & BTN.FIRE) !== 0 && p.emoteT <= 0;
  p.fireCd -= dt;
  p.sinceFire += dt;
  p.firing = false;
  p.rolling = false;

  if (held) {
    p.firing = true;
    p.spawnProtect = 0;
    if (w.kind === 'roller') {
      if (pressed & BTN.FIRE && p.fireCd <= 0) tryShoot(sim, p, w);
      const hSpeed = Math.hypot(p.vel.x, p.vel.z);
      if (p.grounded && p.fireCd < w.fireInterval - 0.3 && p.ink > 0 && hSpeed > 1) roll(sim, p, w, dt);
    } else if (p.fireCd <= 0) {
      tryShoot(sim, p, w);
    }
  }
  if (p.fireCd < -dt) p.fireCd = 0;

  if (pressed & BTN.SPECIAL && p.charge >= 1 && sim.phase === 'playing') activateSpecial(sim, p);

  // Ink: fastest while swimming in your colour; slow trickle otherwise.
  const reload = w.reloadSpeed * (p.surgeT > 0 ? 2 : 1);
  if (p.swimming || p.climbing) p.ink += 42 * reload * dt;
  else if (p.diving) p.ink += 10 * reload * dt;
  else if (p.sinceFire > 0.6 && !p.rolling) p.ink += 7 * reload * dt;
  p.ink = Math.min(MAX_INK, Math.max(0, p.ink));

  if (p.regenDelay > 0) p.regenDelay -= dt;
  else if (p.hp < MAX_HP) p.hp = Math.min(MAX_HP, p.hp + (p.swimming ? 60 : 24) * dt);
  if (p.onEnemyPaint && !p.diving && p.hp > 50) {
    p.hp -= 6 * dt;
    p.regenDelay = Math.max(p.regenDelay, 0.3);
  }
  if (p.spawnProtect > 0) p.spawnProtect -= dt;
  else {
    // Spawn zones repel rivals so spawns can't be camped.
    for (const s of sim.map.spawns[1 - p.team]) {
      if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 5.5 && Math.abs(p.pos.y - FEET_OFFSET - s.y) < 3) {
        damagePlayer(sim, p, 60 * dt, -1, 'special');
        break;
      }
    }
  }
}

function tryShoot(sim: Simulation, p: SimPlayer, w: WeaponDef) {
  if (p.ink < w.inkPerShot) {
    sim.emit({ t: 'empty', id: p.id });
    p.fireCd = 0.4;
    return;
  }
  p.ink -= w.inkPerShot;
  p.sinceFire = 0;
  p.fireCd = Math.max(p.fireCd, 0) + w.fireInterval;
  const n = p.shots++;
  const seed = hash2(p.id, n);
  const o = muzzle(v3(), p.pos, p.yaw, w, n);
  sim.emit({ t: 'fire', id: p.id, w: w.id, x: o.x, y: o.y, z: o.z, yaw: p.aimYaw, pitch: p.aimPitch, seed, n });
  forEachPellet(w, p.aimYaw, p.aimPitch, seed, (d, speed) => {
    sim.projectiles.push({
      id: sim.nextId(),
      owner: p.id,
      team: p.team,
      weapon: w.id,
      pos: copy(v3(), o),
      vel: v3(d.x * speed, d.y * speed, d.z * speed),
      age: 0,
      dripT: 0,
    });
  });
}

function roll(sim: Simulation, p: SimPlayer, w: WeaponDef, dt: number) {
  const r = w.roll!;
  p.rolling = true;
  p.sinceFire = 0;
  p.ink = Math.max(0, p.ink - r.inkPerSec * dt);
  forwardXZ(tmpA, p.yaw);
  const hx = p.pos.x + tmpA.x * 0.75, hz = p.pos.z + tmpA.z * 0.75, hy = p.pos.y - FEET_OFFSET;
  if (Math.hypot(hx - p.rollAt.x, hz - p.rollAt.z) > 0.45) {
    sim.paint(hx, hy + 0.15, hz, r.width / 2, p.team, PAINT_KIND.ROLL, p.id);
    set(p.rollAt, hx, hy, hz);
  }
  for (const e of sim.players) {
    if (e.team === p.team || !e.alive) continue;
    if (Math.hypot(e.pos.x - hx, e.pos.z - hz) < 0.95 && Math.abs(e.pos.y - p.pos.y) < 1.3) {
      damagePlayer(sim, e, r.damage, p.id, w.id);
    }
  }
}

export function damagePlayer(sim: Simulation, v: SimPlayer, amount: number, by: number, w: WeaponId | 'special') {
  if (!v.alive || v.spawnProtect > 0 || sim.phase !== 'playing' || amount <= 0) return;
  v.hp -= amount;
  v.regenDelay = 1.6;
  if (by >= 0) v.damagedBy.set(by, sim.time);
  sim.boards[v.team].distress.set(v.id, sim.time);
  if (by >= 0 || amount >= 1) sim.emit({ t: 'hit', id: v.id, by, dmg: Math.round(amount) });
  if (v.hp <= 0) sim.kill(v, by, w);
}

function explode(sim: Simulation, owner: number, team: Team, at: Vec3, radius: number, dmg: number, skip: number, w: WeaponId | 'special') {
  sim.emit({ t: 'blast', x: at.x, y: at.y, z: at.z, team, r: radius });
  if (dmg <= 0) return;
  for (const e of sim.players) {
    if (e.team === team || !e.alive || e.id === skip) continue;
    const d = Math.hypot(e.pos.x - at.x, e.pos.y - at.y, e.pos.z - at.z);
    if (d > radius + PLAYER_RADIUS) continue;
    tmpA.x = at.x;
    tmpA.y = at.y + 0.2;
    tmpA.z = at.z;
    if (!sim.world.lineOfSight(tmpA, e.pos)) continue;
    damagePlayer(sim, e, dmg * (1 - Math.min(1, d / (radius + PLAYER_RADIUS)) * 0.5), owner, w);
  }
}

/** Closest-approach parameter along a ray segment to a capsule axis, or -1 when outside radius. */
function segmentCapsule(o: Vec3, d: Vec3, len: number, c: Vec3, r: number): number {
  // Capsule axis A + s*(0,1,0), s ∈ [-h, h]. Closest points between two segments (Ericson §5.1.9).
  const h = PLAYER_HALF_HEIGHT;
  const rx = o.x - c.x, ry = o.y - (c.y - h), rz = o.z - c.z;
  const e = 2 * h, e2 = e * e, b = d.y * e, f = ry * e, cc = rx * d.x + ry * d.y + rz * d.z;
  const denom = e2 - b * b;
  let t = denom > 1e-8 ? (b * f - cc * e2) / denom : 0;
  t = Math.max(0, Math.min(len, t));
  let s = (b * t + f) / e2;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(len, b * s - cc));
  const px = o.x + d.x * t - c.x, py = o.y + d.y * t - (c.y - h + s * e), pz = o.z + d.z * t - c.z;
  return px * px + py * py + pz * pz <= r * r ? t : -1;
}

function sphereEntry(o: Vec3, d: Vec3, len: number, c: Vec3, r: number): number {
  const mx = o.x - c.x, my = o.y - c.y, mz = o.z - c.z;
  const b = mx * d.x + my * d.y + mz * d.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc <= 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= len ? t : -1;
}

const segDir = v3(), hitPt = v3();

export function stepProjectiles(sim: Simulation, dt: number) {
  const list = sim.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    const w = WEAPONS[pr.weapon];
    const st = straightTime(w);
    const falling = pr.age > st;
    pr.age += dt;
    pr.vel.y -= (falling ? w.gravity : 2.5) * dt;
    if (falling) {
      const drag = 1 - 2.2 * dt;
      pr.vel.x *= drag;
      pr.vel.z *= drag;
    }
    if (w.burstAtRange && falling) {
      const down = sim.world.raycast(pr.pos, DOWN, 6);
      if (down) sim.paint(down.point.x, down.point.y, down.point.z, w.paintRadius, pr.team, PAINT_KIND.IMPACT, pr.owner);
      explode(sim, pr.owner, pr.team, pr.pos, w.splashRadius, w.splashDamage, -1, w.id);
      list.splice(i, 1);
      continue;
    }
    const len = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z) * dt;
    set(segDir, (pr.vel.x * dt) / len, (pr.vel.y * dt) / len, (pr.vel.z * dt) / len);

    const wh = sim.world.raycast(pr.pos, segDir, len + 0.05);
    let best = wh ? wh.dist : Infinity;
    if (wh) copy(hitPt, wh.point);
    let victim: SimPlayer | null = null;
    for (const e of sim.players) {
      if (!e.alive || e.team === pr.team) continue;
      const t = segmentCapsule(pr.pos, segDir, len, e.pos, PLAYER_RADIUS + 0.12);
      if (t >= 0 && t < best) {
        best = t;
        victim = e;
      }
    }
    let shield: Effect | null = null;
    for (const ef of sim.effects) {
      if (ef.kind !== 'shield' || ef.team === pr.team) continue;
      const t = sphereEntry(pr.pos, segDir, len, ef.pos, SPECIALS.shield.radius);
      if (t >= 0 && t < best) {
        best = t;
        shield = ef;
        victim = null;
      }
    }

    if (shield) {
      shield.hp -= w.damage;
      sim.emit({ t: 'blast', x: pr.pos.x, y: pr.pos.y, z: pr.pos.z, team: pr.team, r: 0.4 });
      list.splice(i, 1);
      continue;
    }
    if (victim) {
      damagePlayer(sim, victim, w.damage * (falling ? 0.6 : 1), pr.owner, w.id);
      const fy = victim.pos.y - FEET_OFFSET;
      sim.paint(victim.pos.x, fy + 0.1, victim.pos.z, w.paintRadius * 0.6, pr.team, PAINT_KIND.IMPACT, pr.owner);
      if (w.splashRadius > 0) explode(sim, pr.owner, pr.team, victim.pos, w.splashRadius, w.splashDamage, victim.id, w.id);
      list.splice(i, 1);
      continue;
    }
    if (wh) {
      sim.paint(hitPt.x, hitPt.y, hitPt.z, w.paintRadius, pr.team, PAINT_KIND.IMPACT, pr.owner);
      if (w.splashRadius > 0) explode(sim, pr.owner, pr.team, hitPt, w.splashRadius, w.splashDamage, -1, w.id);
      list.splice(i, 1);
      continue;
    }

    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;
    pr.pos.z += pr.vel.z * dt;
    if (w.dripInterval > 0 && !falling) {
      pr.dripT += dt;
      if (pr.dripT >= w.dripInterval) {
        pr.dripT = 0;
        const down = sim.world.raycast(pr.pos, DOWN, 14);
        if (down) sim.paint(down.point.x, down.point.y, down.point.z, w.dripRadius, pr.team, PAINT_KIND.DRIP, pr.owner);
      }
    }
    if (pr.age > st + 2.5 || pr.pos.y < sim.map.killY) list.splice(i, 1);
  }
}

export function activateSpecial(sim: Simulation, p: SimPlayer) {
  const id: SpecialId = p.special;
  const def = SPECIALS[id];
  p.charge = 0;
  p.stats.specials++;
  const feetY = p.pos.y - FEET_OFFSET;
  sim.emit({ t: 'special', id: p.id, s: id, x: p.pos.x, y: feetY, z: p.pos.z });
  const add = (kind: Effect['kind'], t: number, y: number, hp = 0) =>
    sim.effects.push({ id: sim.nextId(), kind, team: p.team, owner: p.id, pos: v3(p.pos.x, y, p.pos.z), t, hp });
  switch (id) {
    case 'surge':
      p.surgeT = def.duration;
      break;
    case 'nova':
      add('nova', def.windup, feetY + 0.8);
      break;
    case 'shield':
      add('shield', def.duration, feetY + 0.2, SHIELD_HP);
      break;
    case 'beacon':
      add('beacon', def.duration, feetY);
      break;
    case 'disrupt':
      add('disrupt', def.windup, p.pos.y);
      break;
  }
}

export function updateEffects(sim: Simulation, dt: number) {
  const list = sim.effects;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    e.t -= dt;
    if (e.kind === 'nova' && e.t <= 0) {
      const r = SPECIALS.nova.radius;
      sim.paint(e.pos.x, e.pos.y, e.pos.z, r, e.team, PAINT_KIND.NOVA, e.owner);
      sim.emit({ t: 'blast', x: e.pos.x, y: e.pos.y, z: e.pos.z, team: e.team, r });
      for (const v of sim.players) {
        if (v.team === e.team || !v.alive) continue;
        const d = Math.hypot(v.pos.x - e.pos.x, v.pos.y - e.pos.y, v.pos.z - e.pos.z);
        if (d < r && sim.world.lineOfSight(e.pos, v.pos))
          damagePlayer(sim, v, lerp(NOVA_DAMAGE_MAX, NOVA_DAMAGE_MIN, d / r), e.owner, 'special');
      }
    } else if (e.kind === 'disrupt' && e.t <= 0) {
      const def = SPECIALS.disrupt;
      sim.emit({ t: 'blast', x: e.pos.x, y: e.pos.y, z: e.pos.z, team: e.team, r: def.radius });
      for (const v of sim.players) {
        if (v.team === e.team || !v.alive) continue;
        if (Math.hypot(v.pos.x - e.pos.x, v.pos.y - e.pos.y, v.pos.z - e.pos.z) < def.radius && sim.world.lineOfSight(e.pos, v.pos))
          v.disruptedT = def.duration;
      }
    }
    if (e.t <= 0 || (e.kind === 'shield' && e.hp <= 0)) list.splice(i, 1);
  }
}

/** Map pads plus live team beacons, in the form the movement step consumes. */
export function collectLaunchers(sim: Simulation, out: Launcher[]): Launcher[] {
  out.length = 0;
  for (const pad of sim.map.pads) out.push({ ...pad, team: -1 });
  for (const e of sim.effects)
    if (e.kind === 'beacon')
      out.push({ x: e.pos.x, y: e.pos.y, z: e.pos.z, r: SPECIALS.beacon.radius, vx: 0, vy: BEACON_LAUNCH, vz: 0, team: e.team });
  return out;
}
