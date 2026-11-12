import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapDef } from '@chromashift/shared';
import type { Shore } from './ocean';

/*
 * Summer scenery around the arena: sandy islands with palm trees and beach umbrellas out at sea,
 * a beach under maps that stand high above the water, and pier stilts under arenas that sit just
 * over it. Everything is visual only, far from where anyone can walk, and drawn with a handful of
 * instanced draw calls whatever the count.
 */

export interface BeachOptions {
  tier: number;
  lambert: boolean;
  seaLevel: number;
  /** Radius of a beach island under the arena itself (maps high above the sea), or 0. */
  land: number;
  /** Small sandy islets at these spots (under towers that rise out of the sea). */
  islets?: Shore[];
}

export interface Beach {
  group: THREE.Group;
  /** Where the sand meets the sea, for the shallows and foam. */
  shores: Shore[];
  dispose(): void;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const mat = (lambert: boolean, p: THREE.MeshStandardMaterialParameters) =>
  lambert ? new THREE.MeshLambertMaterial({ color: p.color, map: p.map ?? null, vertexColors: p.vertexColors, side: p.side, alphaTest: p.alphaTest ?? 0 }) : new THREE.MeshStandardMaterial(p);

// ---- Textures --------------------------------------------------------------------------------------

let sandTex: THREE.Texture | null = null;
export function sandTexture() {
  if (sandTex) return sandTex;
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const r = rng(77);
  for (let i = 0; i < n * n; i++) {
    const v = 225 + (r() - 0.5) * 40 + (r() > 0.985 ? -60 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Soft ripples left by the wind.
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 3;
  for (let y = 0; y < n; y += 14) {
    ctx.beginPath();
    for (let x = 0; x <= n; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 4);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(6, 6);
  sandTex = t;
  return t;
}

let leafTex: THREE.Texture | null = null;
/** One palm frond: a midrib with long leaflets, on a transparent background. */
function leafTexture() {
  if (leafTex) return leafTex;
  const w = 128, h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const y = 12 + (i / 26) * (h - 24);
    const len = Math.sin((i / 26) * Math.PI) * (w * 0.48) + 6;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = i % 3 ? '#3f7d2f' : '#58973a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w / 2 + side * len * 0.6, y + 4, w / 2 + side * len, y + 14);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#7a8a3a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  leafTex = t;
  return t;
}

let stripeTex: THREE.Texture | null = null;
function stripeTexture() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 8;
  const ctx = c.getContext('2d')!;
  const cols = ['#ff3f8e', '#fff6ea', '#19d3be', '#fff6ea', '#ffc532', '#fff6ea', '#ff3f8e', '#fff6ea'];
  cols.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(i * 32, 0, 32, 8);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  stripeTex = t;
  return t;
}

// ---- Geometry --------------------------------------------------------------------------------------

/** A low sandy island: a dome whose edge slips under the water, damp sand at the waterline. */
function islandGeometry(radius: number, height: number, seed: number, detail: number) {
  const r = rng(seed);
  const rings = [6, 9, 12, 16, 20][detail], segs = [16, 24, 32, 44, 56][detail];
  const wob = [r() * 6, r() * 6, r() * 6];
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const dry = new THREE.Color(0xf4e2bc), damp = new THREE.Color(0xcfae7f), grass = new THREE.Color(0x86b858);
  const c = new THREE.Color();
  const edge = (a: number) => 1 + Math.sin(a * 2 + wob[0]) * 0.1 + Math.sin(a * 3 + wob[1]) * 0.07 + Math.sin(a * 5 + wob[2]) * 0.04;
  for (let i = 0; i <= rings; i++) {
    const s = (i / rings) * 1.18;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const rr = radius * s * edge(a);
      const k = Math.min(1, s);
      const y = height * Math.pow(Math.max(0, 1 - k * k), 1.4) - 0.9 * Math.pow(Math.max(0, s - 0.8) / 0.38, 1.2) - 0.35;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      uv.push((Math.cos(a) * rr) / 12, (Math.sin(a) * rr) / 12);
      if (y < 0.12) c.copy(damp);
      else if (radius > 26 && y > height * 0.55) c.copy(dry).lerp(grass, Math.min(1, (y - height * 0.55) / (height * 0.2)));
      else c.copy(dry).lerp(damp, Math.max(0, 1 - y / 0.6) * 0.5);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), cc = a + segs, d = b + segs;
      idx.push(a, b, cc, b, d, cc);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A coconut palm: a leaning, ringed trunk, and a crown of drooping fronds. Built once, drawn instanced. */
function palmGeometry(detail: number) {
  const segs = [4, 6, 8, 10, 10][detail], sides = [5, 6, 7, 8, 9][detail];
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 4.2, 0), new THREE.Vector3(1.6, 7.6, 0));
  const pos: number[] = [], idx: number[] = [];
  const up = new THREE.Vector3(), side = new THREE.Vector3(), bin = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPoint(t);
    curve.getTangent(t, up);
    side.set(0, 0, 1);
    bin.crossVectors(up, side).normalize();
    // Tapering, with a bump at every ring of old leaf scars.
    const rad = (0.26 - t * 0.1) * (1 + (i % 2 ? 0.08 : 0));
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      pos.push(p.x + (bin.x * Math.cos(a) + side.x * Math.sin(a)) * rad, p.y + (bin.y * Math.cos(a)) * rad, p.z + Math.sin(a) * rad);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
      idx.push(a, b, c, b, d, c);
    }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();

  const top = curve.getPoint(1);
  const fronds: THREE.BufferGeometry[] = [];
  const count = [5, 6, 7, 8, 9][detail];
  for (let f = 0; f < count; f++) {
    const len = 3.6 + (f % 3) * 0.5, width = 1.25;
    const strip = new THREE.PlaneGeometry(width, len, 1, [3, 4, 5, 6, 7][detail]);
    const p = strip.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const along = (p.getY(i) + len / 2) / len;
      // Arches up and out, then droops; the leaflets fold a little along the midrib.
      const y = Math.sin(along * Math.PI * 0.85) * 0.9 - along * along * 2.1;
      p.setXYZ(i, p.getX(i) * (1 - along * 0.35), y + Math.abs(p.getX(i)) * -0.25, along * len);
    }
    strip.computeVertexNormals();
    strip.rotateY((f / count) * Math.PI * 2 + (f % 2) * 0.3);
    strip.translate(top.x, top.y, top.z);
    fronds.push(strip);
  }
  const crown = mergeGeometries(fronds)!;
  fronds.forEach((x) => x.dispose());
  return { trunk, crown };
}

