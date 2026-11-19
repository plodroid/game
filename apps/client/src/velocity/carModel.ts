import * as THREE from 'three';
import {
  BOOST_FX, CAR_FINISHES, DRIFT_FX, HEADLIGHTS, PART_INDEX, PLATES, RACE_IDENTITIES, RIM_FINISHES, TAILLIGHTS, TINTS, TIRES,
  UNDERGLOWS, WHEEL_FX, WHEEL_R, WHEEL_X, WHEEL_Y, WHEEL_Z, WHEELS, DEFAULT_HANDLING, type CarLoadout,
} from '@chromashift/shared';
import { bodyMaterial, hex, paintTexture, scratch, type Paint } from './finishes';
import { Parts, slab, tube as tube3, turned } from '../modeling/kit';
import { surfaceMaterial } from '../modeling/surfaces';
import {
  accessory, exhaust, face, formulaKit, frontBumper, hood, lensOutline, mirrors, openEngine, rearBumper, rollCage, rollHoops, roof, roundRect, seat, spoiler,
  type BodyKind, type PartCtx,
} from './carParts';

const narrowScale = (w: number) => (w < 0.5 ? 0.6 : 1);

/*
 * Procedural cars. A body is lofted from cross-sections (rounded boxes) along its length, with a
 * glass cabin lofted the same way and a roof panel on top; wheels, lights, bumpers, wings and
 * trinkets are built from simple shapes and attached at fixed points. The same model is used in
 * races and in the garage, from the same loadout.
 *
 * Damage is real: panels dent inwards around where the car was hit (positions are rebuilt only when
 * the damage changes), paint gets scratched and grimy, lights crack and go dark, bumpers sag and
 * damaged wheels lean.
 */

interface Station {
  z: number;
  /** Half width, bottom and top of the hull. */
  w: number;
  b: number;
  t: number;
}
interface Cabin {
  /** Base from z0 (rear) to z1 (front); roof from r0 to r1. */
  z0: number;
  z1: number;
  r0: number;
  r1: number;
  /** Height of the base (beltline) and the roof; half widths at the base and the roof. */
  yb: number;
  yt: number;
  wb: number;
  wt: number;
}
interface BodyShape {
  hull: Station[];
  cabin: Cabin;
  /** Superellipse exponent: higher is boxier. */
  n: number;
  /** Where the bonnet, boot and front/rear faces are, for parts. */
  hoodY: number;
  bootY: number;
  noseZ: number;
  tailZ: number;
  fins?: boolean;
  /** Closed cabin, open top with a windscreen, a tube cage, or a single-seat cockpit. */
  kind?: BodyKind;
  doors?: 2 | 4;
  /** An open load bed between these two z values (pickups). */
  bed?: [number, number];
  /** The engine out in the open on the nose (hot rods). */
  engine?: boolean;
}

const S = (z: number, w: number, b: number, t: number): Station => ({ z, w, b, t });

