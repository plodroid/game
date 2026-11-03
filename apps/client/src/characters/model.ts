import * as THREE from 'three';
import { ACCENT_COLORS, SKIN_TONES, type Cosmetics, type WeaponId } from '@chromashift/shared';
import { buildWeapon, type WeaponModel } from '../weapons/models';

/**
 * Procedural "Shifter" character. The rig is a plain Object3D hierarchy so a skinned GLB can
 * replace it later: anything exposing the same joint names works with the Animator.
 */
export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  chest: THREE.Object3D;
  head: THREE.Object3D;
  shoulderL: THREE.Object3D;
  shoulderR: THREE.Object3D;
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
  blob: THREE.Mesh;
  canisterFill: THREE.Mesh;
  weapon: WeaponModel;
  offWeapon: WeaponModel | null;
  teamMats: THREE.MeshStandardMaterial[];
  dispose(): void;
}

const seg = (detail: number, lo: number, hi: number) => Math.round(lo + ((hi - lo) * detail) / 2);

function capsule(r: number, len: number, detail: number) {
  return new THREE.CapsuleGeometry(r, len, seg(detail, 3, 6), seg(detail, 7, 14));
}

function lathe(points: [number, number][], detail: number) {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    seg(detail, 10, 24),
  );
}

export interface ModelOptions {
  cosmetics: Cosmetics;
  team: THREE.Color;
  weapon: WeaponId;
  detail: number;
  lambert: boolean;
}

