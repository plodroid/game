import { EMOTE_TIME, type WeaponKind } from '@chromashift/shared';
import { EMOTE_MOVES, JOINTS, type EmoteCtx, type Joint, type V3 } from './emotes';
import type { Rig } from './model';

export interface AnimState {
  alive: boolean;
  grounded: boolean;
  diving: boolean;
  swimming: boolean;
  climbing: boolean;
  firing: boolean;
  rolling: boolean;
  sliding: boolean;
  /** 0..1 dodge progress, or -1 when not dodging. */
  dodge: number;
  /** Dodge direction relative to facing: +x right, +z forward. */
  dodgeX: number;
  dodgeZ: number;
  speed: number;
  vy: number;
  landT: number;
  aimPitch: number;
  ink: number;
  emote: string | null;
  emoteT: number;
  /** 'win' / 'lose' for end-of-match and menu poses. */
  outcome: 'none' | 'win' | 'lose';
  /** Hide the blob (rival swimming unseen). */
  hiddenBlob: boolean;
  wallYaw: number;
}

const J = JOINTS;

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Procedural pose blending. Joints ease towards per-frame targets, so state changes never snap. */
export class Animator {
  private t: Record<Joint, [number, number, number]>;
  private phase = 0;
  private recoil = 0;
  private hitT = 9;
  private emptyT = 9;
  private shift = 0;
  private bodyY = 0;
  private bodyZ = 0;
  private spin = 0;
  private time = 0;
  private spawnT = 9;
  private moveAmp = 0;
  private airAmp = 0;

  constructor(
    private rig: Rig,
    private kind: WeaponKind,
  ) {
    this.t = Object.fromEntries(J.map((j) => [j, [0, 0, 0]])) as Record<Joint, [number, number, number]>;
  }

  fire() {
    this.recoil = 1;
  }
  hit() {
    this.hitT = 0;
  }
  /** Out of pigment: a quick shake of the weapon. */
  empty() {
    this.emptyT = 0;
  }
  spawned() {
    this.spawnT = 0;
  }

  update(dt: number, a: AnimState) {
    const r = this.rig, t = this.t;
    this.time += dt;
    this.hitT += dt;
    this.emptyT += dt;
    this.spawnT += dt;
    this.recoil = Math.max(0, this.recoil - dt * 7);
    for (const j of J) t[j][0] = t[j][1] = t[j][2] = 0;

    const amp = Math.min(1, a.speed / 7.4);
    this.moveAmp += ((a.grounded && !a.sliding ? amp : 0) - this.moveAmp) * damp(10, dt);
    this.airAmp += ((a.grounded ? 0 : 1) - this.airAmp) * damp(12, dt);
    const m = this.moveAmp, air = this.airAmp;
    this.phase += dt * (4 + a.speed * 1.35) * (a.grounded ? 1 : 0.3);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);

    // Idle breathing
    const breathe = Math.sin(this.time * 2.1) * 0.025;
    t.chest[0] += breathe;
    t.head[0] -= breathe * 0.6;

    // Locomotion: stride from the hips, the swinging leg bends at the knee, the pelvis turns with
    // the forward leg while the chest counters it, and the body rises as the legs pass.
    const run = Math.min(1, Math.max(0, (a.speed - 5.6) / 1.8)) * m;
    const stride = 0.55 + 0.25 * run;
    t.hipL[0] += s * stride * m;
    t.hipR[0] -= s * stride * m;
    t.kneeL[0] -= (Math.max(0, c) * (0.95 + 0.4 * run) + 0.12) * m;
    t.kneeR[0] -= (Math.max(0, -c) * (0.95 + 0.4 * run) + 0.12) * m;
    t.hips[1] += s * 0.14 * m;
    t.hips[2] += s * 0.05 * m;
    t.spine[1] -= s * 0.12 * m;
    t.spine[0] += 0.06 * m + 0.16 * run;
    t.head[1] -= s * 0.03 * m;
    let bodyY = (0.028 + 0.02 * run) * m * Math.cos(this.phase * 2) - 0.03 * m;

    // Air: knees tucked while rising, legs reaching for the ground while falling.
    const rising = a.vy > 1 ? 1 : 0;
    t.hipL[0] += (0.7 * rising + 0.2) * air;
    t.hipR[0] += (0.25 * rising - 0.15) * air;
    t.kneeL[0] -= (1.1 * rising + 0.3) * air;
    t.kneeR[0] -= (0.6 * rising + 0.25) * air;
    t.spine[0] += 0.08 * air;

