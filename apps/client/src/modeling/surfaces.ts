import * as THREE from 'three';
import type { SurfaceId } from '@chromashift/shared';

/*
 * Surface looks. A material here is more than a colour: each surface has a height field drawn for
 * it (brushed streaks, rubber stipple, wood grain, concrete pores, cloth weave …) from which a
 * normal map, a roughness map and a faint tone map are made. They are greyscale and tileable, so
 * one set serves every colour, and they are built once on first use and shared.
 */

interface SurfaceSpec {
  /** Repeats per metre of surface. */
  tile: number;
  /** How strongly the bumps show. */
  bump: number;
  /** Roughness added by the surface's own variation (0 … 1 across the map). */
  roughVar: number;
  /** How much the tone map darkens the low parts. */
  tone: number;
  height(x: number, y: number, n: number): number;
}

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Tileable value noise: `period` cells across the map. */
function vnoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed), c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Fractal noise over the unit square, tileable. */
function fbm(u: number, v: number, base: number, seed: number, octaves = 4, sx = 1, sy = 1) {
  let t = 0, amp = 0.5, f = base;
  for (let o = 0; o < octaves; o++) {
    t += vnoise(u * f * sx, v * f * sy, Math.max(1, Math.round(f * Math.max(sx, sy))), seed + o * 7) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return t;
}
const tri = (t: number) => 1 - Math.abs(((t % 1) + 1) % 1 * 2 - 1);

const SPECS: Record<Exclude<SurfaceId, 'plain' | 'glass'>, SurfaceSpec> = {
  // Sprayed paint: a very fine orange peel, nothing you notice until the light rakes across it.
  paint: { tile: 7, bump: 0.18, roughVar: 0.1, tone: 0.03, height: (u, v) => fbm(u, v, 24, 3, 2) },
  // Cast metal: fine grain with the odd pit.
  metal: { tile: 5, bump: 0.35, roughVar: 0.3, tone: 0.1, height: (u, v) => fbm(u, v, 32, 5, 3) * 0.8 + (fbm(u, v, 8, 9, 2) > 0.62 ? -0.25 : 0) },
  // Brushed metal: long streaks one way.
  brushed: { tile: 4, bump: 0.3, roughVar: 0.35, tone: 0.06, height: (u, v) => fbm(u, v, 4, 11, 4, 1, 40) },
  // Rubber grip: a diamond stipple.
  rubber: {
    tile: 26, bump: 0.9, roughVar: 0.15, tone: 0.18,
    height: (u, v) => {
      const a = tri(u * 4 + v * 4), b = tri(u * 4 - v * 4);
      return Math.min(1, Math.max(0, Math.min(a, b) * 2.4 - 0.25)) * 0.85 + fbm(u, v, 32, 13, 2) * 0.15;
    },
  },
  // Moulded plastic: a fine pebble.
  plastic: { tile: 18, bump: 0.3, roughVar: 0.12, tone: 0.04, height: (u, v) => fbm(u, v, 40, 17, 2) },
  // Planks: grain running along v, with board gaps and the odd knot.
  wood: {
    tile: 0.9, bump: 0.7, roughVar: 0.3, tone: 0.3,
    height: (u, v) => {
      const board = Math.floor(u * 4), bu = u * 4 - board;
      const gap = bu < 0.035 || bu > 0.965 ? 0 : 1;
      const wob = fbm(u, v, 3, 19 + board, 2) * 0.35;
      const grain = tri((bu + wob) * 9 + fbm(u, v, 2, 23, 3, 6, 1) * 2) * 0.35 + fbm(u, v, 6, 29 + board, 3, 8, 1) * 0.45;
      const kx = bu - 0.3 - hash(board, 1, 31) * 0.4, ky = (v - hash(board, 2, 31)) * 3;
      const knot = Math.exp(-(kx * kx + ky * ky) * 220) * 0.5;
      return gap * (0.35 + grain - knot);
    },
  },
  // Poured concrete: pores, soft stains and faint formwork lines.
  concrete: {
    tile: 0.45, bump: 0.5, roughVar: 0.25, tone: 0.2,
    height: (u, v) => {
      const pores = fbm(u, v, 48, 37, 2) > 0.68 ? -0.35 : 0;
      const line = Math.min(tri(u * 2), tri(v * 2)) < 0.012 ? -0.4 : 0;
      return 0.55 + fbm(u, v, 5, 41, 4) * 0.4 + pores + line;
    },
  },
  // Rock: layered strata with cracks.
  stone: {
    tile: 0.35, bump: 0.9, roughVar: 0.3, tone: 0.3,
    height: (u, v) => {
      const strata = tri(v * 5 + fbm(u, v, 3, 43, 3) * 1.6) * 0.3;
      const crack = Math.abs(fbm(u, v, 6, 47, 3) - 0.5) < 0.012 ? -0.6 : 0;
      return 0.4 + fbm(u, v, 9, 53, 4) * 0.45 + strata + crack;
    },
  },
  // Cloth: an over-and-under weave.
  fabric: {
    tile: 22, bump: 0.6, roughVar: 0.1, tone: 0.16,
    height: (u, v) => {
      const cu = u * 12, cv = v * 12, over = (Math.floor(cu) + Math.floor(cv)) % 2 === 0;
      const a = Math.sin((cu % 1) * Math.PI), b = Math.sin((cv % 1) * Math.PI);
      return (over ? a * 0.9 + b * 0.25 : b * 0.9 + a * 0.25) * 0.8 + fbm(u, v, 48, 59, 2) * 0.12;
    },
  },
  // Carbon fibre: a 2 × 2 twill.
  carbon: {
    tile: 28, bump: 0.45, roughVar: 0.2, tone: 0.3,
    height: (u, v) => {
      const cu = Math.floor(u * 8), cv = Math.floor(v * 8), k = (((cu - cv) % 4) + 4) % 4;
      const fu = (u * 8) % 1, fv = (v * 8) % 1;
      return k < 2 ? 0.35 + Math.sin(fu * Math.PI) * 0.6 : 0.2 + Math.sin(fv * Math.PI) * 0.45;
    },
  },
};

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  spec: SurfaceSpec;
}