export function buildCharacter(o: ModelOptions): Rig {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mat = (color: number | THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = o.lambert
      ? new THREE.MeshLambertMaterial({ color, emissive: extra.emissive ?? 0x000000, emissiveIntensity: extra.emissiveIntensity ?? 1 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...extra });
    mats.push(m);
    return m;
  };
  const d = o.detail;
  const c = o.cosmetics;
  const skin = mat(SKIN_TONES[c.skin] ?? SKIN_TONES[1], { roughness: 0.75 });
  const accent = mat(ACCENT_COLORS[c.accent] ?? 0x2a2d3a, { roughness: 0.7 });
  const dark = mat(0x23252f, { roughness: 0.8 });
  const white = mat(0xf3f0ea, { roughness: 0.5 });
  const eyeMat = mat(0x14151c, { roughness: 0.25 });
  const team = mat(o.team, { emissive: o.team, emissiveIntensity: 0.35, roughness: 0.35 }) as THREE.MeshStandardMaterial;
  const teamFlat = mat(o.team, { roughness: 0.45 }) as THREE.MeshStandardMaterial;

  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const me = new THREE.Mesh(g(geo), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    return me;
  };
  const node = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = node(body, 0, 0.86, 0);
  hips.add(mesh(new THREE.SphereGeometry(0.16, seg(d, 8, 16), seg(d, 6, 12)).scale(1, 0.62, 0.78), dark, 0, 0, 0));
  const spine = node(hips, 0, 0.06, 0);

  // Torso by outfit
  const torsoProfile: [number, number][] =
    c.outfit === 'vest'
      ? [[0.001, 0], [0.15, 0.02], [0.16, 0.16], [0.2, 0.3], [0.17, 0.4], [0.1, 0.44], [0.001, 0.45]]
      : c.outfit === 'suit'
        ? [[0.001, 0], [0.14, 0.02], [0.145, 0.18], [0.185, 0.32], [0.15, 0.41], [0.08, 0.44], [0.001, 0.45]]
        : [[0.001, 0], [0.155, 0.02], [0.16, 0.16], [0.205, 0.3], [0.18, 0.4], [0.1, 0.45], [0.001, 0.46]];
  const torso = mesh(lathe(torsoProfile, d).scale(1, 1, 0.76), c.outfit === 'suit' ? dark : accent);
  spine.add(torso);
  spine.add(mesh(new THREE.BoxGeometry(0.03, 0.36, 0.012), team, 0, 0.22, -0.148));
  if (c.outfit === 'hoodie') {
    const hood = mesh(new THREE.TorusGeometry(0.13, 0.05, seg(d, 4, 8), seg(d, 8, 16), Math.PI).scale(1, 1, 0.8), accent, 0, 0.42, 0.07);
    hood.rotation.x = -0.4;
    spine.add(hood);
  } else if (c.outfit === 'vest') {
    for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), dark, sx * 0.08, 0.14, -0.13));
  } else if (c.outfit === 'suit') {
    for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.012, 0.34, 0.012), team, sx * 0.1, 0.2, -0.13));
  } else {
    spine.add(mesh(new THREE.TorusGeometry(0.1, 0.028, seg(d, 4, 8), seg(d, 10, 18)).scale(1, 1, 0.8), accent, 0, 0.42, 0).rotateX(Math.PI / 2));
  }
  // Belt with the pigment canister: its fill shows the player's ink.
  spine.add(mesh(new THREE.TorusGeometry(0.155, 0.022, 4, seg(d, 12, 20)).scale(1, 1, 0.78), dark, 0, 0.02, 0).rotateX(Math.PI / 2));
  const can = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, seg(d, 8, 14)), mat(0xdfe8f5, { transparent: true, opacity: 0.35, roughness: 0.1 }), 0, 0.06, 0.15);
  spine.add(can);
  const canisterFill = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, seg(d, 8, 14)).translate(0, 0.065, 0), team, 0, -0.005, 0.15);
  spine.add(canisterFill);

  const chest = node(spine, 0, 0.36, 0);
  const neck = node(chest, 0, 0.06, 0);
  neck.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, seg(d, 6, 12)), skin, 0, 0, 0));
  const head = node(neck, 0, 0.07, 0);
  const headMesh = mesh(
    lathe([[0.001, -0.02], [0.13, 0.0], [0.205, 0.09], [0.225, 0.2], [0.2, 0.32], [0.12, 0.4], [0.001, 0.415]], d).scale(1, 1, 0.94),
    skin,
  );
  head.add(headMesh);
  // Face: big readable eyes with highlights, brows and a chroma mark.
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.052, seg(d, 8, 16), seg(d, 6, 12)).scale(0.8, 1.15, 0.45), eyeMat, sx * 0.08, 0.19, -0.19);
    eye.rotation.y = sx * 0.25;
    head.add(eye);
    head.add(mesh(new THREE.SphereGeometry(0.014, 6, 4), white, sx * 0.08 + 0.015, 0.215, -0.21));
    const brow = mesh(new THREE.CapsuleGeometry(0.012, 0.05, 2, 6), dark, sx * 0.085, 0.27, -0.195);
    brow.rotation.z = Math.PI / 2 + sx * 0.18;
    head.add(brow);
  }
  head.add(mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), team, 0.13, 0.12, -0.175).rotateY(-0.5));
  buildHair(head, c.hair, team, d, g);
  buildHeadgear(head, c.headgear, accent, dark, team, d, g);

  // Arms
  const arm = (side: number) => {
    const shoulder = node(chest, side * 0.2, 0.0, 0);
    shoulder.add(mesh(new THREE.SphereGeometry(0.07, seg(d, 6, 12), seg(d, 4, 8)), c.outfit === 'suit' ? dark : accent));
    shoulder.add(mesh(capsule(0.055, 0.17, d), c.outfit === 'vest' ? skin : c.outfit === 'suit' ? dark : accent, 0, -0.13, 0));
    const elbow = node(shoulder, 0, -0.27, 0);
    elbow.add(mesh(capsule(0.05, 0.15, d), c.outfit === 'vest' ? skin : accent, 0, -0.11, 0));
    elbow.add(mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.05, seg(d, 6, 12)), team, 0, -0.17, 0));
    const hand = node(elbow, 0, -0.25, 0);
    hand.add(mesh(new THREE.SphereGeometry(0.055, seg(d, 6, 12), seg(d, 4, 8)), dark));
    return { shoulder, elbow, hand };
  };
  const L = arm(-1), R = arm(1);

  const leg = (side: number) => {
    const hip = node(hips, side * 0.09, -0.02, 0);
    hip.add(mesh(capsule(0.07, 0.22, d), dark, 0, -0.18, 0));
    const knee = node(hip, 0, -0.38, 0);
    knee.add(mesh(capsule(0.06, 0.2, d), dark, 0, -0.17, 0));
    const foot = node(knee, 0, -0.38, 0);
    const shoe = mesh(new THREE.CapsuleGeometry(0.06, 0.13, 3, seg(d, 6, 12)).rotateX(Math.PI / 2).scale(1.1, 0.85, 1), white, 0, -0.025, -0.045);
    foot.add(shoe);
    foot.add(mesh(new THREE.BoxGeometry(0.13, 0.02, 0.24), teamFlat, 0, -0.07, -0.045));
    return { hip, knee };
  };
  const LL = leg(-1), RL = leg(1);

  const weapon = buildWeapon(o.weapon, team, dark, white, d, o.lambert);
  R.hand.add(weapon.group);
  let offWeapon: WeaponModel | null = null;
  if (o.weapon === 'dual') {
    offWeapon = buildWeapon('dual', team, dark, white, d, o.lambert);
    L.hand.add(offWeapon.group);
  }

  // Paint-dive form: a glossy blob that skims along the surface.
  const blobMat = new THREE.MeshStandardMaterial({ color: o.team, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 1, emissive: o.team, emissiveIntensity: 0.15 });
  mats.push(blobMat);
  const blob = new THREE.Mesh(g(new THREE.SphereGeometry(0.4, seg(d, 10, 24), seg(d, 8, 16))), blobMat);
  blob.visible = false;
  blob.castShadow = false;
  root.add(blob);

  return {
    root, body, hips, spine, chest, head,
    shoulderL: L.shoulder, shoulderR: R.shoulder, elbowL: L.elbow, elbowR: R.elbow, handL: L.hand, handR: R.hand,
    hipL: LL.hip, hipR: RL.hip, kneeL: LL.knee, kneeR: RL.knee,
    blob, canisterFill, weapon, offWeapon,
    teamMats: [team, teamFlat, blobMat],
    dispose() {
      for (const x of geos) x.dispose();
      for (const m of mats) m.dispose();
      weapon.dispose();
      offWeapon?.dispose();
    },
  };
}