    // Landing: knees soak it up.
    if (a.landT < 0.22) {
      const f = 1 - a.landT / 0.22;
      t.kneeL[0] -= 0.7 * f;
      t.kneeR[0] -= 0.7 * f;
      t.hipL[0] += 0.35 * f;
      t.hipR[0] += 0.35 * f;
      t.spine[0] += 0.2 * f;
      bodyY -= 0.11 * f;
    }

    // Slide: down on the hip, lead leg out straight, the other folded under, leaning back.
    const slide = a.sliding ? 1 : 0;
    if (slide) {
      t.hipL[0] = 1.45;
      t.kneeL[0] = -0.12;
      t.hipR[0] = 1.25;
      t.kneeR[0] = -2.3;
      t.hipR[2] = -0.25;
      t.hips[1] = 0.25;
      t.spine[0] = -0.5;
      t.spine[1] = -0.2;
      t.head[0] = 0.4;
      bodyY -= 0.6;
    }

    // Dodge: a low dash, legs driving and the body leaning into the direction.
    const dash = a.dodge >= 0 ? Math.sin(Math.min(1, a.dodge) * Math.PI) : 0;
    if (dash > 0) {
      const ax = Math.abs(a.dodgeX);
      t.kneeL[0] -= 0.75 * dash;
      t.kneeR[0] -= 0.75 * dash;
      t.hipL[0] += (0.5 + 0.35 * a.dodgeZ) * dash;
      t.hipR[0] += (0.5 - 0.35 * a.dodgeZ) * dash;
      t.hipL[2] += 0.3 * ax * dash;
      t.hipR[2] -= 0.3 * ax * dash;
      t.spine[0] += 0.25 * dash;
      t.head[0] -= 0.2 * dash;
      bodyY -= 0.16 * dash;
    }

    // Arms by weapon
    const p = Math.max(-1.1, Math.min(1.1, a.aimPitch));
    const sprinting = a.speed > 6.2 && !a.firing && a.grounded;
    const k = this.kind;
    if (k === 'roller') {
      const roll = a.rolling ? 1 : 0;
      t.shoulderR[0] += 0.8 + 0.3 * roll + this.recoil * 1.3;
      t.shoulderL[0] += 0.8 + 0.3 * roll + this.recoil * 1.3;
      t.shoulderR[2] -= 0.35;
      t.shoulderL[2] += 0.35;
      t.elbowR[0] += 0.25;
      t.elbowL[0] += 0.25;
      t.spine[0] -= 0.25 * roll;
    } else if (sprinting) {
      t.shoulderL[0] -= s * 0.95 * m;
      t.shoulderR[0] += s * 0.55 * m + 0.55;
      t.shoulderL[2] += 0.12;
      t.shoulderR[2] -= 0.12;
      t.elbowL[0] += 1.25;
      t.elbowR[0] += 1.35;
    } else {
      t.shoulderR[0] += 1.45 + p + this.recoil * 0.25;
      t.shoulderR[2] -= 0.1;
      t.elbowR[0] += 0.12 - this.recoil * 0.2;
      if (k === 'dual') {
        t.shoulderL[0] += 1.45 + p + this.recoil * 0.2;
        t.shoulderL[2] += 0.1;
        t.elbowL[0] += 0.12;
      } else {
        t.shoulderL[0] += 1.2 + p * 0.85;
        t.shoulderL[2] += 0.62;
        t.elbowL[0] += 0.55;
      }
      t.chest[0] += p * 0.18;
    }
    t.head[0] += p * 0.45;
    if (!a.firing && !sprinting && k !== 'roller' && k !== 'dual') {
      t.shoulderL[0] -= s * 0.3 * m;
      t.elbowL[0] += Math.max(0, -s) * 0.2 * m;
    }
    if (slide && k === 'roller') {
      // Hold the heavy drum up and clear of the floor.
      t.shoulderR[0] += 0.8;
    }
    if (slide) {
      // Free hand trails behind for balance.
      t.shoulderL[0] = -0.5;
      t.shoulderL[2] = 0.9;
      t.elbowL[0] = 0.3;
    }
    if (dash > 0) {
      t.shoulderL[2] += 0.5 * dash;
      t.shoulderL[0] -= 0.4 * dash;
    }

    // Out-of-pigment shake: the weapon is rattled to show it's empty.
    if (this.emptyT < 0.45) {
      const f = 1 - this.emptyT / 0.45;
      t.shoulderR[2] += Math.sin(this.emptyT * 48) * 0.22 * f;
      t.elbowR[0] += Math.sin(this.emptyT * 48 + 1) * 0.3 * f;
      t.head[0] -= 0.12 * f;
    }

