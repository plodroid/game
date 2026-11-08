import type RAPIER from '@dimforge/rapier3d-compat';
import { FEET_OFFSET, GRAVITY, PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from '../constants';
import { DISRUPT_SLOW, SURGE_SPEED } from '../config/specials';
import { WEAPONS } from '../config/weapons';
import { clamp, copy, forwardXZ, normalize, rightXZ, set, UP, v3 } from '../vec';
import type { GameWorld } from '../world/world';
import { BTN, type Input, type PlayerState } from './player';

/** Movement tuning. Speeds in m/s, accelerations in m/s². */
/** Where under the foot paint is sampled, as offsets from the feet. */
const FOOT: [number, number][] = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];

export const MOVE = {
  walk: 5.4,
  sprint: 7.4,
  swim: 10.8,
  blob: 3.4,
  blobEnemy: 1.8,
  enemyPaint: 0.5,
  groundAccel: 62,
  groundDecel: 48,
  swimAccel: 85,
  airAccel: 26,
  jump: 8.6,
  swimJump: 9.8,
  enemyJump: 6.2,
  airJump: 7.4,
  climb: 7.2,
  wallJump: 7,
  slideSpeed: 11.5,
  slideTime: 0.8,
  slideCooldown: 0.9,
  dodgeSpeed: 22,
  dodgeTime: 0.255,
  coyote: 0.1,
  jumpBuffer: 0.12,
  maxFall: 40,
};

/** Anything that flings a grounded player: map pads and team beacons. */
export interface Launcher {
  x: number;
  y: number;
  z: number;
  r: number;
  vx: number;
  vy: number;
  vz: number;
  /** -1 = everyone, otherwise only this team. */
  team: number;
}

const feet = v3(), fwd = v3(), right = v3(), wish = v3(), wallN = v3(), delta = v3(), moved = v3();
const push = v3(), pushed = v3(), probe = v3();
const DOWN = v3(0, -1, 0);

/** Closest two players' centres get: a little under two radii, so brushing past still works. */
export const PLAYER_GAP = PLAYER_RADIUS * 1.8;

function nudge(w: GameWorld, p: PlayerState, col: RAPIER.Collider, x: number, z: number) {
  set(push, x, 0, z);
  w.moveCapsule(col, p.pos, push, pushed);
  p.pos.x += pushed.x;
  p.pos.z += pushed.z;
}

/**
 * Bodies don't stand inside each other. Overlapping players are eased apart through the same
 * collision as movement, so never into walls. Whoever moves more takes more of the correction,
 * so someone standing still isn't shoved off a ledge. With `colB` null only `a` moves (client
 * prediction against other players' interpolated positions).
 */
export function separatePair(w: GameWorld, a: PlayerState, colA: RAPIER.Collider, b: PlayerState, colB: RAPIER.Collider | null) {
  if (!a.alive || !b.alive || a.climbing || b.climbing) return;
  if (Math.abs(a.pos.y - b.pos.y) > PLAYER_HALF_HEIGHT * 2) return;
  let dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
  let d = Math.hypot(dx, dz);
  if (d >= PLAYER_GAP) return;
  if (d < 1e-4) {
    // Exactly on top of each other: split along a fixed axis so every peer agrees.
    dx = a.id < b.id ? 1 : -1;
    dz = 0;
    d = 1;
  }
  const overlap = PLAYER_GAP - Math.min(d, PLAYER_GAP);
  const va = Math.hypot(a.vel.x, a.vel.z), vb = Math.hypot(b.vel.x, b.vel.z);
  const shareA = colB ? clamp(va / (va + vb + 1e-3), 0.2, 0.8) : 1;
  const nx = dx / d, nz = dz / d;
  nudge(w, a, colA, nx * overlap * shareA, nz * overlap * shareA);
  if (colB) nudge(w, b, colB, -nx * overlap * (1 - shareA), -nz * overlap * (1 - shareA));
}

