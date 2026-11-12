import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_HALF, DEFAULT_HANDLING, SURFACE_DRAG, SURFACE_GRIP, WHEEL_R, WHEEL_X, WHEEL_Y, WHEEL_Z, type Handling, type RoadSurface } from './config';
import { damageEffects, PART_COUNT, type DamageEffects } from './damage';
import { lateralOffset, SURFACES, type TrackPath } from './track';
import { G_CAR, G_GHOST, G_TRACK, groups, QUERY_TRACK } from './trackWorld';

/*
 * One car: a Rapier rigid body (a low box with its weight low down) on four ray-cast wheels.
 * Each wheel is a spring and damper pushing up, and a tyre whose grip is limited by how hard it
 * is pressed into the road (a friction circle shared between steering and drive). Drifting lowers
 * the rear grip; letting go after a long drift gives a small boost. Everything runs at the fixed
 * simulation step, so it's the same for people, bots and every frame rate.
 */

/** Input buttons. */
export const RB = { HANDBRAKE: 1, BOOST: 2, ITEM: 4, HORN: 8, RESET: 16, LOOKBACK: 32 } as const;
export const RB_MASK = 63;

export interface RaceInput {
  seq: number;
  /** -1 right … 1 left. */
  steer: number;
  throttle: number;
  brake: number;
  buttons: number;
}
export const emptyRaceInput = (): RaceInput => ({ seq: 0, steer: 0, throttle: 0, brake: 0, buttons: 0 });

/** Wheel order: front-left, front-right, rear-left, rear-right (x is the car's left). */
const MOUNTS: [number, number][] = [
  [WHEEL_X, WHEEL_Z],
  [-WHEEL_X, WHEEL_Z],
  [WHEEL_X, -WHEEL_Z],
  [-WHEEL_X, -WHEEL_Z],
];

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Rotates v by q into out. */
export function rotate(q: Quat, vx: number, vy: number, vz: number, out: { x: number; y: number; z: number }) {
  const ix = q.w * vx + q.y * vz - q.z * vy;
  const iy = q.w * vy + q.z * vx - q.x * vz;
  const iz = q.w * vz + q.x * vy - q.y * vx;
  const iw = -q.x * vx - q.y * vy - q.z * vz;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
}

const V = () => ({ x: 0, y: 0, z: 0 });
const fwd = V(), up = V(), left = V(), mount = V(), pv = V(), wf = V(), ws = V(), tmp = V(), imp = V(), pt = V();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