    // Hit flinch
    if (this.hitT < 0.25) {
      const f = 1 - this.hitT / 0.25;
      t.spine[0] += 0.22 * f;
      t.head[0] += 0.2 * f;
      t.spine[1] += 0.15 * f;
    }

    // Emotes and outcomes: a move is a whole pose of its own, blended in and out over the usual one.
    const emote = a.emoteT > 0 ? a.emote : null;
    const move = emote ?? (a.outcome === 'win' ? 'victory' : a.outcome === 'lose' ? 'defeat' : null);
    const choreo = move ? EMOTE_MOVES[move] : undefined;
    let spinTarget: number | null = null, flip = -1, slideZ = 0;
    if (choreo) {
      const pose = Object.fromEntries(J.map((j) => [j, [0, 0, 0] as V3])) as Record<Joint, V3>;
      const T = emote ? EMOTE_TIME - a.emoteT : this.time;
      const c: EmoteCtx = { t: pose, T, p: Math.min(1, T / EMOTE_TIME), y: 0, z: 0, spin: null, flip: -1 };
      choreo(c);
      const env = emote ? smooth(0, 0.25, T) * smooth(0, 0.3, a.emoteT) : 1;
      for (const j of J) for (let i = 0; i < 3; i++) t[j][i] += (pose[j][i] - t[j][i]) * env;
      bodyY += (c.y - bodyY) * env;
      slideZ = c.z * env;
      spinTarget = c.spin;
      flip = c.flip;
    }
    // Nothing in the hands while emoting.
    const bare = !!emote && !!choreo;
    r.weapon.group.visible = !bare;
    if (r.offWeapon) r.offWeapon.group.visible = !bare;
    const TAU = Math.PI * 2;
    // After a spin, settle by the shortest way back instead of unwinding every turn.
    this.spin = spinTarget !== null ? spinTarget : ((((this.spin + Math.PI) % TAU) + TAU) % TAU - Math.PI) * (1 - damp(8, dt));

    // Ease joints towards targets.
    const f = damp(a.alive ? 16 : 4, dt);
    for (const j of J) {
      const rot = r[j].rotation;
      rot.x += (t[j][0] - rot.x) * f;
      rot.y += (t[j][1] - rot.y) * f;
      rot.z += (t[j][2] - rot.z) * f;
    }
    this.bodyY += (bodyY - this.bodyY) * damp(14, dt);
    r.body.position.y = this.bodyY;
    this.bodyZ += (slideZ - this.bodyZ) * damp(14, dt);
    r.body.position.z = this.bodyZ;
    r.body.rotation.y = this.spin;

    // Dodge: the whole body leans into the dash.
    if (dash > 0) {
      r.body.rotation.x = -a.dodgeZ * 0.32 * dash;
      r.body.rotation.z = -a.dodgeX * 0.32 * dash;
    } else if (flip >= 0) {
      r.body.rotation.x = flip * Math.PI * 2;
    } else {
      r.body.rotation.x *= 1 - damp(20, dt);
      r.body.rotation.z *= 1 - damp(20, dt);
    }

    // Human ↔ blob shift
    this.shift += ((a.diving ? 1 : 0) - this.shift) * damp(26, dt);
    const human = Math.max(0, 1 - this.shift * 1.6);
    const spawnScale = this.spawnT < 0.35 ? easeOutBack(this.spawnT / 0.35) : 1;
    r.body.scale.setScalar(Math.max(0.0001, human * spawnScale));
    r.body.visible = human > 0.01;
    const blob = r.blob;
    blob.visible = this.shift > 0.02 && !a.hiddenBlob;
    if (blob.visible) {
      const wob = 1 + Math.sin(this.time * 14) * 0.05;
      const sb = Math.min(1, this.shift * 1.4);
      const bm = blob.material as THREE_Mat;
      if (a.climbing) {
        blob.position.set(0, 0.7, 0);
        blob.scale.set(0.95 * sb, 1.15 * sb * wob, 0.35 * sb);
        bm.opacity = 0.55;
      } else if (a.swimming) {
        blob.position.set(0, 0.03, 0);
        blob.scale.set(1.05 * sb * wob, 0.18 * sb, 1.25 * sb);
        bm.opacity = 0.45;
      } else {
        blob.position.set(0, 0.3 + Math.abs(Math.sin(this.time * 9)) * 0.06, 0);
        blob.scale.set(0.82 * sb * wob, 0.72 * sb, 0.82 * sb * wob);
        bm.opacity = 1;
      }
    }
    r.canisterFill.scale.y = Math.max(0.02, a.ink);
  }
}

type THREE_Mat = { opacity: number };

function easeOutBack(x: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