function umbrellaGeometry() {
  const canopy = new THREE.ConeGeometry(1.5, 0.55, 12, 1, true);
  canopy.translate(0, 2.05, 0);
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.1, 5);
  pole.translate(0, 1.05, 0);
  return { canopy, pole };
}

// ---- Placement ---------------------------------------------------------------------------------------

interface Spot {
  x: number;
  z: number;
  y: number;
  s: number;
  yaw: number;
}

export function buildBeach(map: MapDef, o: BeachOptions): Beach {
  const group = new THREE.Group();
  group.name = 'beach';
  const r = rng(seedOf(map.id) ^ 0x9e3779b9);
  const ex = map.extent;
  const cx = (ex.minX + ex.maxX) / 2, cz = (ex.minZ + ex.maxZ) / 2;
  const half = Math.hypot(ex.maxX - ex.minX, ex.maxZ - ex.minZ) / 2;
  const detail = Math.max(0, Math.min(4, o.tier));
  const sea = o.seaLevel;
  const shores: Shore[] = [];
  const palms: Spot[] = [];
  const brollies: Spot[] = [];
  const disposables: { dispose(): void }[] = [];

  const sand = mat(o.lambert, { vertexColors: true, map: sandTexture(), roughness: 0.96, metalness: 0 });
  disposables.push(sand);
  const addIsland = (x: number, z: number, radius: number, height: number) => {
    const g = islandGeometry(radius, height, Math.floor(r() * 1e9), detail);
    disposables.push(g);
    const m = new THREE.Mesh(g, sand);
    m.position.set(x, sea, z);
    m.receiveShadow = false;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    shores.push({ x, z, r: radius * 0.98 });
  };

  // A beach under arenas that stand high above the water (a city or cliff top on an island).
  if (o.land > 0) {
    addIsland(cx, cz, o.land, 3.2);
    const ring = Math.floor([0, 10, 18, 28, 36][detail]);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + r() * 0.2;
      const d = o.land * (0.8 + r() * 0.1);
      palms.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, y: sea + 0.9, s: 0.85 + r() * 0.4, yaw: r() * Math.PI * 2 });
    }
  }

  for (const it of o.islets ?? []) {
    addIsland(it.x, it.z, it.r, 1.1);
    palms.push({ x: it.x + it.r * 0.75, z: it.z + it.r * 0.2, y: sea + 0.6, s: 0.9, yaw: r() * 6 });
  }

  // Islands out at sea, away from where anyone plays.
  const count = [2, 3, 5, 7, 8][detail];
  const placed: { x: number; z: number; r: number }[] = [];
  for (let tries = 0; placed.length < count && tries < 80; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.max(half + 55, o.land + 40) + r() * 260;
    const radius = 9 + r() * 24;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + radius + 30)) continue;
    placed.push({ x, z, r: radius });
    const height = 1.2 + radius * 0.07;
    addIsland(x, z, radius, height);
    const n = Math.max(1, Math.round(radius / 8)) + (detail >= 3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const pa = r() * Math.PI * 2, pd = radius * (0.1 + r() * 0.45);
      palms.push({ x: x + Math.cos(pa) * pd, z: z + Math.sin(pa) * pd, y: sea + height * 0.75, s: 0.8 + r() * 0.5, yaw: r() * Math.PI * 2 });
    }
    if (detail >= 2 && radius > 14)
      for (let i = 0; i < 2; i++) {
        const pa = r() * Math.PI * 2, pd = radius * (0.45 + r() * 0.2);
        brollies.push({ x: x + Math.cos(pa) * pd, z: z + Math.sin(pa) * pd, y: sea + height * 0.35, s: 1, yaw: r() * Math.PI * 2 });
      }
  }

  const dummy = new THREE.Object3D();
  const instance = (geo: THREE.BufferGeometry, m: THREE.Material, spots: Spot[]) => {
    if (!spots.length) return;
    const mesh = new THREE.InstancedMesh(geo, m, spots.length);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = false;
    group.add(mesh);
    disposables.push(geo, m);
  };

  if (palms.length) {
    const { trunk, crown } = palmGeometry(detail);
    instance(trunk, mat(o.lambert, { color: 0x9a7650, roughness: 0.92 }), palms);
    instance(crown, mat(o.lambert, { color: 0xffffff, map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 }), palms);
  }
  if (brollies.length) {
    const { canopy, pole } = umbrellaGeometry();
    instance(canopy, mat(o.lambert, { color: 0xffffff, map: stripeTexture(), side: THREE.DoubleSide, roughness: 0.65 }), brollies);
    instance(pole, mat(o.lambert, { color: 0xe8e2d8, roughness: 0.5 }), brollies);
  }
  return {
    group,
    shores,
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
}