export function stepMovement(
  w: GameWorld,
  p: PlayerState,
  col: RAPIER.Collider,
  inp: Input,
  dt: number,
  frozen: boolean,
  launchers: readonly Launcher[],
): void {
  p.yaw = inp.yaw;
  p.pitch = clamp(inp.pitch, -1.35, 1.35);
  p.aimYaw = inp.aimYaw;
  p.aimPitch = clamp(inp.aimPitch, -1.45, 1.45);
  const buttons = frozen ? 0 : inp.buttons;
  const pressed = buttons & ~p.prevButtons;
  p.prevButtons = buttons;
  const weapon = WEAPONS[p.weapon];
  const disrupted = p.disruptedT > 0;
  const vel = p.vel;

  set(feet, p.pos.x, p.pos.y - FEET_OFFSET, p.pos.z);
  // Sample under the whole foot, not one point: at a ledge or a patch edge the centre can sit past the
  // painted cell while you are plainly standing on your paint. Your colour under any part of the foot wins.
  let footOwner = -1;
  if (p.grounded) {
    const fx = feet.x, fz = feet.z;
    for (const [ox, oz] of FOOT) {
      feet.x = fx + ox;
      feet.z = fz + oz;
      const o = w.grid.ownerAt(feet, UP, 0.3);
      if (o === p.team) {
        footOwner = o;
        break;
      }
      if (o >= 0 && footOwner < 0) footOwner = o;
    }
    feet.x = fx;
    feet.z = fz;
  }
  const onFriendly = footOwner === p.team;
  p.onEnemyPaint = footOwner === 1 - p.team;

  let mx = frozen ? 0 : clamp(inp.mx, -1, 1);
  let mz = frozen ? 0 : clamp(inp.mz, -1, 1);
  if (p.emoteT > 0 && (Math.abs(mx) > 0.1 || Math.abs(mz) > 0.1 || buttons & BTN.FIRE)) p.emoteT = 0;
  if (p.emoteT > 0) mx = mz = 0;
  const mag = Math.min(1, Math.hypot(mx, mz));
  rightXZ(right, p.yaw);
  forwardXZ(fwd, p.yaw);
  set(wish, right.x * mx + fwd.x * mz, 0, right.z * mx + fwd.z * mz);
  if (mag > 0.05) normalize(wish, wish);

  p.diving = (buttons & BTN.DIVE) !== 0 && !disrupted && !(buttons & BTN.FIRE);
  p.swimming = p.diving && p.grounded && onFriendly;
  if (p.diving) p.slideT = 0;

  // Paint-dive wall climbing: push into a wall covered in your colour.
  p.climbing = false;
  if (p.diving && mag > 0.2) {
    const hit = w.raycast(p.pos, wish, PLAYER_RADIUS + 0.35);
    if (hit && Math.abs(hit.normal.y) < 0.35 && wish.x * hit.normal.x + wish.z * hit.normal.z < -0.3) {
      if (w.grid.ownerAt(hit.point, hit.normal, 0.2) === p.team) {
        p.climbing = true;
        copy(wallN, hit.normal);
      }
    }
  }

  let speed: number;
  if (p.diving) speed = p.swimming || p.climbing ? MOVE.swim : p.onEnemyPaint ? MOVE.blobEnemy : MOVE.blob;
  else {
    const sprint = (buttons & BTN.SPRINT) !== 0 && !p.firing && mz > 0.2;
    speed = sprint ? MOVE.sprint : MOVE.walk;
    if (p.firing) speed *= p.rolling && weapon.roll ? weapon.roll.speedMult : weapon.moveWhileFiring;
    if (p.onEnemyPaint) speed *= MOVE.enemyPaint;
  }
  if (p.speedMult) speed *= p.speedMult;
  if (p.surgeT > 0) speed *= SURGE_SPEED;
  if (disrupted) speed *= DISRUPT_SLOW;

  if (!frozen && pressed & BTN.DODGE && p.dodgeCd <= 0 && !p.diving) {
    p.dodgeT = MOVE.dodgeTime;
    p.dodgeCd = weapon.dodgeCooldown;
    copy(p.dodgeDir, mag > 0.1 ? wish : fwd);
    p.slideT = 0;
  }
  const hSpeed = Math.hypot(vel.x, vel.z);
  if (!frozen && pressed & BTN.SLIDE && p.grounded && !p.diving && p.slideCd <= 0 && hSpeed > 2.5) {
    p.slideT = MOVE.slideTime;
    p.slideCd = MOVE.slideCooldown;
    const s = Math.max(hSpeed * 1.2, MOVE.slideSpeed) / hSpeed;
    vel.x *= s;
    vel.z *= s;
  }

  if (p.dodgeT > 0) {
    p.dodgeT -= dt;
    // A burst that eases off, so the dash reads instead of teleporting.
    const k = Math.max(0, p.dodgeT) / MOVE.dodgeTime;
    vel.x = p.dodgeDir.x * MOVE.dodgeSpeed * (0.3 + 0.7 * k);
    vel.z = p.dodgeDir.z * MOVE.dodgeSpeed * (0.3 + 0.7 * k);
  } else if (p.slideT > 0 && p.grounded) {
    // Speed now, after this tick's slide boost (hSpeed was measured before it).
    const now = Math.hypot(vel.x, vel.z);
    const sp = now * (1 - 0.9 * dt);
    let dx = vel.x / (now || 1) + wish.x * 2.5 * dt * mag;
    let dz = vel.z / (now || 1) + wish.z * 2.5 * dt * mag;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    vel.x = dx * sp;
    vel.z = dz * sp;
  } else if (p.climbing) {
    const into = -(wish.x * wallN.x + wish.z * wallN.z);
    // Sideways component along the wall plus a light push to stay attached.
    const lx = wish.x + wallN.x * into, lz = wish.z + wallN.z * into;
    vel.x = lx * speed * 0.6 - wallN.x * 1.5;
    vel.z = lz * speed * 0.6 - wallN.z * 1.5;
    vel.y = MOVE.climb * clamp(into * 1.4, 0, 1);
  } else if (p.grounded) {
    const tx = wish.x * speed * mag, tz = wish.z * speed * mag;
    const dx = tx - vel.x, dz = tz - vel.z, dl = Math.hypot(dx, dz);
    const rate = mag > 0.05 ? (p.swimming ? MOVE.swimAccel : MOVE.groundAccel) : MOVE.groundDecel;
    if (dl > 0) {
      const step = Math.min(dl, rate * dt);
      vel.x += (dx / dl) * step;
      vel.z += (dz / dl) * step;
    }
  } else {
    // Air: keep momentum, only add speed up to the target along the wish direction.
    const proj = vel.x * wish.x + vel.z * wish.z;
    const add = speed * mag - proj;
    if (add > 0 && mag > 0.05) {
      const a = Math.min(add, MOVE.airAccel * dt);
      vel.x += wish.x * a;
      vel.z += wish.z * a;
    }
    const drag = 1 - 0.25 * dt;
    vel.x *= drag;
    vel.z *= drag;
  }

  if (!frozen && pressed & BTN.JUMP) p.jumpBuffer = MOVE.jumpBuffer;
  else p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  if (p.jumpBuffer > 0 && !frozen) {
    if (p.climbing) {
      vel.x = wallN.x * MOVE.wallJump * 0.8;
      vel.z = wallN.z * MOVE.wallJump * 0.8;
      vel.y = MOVE.wallJump;
      p.climbing = false;
      p.jumpBuffer = 0;
    } else if (p.grounded || p.airTime < MOVE.coyote) {
      vel.y = p.swimming ? MOVE.swimJump : p.onEnemyPaint ? MOVE.enemyJump : MOVE.jump;
      p.grounded = false;
      p.airTime = MOVE.coyote;
      p.jumpBuffer = 0;
    } else if (p.airJumps > 0 && !p.diving) {
      vel.y = MOVE.airJump;
      p.airJumps--;
      p.jumpBuffer = 0;
      if (mag > 0.2) {
        const s = Math.max(Math.hypot(vel.x, vel.z), speed * 0.8);
        vel.x += (wish.x * s - vel.x) * 0.6;
        vel.z += (wish.z * s - vel.z) * 0.6;
      }
    }
  }

  if (p.grounded) {
    for (const l of launchers) {
      if (l.team >= 0 && l.team !== p.team) continue;
      if (Math.hypot(feet.x - l.x, feet.z - l.z) < l.r && Math.abs(feet.y - l.y) < 0.7) {
        set(vel, l.vx, l.vy, l.vz);
        p.grounded = false;
        p.airTime = MOVE.coyote;
        p.airJumps = 1;
        break;
      }
    }
  }

  if (!p.climbing) vel.y = Math.max(vel.y - GRAVITY * dt, -MOVE.maxFall);

  // On the ground, step along the surface under the feet. The controller keeps only the part of a
  // move that runs along a slope, so a flat step (or one pressed into the ground) would lose most
  // of its length on ramps. Following the slope keeps full speed up and down; snap-to-ground and
  // keep the feet on it.
  let dy = vel.y * dt;
  const walking = p.grounded && vel.y <= 0 && !p.climbing;
  if (walking) {
    const hit = w.raycast(set(probe, p.pos.x, p.pos.y - FEET_OFFSET + 0.3, p.pos.z), DOWN, 0.75);
    dy = hit && hit.normal.y > 0.55 ? (-(hit.normal.x * vel.x + hit.normal.z * vel.z) / hit.normal.y) * dt : -0.02;
  }
  set(delta, vel.x * dt, dy, vel.z * dt);
  const wasGrounded = p.grounded;
  let grounded = w.moveCapsule(col, p.pos, delta, moved);
  // A walking step that catches on a lip or a seam between blocks: try it again a hand's
  // width higher and keep whichever got further. Real walls block both.
  if (walking && Math.hypot(moved.x, moved.z) < Math.hypot(delta.x, delta.z) * 0.8) {
    const lowX = moved.x, lowY = moved.y, lowZ = moved.z;
    delta.y += 0.06;
    const liftGrounded = w.moveCapsule(col, p.pos, delta, moved);
    if (Math.hypot(moved.x, moved.z) > Math.hypot(lowX, lowZ) + 1e-4) grounded = liftGrounded || grounded;
    else {
      set(moved, lowX, lowY, lowZ);
      col.setTranslation({ x: p.pos.x + lowX, y: p.pos.y + lowY, z: p.pos.z + lowZ });
    }
    delta.y -= 0.06;
  }
  p.pos.x += moved.x;
  p.pos.y += moved.y;
  p.pos.z += moved.z;

  // Feed collisions back into velocity so walls and ceilings don't store speed.
  const wantH = Math.hypot(delta.x, delta.z), gotH = Math.hypot(moved.x, moved.z);
  if (gotH < wantH * 0.98 && !p.climbing && p.dodgeT <= 0) {
    vel.x = moved.x / dt;
    vel.z = moved.z / dt;
  }
  if (delta.y > 0 && moved.y < delta.y * 0.5) vel.y = Math.min(vel.y, 0);

  p.grounded = grounded && vel.y <= 0.1;
  if (p.grounded) {
    if (!wasGrounded) p.landT = 0;
    p.airTime = 0;
    p.airJumps = 1;
    if (vel.y < -2) vel.y = -2;
  } else p.airTime += dt;

  p.landT += dt;
  p.slideT = Math.max(0, p.slideT - dt);
  p.slideCd = Math.max(0, p.slideCd - dt);
  p.dodgeCd = Math.max(0, p.dodgeCd - dt);
  p.surgeT = Math.max(0, p.surgeT - dt);
  p.disruptedT = Math.max(0, p.disruptedT - dt);
  p.emoteT = Math.max(0, p.emoteT - dt);
  if (!frozen && pressed & BTN.EMOTE && p.grounded && !p.firing && !p.diving) {
    p.emoteT = 2.4;
    p.emoteSlot = Math.max(0, Math.min(7, (inp.emote ?? 0) | 0));
  }
}
