import * as THREE from 'three';
import type { MapDef, PropDef } from '@chromashift/shared';
import { boxUV, chamferBox, Parts, rng, roughen, tube, turned } from '../modeling/kit';
import { surfaceMaterial } from '../modeling/surfaces';
import { facadeTexture, logoTexture } from './textures';

/*
 * The scenery props of the arenas, modelled rather than assembled: towers with setbacks, piers,
 * parapets and rooftop plant; tanks on braced legs with ladders and hatches; lattice masts; lamps
 * with lanterns; flanged pipework; trees with branches and clustered crowns; weathered rocks and
 * crystal clusters. Each prop is merged into a few meshes (one per material).
 */

export interface PropLook {
  lambert: boolean;
  tier: number;
  shadows?: boolean;
}

const up = -Math.PI / 2;

type Mats = Record<string, THREE.Material>;

function finish(p: Parts, mats: Mats, look: PropLook, def: PropDef): THREE.Group {
  const g = new THREE.Group();
  for (const [name, geo] of p.merged()) {
    const m = new THREE.Mesh(geo, mats[name] ?? mats.main);
    m.castShadow = look.shadows !== false && name !== 'glow' && name !== 'glass';
    m.receiveShadow = look.shadows !== false;
    g.add(m);
  }
  g.position.set(def.x, def.y, def.z);
  g.rotation.y = def.yaw ?? 0;
  g.traverse((x) => {
    x.matrixAutoUpdate = false;
    x.updateMatrix();
  });
  return g;
}

const size = (l: PropLook) => (l.lambert ? 0 : l.tier >= 3 ? 256 : 128);
const M = (l: PropLook, color: number, surface: Parameters<typeof surfaceMaterial>[0]['surface'], rough = 0.7, metal = 0, extra: Partial<Parameters<typeof surfaceMaterial>[0]> = {}) =>
  surfaceMaterial({ color, surface, rough, metal, lambert: l.lambert, size: size(l), ...extra });
const glow = (color: number, strength = 2.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: 0.4 });

/** A ladder up the side of something: two rails and rungs, from y0 to y1 at distance r, facing +z. */
function ladder(p: Parts, mat: string, r: number, y0: number, y1: number) {
  for (const sx of [-0.22, 0.22]) p.add(mat, tube([[sx, y0, r], [sx, y1, r], [sx, y1 + 0.25, r - 0.3]], 0.03, 5));
  for (let y = y0 + 0.3; y < y1; y += 0.42) p.add(mat, chamferBox(0.44, 0.04, 0.04, 0.01), 0, y, r);
}