const cache = new Map<string, SurfaceMaps>();
const canvasOf = (n: number) => {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
};

/** The maps of a surface at a size (64 … 512). Null for plain and glass, which have none. */
export function surfaceMaps(id: SurfaceId, size = 256): SurfaceMaps | null {
  if (id === 'plain' || id === 'glass') return null;
  const n = Math.max(64, Math.min(512, size));
  const key = `${id}:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = SPECS[id];
  const h = new Float32Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = spec.height(x / n, y / n, n);
      h[y * n + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / span;
  const tone = canvasOf(n), nrm = canvasOf(n), rgh = canvasOf(n);
  const tc = tone.getContext('2d')!, nc = nrm.getContext('2d')!, rc = rgh.getContext('2d')!;
  const ti = tc.createImageData(n, n), ni = nc.createImageData(n, n), ri = rc.createImageData(n, n);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  const strength = spec.bump * (n / 128) * 2.2;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4, v = h[y * n + x];
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      ni.data[i] = Math.round((-dx / l) * 127.5 + 127.5);
      ni.data[i + 1] = Math.round((dy / l) * 127.5 + 127.5);
      ni.data[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
      ni.data[i + 3] = 255;
      const t = Math.round(255 * (1 - spec.tone + spec.tone * v));
      ti.data[i] = ti.data[i + 1] = ti.data[i + 2] = t;
      ti.data[i + 3] = 255;
      // Roughness lives in green (as three.js reads it): high points are a touch smoother (worn).
      const r = Math.round(255 * Math.max(0, Math.min(1, 1 - spec.roughVar * v)));
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = r;
      ri.data[i + 3] = 255;
    }
  tc.putImageData(ti, 0, 0);
  nc.putImageData(ni, 0, 0);
  rc.putImageData(ri, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(spec.tile, spec.tile);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const maps: SurfaceMaps = { map: tex(tone, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false), spec };
  cache.set(key, maps);
  return maps;
}

export interface SurfaceOptions {
  color: number;
  rough?: number;
  metal?: number;
  surface?: SurfaceId;
  /** Glow strength in the material's own colour. */
  emissive?: number;
  opacity?: number;
  /** Cheapest shading (very low graphics): colour and tone map only. */
  lambert?: boolean;
  /** Texture size; 0 leaves the maps off (plain colour). */
  size?: number;
  flat?: boolean;
  side?: THREE.Side;
  /** Extra settings passed straight to the material. */
  extra?: THREE.MeshStandardMaterialParameters;
}

/** A material with a surface look. UVs are expected in metres (see boxUV in the kit). */
export function surfaceMaterial(o: SurfaceOptions): THREE.Material {
  const maps = o.size === 0 ? null : surfaceMaps(o.surface ?? 'plain', o.size ?? 256);
  const glass = o.surface === 'glass';
  const opacity = o.opacity ?? (glass ? 0.4 : 1);
  const emissive = o.emissive ? new THREE.Color(o.color) : undefined;
  if (o.lambert && !glass)
    return new THREE.MeshLambertMaterial({ color: o.color, map: maps?.map ?? null, emissive: emissive ?? 0, emissiveIntensity: o.emissive ?? 0, transparent: opacity < 1, opacity, flatShading: !!o.flat, side: o.side ?? THREE.FrontSide });
  return new THREE.MeshStandardMaterial({
    color: o.color,
    roughness: o.rough ?? (glass ? 0.06 : 0.6),
    metalness: o.metal ?? 0,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
    ...(emissive ? { emissive, emissiveIntensity: o.emissive } : {}),
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    flatShading: !!o.flat,
    side: o.side ?? THREE.FrontSide,
    ...o.extra,
  });
}

export function disposeSurfaces() {
  for (const m of cache.values()) {
    m.map.dispose();
    m.normalMap.dispose();
    m.roughnessMap.dispose();
  }
  cache.clear();
}