const SHAPES: Record<string, BodyShape> = {
  sport: {
    n: 4.2,
    hull: [S(-2.18, 0.7, -0.42, -0.02), S(-2.05, 0.88, -0.5, 0.14), S(-1.5, 0.95, -0.54, 0.18), S(-0.6, 0.93, -0.55, 0.14), S(0.4, 0.93, -0.55, 0.1), S(1.3, 0.95, -0.54, 0.04), S(1.95, 0.88, -0.5, -0.04), S(2.2, 0.66, -0.42, -0.16)],
    cabin: { z0: -1.45, z1: 0.75, r0: -0.85, r1: -0.02, yb: 0.1, yt: 0.6, wb: 0.84, wt: 0.62 },
    hoodY: 0.06, bootY: 0.16, noseZ: 2.2, tailZ: -2.18,
  },
  compact: {
    n: 4.8,
    hull: [S(-1.95, 0.8, -0.45, 0.12), S(-1.85, 0.9, -0.52, 0.2), S(-1.0, 0.92, -0.54, 0.2), S(0.4, 0.92, -0.54, 0.16), S(1.5, 0.9, -0.52, 0.08), S(1.95, 0.76, -0.46, -0.04)],
    cabin: { z0: -1.82, z1: 0.6, r0: -1.7, r1: -0.15, yb: 0.16, yt: 0.82, wb: 0.86, wt: 0.72 },
    hoodY: 0.1, bootY: 0.2, noseZ: 1.95, tailZ: -1.95,
  },
  muscle: {
    n: 5.2,
    hull: [S(-2.2, 0.86, -0.42, 0.08), S(-2.08, 0.97, -0.5, 0.2), S(-1.2, 0.99, -0.54, 0.2), S(0, 0.95, -0.54, 0.16), S(1.2, 0.95, -0.54, 0.16), S(2.08, 0.93, -0.5, 0.1), S(2.22, 0.86, -0.44, 0.02)],
    cabin: { z0: -1.55, z1: 0.15, r0: -1.05, r1: -0.4, yb: 0.16, yt: 0.58, wb: 0.84, wt: 0.66 },
    hoodY: 0.16, bootY: 0.2, noseZ: 2.22, tailZ: -2.2,
  },
  rally: {
    n: 4.4,
    hull: [S(-1.98, 0.84, -0.36, 0.14), S(-1.86, 0.98, -0.46, 0.24), S(-1.0, 0.99, -0.48, 0.24), S(0.5, 0.99, -0.48, 0.2), S(1.6, 0.98, -0.46, 0.12), S(2.0, 0.82, -0.38, 0.0)],
    cabin: { z0: -1.78, z1: 0.62, r0: -1.62, r1: -0.12, yb: 0.2, yt: 0.86, wb: 0.88, wt: 0.72 },
    hoodY: 0.14, bootY: 0.24, noseZ: 2.0, tailZ: -1.98,
  },
  super: {
    n: 3.6,
    hull: [S(-2.2, 0.82, -0.44, 0.06), S(-2.05, 0.98, -0.52, 0.14), S(-1.3, 1.0, -0.56, 0.16), S(-0.2, 0.97, -0.56, 0.06), S(0.9, 0.95, -0.56, -0.04), S(1.8, 0.92, -0.54, -0.14), S(2.22, 0.7, -0.5, -0.26)],
    cabin: { z0: -1.15, z1: 1.1, r0: -0.55, r1: 0.2, yb: 0.0, yt: 0.46, wb: 0.86, wt: 0.58 },
    hoodY: -0.08, bootY: 0.14, noseZ: 2.22, tailZ: -2.2,
  },
  future: {
    n: 2.6,
    hull: [S(-2.2, 0.6, -0.4, 0.04), S(-1.95, 0.92, -0.5, 0.18), S(-0.8, 1.0, -0.54, 0.16), S(0.5, 0.98, -0.54, 0.08), S(1.6, 0.9, -0.52, -0.06), S(2.24, 0.5, -0.44, -0.22)],
    cabin: { z0: -1.2, z1: 1.25, r0: -0.6, r1: 0.45, yb: 0.04, yt: 0.56, wb: 0.8, wt: 0.42 },
    hoodY: -0.02, bootY: 0.14, noseZ: 2.24, tailZ: -2.2,
    fins: true,
  },
  sedan: {
    n: 4.6,
    hull: [S(-2.15, 0.78, -0.44, 0.12), S(-2.05, 0.9, -0.52, 0.2), S(-1.3, 0.94, -0.55, 0.22), S(-0.4, 0.94, -0.56, 0.16), S(0.6, 0.93, -0.56, 0.12), S(1.5, 0.92, -0.54, 0.06), S(2.05, 0.84, -0.5, -0.02), S(2.2, 0.66, -0.44, -0.12)],
    cabin: { z0: -1.45, z1: 0.95, r0: -1.0, r1: 0.3, yb: 0.16, yt: 0.74, wb: 0.88, wt: 0.7 },
    hoodY: 0.08, bootY: 0.2, noseZ: 2.2, tailZ: -2.15, doors: 4,
  },
  wagon: {
    n: 4.8,
    hull: [S(-2.18, 0.84, -0.44, 0.16), S(-2.08, 0.92, -0.52, 0.22), S(-1.0, 0.94, -0.55, 0.22), S(0.6, 0.93, -0.56, 0.12), S(1.5, 0.92, -0.54, 0.06), S(2.05, 0.84, -0.5, -0.02), S(2.2, 0.66, -0.44, -0.12)],
    cabin: { z0: -2.06, z1: 0.95, r0: -1.96, r1: 0.3, yb: 0.18, yt: 0.8, wb: 0.88, wt: 0.74 },
    hoodY: 0.08, bootY: 0.22, noseZ: 2.2, tailZ: -2.18, doors: 4,
  },
  suv: {
    n: 5.2,
    hull: [S(-2.12, 0.86, -0.36, 0.3), S(-2.02, 0.96, -0.44, 0.36), S(-1.0, 0.98, -0.46, 0.36), S(0.6, 0.98, -0.46, 0.32), S(1.6, 0.96, -0.44, 0.24), S(2.08, 0.88, -0.4, 0.14), S(2.18, 0.74, -0.36, 0.02)],
    cabin: { z0: -2.04, z1: 0.85, r0: -1.95, r1: 0.15, yb: 0.34, yt: 1.02, wb: 0.92, wt: 0.8 },
    hoodY: 0.26, bootY: 0.36, noseZ: 2.18, tailZ: -2.12, doors: 4,
  },
  pickup: {
    n: 5.6,
    hull: [S(-2.18, 0.9, -0.36, 0.3), S(-2.1, 0.96, -0.42, 0.34), S(-1.0, 0.97, -0.44, 0.34), S(0.4, 0.97, -0.44, 0.3), S(1.5, 0.95, -0.42, 0.24), S(2.08, 0.88, -0.38, 0.14), S(2.2, 0.74, -0.34, 0.02)],
    cabin: { z0: -0.62, z1: 0.8, r0: -0.55, r1: 0.2, yb: 0.3, yt: 0.98, wb: 0.92, wt: 0.8 },
    hoodY: 0.24, bootY: 0.34, noseZ: 2.2, tailZ: -2.18, bed: [-2.06, -0.68],
  },
  van: {
    n: 6.5,
    hull: [S(-2.2, 0.92, -0.38, 0.36), S(-2.14, 0.96, -0.44, 0.38), S(-1.0, 0.97, -0.45, 0.38), S(0.8, 0.97, -0.45, 0.36), S(1.7, 0.95, -0.43, 0.3), S(2.12, 0.88, -0.4, 0.18), S(2.22, 0.72, -0.36, 0.06)],
    cabin: { z0: -2.16, z1: 1.85, r0: -2.1, r1: 1.15, yb: 0.34, yt: 1.32, wb: 0.94, wt: 0.9 },
    hoodY: 0.3, bootY: 0.38, noseZ: 2.22, tailZ: -2.2, doors: 4,
  },
  roadster: {
    n: 3.8,
    kind: 'open',
    hull: [S(-2.1, 0.7, -0.44, 0.0), S(-1.95, 0.88, -0.52, 0.12), S(-1.2, 0.93, -0.55, 0.14), S(-0.2, 0.9, -0.55, 0.1), S(0.8, 0.92, -0.55, 0.06), S(1.6, 0.9, -0.53, 0.0), S(2.1, 0.7, -0.46, -0.1)],
    cabin: { z0: -0.02, z1: 0.55, r0: 0.03, r1: 0.06, yb: 0.08, yt: 0.44, wb: 0.82, wt: 0.74 },
    hoodY: 0.04, bootY: 0.12, noseZ: 2.1, tailZ: -2.1,
  },
  buggy: {
    n: 3.2,
    kind: 'cage',
    hull: [S(-1.95, 0.55, -0.36, -0.02), S(-1.75, 0.78, -0.42, 0.06), S(-1.0, 0.8, -0.44, 0.02), S(0, 0.76, -0.44, -0.02), S(1.0, 0.72, -0.42, -0.04), S(1.7, 0.6, -0.38, -0.08), S(2.05, 0.4, -0.3, -0.16)],
    cabin: { z0: -1.2, z1: 0.75, r0: -0.95, r1: 0.2, yb: 0.0, yt: 0.86, wb: 0.74, wt: 0.62 },
    hoodY: -0.06, bootY: 0.04, noseZ: 2.05, tailZ: -1.95,
  },
  openwheel: {
    n: 3,
    kind: 'cockpit',
    hull: [S(-2.0, 0.3, -0.5, -0.1), S(-1.6, 0.4, -0.56, 0.02), S(-0.8, 0.7, -0.58, 0.04), S(-0.3, 0.74, -0.58, 0.06), S(0.2, 0.5, -0.58, 0.12), S(0.7, 0.3, -0.56, 0.06), S(1.4, 0.22, -0.54, -0.04), S(2.1, 0.12, -0.5, -0.18)],
    cabin: { z0: -0.3, z1: 0.35, r0: -0.2, r1: -0.15, yb: 0.08, yt: 0.24, wb: 0.26, wt: 0.22 },
    hoodY: 0.0, bootY: 0.1, noseZ: 2.1, tailZ: -2.0,
  },
  hotrod: {
    n: 4,
    engine: true,
    hull: [S(-2.0, 0.82, -0.46, 0.16), S(-1.85, 0.94, -0.52, 0.24), S(-1.1, 0.94, -0.54, 0.24), S(-0.4, 0.86, -0.54, 0.18), S(0.3, 0.5, -0.5, 0.1), S(1.2, 0.46, -0.5, 0.06), S(1.9, 0.44, -0.46, 0.02), S(2.15, 0.36, -0.4, -0.06)],
    cabin: { z0: -1.75, z1: -0.25, r0: -1.55, r1: -0.6, yb: 0.22, yt: 0.6, wb: 0.84, wt: 0.72 },
    hoodY: 0.06, bootY: 0.24, noseZ: 2.15, tailZ: -2.0,
  },
  kei: {
    n: 5.4,
    hull: [S(-1.88, 0.82, -0.42, 0.2), S(-1.8, 0.88, -0.5, 0.26), S(-0.8, 0.88, -0.52, 0.26), S(0.6, 0.88, -0.52, 0.22), S(1.5, 0.86, -0.5, 0.14), S(1.9, 0.76, -0.44, 0.02)],
    cabin: { z0: -1.82, z1: 1.0, r0: -1.74, r1: 0.45, yb: 0.24, yt: 1.06, wb: 0.86, wt: 0.8 },
    hoodY: 0.16, bootY: 0.26, noseZ: 1.9, tailZ: -1.88, doors: 4,
  },
  gt: {
    n: 4,
    hull: [S(-2.2, 0.72, -0.44, 0.02), S(-2.08, 0.9, -0.52, 0.14), S(-1.5, 0.98, -0.55, 0.16), S(-0.7, 0.94, -0.56, 0.1), S(0.4, 0.92, -0.56, 0.06), S(1.4, 0.94, -0.55, 0.02), S(2.0, 0.86, -0.5, -0.06), S(2.24, 0.6, -0.44, -0.16)],
    cabin: { z0: -1.9, z1: 0.2, r0: -1.1, r1: -0.35, yb: 0.06, yt: 0.52, wb: 0.84, wt: 0.6 },
    hoodY: 0.02, bootY: 0.1, noseZ: 2.24, tailZ: -2.2,
  },
  classic: {
    n: 3.4,
    fins: true,
    hull: [S(-2.22, 0.8, -0.42, 0.18), S(-2.1, 0.92, -0.5, 0.26), S(-1.3, 0.95, -0.53, 0.22), S(-0.3, 0.95, -0.54, 0.18), S(0.8, 0.95, -0.54, 0.16), S(1.7, 0.93, -0.52, 0.12), S(2.15, 0.84, -0.46, 0.04), S(2.24, 0.7, -0.42, -0.04)],
    cabin: { z0: -1.4, z1: 0.6, r0: -0.95, r1: 0.15, yb: 0.2, yt: 0.66, wb: 0.86, wt: 0.7 },
    hoodY: 0.14, bootY: 0.22, noseZ: 2.24, tailZ: -2.22,
  },
  hyper: {
    n: 2.8,
    hull: [S(-2.22, 0.86, -0.46, 0.0), S(-2.08, 1.0, -0.54, 0.16), S(-1.2, 1.02, -0.58, 0.14), S(-0.3, 0.94, -0.58, 0.0), S(0.7, 0.98, -0.58, -0.08), S(1.6, 0.96, -0.56, -0.16), S(2.24, 0.66, -0.52, -0.3)],
    cabin: { z0: -1.4, z1: 1.2, r0: -0.6, r1: 0.3, yb: -0.06, yt: 0.4, wb: 0.72, wt: 0.5 },
    hoodY: -0.12, bootY: 0.12, noseZ: 2.24, tailZ: -2.22,
  },
};
export const bodyShape = (id: string) => SHAPES[id] ?? SHAPES.sport;