/** What one tick of driving produced, for effects and stats. */
export interface DriveOut {
  /** Tyres sliding (0–1), for smoke and squeal. */
  slip: number;
  /** A drift just ended with this tier (1–3) of boost. */
  released: number;
  grounded: number;
}

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Front wheel angle, radians (left positive). */
  steer = 0;
  /** Suspension compression per wheel, 0..1, and whether it touches. */
  readonly comp = [0, 0, 0, 0];
  readonly contact = [false, false, false, false];
  /** Wheel spin angle (visual). */
  spin = 0;
  /** Seconds of the current drift, and its direction. */
  drift = 0;
  driftDir = 0;
  /** Boost meter 0..1, boost time left (meter, mini-turbo, pickup). */
  meter = 0.25;
  miniT = 0;
  turboT = 0;
  boosting = false;
  /** Pickup effects. */
  shieldT = 0;
  spunT = 0;
  slipT = 0;
  draftT = 0;
  ghostT = 0;
  readonly damage = new Float32Array(PART_COUNT);
  fx: DamageEffects = damageEffects(this.damage, false);
  /** For audio and the HUD. */
  throttle = 0;
  brake = 0;
  rpm = 0;
  gear = 1;
  slip = 0;
  handbrake = false;
  /** Track sample the car is on, and the surface under it. */
  sample = 0;
  surface: RoadSurface = 'asphalt';
  offRoad = false;
  private prevH = false;
  /** Speed when the drift began (the slide keeps most of it). */
  private driftV = 0;

  constructor(
    readonly world: RAPIER.World,
    readonly h: Handling = DEFAULT_HANDLING,
    x = 0,
    y = 0,
    z = 0,
    yaw = 0,
  ) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCcdEnabled(true)
      .setLinearDamping(0.02)
      .setAngularDamping(0.8)
      // Weight low in the car, with plenty of roll inertia: it leans, it doesn't tip over.
      .setAdditionalMassProperties(h.mass, { x: 0, y: -0.28, z: 0.05 }, { x: h.mass * 1.6, y: h.mass * 1.85, z: h.mass * 0.62 }, { x: 0, y: 0, z: 0, w: 1 });
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z)
        .setTranslation(0, 0.12, 0)
        .setDensity(0)
        .setFriction(0.35)
        .setRestitution(0.18)
        .setCollisionGroups(groups(G_CAR, G_TRACK | G_CAR))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(h.mass * 60),
      this.body,
    );
  }

  get speed() {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Forward speed (negative when reversing). */
  forwardSpeed() {
    const q = this.body.rotation();
    rotate(q, 0, 0, 1, fwd);
    const v = this.body.linvel();
    return v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  }

  setGhost(on: boolean) {
    this.collider.setCollisionGroups(on ? groups(G_GHOST, G_TRACK) : groups(G_CAR, G_TRACK | G_CAR));
  }

  /** Puts the car at a spot, still. */
  place(x: number, y: number, z: number, yaw: number) {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.drift = 0;
    this.driftDir = 0;
    this.miniT = 0;
  }

  refreshDamage(mechanical: boolean) {
    this.fx = damageEffects(this.damage, mechanical);
  }

  /** One fixed step of driving. `locked` holds the car on the grid (countdown). */
  drive(inp: RaceInput, dt: number, path: TrackPath, locked: boolean): DriveOut {
    const h = this.h, b = this.body, fx = this.fx;
    const m = h.mass;
    const q = b.rotation();
    const pos = b.translation();
    const vel = b.linvel();
    const av = b.angvel();
    rotate(q, 0, 0, 1, fwd);
    rotate(q, 0, 1, 0, up);
    rotate(q, 1, 0, 0, left);
    const vf = vel.x * fwd.x + vel.y * fwd.y + vel.z * fwd.z;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const com = b.worldCom();

    // RoadSurface under the car, from where it is across the road.
    const off = lateralOffset(path, this.sample, pos.x, pos.y, pos.z);
    const half = path.w[this.sample];
    this.offRoad = Math.abs(off) > half + 0.6;
    this.surface = this.offRoad ? path.def.verge : SURFACES[path.surf[this.sample]] ?? 'asphalt';
    const surfGrip = SURFACE_GRIP[this.surface];

    // Inputs.
    let throttle = locked ? 0 : Math.max(0, Math.min(1, inp.throttle));
    let brake = Math.max(0, Math.min(1, inp.brake));
    const hand = !locked && (inp.buttons & RB.HANDBRAKE) !== 0;
    this.handbrake = hand;
    // Brake while rolling forward; reverse once nearly stopped. Throttle while rolling back brakes first.
    let reverse = 0;
    if (brake > 0.05 && vf < 1.2 && !locked) {
      reverse = brake;
      brake = 0;
    }
    if (throttle > 0.05 && vf < -1) {
      brake = Math.max(brake, throttle);
      throttle = 0;
    }
    if (locked) brake = 1;
    this.throttle = throttle || reverse;
    this.brake = brake;

    // Steering: less lock at speed, eased towards the stick.
    const sp = Math.min(1, Math.abs(vf) / h.topSpeed);
    const lock = (h.steerLow + (h.steerHigh - h.steerLow) * Math.sqrt(sp)) * fx.steer;
    let target = Math.max(-1, Math.min(1, inp.steer)) * lock + fx.pull;
    // Drifting: the front wheels counter-steer along the direction of travel (the slide is held by the drift control below).
    if (this.drift > 0) {
      const hl = Math.hypot(fwd.x, fwd.z) || 1;
      const beta = Math.atan2((vel.x * fwd.z - vel.z * fwd.x) / hl, (vel.x * fwd.x + vel.z * fwd.z) / hl);
      target = Math.max(-0.75, Math.min(0.75, beta * 0.95 + inp.steer * 0.08));
    }
    const ds = h.steerRate * dt;
    this.steer += Math.max(-ds, Math.min(ds, target - this.steer));

    // Drift: hold the handbrake while turning at speed.
    if (hand && speed > 9 && (this.drift > 0 || Math.abs(inp.steer) > 0.25)) {
      if (this.drift === 0) {
        this.driftDir = Math.sign(inp.steer) || 1;
        this.driftV = speed;
      }
      this.drift += dt;
    }
    let released = 0;
    if (!hand && this.prevH && this.drift > 0) {
      released = this.drift > 3 ? 3 : this.drift > 1.9 ? 2 : this.drift > 0.9 ? 1 : 0;
      if (released) {
        this.miniT = [0, 0.55, 0.9, 1.35][released];
        this.meter = Math.min(1, this.meter + 0.07 * released);
      }
    }
    if (!hand || speed < 6) {
      this.drift = 0;
      this.driftDir = 0;
    }
    this.prevH = hand;

    // Boost: the meter (held), a mini-turbo after a drift, or a pickup.
    this.boosting = false;
    let boostF = 0;
    if (!locked) {
      if (this.turboT > 0) boostF += h.boost * 1.15;
      if (this.miniT > 0) boostF += h.boost * 0.75;
      if (inp.buttons & RB.BOOST && this.meter > 0.01) {
        boostF += h.boost;
        this.meter = Math.max(0, this.meter - dt * 0.42);
      }
      if (this.slipT > 0 && this.draftT > 0) boostF += h.boost * 0.5;
      this.boosting = boostF > 0;
    }
    this.miniT = Math.max(0, this.miniT - dt);
    this.turboT = Math.max(0, this.turboT - dt);

    // Engine force falls away towards top speed; reverse is gentle.
    const top = h.topSpeed * (this.boosting ? 1.22 : 1);
    const curve = Math.max(0, 1 - (Math.max(0, vf) / top) ** 2);
    let driveF = throttle * h.engine * fx.power * curve * (1 - SURFACE_DRAG[this.surface] * 0.6);
    if (reverse) driveF = -reverse * h.engine * 0.45 * Math.max(0, 1 - Math.max(0, -vf) / h.reverseSpeed);
    driveF += boostF;

    // Wheels.
    let grounded = 0, slipSum = 0;
    let nx = 0, ny = 0, nz = 0;
    const spring = h.spring * fx.suspension, damper = h.damper * (0.6 + 0.4 * fx.suspension);
    const maxLen = h.rest + WHEEL_R;
    for (let w = 0; w < 4; w++) {
      const [mx, mz] = MOUNTS[w];
      rotate(q, mx, WHEEL_Y, mz, mount);
      mount.x += pos.x;
      mount.y += pos.y;
      mount.z += pos.z;
      ray.origin = mount;
      ray.dir = { x: -up.x, y: -up.y, z: -up.z };
      const hit = this.world.castRayAndGetNormal(ray, maxLen, true, undefined, QUERY_TRACK);
      if (!hit) {
        this.comp[w] += (0 - this.comp[w]) * 0.3;
        this.contact[w] = false;
        continue;
      }
      grounded++;
      this.contact[w] = true;
      const n = hit.normal;
      nx += n.x;
      ny += n.y;
      nz += n.z;
      const len = Math.max(0, hit.timeOfImpact - WHEEL_R);
      const x = h.rest - len;
      this.comp[w] = Math.max(0, Math.min(1, x / h.rest));
      b.velocityAtPoint(mount, pv);
      const vUp = pv.x * up.x + pv.y * up.y + pv.z * up.z;
      let Fs = spring * x - damper * vUp;
      Fs = Math.max(0, Math.min(Fs, m * 9.81 * 3));
      // Contact point on the road.
      pt.x = mount.x - up.x * hit.timeOfImpact;
      pt.y = mount.y - up.y * hit.timeOfImpact;
      pt.z = mount.z - up.z * hit.timeOfImpact;
      imp.x = up.x * Fs * dt;
      imp.y = up.y * Fs * dt;
      imp.z = up.z * Fs * dt;
      b.applyImpulseAtPoint(imp, mount, true);

      // Tyre directions on the road plane.
      const front = w < 2;
      if (front) {
        const c = Math.cos(this.steer), s = Math.sin(this.steer);
        wf.x = fwd.x * c + left.x * s;
        wf.y = fwd.y * c + left.y * s;
        wf.z = fwd.z * c + left.z * s;
      } else {
        wf.x = fwd.x;
        wf.y = fwd.y;
        wf.z = fwd.z;
      }
      const dn = wf.x * n.x + wf.y * n.y + wf.z * n.z;
      wf.x -= n.x * dn;
      wf.y -= n.y * dn;
      wf.z -= n.z * dn;
      const wl = Math.hypot(wf.x, wf.y, wf.z) || 1;
      wf.x /= wl;
      wf.y /= wl;
      wf.z /= wl;
      // Side (left) = n × wf.
      ws.x = n.y * wf.z - n.z * wf.y;
      ws.y = n.z * wf.x - n.x * wf.z;
      ws.z = n.x * wf.y - n.y * wf.x;
      b.velocityAtPoint(pt, pv);
      const vLong = pv.x * wf.x + pv.y * wf.y + pv.z * wf.z;
      const vLat = pv.x * ws.x + pv.y * ws.y + pv.z * ws.z;
      const mEff = m / 4;

      const mu = h.grip * surfGrip * fx.wheel[w] * (front ? 1 : 1.08);
      let latMu = mu;
      if (!front && hand) latMu *= h.driftGrip;
      if (this.spunT > 0) latMu *= 0.3;
      // Lateral: cancel sideways sliding, as far as grip allows.
      let jLat = -vLat * mEff * (front ? 0.85 : 0.8);
      // Longitudinal: drive is shared 40/60 front/rear; brakes on all four.
      let jLong = driveF * 0.5 * 0.5 * dt;
      if (brake > 0) jLong -= Math.sign(vLong) * Math.min(Math.abs(vLong) * mEff, brake * h.brake * fx.brake * 0.25 * dt);
      if (hand && !front && this.drift === 0) jLong -= Math.sign(vLong) * Math.min(Math.abs(vLong) * mEff * 0.15, h.brake * 0.12 * dt);
      // Rolling resistance and soft ground.
      jLong -= vLong * (0.0035 + SURFACE_DRAG[this.surface] * 0.05) * mEff * dt * 6;
      const maxLat = latMu * Fs * dt, maxLong = mu * Fs * dt * 1.1;
      const over = Math.hypot(jLat / Math.max(1e-6, maxLat), jLong / Math.max(1e-6, maxLong));
      if (over > 1) {
        jLat /= over;
        jLong /= over;
        slipSum += Math.min(1, (over - 1) * 0.8 + 0.25);
      }
      if (Math.abs(vLat) > 3.5) slipSum += Math.min(1, (Math.abs(vLat) - 3.5) / 6);
      // Apply near axle height (between road and centre of mass) so the car doesn't roll over.
      tmp.x = pt.x + (com.x - pt.x) * 0.7;
      tmp.y = pt.y + (com.y - pt.y) * 0.7;
      tmp.z = pt.z + (com.z - pt.z) * 0.7;
      imp.x = ws.x * jLat + wf.x * jLong;
      imp.y = ws.y * jLat + wf.y * jLong;
      imp.z = ws.z * jLat + wf.z * jLong;
      b.applyImpulseAtPoint(imp, tmp, true);
    }
    this.slip = Math.min(1, slipSum / 2.5);

    // Aerodynamics: drag always, downforce when the wheels are down.
    const dragK = h.drag * (this.slipT > 0 || this.draftT > 0 ? 0.72 : 1);
    b.applyImpulse({ x: -vel.x * speed * dragK * dt, y: -vel.y * speed * dragK * dt * 0.3, z: -vel.z * speed * dragK * dt }, true);
    if (grounded) {
      const df = h.downforce * vf * vf * dt;
      b.applyImpulse({ x: -up.x * df, y: -up.y * df, z: -up.z * df }, true);
    }

    // Stability and arcade assists.
    const I = m * 1.85;
    const yawRate = av.x * up.x + av.y * up.y + av.z * up.z;
    if (grounded >= 2) {
      nx /= grounded;
      ny /= grounded;
      nz /= grounded;
      // Keep the car square to the road: a soft spring on roll and pitch.
      const cx = up.y * nz - up.z * ny, cy = up.z * nx - up.x * nz, cz = up.x * ny - up.y * nx;
      const k = I * 3.5 * dt;
      b.applyTorqueImpulse({ x: cx * k - (av.x - up.x * yawRate) * I * 0.9 * dt, y: cy * k - (av.y - up.y * yawRate) * I * 0.9 * dt, z: cz * k - (av.z - up.z * yawRate) * I * 0.9 * dt }, true);
      if (this.drift > 0) {
        // Drift: the car slides at an angle it holds (steering opens or tightens it), its path curves
        // into the corner, and it keeps most of its speed. Counter-steering widens the line.
        const vh = Math.hypot(vel.x, vel.z);
        if (vh > 4) {
          const sd = inp.steer * this.driftDir; // +1 tighter, -1 wider
          const k = Math.min(1, vh / 14) * h.driftYaw;
          // Slip angle between heading and travel (left positive).
          const hx = fwd.x, hz = fwd.z, hl = Math.hypot(hx, hz) || 1;
          const beta = Math.atan2((vel.x * hz - vel.z * hx) / hl, (vel.x * hx + vel.z * hz) / hl);
          const betaWant = -this.driftDir * (0.38 + 0.18 * sd);
          const turnRate = this.driftDir * (0.62 + 0.42 * sd) * k;
          const tq = ((beta - betaWant) * 12 + (turnRate - yawRate) * 0.6) * I * 1.4 * dt;
          b.applyTorqueImpulse({ x: up.x * tq, y: up.y * tq, z: up.z * tq }, true);
          // Turn the direction of travel into the corner (from the velocity as it is now, after this
          // tick's suspension and tyre impulses, so they all still count).
          const cv = b.linvel();
          const cvh = Math.hypot(cv.x, cv.z) || 1;
          const turn = turnRate * dt;
          const c = Math.cos(turn), s2 = Math.sin(turn);
          let nvx = cv.x * c + cv.z * s2, nvz = -cv.x * s2 + cv.z * c;
          // Hold the entry speed, bleeding a little each second.
          this.driftV = Math.max(0, this.driftV - dt * 1.6);
          const want = Math.min(this.driftV, h.topSpeed);
          if (cvh < want) {
            const f2 = (cvh + (want - cvh) * Math.min(1, dt * 4)) / cvh;
            nvx *= f2;
            nvz *= f2;
          }
          b.setLinvel({ x: nvx, y: cv.y, z: nvz }, true);
        }
      } else if (Math.abs(inp.steer) < 0.15 && speed > 6) {
        // Not steering: calm a fishtailing car down.
        const tq = -yawRate * I * 0.9 * dt;
        b.applyTorqueImpulse({ x: up.x * tq, y: up.y * tq, z: up.z * tq }, true);
      }
    } else {
      // In the air: steer turns the car, throttle and brake pitch it, and it slowly levels itself.
      const a = h.air * I * dt;
      const ax = up.y * 0 - up.z * 1, az = up.x * 1 - up.y * 0;
      b.applyTorqueImpulse(
        {
          x: left.x * (inp.brake - inp.throttle) * a * 0.6 + ax * a * 1.4,
          y: inp.steer * a * 0.9,
          z: left.z * (inp.brake - inp.throttle) * a * 0.6 + az * a * 1.4,
        },
        true,
      );
    }

    // For the dashboard: a pretend gearbox.
    const kmh = Math.abs(vf) * 3.6;
    const gears = [0, 38, 70, 105, 140, 178, 999];
    let g = 1;
    while (g < 6 && kmh > gears[g]) g++;
    this.gear = reverse && vf < 0 ? 0 : g;
    const lo = gears[g - 1], hi = gears[g];
    const target2 = this.gear === 0 ? 0.35 : Math.min(1, 0.22 + 0.78 * ((kmh - lo) / Math.max(1, hi - lo)));
    const rev = locked && inp.throttle > 0.1 ? 0.3 + inp.throttle * 0.6 : target2;
    this.rpm += (rev - this.rpm) * Math.min(1, dt * 10);
    this.spin = (this.spin + (vf / WHEEL_R) * dt) % (Math.PI * 2);
    return { slip: this.slip, released, grounded };
  }

  /** Pose for the network and rendering. */
  get pose() {
    return { p: this.body.translation(), q: this.body.rotation(), v: this.body.linvel(), w: this.body.angvel() };
  }

  /** Upside down? */
  upsideDown() {
    rotate(this.body.rotation(), 0, 1, 0, tmp);
    return tmp.y < 0.15;
  }

  dispose() {
    this.world.removeRigidBody(this.body);
  }
}

export { MOUNTS as WHEEL_MOUNTS };