function tower(def: PropDef, look: PropLook): THREE.Group {
  const s = def.s, H = def.h ?? 20, r = rng(Math.round(def.x * 7 + def.z * 13) + 5);
  const p = new Parts();
  const tall = H > 26;
  const split = tall ? 0.6 + r() * 0.12 : 1;
  const h1 = H * split, h2 = H - h1;
  const s2 = s * (0.72 + r() * 0.1);
  const ox = tall ? (r() - 0.5) * (s - s2) * 0.6 : 0, oz = tall ? (r() - 0.5) * (s - s2) * 0.6 : 0;
  const facade = (w: number, h: number, d: number) => boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), 1 / 8);
  // Plinth, body, ledge, upper tier.
  p.add('stone', chamferBox(s * 1.07, 1.8, s * 1.07, 0.25), 0, 0.9, 0);
  p.add('facade', facade(s, h1 - 1.8, s), 0, 1.8 + (h1 - 1.8) / 2, 0);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) p.add('stone', chamferBox(1.1, h1 - 1.8, 1.1, 0.14), sx * (s / 2 - 0.35), 1.8 + (h1 - 1.8) / 2, sz * (s / 2 - 0.35));
  p.add('stone', chamferBox(s * 1.06, 0.8, s * 1.06, 0.18), 0, h1 + 0.4, 0);
  let top = h1 + 0.8, ts = s;
  if (tall) {
    p.add('facade', facade(s2, h2, s2), ox, top + h2 / 2, oz);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) p.add('stone', chamferBox(0.8, h2, 0.8, 0.1), ox + sx * (s2 / 2 - 0.25), top + h2 / 2, oz + sz * (s2 / 2 - 0.25));
    top += h2;
    ts = s2;
    p.add('stone', chamferBox(s2 * 1.05, 0.6, s2 * 1.05, 0.14), ox, top + 0.3, oz);
    top += 0.6;
  }
  // Parapet round the roof.
  for (const [dx, dz, w, d] of [[0, 1, ts, 0.3], [0, -1, ts, 0.3], [1, 0, 0.3, ts], [-1, 0, 0.3, ts]] as const)
    p.add('stone', chamferBox(w, 0.9, d, 0.06), ox + dx * (ts / 2 - 0.15), top + 0.45, oz + dz * (ts / 2 - 0.15));
  // Rooftop plant: air handlers, a stair head, sometimes a water tank or a mast.
  const units = 2 + Math.floor(r() * 2);
  for (let i = 0; i < units; i++) {
    const w = 1.6 + r() * 1.4, d = 1.4 + r() * 1.2, x = ox + (r() - 0.5) * (ts - 4), z = oz + (r() - 0.5) * (ts - 4);
    p.add('metal', chamferBox(w, 1.1, d, 0.1), x, top + 0.55, z);
    p.add('dark', turned([[0, 0.02], [0.42, 0.02], [0.46, 0], [0.46, -0.06], [0, -0.06]], 10), x, top + 1.14, z, up);
  }
  p.add('stone', chamferBox(2.6, 2.2, 3, 0.12), ox + ts * 0.22, top + 1.1, oz - ts * 0.2);
  if (r() < 0.55) {
    const x = ox - ts * 0.22, z = oz + ts * 0.2;
    p.add('metal', turned([[0, 0], [1.1, 0], [1.2, 0.15], [1.2, 2.1], [0.9, 2.5], [0, 2.75]], 12), x, top + 1.2, z, up);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) p.add('dark', chamferBox(0.14, 1.3, 0.14, 0.03), x + sx * 0.8, top + 0.65, z + sz * 0.8);
  } else {
    const x = ox - ts * 0.25, z = oz + ts * 0.22;
    p.add('dark', tube([[x, top, z], [x, top + 7, z]], 0.09, 6));
    p.add('glow', new THREE.SphereGeometry(0.2, 8, 6), x, top + 7.1, z);
  }
  const tex = facadeTexture(Math.round(def.x * 7 + def.z));
  const mats: Mats = {
    facade: look.lambert ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.35 }),
    stone: M(look, r() < 0.5 ? 0xe6dfd1 : 0xd9dee4, 'concrete', 0.85),
    metal: M(look, 0xaab2bf, 'metal', 0.5, 0.5),
    dark: M(look, 0x3a4050, 'metal', 0.6, 0.4),
    glow: glow(0xff3355),
    main: M(look, 0xe6dfd1, 'concrete'),
  };
  return finish(p, mats, look, def);
}

function tank(def: PropDef, look: PropLook): THREE.Group {
  const s = def.s, h = def.h ?? 3, p = new Parts();
  const y0 = 0.9;
  // The vessel, with stiffening bands and a domed top.
  const wall: [number, number][] = [[0, y0], [s * 0.96, y0], [s, y0 + 0.12]];
  const bands = Math.max(2, Math.round(h / 1.3));
  for (let i = 1; i <= bands; i++) {
    const y = y0 + (h * i) / (bands + 1);
    wall.push([s, y - 0.07], [s + 0.05, y - 0.05], [s + 0.05, y + 0.05], [s, y + 0.07]);
  }
  wall.push([s, y0 + h], [s * 0.9, y0 + h + 0.4], [s * 0.5, y0 + h + 0.85], [s * 0.16, y0 + h + 1.0], [0, y0 + h + 1.0]);
  p.add('main', turned(wall, 20), 0, 0, 0, up);
  p.add('dark', turned([[0, 0], [s * 0.2, 0], [s * 0.22, 0.04], [s * 0.22, 0.14], [s * 0.14, 0.2], [0, 0.2]], 12), 0, y0 + h + 0.98, 0, up);
  // Braced legs.
  const leg = s * 0.72;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, b = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * leg, z = Math.sin(a) * leg, x2 = Math.cos(b) * leg, z2 = Math.sin(b) * leg;
    p.add('dark', chamferBox(0.2, y0 + 0.1, 0.2, 0.04), x, (y0 + 0.1) / 2, z);
    p.add('dark', chamferBox(0.42, 0.06, 0.42, 0.015), x, 0.03, z);
    p.add('dark', tube([[x, 0.12, z], [x2, y0 - 0.05, z2]], 0.035, 5));
  }
  ladder(p, 'dark', s + 0.08, 0.1, y0 + h + 0.2);
  // Outlet with a handwheel.
  p.add('dark', tube([[s * 0.5, y0, 0], [s * 0.5, 0.45, 0], [s * 0.75, 0.3, 0], [s * 1.25, 0.3, 0]], 0.1, 8));
  p.add('accent', new THREE.TorusGeometry(0.17, 0.025, 5, 12), s * 0.5, 0.62, 0.16);
  const mats: Mats = {
    main: M(look, 0x9aa4b5, 'metal', 0.55, 0.35),
    dark: M(look, 0x4d5568, 'metal', 0.6, 0.45),
    accent: M(look, 0xd7192f, 'paint', 0.5, 0.2),
  };
  return finish(p, mats, look, def);
}