/** Smooth interpolation between stations (Catmull-Rom on each field). */
function sampleStations(st: Station[], k: number): Station[] {
  const out: Station[] = [];
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[Math.max(0, i - 1)], b = st[i], c = st[i + 1], d = st[Math.min(st.length - 1, i + 2)];
    for (let j = 0; j < k; j++) {
      const t = j / k;
      out.push({ z: cr(a.z, b.z, c.z, d.z, t), w: cr(a.w, b.w, c.w, d.w, t), b: cr(a.b, b.b, c.b, d.b, t), t: cr(a.t, b.t, c.t, d.t, t) });
    }
  }
  out.push(st[st.length - 1]);
  return out;
}

const ss = (v: number, n: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);

/**
 * Lofts rounded sections along z. UV: u along the car (tail 0 → nose 1), v round the section from
 * underneath (0) up the left side, over the top (0.5), down the right side and back under (1).
 */
function loft(st: Station[], n: number, seg: number, z0: number, z1: number, caps = true): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const ring = seg + 1;
  for (const s of st) {
    const mid = (s.b + s.t) / 2, hh = Math.max(0.001, (s.t - s.b) / 2);
    for (let j = 0; j <= seg; j++) {
      const th = -Math.PI / 2 + (j / seg) * Math.PI * 2;
      pos.push(s.w * ss(Math.cos(th), n), mid + hh * ss(Math.sin(th), n), s.z);
      uv.push((s.z - z0) / (z1 - z0), j / seg);
    }
  }
  for (let i = 0; i < st.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * ring + j, b = a + ring;
      // Wound so the outside faces out (ring goes round anticlockwise seen from the nose).
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  if (caps)
    for (const [i, flip] of [
      [0, true],
      [st.length - 1, false],
    ] as const) {
      const s = st[i];
      const c = pos.length / 3;
      pos.push(0, (s.b + s.t) / 2, s.z);
      uv.push((s.z - z0) / (z1 - z0), 0.5);
      for (let j = 0; j < seg; j++) {
        const a = i * ring + j;
        if (flip) idx.push(c, a + 1, a);
        else idx.push(c, a, a + 1);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Cuts wheel arches into a lofted hull and raises a lip round each one. Vertices low on the flanks
 * near a wheel are lifted to an arch over it (leaving a wheel well behind the flank), and the metal
 * just above is pushed out into a flare that covers the tyre.
 */
function cutArches(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  const R = WHEEL_R + 0.1, capY = 0.085;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(x);
    if (ax < 0.5) continue;
    for (const wz of [WHEEL_Z, -WHEEL_Z]) {
      const dz = Math.abs(z - wz);
      if (dz > R + 0.14) continue;
      const arch = dz < R ? Math.min(capY, WHEEL_Y + Math.sqrt(R * R - dz * dz)) : -1;
      let ny = y, nx = ax;
      if (dz < R && y < arch) ny = arch;
      // The flare: strongest right at the arch edge, fading upwards and to either side.
      const edge = dz < R ? arch : WHEEL_Y;
      const up = ny - edge;
      if (up >= -0.01 && up < 0.16 && ax > 0.7) {
        const k = (1 - up / 0.16) * Math.min(1, (R + 0.14 - dz) / 0.14);
        nx = Math.max(ax, ax + (WHEEL_X + 0.15 - ax) * Math.max(0, k));
      }
      pos.setXYZ(i, Math.sign(x) * nx, ny, z);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/**
 * The painted frame of the glasshouse: the corner posts and roof rails (one strip along each upper
 * corner of the cabin, front to back) and a centre post on each side. Built from the cabin's own
 * surface, lifted a hair so it sits on the glass.
 */
function cabinFrame(cab: THREE.BufferGeometry, rings: number, seg: number, postZ: number): THREE.BufferGeometry {
  const src = cab.attributes.position, nor = cab.attributes.normal, uv = cab.attributes.uv;
  const ring = seg + 1;
  const pos = new Float32Array(rings * ring * 3);
  for (let i = 0; i < rings * ring; i++) {
    pos[i * 3] = src.getX(i) + nor.getX(i) * 0.012;
    pos[i * 3 + 1] = src.getY(i) + nor.getY(i) * 0.012;
    pos[i * 3 + 2] = src.getZ(i) + nor.getZ(i) * 0.012;
  }
  const idx: number[] = [];
  const corner = (th: number) => Math.round(((th + Math.PI / 2) / (Math.PI * 2)) * seg - 0.5);
  const posts = new Set([corner(Math.PI / 4), corner((3 * Math.PI) / 4)]);
  // The ring nearest the centre post.
  let pi = 0, best = Infinity;
  for (let i = 0; i < rings - 1; i++) {
    const d = Math.abs((src.getZ(i * ring) + src.getZ((i + 1) * ring)) / 2 - postZ);
    if (d < best) {
      best = d;
      pi = i;
    }
  }
  for (let i = 0; i < rings - 1; i++)
    for (let j = 0; j < seg; j++) {
      const th = -Math.PI / 2 + ((j + 0.5) / seg) * Math.PI * 2;
      const side = Math.abs(th) < 0.62 || Math.abs(th - Math.PI) < 0.62;
      if (!posts.has(j) && !(i === pi && side)) continue;
      const a = i * ring + j, b = a + ring;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute((uv.array as Float32Array).slice(0, rings * ring * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sinks the top of the hull between z0 and z1 inside the walls, making an open load bed. */
function cutBed(g: THREE.BufferGeometry, z0: number, z1: number, wall = 0.08, depth = 0.34) {
  const pos = g.attributes.position;
  let top = -Infinity, w = 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > z0 && z < z1) {
      top = Math.max(top, pos.getY(i));
      w = Math.max(w, Math.abs(pos.getX(i)));
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z <= z0 + wall || z >= z1 - wall || Math.abs(x) >= w - wall || y < top - 0.08) continue;
    pos.setY(i, top - depth);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/** The cabin: a trapezoid section that rises from the beltline to the roof and back down. */
function cabinStations(c: Cabin): Station[] {
  const st: Station[] = [];
  const zs = [c.z0, c.z0 + (c.r0 - c.z0) * 0.5, c.r0, (c.r0 + c.r1) / 2, c.r1, c.r1 + (c.z1 - c.r1) * 0.5, c.z1];
  const hs = [0.02, 0.62, 1, 1.02, 1, 0.55, 0.02];
  for (let i = 0; i < zs.length; i++) {
    const k = hs[i];
    st.push({ z: zs[i], w: c.wb - (c.wb - c.wt) * Math.min(1, k) * 0.6, b: c.yb - 0.06, t: c.yb + (c.yt - c.yb) * k });
  }
  return sampleStations(st, 4);
}

/* ---------- Shared geometry and materials ---------- */

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** A wheel rim of a given style, facing +x (the axle is x). */
function rimGeometry(id: string, detail: number): THREE.BufferGeometry {
  const w = WHEELS[id] ?? WHEELS.five;
  return cached(`rim:${id}:${detail}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const R = WHEEL_R * 0.72;
    const seg = detail > 0 ? 28 : 16;
    // Barrel and lip.
    const barrel = new THREE.CylinderGeometry(R, R, 0.2, seg, 1, true);
    barrel.rotateZ(Math.PI / 2);
    parts.push(barrel);
    const lip = new THREE.TorusGeometry(R - 0.012, 0.022 + w.depth * 0.02, 6, seg);
    lip.rotateY(Math.PI / 2);
    lip.translate(0.1, 0, 0);
    parts.push(lip);
    // Face: spokes recessed by the dish depth.
    const face = 0.1 - w.depth * 0.16;
    const hub = new THREE.CylinderGeometry(0.06, 0.07, 0.06, 12);
    hub.rotateZ(Math.PI / 2);
    hub.translate(face + 0.02, 0, 0);
    parts.push(hub);
    const spoke = (a: number, width: number, len: number, twist = 0, at = 0) => {
      const b = new THREE.BoxGeometry(0.035, width, len);
      b.translate(0, 0, at + len / 2);
      if (twist) b.rotateX(twist);
      b.rotateX(a);
      b.translate(face, 0, 0);
      parts.push(b);
    };
    const n = Math.max(1, w.spokes);
    switch (w.style) {
      case 'spokes':
      case 'star':
        for (let i = 0; i < n; i++) spoke((i / n) * Math.PI * 2, w.style === 'star' ? 0.05 : 0.07, R - 0.05, 0, 0.04);
        break;
      case 'split':
        for (let i = 0; i < n; i++) {
          spoke((i / n) * Math.PI * 2 + 0.09, 0.028, R - 0.05, 0, 0.04);
          spoke((i / n) * Math.PI * 2 - 0.09, 0.028, R - 0.05, 0, 0.04);
        }
        break;
      case 'twist':
      case 'fan':
        for (let i = 0; i < n; i++) {
          // Curved: two segments at an angle.
          spoke((i / n) * Math.PI * 2, w.style === 'fan' ? 0.07 : 0.04, R * 0.5, 0, 0.04);
          spoke((i / n) * Math.PI * 2 + (w.style === 'fan' ? 0.35 : 0.25), w.style === 'fan' ? 0.08 : 0.04, R * 0.48, 0, R * 0.45);
        }
        break;
      case 'mesh':
        for (let i = 0; i < n; i++) {
          spoke((i / n) * Math.PI * 2 + 0.28, 0.02, R - 0.05, 0, 0.04);
          spoke((i / n) * Math.PI * 2 - 0.28, 0.02, R - 0.05, 0, 0.04);
        }
        break;
      case 'y':
        for (let i = 0; i < n; i++) {
          spoke((i / n) * Math.PI * 2, 0.06, R * 0.5, 0, 0.04);
          spoke((i / n) * Math.PI * 2 + 0.16, 0.035, R * 0.5, 0, R * 0.45);
          spoke((i / n) * Math.PI * 2 - 0.16, 0.035, R * 0.5, 0, R * 0.45);
        }
        break;
      case 'dish':
      case 'block': {
        const disc = new THREE.CylinderGeometry(R * (w.style === 'dish' ? 0.62 : 0.9), R * 0.62, 0.03, seg);
        disc.rotateZ(Math.PI / 2);
        disc.translate(face, 0, 0);
        parts.push(disc);
        for (let i = 0; i < n; i++) spoke((i / n) * Math.PI * 2, 0.08, w.style === 'dish' ? R * 0.35 : R * 0.2, 0, w.style === 'dish' ? R * 0.58 : 0.08);
        break;
      }
      case 'wire':
        for (let i = 0; i < n; i++) spoke((i / n) * Math.PI * 2, 0.008, R - 0.04, (i % 2 ? 1 : -1) * 0.18, 0.04);
        break;
      case 'turbine':
        for (let i = 0; i < n; i++) spoke((i / n) * Math.PI * 2, 0.05, R * 0.75, 0.6, 0.06);
        break;
      case 'disc': {
        const disc = new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.03, seg);
        disc.rotateZ(Math.PI / 2);
        disc.translate(face + 0.03, 0, 0);
        parts.push(disc);
        for (let i = 0; i < w.spokes; i++) {
          const hole = new THREE.CylinderGeometry(0.06, 0.06, 0.035, 10);
          hole.rotateZ(Math.PI / 2);
          hole.translate(face + 0.035, Math.cos((i / w.spokes) * Math.PI * 2) * R * 0.55, Math.sin((i / w.spokes) * Math.PI * 2) * R * 0.55);
          parts.push(hole);
        }
        break;
      }
    }
    return mergeAll(parts);
  });
}

function tireGeometry(id: string, detail: number): THREE.BufferGeometry {
  const t = TIRES[id] ?? TIRES.street;
  return cached(`tire:${id}:${detail}`, () => {
    // A lathe profile: tread across the width, rounded shoulders.
    const R = WHEEL_R, r = WHEEL_R * 0.72, half = t.tread === 'offroad' || t.tread === 'block' ? 0.15 : 0.13;
    const pts: THREE.Vector2[] = [];
    const k = detail > 0 ? 6 : 3;
    for (let i = 0; i <= k; i++) {
      const a = -Math.PI / 2 + (i / k) * Math.PI;
      pts.push(new THREE.Vector2(R - 0.035 + Math.cos(a) * 0.035, Math.sin(a) * half));
    }
    pts.unshift(new THREE.Vector2(r, -half * 0.8));
    pts.push(new THREE.Vector2(r, half * 0.8));
    const g = new THREE.LatheGeometry(pts, detail > 0 ? 32 : 18);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of ni) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of ni) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}


function textTexture(text: string, bg: number, fg: number, w = 256, h = 64) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = `#${fg.toString(16).padStart(6, '0')}`;
  g.lineWidth = 4;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = g.strokeStyle;
  g.font = `800 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface CarModelOptions {
  /** Very Low graphics: Lambert, fewer segments. */
  lambert: boolean;
  detail: number;
  identity: number;
  /** Show the identity marker (race number roundel colour, roof shape) — off in the garage. */
  showIdentity: boolean;
  /** Paint texture size. */
  texSize: number;
}

/** A car built from a loadout. The group's origin is the physics body's centre. */
export class CarModel {
  readonly group = new THREE.Group();
  /** Wheel pivots (steer) and spinners (roll), FL FR RL RR. */
  private pivots: THREE.Object3D[] = [];
  private spinners: THREE.Object3D[] = [];
  private hull!: THREE.Mesh;
  private rest!: Float32Array;
  private zoneW!: Float32Array;
  private paint!: Paint;
  private bodyMat!: THREE.Material;
  private headMats: THREE.MeshStandardMaterial[] = [];
  private tailMats: THREE.MeshStandardMaterial[] = [];
  private frontBumper: THREE.Object3D | null = null;
  private rearBumper: THREE.Object3D | null = null;
  private glassMat!: THREE.MeshPhysicalMaterial;
  private glow: THREE.Mesh | null = null;
  private rimGlow: THREE.MeshBasicMaterial | null = null;
  private time = 0;
  private lastDamage = '';
  private disposables: (THREE.Material | THREE.Texture | THREE.BufferGeometry)[] = [];
  readonly shape: BodyShape;
  /** Exhaust tips (car space), for boost flames. */
  readonly exhausts: THREE.Vector3[] = [];
  readonly fx: { trail: string; boost: string; drift: string; driftColor: number; boostColor: number };
  private animated = false;
  private identityMarker: THREE.Object3D | null = null;

  constructor(
    readonly loadout: CarLoadout,
    private o: CarModelOptions,
  ) {
    this.shape = bodyShape(loadout.body);
    this.fx = {
      trail: loadout.trail,
      boost: loadout.boostfx,
      drift: loadout.driftfx,
      driftColor: DRIFT_FX[loadout.driftfx]?.color ?? 0xffffff,
      boostColor: BOOST_FX[loadout.boostfx]?.color ?? 0x5fa8ff,
    };
    this.build();
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.disposables.push(m);
    return m;
  }

  private std(color: number, rough = 0.5, metal = 0, emissive = 0) {
    if (this.o.lambert) return this.mat(new THREE.MeshLambertMaterial({ color, emissive: emissive ? new THREE.Color(color) : undefined, emissiveIntensity: emissive }));
    return this.mat(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive ? new THREE.Color(color) : 0x000000, emissiveIntensity: emissive }));
  }

  private build() {
    const l = this.loadout, sh = this.shape, o = this.o;
    const identColor = RACE_IDENTITIES[o.identity % 6].color;
    const finish = CAR_FINISHES[l.finish] ?? CAR_FINISHES.gloss;
    this.animated = !!finish.animated;
    const span = sh.noseZ - sh.tailZ, u = (z: number) => (z - sh.tailZ) / span;
    const cb = sh.cabin;
    const closed = (sh.kind ?? 'closed') === 'closed';
    const seams = closed ? { doorBack: u(sh.doors === 4 ? cb.r0 - 0.05 : cb.r0 + 0.08), doorFront: u(cb.z1 - 0.06), hood: u(cb.z1 + 0.07), boot: u(sh.bed ? sh.bed[0] + 0.06 : cb.z0 - 0.07), ...(sh.doors === 4 ? { doorMid: u((cb.r0 + cb.z1) / 2) } : {}) } : undefined;
    this.paint = paintTexture(l, o.identity, o.showIdentity ? identColor : hex(l.accent), o.texSize, seams);
    this.disposables.push(this.paint.texture);
    this.bodyMat = this.mat(bodyMaterial(finish, this.paint.texture, o.lambert));
    const z0 = sh.tailZ, z1 = sh.noseZ;
    const seg = o.detail > 0 ? 28 : 16;
    const hullGeo = loft(sampleStations(sh.hull, o.detail > 0 ? 8 : 4), sh.n, seg, z0, z1);
    cutArches(hullGeo);
    if (sh.bed) cutBed(hullGeo, sh.bed[0], sh.bed[1]);
    this.disposables.push(hullGeo);
    this.hull = new THREE.Mesh(hullGeo, this.bodyMat);
    this.hull.castShadow = true;
    this.group.add(this.hull);
    // Remember the clean shape, and which way each vertex faces (for dents).
    const pos = hullGeo.attributes.position;
    this.rest = new Float32Array(pos.array as Float32Array);
    this.zoneW = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const fz = z / Math.max(z1, -z0);
      this.zoneW[i * 4] = Math.max(0, fz - 0.45) / 0.55; // front
      this.zoneW[i * 4 + 1] = Math.max(0, -fz - 0.45) / 0.55; // rear
      this.zoneW[i * 4 + 2] = Math.max(0, x / 0.95 - 0.5) * 2; // left
      this.zoneW[i * 4 + 3] = Math.max(0, -x / 0.95 - 0.5) * 2; // right
    }

    // Cabin glass and roof.
    const tint = TINTS[l.tint] ?? TINTS.light;
    this.glassMat = this.mat(
      new THREE.MeshPhysicalMaterial({ color: tint.color, roughness: 0.04, metalness: 0.55, transparent: true, opacity: Math.max(0.82, tint.opacity), clearcoat: 1, envMapIntensity: 2.2 }),
    );
    const c = sh.cabin, kind = sh.kind ?? 'closed';
    const mats = (this.partMatsCache = this.partMats());
    const inside = new Parts();
    if (kind !== 'cage') {
      // Glass: the whole glasshouse when closed, a windscreen on open cars and single-seaters.
      const cab = cabinStations(c);
      const cabGeo = loft(cab, sh.n * 0.9, seg, z0, z1);
      this.disposables.push(cabGeo);
      const cabin = new THREE.Mesh(cabGeo, o.lambert ? this.mat(new THREE.MeshLambertMaterial({ color: tint.color, transparent: true, opacity: 0.9 })) : this.glassMat);
      cabin.renderOrder = 2;
      this.group.add(cabin);
      if (kind === 'closed') {
        // Posts and roof rails in body colour over the glass.
        const frameGeo = cabinFrame(cabGeo, cab.length, seg, (c.r0 + c.r1) / 2 + 0.12);
        this.disposables.push(frameGeo);
        const frame = new THREE.Mesh(frameGeo, this.bodyMat);
        frame.castShadow = true;
        this.group.add(frame);
        const roofSt = sampleStations(
          [
            { z: c.r0 - 0.05, w: c.wt * 0.9, b: c.yt - 0.03, t: c.yt + 0.025 },
            { z: (c.r0 + c.r1) / 2, w: c.wt * 0.98, b: c.yt - 0.03, t: c.yt + 0.035 },
            { z: c.r1 + 0.05, w: c.wt * 0.9, b: c.yt - 0.03, t: c.yt + 0.025 },
          ],
          4,
        );
        const roofGeo = loft(roofSt, 4, seg, z0, z1);
        this.disposables.push(roofGeo);
        const roofMesh = new THREE.Mesh(roofGeo, this.bodyMat);
        roofMesh.castShadow = true;
        this.group.add(roofMesh);
      } else {
        // A windscreen frame along the top of the glass.
        inside.add('dark', slab([[c.r1 + 0.03, c.yt - 0.02], [c.r0 - 0.03, c.yt - 0.02], [c.r0 - 0.03, c.yt + 0.02], [c.r1 + 0.03, c.yt + 0.02]], c.wt * 2.02, 0.008));
      }
    }
    // The cockpit: seats (and a wheel) behind the glass, so windows read as glass, not holes.
    const seatZ = kind === 'open' ? c.z0 - 0.45 : kind === 'cockpit' ? -0.5 : (c.r0 + c.r1) / 2 - 0.1;
    const seatY = kind === 'cockpit' ? -0.2 : c.yb - (kind === 'closed' ? 0.12 : 0.18);
    const seatH = kind === 'closed' ? (c.yt - c.yb) * 0.8 : 0.55;
    for (const sx of kind === 'cockpit' ? [0] : [0.32, -0.32]) seat(inside, sx, seatY, seatZ, seatH);
    if (kind !== 'cockpit') {
      inside.add('dark', slab([[c.z1 - 0.02, c.yb - 0.02], [c.z1 - 0.1, c.yb + 0.1], [c.z1 - 0.35, c.yb + 0.08], [c.z1 - 0.4, c.yb - 0.02]], c.wb * 1.9, 0.03));
      inside.add('dark', new THREE.TorusGeometry(0.15, 0.018, 6, 20), 0.32, c.yb + 0.12, c.z1 - 0.42, -0.4);
    } else inside.add('dark', new THREE.TorusGeometry(0.11, 0.016, 6, 18), 0, 0.05, -0.12, -0.3);
    if (kind === 'open') rollHoops(inside, this.partCtx(), seatZ);
    if (sh.bed) {
      // The bed: a ribbed floor, a roll bar behind the cab and tie-down hooks.
      const [bz0, bz1] = sh.bed;
      for (let i = 0; i < 7; i++) inside.add('dark', slab([[bz1 - 0.1, 0], [bz0 + 0.1, 0], [bz0 + 0.1, 0.012], [bz1 - 0.1, 0.012]], 0.04, 0.004), (i - 3) * 0.24, sh.bootY - 0.33);
      inside.add('chrome', tube3([[-0.82, sh.bootY - 0.02, bz1 - 0.12], [-0.8, sh.bootY + 0.4, bz1 - 0.14], [0.8, sh.bootY + 0.4, bz1 - 0.14], [0.82, sh.bootY - 0.02, bz1 - 0.12]], 0.03));
    }
    this.addParts(inside, mats);
    this.buildWheels();
    this.buildLights();
    this.buildParts();
  }

  private buildWheels() {
    const l = this.loadout, o = this.o;
    const rf = RIM_FINISHES[l.rim] ?? RIM_FINISHES.silver;
    const rimColor = rf.color === 'paint' ? hex(l.paint) : rf.color === 'accent' ? hex(l.accent) : rf.color;
    const rimMat = this.std(rimColor, rf.rough, rf.metal);
    const t = TIRES[l.tire] ?? TIRES.street;
    const tireMat = this.std(0x1b1c20, 0.92, 0);
    const wallColor = { plain: 0x1b1c20, redline: 0xd7192f, white: 0xf2f2ee, letters: 0xd8d8d8, blue: 0x2f6dff }[t.wall];
    const wallMat = this.std(wallColor, 0.8, 0);
    const wfx = WHEEL_FX[l.wheelfx];
    if (wfx?.color != null) this.rimGlow = this.mat(new THREE.MeshBasicMaterial({ color: wfx.color === -1 ? 0xffffff : wfx.color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    const rimGeo = rimGeometry(l.wheel, o.detail);
    const tireGeo = tireGeometry(l.tire, o.detail);
    const ringGeo = cached('wallring', () => {
      const g = new THREE.RingGeometry(WHEEL_R * 0.76, WHEEL_R * 0.84, 28);
      g.rotateY(Math.PI / 2);
      return g;
    });
    const glowGeo = cached('glowring', () => {
      const g = new THREE.TorusGeometry(WHEEL_R * 0.68, 0.025, 6, 28);
      g.rotateY(Math.PI / 2);
      return g;
    });
    for (let w = 0; w < 4; w++) {
      const side = w % 2 === 0 ? 1 : -1;
      const z = w < 2 ? WHEEL_Z : -WHEEL_Z;
      const pivot = new THREE.Object3D();
      pivot.position.set(side * WHEEL_X, WHEEL_Y - DEFAULT_HANDLING.rest * 0.7, z);
      const spin = new THREE.Object3D();
      // Face outwards: the rim geometry faces +x; the right side is turned round.
      spin.rotation.y = side > 0 ? 0 : Math.PI;
      const inner = new THREE.Object3D();
      spin.add(inner);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      inner.add(tire);
      inner.add(new THREE.Mesh(rimGeo, rimMat));
      if (t.wall !== 'plain') {
        const ring = new THREE.Mesh(ringGeo, wallMat);
        ring.position.x = 0.135;
        inner.add(ring);
      }
      if (this.rimGlow) {
        const gl = new THREE.Mesh(glowGeo, this.rimGlow);
        gl.position.x = 0.12;
        inner.add(gl);
      }
      pivot.add(spin);
      this.group.add(pivot);
      this.pivots.push(pivot);
      this.spinners.push(inner);
    }
  }

  /** Materials for the parts, by the names carParts uses. */
  private partMats(): Record<string, THREE.Material> {
    const l = this.loadout, o = this.o;
    const sm = (color: number, surface: Parameters<typeof surfaceMaterial>[0]['surface'], rough: number, metal = 0, emissive = 0) =>
      this.mat(surfaceMaterial({ color, surface, rough, metal, emissive, lambert: o.lambert, size: o.detail > 0 ? 128 : 0 }));
    const accent = hex(l.accent);
    return {
      body: this.bodyMat,
      dark: sm(0x1d1e24, 'plastic', 0.7, 0.1),
      mesh: sm(0x0d0e12, 'carbon', 0.6, 0.3),
      chrome: this.std(0xe2e6ee, 0.1, 1),
      steel: sm(0x8d939e, 'brushed', 0.35, 0.85),
      accent: sm(accent, 'paint', 0.35, 0.2),
      carbon: sm(0x24262d, 'carbon', 0.35, 0.35),
      rubber: sm(0x1a1b1f, 'rubber', 0.92),
      cloth: sm(0x2c2833, 'fabric', 0.95),
      leather: sm(0x8a5a32, 'fabric', 0.7),
      bone: sm(0xefe4cc, 'plastic', 0.5),
      cage: sm(accent, 'paint', 0.4, 0.4),
      gold: this.std(0xe2b23e, 0.25, 1),
      yellow: sm(0xffc21a, 'paint', 0.45),
      orange: sm(0xff7a1a, 'plastic', 0.55),
      white: sm(0xf2f2ee, 'paint', 0.45),
      green: sm(0x3f8f4a, 'plastic', 0.7),
      wood: sm(0xb5653a, 'concrete', 0.85),
      glass: this.glassMat ?? this.std(0x2a3340, 0.05, 0.4),
      identity: this.mat(new THREE.MeshStandardMaterial({ color: RACE_IDENTITIES[o.identity % 6].color, side: THREE.DoubleSide, roughness: 0.6 })),
      glow: this.std(accent, 0.2, 0, 1.6),
      lampW: this.std(0xfff4e0, 0.15, 0, 1.6),
      lampR: this.std(0xff2030, 0.3, 0, 1.0),
    };
  }

  /** Adds a Parts collection to a parent as one mesh per material. */
  private addParts(p: Parts, mats: Record<string, THREE.Material>, parent: THREE.Object3D = this.group) {
    for (const [name, geo] of p.merged()) {
      if (!geo.attributes.position?.count) continue;
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, mats[name] ?? mats.dark);
      m.castShadow = this.o.detail > 0 && name !== 'glass' && name !== 'glow';
      if (name === 'glass') m.renderOrder = 2;
      parent.add(m);
    }
  }

  private partCtx(): PartCtx {
    const sh = this.shape;
    return { l: this.loadout, fr: sh.hull[sh.hull.length - 2], bk: sh.hull[1], nose: sh.noseZ, tail: sh.tailZ, hoodY: sh.hoodY, bootY: sh.bootY, cabin: sh.cabin, kind: sh.kind ?? 'closed', detail: this.o.detail };
  }

  /** Head and tail lamps: a dark bezel, a chrome reflector and a glowing lens, in the chosen shape. */
  private buildLights() {
    const l = this.loadout, sh = this.shape;
    const hl = HEADLIGHTS[l.headlights] ?? HEADLIGHTS.standard;
    const front = sh.hull[sh.hull.length - 2];
    const nose = sh.noseZ - 0.06;
    const yH = (front.b + front.t) / 2 + (front.t - front.b) * 0.18;
    const narrow = front.w < 0.5;
    const hx = narrow ? 0.62 : front.w * 0.62;
    const lens = (shape: string, scale: number, depth: number) => face(lensOutline(shape, scale), depth, Math.min(0.012, depth / 3));
    for (const side of [1, -1]) {
      const m = this.std(hl.color, 0.2, 0, 0.55);
      this.headMats.push(m as THREE.MeshStandardMaterial);
      const g = new THREE.Group();
      g.position.set(side * hx, yH, nose);
      g.rotation.y = side * 0.25;
      const bezel = new THREE.Mesh(lens(hl.shape, narrow ? 0.6 : 1.12, 0.06), this.partMatsCache!.dark);
      const lensMesh = new THREE.Mesh(lens(hl.shape, narrow ? 0.52 : 1, 0.05), m);
      lensMesh.position.z = 0.012;
      this.disposables.push(bezel.geometry, lensMesh.geometry);
      g.add(bezel, lensMesh);
      // A projector or two inside the lens.
      const cups = hl.shape === 'twin' ? [-0.07, 0.07] : hl.shape === 'bar' ? [] : [0];
      for (const x of cups) {
        const cup = new THREE.Mesh(cached('lampcup', () => turned([[0, 0.012], [0.03, 0.01], [0.04, 0], [0, 0]], 12)), this.partMatsCache!.chrome);
        cup.position.set(x * (narrow ? 0.5 : 1), 0, 0.02);
        g.add(cup);
      }
      this.group.add(g);
    }
    const tl = TAILLIGHTS[l.taillights] ?? TAILLIGHTS.standard;
    const back = sh.hull[1];
    const tail = sh.tailZ + 0.08;
    const yT = (back.b + back.t) / 2 + (back.t - back.b) * 0.22;
    const tailShapes = tl.shape === 'bar' ? [0] : [1, -1];
    for (const side of tailShapes) {
      const m = this.std(0xff2030, 0.3, 0, 1.0);
      this.tailMats.push(m as THREE.MeshStandardMaterial);
      const scale = tl.shape === 'bar' ? (back.w * 1.7) / 0.42 : narrowScale(back.w);
      const rows = tl.shape === 'split' ? [0.045, -0.045] : [0];
      for (const dy of rows) {
        const g = new THREE.Group();
        g.position.set(side * (tl.shape === 'bar' ? 0 : back.w * 0.62), yT + dy, tail);
        g.rotation.y = Math.PI;
        const bezel = new THREE.Mesh(face(lensOutline(tl.shape, scale * 1.1), 0.05, 0.01), this.partMatsCache!.dark);
        const lensMesh = new THREE.Mesh(
          tl.shape === 'ring' ? face(lensOutline('ring', scale), 0.04, 0.008, [lensOutline('ring', scale * 0.55)]) : face(lensOutline(tl.shape, scale), 0.04, 0.008),
          m,
        );
        lensMesh.position.z = 0.012;
        this.disposables.push(bezel.geometry, lensMesh.geometry);
        g.add(bezel, lensMesh);
        this.group.add(g);
      }
    }
  }

  private partMatsCache: Record<string, THREE.Material> | null = null;

  private buildParts() {
    const l = this.loadout, sh = this.shape, o = this.o;
    const mats = this.partMatsCache ?? (this.partMatsCache = this.partMats());
    const c = this.partCtx();
    const kind = c.kind;
    const fr = c.fr, bk = c.bk, nose = sh.noseZ, tail = sh.tailZ;
    // Bumpers hang in their own groups (damage makes them sag).
    const fb = new THREE.Group(), rb = new THREE.Group();
    this.frontBumper = fb;
    this.rearBumper = rb;
    this.group.add(fb, rb);
    const body = new Parts();
    if (kind !== 'cockpit') {
      const f = new Parts();
      frontBumper(f, c);
      this.addParts(f, mats, fb);
      const r = new Parts();
      rearBumper(r, c);
      this.addParts(r, mats, rb);
      spoiler(body, c);
      mirrors(body, c);
    } else formulaKit(body, c);
    for (const v of exhaust(body, c)) this.exhausts.push(v);
    hood(body, c);
    if (kind === 'closed') roof(body, c);
    if (kind === 'cage') rollCage(body, c);
    if (sh.engine) openEngine(body, c);
    const acc = accessory(body, c);
    this.addParts(body, mats);
    if (acc.prop && acc.propAt) {
      this.disposables.push(acc.prop);
      const pr = new THREE.Mesh(acc.prop, mats.accent);
      pr.position.set(...acc.propAt);
      pr.name = 'prop';
      this.group.add(pr);
    }
    // Number plates (front and back), set into a dark surround.
    const pl = PLATES[l.plate] ?? PLATES.white;
    const plateTex = textTexture(l.plateText, pl.bg, pl.fg);
    this.disposables.push(plateTex);
    const plateMat = this.mat(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4 }));
    if (kind !== 'cockpit') {
      const yLow = fr.b + 0.08;
      for (const [y, z, turn] of [[yLow + 0.12, nose + 0.02, 0], [bk.b + 0.25, tail - 0.02, Math.PI]] as const) {
        const holder = new THREE.Mesh(cached('plateholder', () => face(roundRect(0.46, 0.14, 0.02), 0.02, 0.005)), mats.dark);
        holder.position.set(0, y, z + (turn ? 0.012 : -0.012));
        holder.rotation.y = turn;
        const pm = new THREE.Mesh(cached('plate', () => new THREE.PlaneGeometry(0.42, 0.11)), plateMat);
        pm.position.set(0, y, z + (turn ? -0.003 : 0.003));
        pm.rotation.y = turn;
        this.group.add(holder, pm);
      }
    }
    // Badge on the nose.
    if (l.badge !== 'none') {
      const bt = badgeTexture(l.badge);
      this.disposables.push(bt);
      const b = new THREE.Mesh(cached('badge', () => new THREE.PlaneGeometry(0.16, 0.16)), this.mat(new THREE.MeshStandardMaterial({ map: bt, transparent: true, metalness: 0.8, roughness: 0.25 })));
      b.position.set(0, (fr.b + fr.t) / 2 + 0.06, nose + 0.012);
      b.rotation.x = -0.2;
      this.group.add(b);
    }
    // Underglow.
    const ug = UNDERGLOWS[l.underglow];
    if (ug?.color != null) {
      const g = new THREE.PlaneGeometry(2.4, 4.6);
      this.disposables.push(g);
      this.glow = new THREE.Mesh(g, this.mat(new THREE.MeshBasicMaterial({ map: glowTexture(), color: ug.color === -1 ? 0xffffff : ug.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      this.glow.position.set(0, -0.82, 0);
      this.glow.rotation.x = -Math.PI / 2;
      this.group.add(this.glow);
    }
    // Tail fins on the concept and the classic.
    if (sh.fins) {
      const fins = new Parts();
      fins.both('body', () => slab([[tail + 1.0, sh.bootY - 0.02], [tail + 0.05, sh.bootY - 0.02], [tail - 0.02, sh.bootY + 0.3], [tail + 0.25, sh.bootY + 0.3]], 0.04, 0.012), bk.w * 0.8);
      this.addParts(fins, mats);
    }
    // Identity marker over the roof in races, so racers stay easy to tell apart.
    if (o.showIdentity) {
      const id = RACE_IDENTITIES[o.identity % 6];
      const g = identityGeometry(id.shape);
      this.disposables.push(g);
      this.identityMarker = new THREE.Mesh(g, this.mat(new THREE.MeshBasicMaterial({ color: id.color })));
      this.identityMarker.position.set(0, sh.cabin.yt + 0.09, (sh.cabin.r0 + sh.cabin.r1) / 2 + 0.05);
      this.identityMarker.rotation.x = -Math.PI / 2;
      this.group.add(this.identityMarker);
    }
  }

  /** Wheels: steering angle, roll angle and suspension compression (0..1). */
  setWheels(steer: number, spin: number, comp: number[]) {
    for (let w = 0; w < 4; w++) {
      const p = this.pivots[w];
      p.rotation.y = w < 2 ? steer : 0;
      p.position.y = WHEEL_Y - DEFAULT_HANDLING.rest * (1 - (comp[w] ?? 0.3));
      const side = w % 2 === 0 ? 1 : -1;
      this.spinners[w].rotation.x = spin * side;
    }
  }

  /** Brake lights and headlights. */
  setLights(braking: boolean, night: boolean) {
    for (const m of this.tailMats) if (m.emissiveIntensity !== undefined && !m.userData.broken) m.emissiveIntensity = braking ? 3 : 1;
    for (const m of this.headMats) if (!m.userData.broken) m.emissiveIntensity = night ? 1.2 : 0.55;
  }

  /** Visual damage from the 18 part values. Rebuilds only when something changed noticeably. */
  setDamage(d: Float32Array) {
    const key = Array.from(d, (v) => Math.round(v * 20)).join(',');
    if (key === this.lastDamage) return;
    this.lastDamage = key;
    const g = (p: keyof typeof PART_INDEX) => d[PART_INDEX[p]];
    const front = Math.max(g('frontBody'), g('frontBumper') * 0.8, g('hood') * 0.8);
    const rear = Math.max(g('rearBody'), g('rearBumper') * 0.8);
    const left = g('leftBody'), right = g('rightBody');
    // Dents: push vertices inwards along their own direction from the car's centre line.
    const pos = this.hull.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1], z = this.rest[i * 3 + 2];
      const zw = this.zoneW;
      const amt = zw[i * 4] * front * 0.16 + zw[i * 4 + 1] * rear * 0.16 + zw[i * 4 + 2] * left * 0.12 + zw[i * 4 + 3] * right * 0.12;
      if (amt <= 0) {
        pos.setXYZ(i, x, y, z);
        continue;
      }
      // Crumple: a bumpy dent, never a smooth one.
      const n = 0.55 + 0.45 * Math.sin(x * 23.1 + z * 17.3) * Math.sin(y * 31.7 + z * 9.1);
      const k = amt * n;
      const len = Math.hypot(x, z * 0.45) || 1;
      pos.setXYZ(i, x - (x / len) * k, y - k * 0.25, z - ((z * 0.45) / len) * k);
    }
    pos.needsUpdate = true;
    this.hull.geometry.computeVertexNormals();
    // Scratches and grime.
    scratch(this.paint, { left, right, front, rear, top: g('hood') * 0.6 });
    // Lights: dim when cracked, dark when broken.
    const lamp = (m: THREE.MeshStandardMaterial | undefined, v: number, on: number) => {
      if (!m) return;
      m.userData.broken = v > 0.8;
      m.emissiveIntensity = v > 0.8 ? 0 : on * (1 - v * 0.8);
      m.color.setScalar(v > 0.8 ? 0.15 : 1).multiply(new THREE.Color(m.emissive));
    };
    lamp(this.headMats[0], g('headlightL'), 2.2);
    lamp(this.headMats[1], g('headlightR'), 2.2);
    lamp(this.tailMats[0], g('taillightL'), 1);
    lamp(this.tailMats[1] ?? this.tailMats[0], g('taillightR'), 1);
    // Bumpers sag and twist.
    if (this.frontBumper) {
      const v = g('frontBumper');
      this.frontBumper.position.set(0, -v * 0.08, -v * 0.12);
      this.frontBumper.rotation.set(v * 0.15, 0, v * 0.12);
    }
    if (this.rearBumper) {
      const v = g('rearBumper');
      this.rearBumper.position.set(0, -v * 0.08, v * 0.12);
      this.rearBumper.rotation.set(-v * 0.15, 0, -v * 0.1);
    }
    // Damaged wheels lean.
    (['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'] as const).forEach((p, w) => {
      this.pivots[w].rotation.z = (w % 2 === 0 ? 1 : -1) * g(p) * 0.18;
    });
    // Cracked glass: frostier.
    const glassHit = Math.max(front, left, right, rear);
    this.glassMat.roughness = 0.05 + glassHit * 0.5;
  }

  update(dt: number) {
    this.time += dt;
    if (this.animated && this.bodyMat instanceof THREE.MeshPhysicalMaterial) {
      this.bodyMat.iridescenceThicknessRange = [120 + Math.sin(this.time * 0.8) * 80, 900];
      if (this.bodyMat.emissiveIntensity) this.bodyMat.emissiveIntensity = 0.45 + Math.sin(this.time * 3) * 0.2;
    }
    if (this.rimGlow && WHEEL_FX[this.loadout.wheelfx]?.color === -1) this.rimGlow.color.setHSL((this.time * 0.25) % 1, 0.9, 0.6);
    if (this.glow && UNDERGLOWS[this.loadout.underglow]?.color === -1) (this.glow.material as THREE.MeshBasicMaterial).color.setHSL((this.time * 0.2) % 1, 0.9, 0.55);
    const prop = this.group.getObjectByName('prop');
    if (prop) prop.rotation.y += dt * 18;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

function badgeTexture(id: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8ecf2';
  g.strokeStyle = '#e8ecf2';
  g.lineWidth = 5;
  g.translate(32, 32);
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y));
    g.closePath();
    g.fill();
  };
  switch (id) {
    case 'bolt':
      poly([[6, -28], [-14, 4], [0, 4], [-6, 28], [14, -6], [0, -6]]);
      break;
    case 'star':
      poly(Array.from({ length: 10 }, (_, i) => [Math.sin((i / 10) * Math.PI * 2) * (i % 2 ? 12 : 28), -Math.cos((i / 10) * Math.PI * 2) * (i % 2 ? 12 : 28)] as [number, number]));
      break;
    case 'wing':
      poly([[-28, -6], [-4, 2], [-4, 10], [-24, 6]]);
      poly([[28, -6], [4, 2], [4, 10], [24, 6]]);
      g.beginPath();
      g.arc(0, 4, 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'shield':
      poly([[-20, -24], [20, -24], [20, 2], [0, 26], [-20, 2]]);
      break;
    case 'flag':
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) g.fillRect(-20 + i * 10, -20 + j * 10, 10, 10);
      g.strokeRect(-20, -20, 40, 40);
      break;
    case 'skull':
      g.beginPath();
      g.arc(0, -4, 18, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-10, 8, 20, 12);
      g.fillStyle = '#15161b';
      g.beginPath();
      g.arc(-7, -4, 5, 0, Math.PI * 2);
      g.arc(7, -4, 5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'diamond':
      poly([[0, -26], [22, -6], [0, 26], [-22, -6]]);
      break;
    case 'trophy':
      g.fillStyle = '#ffd23f';
      poly([[-16, -24], [16, -24], [12, 2], [-12, 2]]);
      g.fillRect(-4, 2, 8, 12);
      g.fillRect(-12, 14, 24, 8);
      break;
    default:
      g.fillStyle = '#ff3f8e';
      g.beginPath();
      for (let k = 0; k <= 20; k++) {
        const a = (k / 20) * Math.PI * 2, r = k % 2 ? 18 : 26;
        g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function identityGeometry(shape: string): THREE.BufferGeometry {
  return cached(`ident:${shape}`, () => {
    const s = new THREE.Shape();
    const r = 0.16;
    const sides = { circle: 24, triangle: 3, square: 4, diamond: 4, hexagon: 6, star: 10 }[shape] ?? 24;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + (shape === 'square' ? Math.PI / 4 : shape === 'triangle' ? -Math.PI / 2 : 0);
      const rr = shape === 'star' && i % 2 ? r * 0.45 : r;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i) s.lineTo(x, y);
      else s.moveTo(x, y);
    }
    return new THREE.ShapeGeometry(s);
  });
}

export const identityHex = (i: number) => RACE_IDENTITIES[i % 6].color;
