import * as THREE from 'three';
import { FINISHES, WEAPONS, type WeaponId } from '@chromashift/shared';
import { patternTexture } from '../characters/patterns';

/** The second colour each finish pattern is drawn in. */
const PATTERN_INK = { camo: 0x3b4a22, stripes: 0xe0b03a, carbon: 0x3a3a44, marble: 0x9a93b4, galaxy: 0xffffff } as const;

export interface WeaponModel {
  group: THREE.Group;
  /** Tip of the barrel, for muzzle effects. */
  muzzle: THREE.Object3D;
  dispose(): void;
}

/**
 * Built in a canonical frame (grip at origin, barrel toward -Z, up +Y) and rotated onto the
 * hand, whose -Y runs along the forearm. Swap in a GLB later by matching this frame.
 */
export function buildWeapon(
  id: WeaponId,
  team: THREE.Material,
  dark: THREE.Material,
  light: THREE.Material,
  detail: number,
  lambert: boolean,
  finish = 'factory',
): WeaponModel {
  const def = WEAPONS[id] ?? WEAPONS.pulse;
  const f = FINISHES[finish] ?? FINISHES.factory;
  const geos: THREE.BufferGeometry[] = [];
  const own: THREE.Material[] = [];
  const s = (n: number) => Math.round(n + (n * detail) / 2);
  const map = f.pattern ? patternTexture(f.pattern, f.color, PATTERN_INK[f.pattern]) : null;
  const glow = f.glow ? { emissive: f.color, emissiveIntensity: f.glow } : {};
  const shell = lambert
    ? new THREE.MeshLambertMaterial({ color: map ? 0xffffff : f.color, map, ...glow })
    : new THREE.MeshStandardMaterial({ color: map ? 0xffffff : f.color, map, roughness: f.rough, metalness: f.metal, ...glow });
  const glass = new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.3, roughness: 0.05 });
  own.push(shell, glass);
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    geos.push(geo);
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.rotation.set(rx, ry, rz);
    me.castShadow = true;
    group.add(me);
    return me;
  };
  const muzzle = new THREE.Object3D();
  group.add(muzzle);
  const Z = Math.PI / 2;

  const parts = def.look.parts;
  if (parts?.length) {
    const mat = { team, dark, light, shell };
    for (const q of parts) {
      const geo =
        q.s === 'box' ? new THREE.BoxGeometry(1, 1, 1)
        : q.s === 'cyl' ? new THREE.CylinderGeometry(0.5, 0.5, 1, s(10)).rotateX(Z)
        : q.s === 'sphere' ? new THREE.SphereGeometry(0.5, s(10), s(8))
        : q.s === 'cone' ? new THREE.ConeGeometry(0.5, 1, s(10)).rotateX(-Z)
        : new THREE.TorusGeometry(0.5, 0.12, 6, s(14));
      add(geo, mat[q.c], q.x, q.y, q.z).scale.set(q.w, q.h, q.d);
    }
    muzzle.position.set(0, def.look.muzzle?.[0] ?? 0.1, def.look.muzzle?.[1] ?? -0.4);
  } else switch (def.kind) {
    case 'auto':
      add(new THREE.BoxGeometry(0.05, 0.12, 0.06), dark, 0, 0.01, 0.03, -0.25);
      add(new THREE.CapsuleGeometry(0.055, 0.26, 3, s(8)).rotateX(Z), shell, 0, 0.11, -0.06);
      add(new THREE.CylinderGeometry(0.026, 0.03, 0.2, s(8)).rotateX(Z), dark, 0, 0.12, -0.3);
      add(new THREE.TorusGeometry(0.035, 0.012, 4, s(10)), team, 0, 0.12, -0.4);
      add(new THREE.CapsuleGeometry(0.035, 0.14, 3, s(8)).rotateX(Z), glass, 0, 0.19, 0.0);
      add(new THREE.CapsuleGeometry(0.028, 0.12, 3, s(8)).rotateX(Z), team, 0, 0.185, 0.0);
      add(new THREE.BoxGeometry(0.11, 0.012, 0.2), team, 0, 0.06, -0.05);
      muzzle.position.set(0, 0.12, -0.42);
      break;
    case 'roller': {
      // Long handle angled down-forward with a wide roller head.
      const handle = new THREE.Group();
      // Near level, so the drum stays off the floor (a steep angle dug it into the ground).
      handle.rotation.x = 0.15;
      group.add(handle);
      const h = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rz = 0) => {
        geos.push(geo);
        const me = new THREE.Mesh(geo, m);
        me.position.set(x, y, z);
        me.rotation.z = rz;
        me.castShadow = true;
        handle.add(me);
      };
      h(new THREE.CylinderGeometry(0.022, 0.022, 0.95, s(8)).rotateX(Z), dark, 0, 0, -0.42);
      h(new THREE.CylinderGeometry(0.035, 0.035, 0.16, s(8)).rotateX(Z), team, 0, 0, 0.02);
      h(new THREE.BoxGeometry(0.05, 0.05, 0.14), shell, 0, 0, -0.9);
      h(new THREE.CylinderGeometry(0.15, 0.15, 0.95, s(12)), shell, 0, -0.02, -0.98, Z);
      h(new THREE.CylinderGeometry(0.155, 0.155, 0.8, s(12)), team, 0, -0.02, -0.98, Z);
      handle.add(muzzle);
      muzzle.position.set(0, 0, -1.0);
      break;
    }
    case 'burst':
      add(new THREE.BoxGeometry(0.06, 0.13, 0.07), dark, 0, 0.01, 0.04, -0.2);
      add(new THREE.CylinderGeometry(0.075, 0.08, 0.34, s(10)).rotateX(Z), shell, 0, 0.13, -0.08);
      add(
        new THREE.LatheGeometry([[0.05, 0], [0.07, 0.06], [0.12, 0.12], [0.13, 0.14]].map(([x, y]) => new THREE.Vector2(x, y)), s(10)).rotateX(-Z),
        dark, 0, 0.13, -0.25,
      );
      for (const z of [-0.02, -0.14]) add(new THREE.TorusGeometry(0.085, 0.016, 4, s(12)), team, 0, 0.13, z);
      add(new THREE.SphereGeometry(0.06, s(8), s(6)), glass, 0, 0.24, 0.02);
      add(new THREE.SphereGeometry(0.048, s(8), s(6)), team, 0, 0.24, 0.02);
      muzzle.position.set(0, 0.13, -0.4);
      break;
    case 'lobber':
      add(new THREE.BoxGeometry(0.055, 0.13, 0.065), dark, 0, 0.01, 0.05, -0.2);
      add(new THREE.BoxGeometry(0.12, 0.1, 0.3), shell, 0, 0.11, -0.04);
      add(new THREE.CylinderGeometry(0.085, 0.085, 0.34, 3).rotateX(Z).rotateZ(Z), team, 0, 0.2, -0.06);
      add(new THREE.CylinderGeometry(0.06, 0.075, 0.08, s(8)).rotateX(Z), dark, 0, 0.13, -0.23);
      muzzle.position.set(0, 0.14, -0.3);
      break;
    case 'dual':
      add(new THREE.BoxGeometry(0.045, 0.1, 0.05), dark, 0, 0.0, 0.02, -0.25);
      add(new THREE.BoxGeometry(0.06, 0.08, 0.2), shell, 0, 0.08, -0.05);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, s(8)).rotateX(Z), dark, 0, 0.09, -0.19);
      add(new THREE.TorusGeometry(0.032, 0.01, 4, s(10)), team, 0, 0.09, -0.24);
      add(new THREE.BoxGeometry(0.065, 0.012, 0.14), team, 0, 0.125, -0.04);
      muzzle.position.set(0, 0.09, -0.26);
      break;
  }

  // What sets each weapon apart from its base: one extra part, then its proportions.
  const top = def.kind === 'dual' ? 0.13 : 0.2;
  switch (parts?.length ? 'none' : def.look.extra) {
    case 'scope':
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.14, s(8)).rotateX(Z), dark, 0, top + 0.03, -0.08);
      add(new THREE.CircleGeometry(0.018, s(8)), glass, 0, top + 0.03, -0.151);
      break;
    case 'drum':
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, s(10)).rotateZ(Z), team, 0, 0.0, -0.12);
      break;
    case 'fins':
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.008, 0.07, 0.12), team, sx * 0.065, 0.13, 0.02, 0, 0, sx * 0.3);
      break;
    case 'tank':
      add(new THREE.CapsuleGeometry(0.045, 0.16, 3, s(8)).rotateX(Z), glass, 0, top + 0.04, -0.02);
      add(new THREE.CapsuleGeometry(0.036, 0.14, 3, s(8)).rotateX(Z), team, 0, top + 0.035, -0.02);
      break;
    case 'spikes':
      for (const z of [0, -0.06, -0.12]) add(new THREE.ConeGeometry(0.012, 0.04, 5), team, 0, top - 0.005, z);
      break;
    case 'rings':
      for (const z of [-0.05, -0.15, -0.25]) add(new THREE.TorusGeometry(def.kind === 'roller' ? 0.03 : 0.075, 0.01, 4, s(10)), team, 0, def.kind === 'roller' ? 0.02 : 0.13, z);
      break;
    case 'grip':
      add(new THREE.BoxGeometry(0.035, 0.09, 0.04), dark, 0, 0.03, -0.17, 0.25);
      break;
  }
  group.scale.set(def.look.bulk, def.look.bulk, def.look.len);
  group.rotation.x = -Math.PI / 2;
  return {
    group,
    muzzle,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of own) m.dispose();
    },
  };
}