/**
 * Stilts under arena floors that stand just above the sea, so the arena reads as a pier rather
 * than a slab floating over the water.
 */
export function buildStilts(map: MapDef, seaLevel: number, lambert: boolean): THREE.InstancedMesh | null {
  const spots: { x: number; z: number; top: number }[] = [];
  for (const b of map.blocks) {
    if (!b.visible || b.mat === 'invisible' || b.pitch) continue;
    const bottom = b.c.y - b.h.y;
    if (b.h.x * b.h.z * 4 < 150 || bottom < seaLevel || bottom - seaLevel > 7) continue;
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const along = (lx: number, lz: number) => spots.push({ x: b.c.x + lx * c + lz * s, z: b.c.z - lx * s + lz * c, top: bottom });
    for (const sx of [-1, 1]) for (let z = -b.h.z; z <= b.h.z + 0.01; z += Math.max(4, (b.h.z * 2) / Math.ceil((b.h.z * 2) / 6))) along(sx * (b.h.x - 0.6), z);
    for (const sz of [-1, 1]) for (let x = -b.h.x + 6; x < b.h.x - 3; x += 6) along(x, sz * (b.h.z - 0.6));
  }
  if (!spots.length) return null;
  const geo = new THREE.CylinderGeometry(0.32, 0.38, 1, 8);
  geo.translate(0, -0.5, 0);
  const m = lambert ? new THREE.MeshLambertMaterial({ color: 0x8f7a62 }) : new THREE.MeshStandardMaterial({ color: 0x8f7a62, roughness: 0.85 });
  const mesh = new THREE.InstancedMesh(geo, m, spots.length);
  const d = new THREE.Object3D();
  spots.forEach((p, i) => {
    const len = p.top - seaLevel + 2.5;
    d.position.set(p.x, p.top, p.z);
    d.scale.set(1, len, 1);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'stilts';
  return mesh;
}

/**
 * The menu's beach: the character's plinth on the sand, the sea beyond with a couple of islands,
 * palms either side and a striped umbrella. The camera looks out to sea (towards −z).
 */
export function menuBeach(o: { tier: number; lambert: boolean; seaLevel: number; floor: number }): Beach {
  const group = new THREE.Group();
  group.name = 'menu-beach';
  const detail = Math.max(0, Math.min(4, o.tier));
  const disposables: { dispose(): void }[] = [];
  const r = rng(4242);

  // The beach itself: flat where the character stands, sloping gently under the water further out.
  const shoreZ = -9;
  const g = new THREE.PlaneGeometry(140, 70, [24, 40, 64, 90, 110][detail], [12, 20, 32, 44, 56][detail]);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -6);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  const dry = new THREE.Color(0xf4e2bc), damp = new THREE.Color(0xcfae7f), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const out = Math.max(0, -(z - shoreZ) + 3);
    const dune = Math.max(0, z - 6) * 0.06 + Math.sin(x * 0.21) * Math.sin(z * 0.17) * 0.12 * Math.min(1, Math.max(0, z + 4) / 6);
    const y = o.floor - out * out * 0.018 - Math.max(0, out - 6) * 0.25 + dune;
    p.setY(i, y);
    c.copy(dry).lerp(damp, Math.min(1, Math.max(0, (o.seaLevel + 0.55 - y) / 0.5)));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const sand = mat(o.lambert, { vertexColors: true, map: sandTexture(), roughness: 0.95 });
  const ground = new THREE.Mesh(g, sand);
  ground.receiveShadow = true;
  ground.name = 'sand';
  group.add(ground);
  disposables.push(g, sand);

  // Palms behind the character on the right (the menu sheet covers the left on wide screens).
  const palms: Spot[] = [
    { x: 4.3, z: -9.5, y: o.floor - 0.12, s: 1.1, yaw: 0.5 },
    { x: 8, z: -6.5, y: o.floor - 0.05, s: 0.95, yaw: 2.4 },
    { x: -7, z: -6.5, y: o.floor - 0.05, s: 1.05, yaw: 3.6 },
  ];
  if (detail >= 2) palms.push({ x: -10.5, z: -3, y: o.floor, s: 0.9, yaw: 5.2 }, { x: 12.5, z: -3.5, y: o.floor, s: 1, yaw: 1.2 });
  // The waterline sits where the slope reaches the sea (about 2.8 m past the start of the slope).
  const shores: Shore[] = [{ x: 0, z: shoreZ - 2.8 + 1200, r: 1200 }];
  // Two islands out to sea.
  for (const [x, z, rad] of [[-70, -150, 26], [95, -230, 34]] as const) {
    const ig = islandGeometry(rad, 2.4, Math.floor(r() * 1e9), detail);
    const m = new THREE.Mesh(ig, sand);
    m.position.set(x, o.seaLevel, z);
    group.add(m);
    disposables.push(ig);
    shores.push({ x, z, r: rad * 0.98 });
    for (let i = 0; i < 3; i++) palms.push({ x: x + (r() - 0.5) * rad * 0.8, z: z + (r() - 0.5) * rad * 0.8, y: o.seaLevel + 1.6, s: 1.2 + r() * 0.4, yaw: r() * 6 });
  }

  const dummy = new THREE.Object3D();
  const instance = (geo: THREE.BufferGeometry, m: THREE.Material, spots: Spot[], shadows: boolean) => {
    const mesh = new THREE.InstancedMesh(geo, m, spots.length);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    group.add(mesh);
    disposables.push(geo, m);
  };
  const { trunk, crown } = palmGeometry(detail);
  instance(trunk, mat(o.lambert, { color: 0x9a7650, roughness: 0.92 }), palms, true);
  instance(crown, mat(o.lambert, { color: 0xffffff, map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 }), palms, true);
  const { canopy, pole } = umbrellaGeometry();
  const brolly: Spot[] = [{ x: 3.4, z: -5.6, y: o.floor, s: 1, yaw: 0.3 }];
  instance(canopy, mat(o.lambert, { color: 0xffffff, map: stripeTexture(), side: THREE.DoubleSide, roughness: 0.65 }), brolly, true);
  instance(pole, mat(o.lambert, { color: 0xe8e2d8, roughness: 0.5 }), brolly, true);
  return {
    group,
    shores,
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
}