function mast(def: PropDef, look: PropLook): THREE.Group {
  const h = def.h ?? 8, p = new Parts();
  const r0 = Math.max(0.35, h * 0.06), r1 = 0.08;
  const at = (i: number, y: number): [number, number, number] => {
    const a = (i / 3) * Math.PI * 2, r = r0 + ((r1 - r0) * y) / h;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let i = 0; i < 3; i++) p.add('main', tube([at(i, 0), at(i, h)], 0.035, 5));
  const levels = Math.max(4, Math.round(h / 1.1));
  for (let k = 0; k < levels; k++) {
    const y0 = (h * k) / levels, y1 = (h * (k + 1)) / levels;
    for (let i = 0; i < 3; i++) {
      p.add('main', tube([at(i, y0), at((i + 1) % 3, y1)], 0.018, 4));
      p.add('main', tube([at(i, y1), at((i + 1) % 3, y1)], 0.018, 4));
    }
  }
  p.add('dark', turned([[0, 0], [r0 + 0.25, 0], [r0 + 0.25, 0.1], [0, 0.14]], 10), 0, 0, 0, up);
  p.add('main', tube([[0, h, 0], [0, h + 1.1, 0]], 0.03, 5));
  p.add('glow', new THREE.SphereGeometry(0.15, 8, 6), 0, h + 1.15, 0);
  // Two dishes.
  for (const [f, yaw] of [[0.62, 0.6], [0.8, 3.4]]) {
    const y = h * f, rr = r0 + ((r1 - r0) * y) / h + 0.12;
    p.add('dish', turned([[0, 0], [0.2, 0.03], [0.34, 0.1], [0.38, 0.16], [0.36, 0.16], [0.2, 0.06], [0, 0.03]], 12), Math.sin(yaw) * rr, y, Math.cos(yaw) * rr, 0, yaw);
  }
  const mats: Mats = { main: M(look, 0xb9c0cc, 'metal', 0.45, 0.6), dark: M(look, 0x4d5568, 'concrete', 0.8), dish: M(look, 0xf1f1ec, 'paint', 0.5, 0.1), glow: glow(0xff3355) };
  return finish(p, mats, look, def);
}

