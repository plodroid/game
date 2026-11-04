import type { WeaponKind } from '@chromashift/shared';
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

const J = ['hips', 'spine', 'chest', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR'] as const;
type Joint = (typeof J)[number];

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

    // Locomotion
    t.hipL[0] += s * 0.75 * m;
    t.hipR[0] -= s * 0.75 * m;
    t.kneeL[0] -= (Math.max(0, c) * 1.1 + 0.08) * m;
    t.kneeR[0] -= (Math.max(0, -c) * 1.1 + 0.08) * m;
    t.hips[1] += s * 0.12 * m;
    t.spine[0] -= 0.14 * m;
    let bodyY = Math.abs(s) * 0.045 * m - 0.02 * m;

    // Air: tucked rising, reaching when falling.
    const rising = a.vy > 1 ? 1 : 0;
    t.hipL[0] += (0.55 * rising + 0.25) * air;
    t.hipR[0] += (0.15 * rising - 0.1) * air;
    t.kneeL[0] -= (0.95 * rising + 0.35) * air;
    t.kneeR[0] -= (0.5 * rising + 0.2) * air;

    // Landing squash
    if (a.landT < 0.18) bodyY -= 0.1 * (1 - a.landT / 0.18);

    if (a.sliding) {
      t.spine[0] += 0.4;
      t.hipL[0] += 1.25;
      t.kneeL[0] -= 0.25;
      t.hipR[0] += 0.6;
      t.kneeR[0] -= 1.2;
      bodyY -= 0.36;
    }

    // Arms by weapon
    const p = Math.max(-1.1, Math.min(1.1, a.aimPitch));
    const sprinting = a.speed > 6.2 && !a.firing && a.grounded;
    const k = this.kind;
    if (k === 'roller') {
      const roll = a.rolling ? 1 : 0;
      t.shoulderR[0] += 0.55 + 0.3 * roll + this.recoil * 1.3;
      t.shoulderL[0] += 0.55 + 0.3 * roll + this.recoil * 1.3;
      t.shoulderR[2] -= 0.35;
      t.shoulderL[2] += 0.35;
      t.elbowR[0] += 0.25;
      t.elbowL[0] += 0.25;
      t.spine[0] -= 0.25 * roll;
    } else if (sprinting) {
      t.shoulderL[0] -= s * 0.7 * m;
      t.shoulderR[0] += s * 0.4 * m + 0.6;
      t.elbowL[0] += 0.7;
      t.elbowR[0] += 1.1;
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
    if (!a.firing && !sprinting && k !== 'roller') {
      t.shoulderL[0] -= s * 0.15 * m;
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

    // Emotes and outcomes
    const e = a.emoteT > 0 ? a.emote : a.outcome === 'win' ? 'victory' : a.outcome === 'lose' ? 'defeat' : null;
    let spinTarget = 0;
    if (e === 'wave') {
      t.shoulderR[0] = 2.7;
      t.shoulderR[2] = -0.5 + Math.sin(this.time * 11) * 0.35;
      t.elbowR[0] = 0.4;
    } else if (e === 'spin') {
      spinTarget = (1 - a.emoteT / 2.4) * Math.PI * 4;
    } else if (e === 'flex') {
      t.shoulderL[2] = 1.45;
      t.shoulderR[2] = -1.45;
      t.elbowL[0] = 1.8;
      t.elbowR[0] = 1.8;
      t.shoulderL[0] = t.shoulderR[0] = 0.2;
    } else if (e === 'dance') {
      t.hips[2] = Math.sin(this.time * 8) * 0.15;
      t.shoulderL[0] = 1.4 + Math.sin(this.time * 8) * 0.8;
      t.shoulderR[0] = 1.4 - Math.sin(this.time * 8) * 0.8;
      bodyY += Math.abs(Math.sin(this.time * 8)) * 0.06;
    } else if (e === 'victory') {
      t.shoulderL[0] = t.shoulderR[0] = 2.8;
      t.shoulderL[2] = 0.3;
      t.shoulderR[2] = -0.3;
      bodyY += Math.abs(Math.sin(this.time * 6)) * 0.18;
      t.head[0] = 0.25;
    } else if (e === 'defeat') {
      t.head[0] = -0.55;
      t.spine[0] = -0.3;
      t.shoulderL[0] = t.shoulderR[0] = 0.1;
      t.shoulderL[2] = 0.15;
      t.shoulderR[2] = -0.15;
      bodyY -= 0.05;
    }
    this.spin = e === 'spin' ? spinTarget : this.spin * (1 - damp(8, dt));

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
    r.body.rotation.y = this.spin;

    // Dodge roll: one full tumble around the dodge axis.
    if (a.dodge >= 0) {
      const ang = a.dodge * Math.PI * 2;
      r.body.rotation.x = -ang * a.dodgeZ;
      r.body.rotation.z = ang * a.dodgeX;
      r.body.position.y = this.bodyY - Math.sin(a.dodge * Math.PI) * 0.35;
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