function buildHair(head: THREE.Object3D, id: string, team: THREE.Material, d: number, g: <T extends THREE.BufferGeometry>(x: T) => T) {
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(g(geo), team);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    head.add(m);
    return m;
  };
  if (id === 'fin') {
    // Swept crest: an extruded curved fin running front-to-back.
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.08, 0.2, 0.34, 0.16);
    s.quadraticCurveTo(0.2, 0.06, 0.26, 0);
    s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: seg(d, 4, 10) });
    geo.translate(-0.13, 0, -0.035);
    add(geo, 0, 0.3, 0.02, 0, Math.PI / 2, 0);
    add(new THREE.SphereGeometry(0.215, seg(d, 10, 20), seg(d, 6, 12), 0, Math.PI * 2, 0, Math.PI * 0.42), 0, 0.12, 0.012);
  } else if (id === 'spikes') {
    add(new THREE.SphereGeometry(0.218, seg(d, 10, 20), seg(d, 6, 12), 0, Math.PI * 2, 0, Math.PI * 0.45), 0, 0.12, 0.01);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.45;
      add(new THREE.ConeGeometry(0.06, 0.2, seg(d, 5, 8)), Math.sin(a) * 0.13, 0.33, 0.06 + Math.cos(a) * 0.04, -0.9, 0, -a * 0.8);
    }
  } else if (id === 'bob') {
    add(new THREE.SphereGeometry(0.24, seg(d, 10, 20), seg(d, 8, 14), 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1, 1.02), 0, 0.12, 0.02);
    add(new THREE.BoxGeometry(0.3, 0.06, 0.06), 0, 0.33, -0.17, 0.4);
  } else if (id === 'tails') {
    add(new THREE.SphereGeometry(0.22, seg(d, 10, 20), seg(d, 6, 12), 0, Math.PI * 2, 0, Math.PI * 0.48), 0, 0.12, 0.01);
    for (const sx of [-1, 1]) {
      const drop = new THREE.LatheGeometry(
        [[0.001, 0], [0.05, 0.04], [0.07, 0.12], [0.05, 0.22], [0.001, 0.3]].map(([x, y]) => new THREE.Vector2(x, y)),
        seg(d, 8, 16),
      );
      add(drop, sx * 0.18, -0.06, 0.12, 0.35, 0, sx * 0.3);
    }
  } else {
    // ridge / mohawk
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.04, 0.12 - Math.abs(i - 1.5) * 0.02, 0.1), 0, 0.42 - Math.abs(i - 2) * 0.03, -0.16 + i * 0.08, 0.2 * (i - 2));
  }
}

function buildHeadgear(
  head: THREE.Object3D,
  id: string,
  accent: THREE.Material,
  dark: THREE.Material,
  team: THREE.Material,
  d: number,
  g: <T extends THREE.BufferGeometry>(x: T) => T,
) {
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const me = new THREE.Mesh(g(geo), m);
    me.position.set(x, y, z);
    me.rotation.x = rx;
    me.castShadow = true;
    head.add(me);
  };
  const s = (n: number) => seg(d, n, n * 2);
  switch (id) {
    case 'cap':
      add(new THREE.SphereGeometry(0.235, s(10), s(6), 0, Math.PI * 2, 0, Math.PI / 2), accent, 0, 0.18, 0.01);
      add(new THREE.CylinderGeometry(0.16, 0.16, 0.015, s(10), 1, false, 0, Math.PI).scale(1, 1, 0.9), accent, 0, 0.19, -0.16, 0);
      break;
    case 'phones':
      add(new THREE.TorusGeometry(0.235, 0.02, 4, s(12), Math.PI), dark, 0, 0.2, 0.01);
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, s(8)).rotateZ(Math.PI / 2), team, sx * 0.23, 0.19, 0.01);
      break;
    case 'visor':
      add(new THREE.TorusGeometry(0.21, 0.035, 4, s(14), Math.PI * 1.1).rotateX(Math.PI / 2).rotateY(Math.PI * 0.95), team, 0, 0.23, 0);
      break;
    case 'beanie':
      add(new THREE.SphereGeometry(0.235, s(10), s(8), 0, Math.PI * 2, 0, Math.PI * 0.55), accent, 0, 0.16, 0.01);
      add(new THREE.TorusGeometry(0.215, 0.035, 4, s(14)).rotateX(Math.PI / 2), dark, 0, 0.2, 0.01);
      add(new THREE.SphereGeometry(0.05, 6, 4), team, 0, 0.43, 0.02);
      break;
    case 'halo':
      add(new THREE.TorusGeometry(0.17, 0.018, 4, s(16)).rotateX(Math.PI / 2), team, 0, 0.52, 0.02);
      break;
  }
}