function billboard(def: PropDef, look: PropLook): THREE.Group {
  const p = new Parts();
  // Frame, posts, back struts, a catwalk and three lamps leaning over the face.
  p.add('dark', chamferBox(5.4, 2.8, 0.2, 0.05), 0, 2.6, 0);
  for (const sx of [-2, 2]) {
    p.add('steel', chamferBox(0.2, 1.3, 0.24, 0.03), sx, 0.65, 0.02);
    p.add('steel', chamferBox(0.5, 0.06, 0.5, 0.015), sx, 0.03, 0.02);
    p.add('steel', tube([[sx, 3.6, 0.1], [sx, 0.1, 1.5]], 0.045, 5));
  }
  p.add('steel', chamferBox(5.3, 0.05, 0.5, 0.012), 0, 1.22, -0.3);
  p.add('steel', tube([[-2.6, 1.7, -0.54], [2.6, 1.7, -0.54]], 0.02, 4));
  for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) p.add('steel', tube([[x, 1.24, -0.54], [x, 1.7, -0.54]], 0.018, 4));
  for (const x of [-1.6, 0, 1.6]) {
    p.add('steel', tube([[x, 4.0, 0], [x, 4.4, -0.3], [x, 4.3, -0.75]], 0.022, 4));
    p.add('glow', chamferBox(0.34, 0.06, 0.16, 0.015), x, 4.27, -0.78);
  }
  const g = finish(p, { dark: M(look, 0x1b1d30, 'metal', 0.6, 0.3), steel: M(look, 0x59617a, 'metal', 0.5, 0.6), glow: glow(0xfff0c8, 1.6), main: M(look, 0x1b1d30, 'plain') }, look, def);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 2.4), new THREE.MeshBasicMaterial({ map: logoTexture(), toneMapped: false }));
  face.position.set(0, 2.6, -0.105);
  face.rotation.y = Math.PI;
  face.matrixAutoUpdate = false;
  face.updateMatrix();
  g.add(face);
  return g;
}

function lamp(def: PropDef, look: PropLook): THREE.Group {
  const p = new Parts();
  p.add('main', turned([[0, 0], [0.16, 0], [0.16, 0.05], [0.09, 0.09], [0.07, 0.2], [0.05, 0.26], [0.04, 1.3], [0.055, 1.33], [0.055, 1.37], [0, 1.37]], 10), 0, 0, 0, up);
  // Lantern: a cage round a glowing globe, under a little roof.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.add('main', chamferBox(0.022, 0.3, 0.022, 0.005), Math.cos(a) * 0.13, 1.52, Math.sin(a) * 0.13);
  }
  p.add('main', turned([[0, 0.14], [0.05, 0.12], [0.2, 0.02], [0.2, 0], [0, 0]], 8), 0, 1.67, 0, up);
  p.add('main', turned([[0, 0], [0.16, 0], [0.16, 0.03], [0, 0.03]], 8), 0, 1.355, 0, up);
  p.add('glow', new THREE.SphereGeometry(0.105, 10, 8), 0, 1.52, 0);
  return finish(p, { main: M(look, 0x353b4d, 'metal', 0.55, 0.5), glow: glow(0xffd28a, 2.6) }, look, def);
}

function pipe(def: PropDef, look: PropLook): THREE.Group {
  const h = def.h ?? 4, p = new Parts();
  const wall: [number, number][] = [[0.2, 0], [0.3, 0], [0.3, 0.07], [0.22, 0.07]];
  for (let y = 2.2; y < h - 0.6; y += 2.2) wall.push([0.22, y - 0.06], [0.29, y - 0.06], [0.29, y + 0.06], [0.22, y + 0.06]);
  wall.push([0.22, h - 0.3]);
  p.add('main', turned(wall, 12), 0, 0, 0, up);
  // An elbow at the top, turning away, and a handwheel on a stub lower down.
  const bend: [number, number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    bend.push([0.5 - Math.cos(a) * 0.5, h - 0.3 + Math.sin(a) * 0.5, 0]);
  }
  bend.push([1.1, h + 0.2, 0]);
  p.add('main', tube(bend, 0.22, 10));
  p.add('main', turned([[0.22, -0.06], [0.3, -0.06], [0.3, 0.06], [0.22, 0.06]], 12), 1.1, h + 0.2, 0, 0, Math.PI / 2);
  p.add('dark', tube([[0, 1.2, 0.2], [0, 1.2, 0.42]], 0.035, 5));
  p.add('accent', new THREE.TorusGeometry(0.16, 0.022, 5, 12), 0, 1.2, 0.43);
  for (let i = 0; i < 3; i++) p.add('accent', chamferBox(0.3, 0.02, 0.02, 0.004), 0, 1.2, 0.43, 0, 0, (i / 3) * Math.PI);
  return finish(p, { main: M(look, 0x7d8799, 'metal', 0.5, 0.45), dark: M(look, 0x4d5568, 'metal', 0.6, 0.4), accent: M(look, 0xd7192f, 'paint', 0.5, 0.2) }, look, def);
}

