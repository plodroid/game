import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EMOTE_TIME } from '@chromashift/shared';
import { Animator } from './animator';
import { EMOTE_MOVES } from './emotes';
import type { Rig } from './model';

/** The joint layout of the real rig (see model.ts), without any meshes. */
function stub() {
  const node = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = node(body, 0, 0.86, 0);
  const spine = node(hips, 0, 0.06, 0);
  const chest = node(spine, 0, 0.36, 0);
  const neck = node(chest, 0, 0.06, 0);
  const head = node(neck, 0, 0.07, 0);
  const arm = (s: number) => {
    const shoulder = node(chest, s * 0.2, 0);
    const elbow = node(shoulder, 0, -0.27);
    return { shoulder, elbow, hand: node(elbow, 0, -0.25) };
  };
  const leg = (s: number) => {
    const hip = node(hips, s * 0.09, -0.02);
    const knee = node(hip, 0, -0.38);
    return { hip, knee, foot: node(knee, 0, -0.38) };
  };
  const L = arm(-1), R = arm(1), LL = leg(-1), RL = leg(1);
  const rig = {
    root, body, hips, spine, chest, head,
    shoulderL: L.shoulder, shoulderR: R.shoulder, elbowL: L.elbow, elbowR: R.elbow, handL: L.hand, handR: R.hand,
    hipL: LL.hip, hipR: RL.hip, kneeL: LL.knee, kneeR: RL.knee,
    blob: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
    canisterFill: new THREE.Mesh(),
    weapon: { group: new THREE.Group() },
    offWeapon: null,
  } as unknown as Rig;
  return { rig, spine, head, hands: [L.hand, R.hand], elbows: [L.elbow, R.elbow], feet: [LL.foot, RL.foot], knees: [LL.knee, RL.knee] };
}

const base = {
  alive: true, grounded: true, diving: false, swimming: false, climbing: false, firing: false, rolling: false, sliding: false,
  dodge: -1, dodgeX: 0, dodgeZ: 0, speed: 0, vy: 0, landT: 9, aimPitch: 0, ink: 1, outcome: 'none' as const, hiddenBlob: false, wallYaw: 0,
};

/** Plays an emote and returns what it found wrong with it. */
function inspect(id: string) {
  const { rig, spine, head, hands, elbows, feet, knees } = stub();
  const anim = new Animator(rig, 'auto');
  const bad = new Set<string>();
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  let weaponShown = false;
  for (let f = 0; f <= EMOTE_TIME * 60; f++) {
    const left = EMOTE_TIME - f / 60;
    anim.update(1 / 60, { ...base, emote: id, emoteT: Math.max(0.0001, left) });
    rig.root.updateMatrixWorld(true);
    if (rig.weapon.group.visible) weaponShown = true;
    const flipping = Math.abs(rig.body.rotation.x) > 0.3;
    const T = EMOTE_TIME - left;
    // Head: hands and elbows must stay outside the skull (an ellipsoid with a hand's thickness added).
    for (const [label, list] of [['hand', hands], ['elbow', elbows]] as const)
      list.forEach((o, i) => {
        o.getWorldPosition(v);
        head.worldToLocal(v);
        const n = (v.x / 0.285) ** 2 + ((v.y - 0.2) / 0.27) ** 2 + (v.z / 0.27) ** 2;
        if (n < 1 && !flipping) bad.add(`${label}${i ? 'R' : 'L'} in the head @${T.toFixed(2)}s (${n.toFixed(2)})`);
      });
    // Torso: hands must not pass through the body.
    hands.forEach((o, i) => {
      o.getWorldPosition(v);
      spine.worldToLocal(v);
      const n = (v.x / 0.17) ** 2 + (v.z / 0.14) ** 2;
      if (n < 1 && v.y > -0.05 && v.y < 0.5 && !flipping) bad.add(`hand${i ? 'R' : 'L'} in the torso @${T.toFixed(2)}s`);
    });
    // Floor: nothing below the ground.
    for (const o of [...feet, ...hands, ...knees]) {
      o.getWorldPosition(w);
      if (w.y < -0.04 && !flipping) bad.add(`part under the floor @${T.toFixed(2)}s (${w.y.toFixed(2)})`);
    }
  }
  return { bad: [...bad], weaponShown };
}

describe('emotes', () => {
  const ids = Object.keys(EMOTE_MOVES).filter((m) => m !== 'victory' && m !== 'defeat');
  it('plays more than fifty distinct moves', () => {
    expect(ids.length).toBeGreaterThan(50);
  });
  it.each(ids)('%s hides the weapon and passes through nothing', (id) => {
    const r = inspect(id);
    expect(r.weaponShown).toBe(false);
    expect(r.bad.slice(0, 4)).toEqual([]);
  });
});