function panel(def: PropDef, look: PropLook): THREE.Group {
  const p = new Parts();
  p.add('main', chamferBox(0.14, 3.2, 6.2, 0.04), 0, 0, 0);
  p.add('dark', chamferBox(0.16, 2.9, 5.9, 0.02), 0, 0, 0);
  for (const y of [-1, 0, 1]) {
    p.add('glow', chamferBox(0.2, 0.09, 5.4, 0.02), 0, y, 0);
    for (const z of [-2.75, 2.75]) p.add('main', chamferBox(0.22, 0.16, 0.12, 0.02), 0, y, z);
  }
  // Vent slats between the light bars.
  for (const y of [-0.5, 0.5]) for (let z = -2.2; z <= 2.2; z += 0.55) p.add('main', chamferBox(0.18, 0.05, 0.4, 0.01), 0, y, z);
  return finish(p, { main: M(look, 0x2a3156, 'metal', 0.5, 0.5), dark: M(look, 0x141833, 'plastic', 0.7), glow: glow(0x5fd3ff, 1.7) }, look, def);
}

function crystals(def: PropDef, look: PropLook): THREE.Group {
  const s = def.s, p = new Parts(), r = rng(Math.round(def.x * 31 + def.z * 17) + 3);
  // A cluster of six-sided shards leaning out of a rocky foot.
  const shard = (h: number, w: number) => turned([[0, 0], [w * 0.8, 0.02 * h], [w, 0.55 * h], [w * 0.75, 0.82 * h], [0, h]], 6);
  p.add('main', shard(1.6 * s, 0.3 * s), 0, 0.05 * s, 0, up + 0.06);
  const n = 4 + Math.floor(r() * 2);
  const g = finish(p, { main: new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x5fd3ff, emissiveIntensity: 1.1, roughness: 0.12, metalness: 0.1, flatShading: true }) }, look, def);
  // Leaning shards, as separate small meshes (a handful per cluster).
  const mat = (g.children[0] as THREE.Mesh).material as THREE.Material;
  const r2 = rng(Math.round(def.x * 31 + def.z * 17) + 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r2(), k = 0.4 + r2() * 0.35;
    const m = new THREE.Mesh(shard(1.25 * s * k, 0.2 * s * k).rotateX(up), mat);
    m.position.set(Math.cos(a) * 0.3 * s, 0.02 * s, Math.sin(a) * 0.3 * s);
    m.rotation.set(Math.sin(a) * (0.5 + r2() * 0.3), 0, -Math.cos(a) * (0.5 + r2() * 0.3));
    m.castShadow = look.shadows !== false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    g.add(m);
  }
  const foot = new THREE.Mesh(roughen(new THREE.IcosahedronGeometry(0.42 * s, 1), 0.16 * s, 3 / s, 7).scale(1.2, 0.45, 1.2), M(look, 0x6f7d8c, 'stone', 0.9, 0, { flat: true }));
  foot.position.y = 0.05 * s;
  foot.matrixAutoUpdate = false;
  foot.updateMatrix();
  g.add(foot);
  return g;
}

/** A broadleaf tree: flared trunk, two limbs, a crown of several leafy masses in two greens. */
export function treeParts(p: Parts, s: number, seed: number) {
  const r = rng(seed);
  p.add('bark', roughen(turned([[0, 0], [0.26 * s, 0], [0.19 * s, 0.14 * s], [0.14 * s, 0.5 * s], [0.12 * s, 1.15 * s], [0.07 * s, 1.5 * s], [0, 1.52 * s]], 8, false), 0.03 * s, 6 / s, seed), 0, 0, 0, up);
  const crown: [number, number, number, number][] = [[0, 1.85 * s, 0, 0.78 * s]];
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2 + i * Math.PI, rr = (0.55 + r() * 0.25) * s, y = (1.25 + r() * 0.25) * s;
    p.add('bark', tube([[0, 0.9 * s, 0], [Math.cos(a) * rr * 0.5, y - 0.1 * s, Math.sin(a) * rr * 0.5], [Math.cos(a) * rr, y + 0.1 * s, Math.sin(a) * rr]], 0.05 * s, 5));
    crown.push([Math.cos(a) * rr, y + 0.25 * s, Math.sin(a) * rr, (0.5 + r() * 0.15) * s]);
  }
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2;
    crown.push([Math.cos(a) * 0.45 * s, (2.15 + r() * 0.25) * s, Math.sin(a) * 0.45 * s, (0.42 + r() * 0.14) * s]);
  }
  crown.forEach(([x, y, z, rad], i) => {
    const blob = roughen(new THREE.IcosahedronGeometry(rad, 1), rad * 0.3, 2.2 / rad, seed + i * 3);
    blob.scale(1, 0.82, 1);
    p.add(i % 2 ? 'leaf2' : 'leaf', blob, x, y, z);
  });
}

function tree(def: PropDef, look: PropLook, leaf: number): THREE.Group {
  const p = new Parts();
  treeParts(p, def.s, Math.round(def.x * 11 + def.z * 5) + 2);
  const c = new THREE.Color(leaf);
  const lighter = c.clone().offsetHSL(0.03, 0.02, 0.07), darker = c.clone().offsetHSL(-0.02, 0.04, -0.06);
  return finish(p, { bark: M(look, 0x7a5a3c, 'wood', 0.9), leaf: M(look, darker.getHex(), 'plain', 0.9, 0, { flat: true }), leaf2: M(look, lighter.getHex(), 'plain', 0.9, 0, { flat: true }) }, look, def);
}

/** A weathered boulder with a couple of smaller ones against it. */
export function rockParts(p: Parts, s: number, seed: number, mat = 'main') {
  const r = rng(seed);
  p.add(mat, roughen(new THREE.IcosahedronGeometry(s, 2), s * 0.42, 1.3 / s, seed).scale(1, 0.72, 1));
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2, k = 0.32 + r() * 0.2;
    p.add(mat, roughen(new THREE.IcosahedronGeometry(s * k, 1), s * k * 0.4, 1.6 / (s * k), seed + i + 1).scale(1, 0.7, 1), Math.cos(a) * s * 0.95, -s * 0.3, Math.sin(a) * s * 0.95);
  }
}

function rock(def: PropDef, look: PropLook): THREE.Group {
  const p = new Parts(), s = def.s, seed = Math.round(def.x * 3 + def.z * 19) + 1;
  rockParts(p, s, seed);
  // The underside tapers away (these float).
  p.add('under', roughen(new THREE.ConeGeometry(s * 0.92, s * 1.9, 9, 3), s * 0.22, 1.2 / s, seed + 4).rotateX(Math.PI), 0, -s * 1.15, 0);
  return finish(p, { main: M(look, 0x8a7b6a, 'stone', 0.95, 0, { flat: true }), under: M(look, 0x74665a, 'stone', 0.95, 0, { flat: true }) }, look, def);
}

/** The tapering rock underneath a floating island (scaled to the island's footprint). */
export function islandBelly(hx: number, hz: number, look: PropLook, seed: number): THREE.Mesh {
  const r = Math.min(hx, hz) * 1.15;
  const g = roughen(new THREE.ConeGeometry(r, r * 1.6, 12, 4), r * 0.2, 1.4 / r, seed).rotateX(Math.PI);
  const m = new THREE.Mesh(g, M(look, 0x7a6b5c, 'stone', 0.95, 0, { flat: true }));
  m.scale.set(hx / r, 1, hz / r);
  return m;
}

/** Builds a map prop, or null for kinds drawn elsewhere (clouds). */
export function buildPropModel(def: PropDef, map: MapDef, look: PropLook): THREE.Object3D | null {
  switch (def.kind) {
    case 'building': return tower(def, look);
    case 'tank': return tank(def, look);
    case 'antenna': return mast(def, look);
    case 'billboard': return billboard(def, look);
    case 'lamp': return lamp(def, look);
    case 'pipe': return pipe(def, look);
    case 'panel': return panel(def, look);
    case 'crystal': return crystals(def, look);
    case 'tree': return tree(def, look, map.theme.materials.island);
    case 'rock': return rock(def, look);
    default: return null;
  }
}

