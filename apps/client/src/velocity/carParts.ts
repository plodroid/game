import * as THREE from 'three';
import type { CarLoadout } from '@chromashift/shared';
import { chamferBox, Parts, plate, slab, tube, turned } from '../modeling/kit';

/*
 * The parts that go on a car, each one modelled: wings are real aerofoil sections, lips and
 * splitters are cut from profiles with chamfered edges, pipes and lamps are turned, bars and
 * cages are bent tube. Every part is added to a Parts collection by material name; the car model
 * merges each collection into a handful of meshes.
 *
 * Car space: +z is the nose, +y up, x across. Sizes in metres.
 */

type P2 = [number, number];
type V3 = [number, number, number];

export interface Station {
  z: number;
  w: number;
  b: number;
  t: number;
}
export interface Cabin {
  z0: number;
  z1: number;
  r0: number;
  r1: number;
  yb: number;
  yt: number;
  wb: number;
  wt: number;
}
export type BodyKind = 'closed' | 'open' | 'cage' | 'cockpit';

export interface PartCtx {
  l: CarLoadout;
  /** Hull sections near the front and the back. */
  fr: Station;
  bk: Station;
  nose: number;
  tail: number;
  hoodY: number;
  bootY: number;
  cabin: Cabin;
  kind: BodyKind;
  /** 0 low … 2 high: how round the turned parts are. */
  detail: number;
}

const up = -Math.PI / 2;
const segs = (c: PartCtx, n = 14) => (c.detail > 0 ? n : Math.max(8, Math.round(n * 0.6)));

/**
 * An aerofoil section in the (z, y) plane, its leading edge at (z0, y0) facing +z, the chord running
 * back towards -z. `thick` is the thickness as a fraction of the chord; `aoa` tilts the trailing
 * edge up (radians).
 */
export function foil(chord: number, thick: number, z0: number, y0: number, aoa = 0, camber = 0.6): P2[] {
  const n = 9, top: P2[] = [], bot: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const c = camber * thick * 4 * x * (1 - x);
    top.push([-x * chord, (c + t) * chord]);
    bot.push([-x * chord, (c - t) * chord]);
  }
  const pts = [...top, ...bot.reverse().slice(1, -1)];
  const ca = Math.cos(aoa), sa = Math.sin(aoa);
  // Turn about the leading edge so the trailing edge (at -z) rises.
  return pts.map(([z, y]) => [z0 + z * ca + y * sa, y0 - z * sa + y * ca] as P2);
}

/** A flat face extruded along z: `outline` in (x, y), `depth` thick, front face at z = 0 facing +z. */
function face(outline: P2[], depth: number, bevel = 0, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const b = Math.min(bevel, depth / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -depth + b);
  return g;
}

/** A rounded rectangle outline, centred. */
export function roundRect(w: number, h: number, r: number, n = 3): P2[] {
  const out: P2[] = [];
  const rr = Math.min(r, w / 2, h / 2);
  for (const [cx, cy, a0] of [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI], [w / 2 - rr, -h / 2 + rr, (3 * Math.PI) / 2]] as const)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  return out;
}

const circle = (r: number, n = 16, cx = 0, cy = 0): P2[] => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as P2);

/** A tyre with tread blocks round it, facing +x (for spares). */
function spareWheel(p: Parts, at: V3, r: number, c: PartCtx) {
  const n = segs(c, 18);
  p.add('rubber', turned([[r * 0.62, 0.11], [r * 0.9, 0.12], [r, 0.08], [r, -0.08], [r * 0.9, -0.12], [r * 0.62, -0.11]], n), at[0], at[1], at[2], 0, 0, 0);
  p.add('chrome', turned([[0, 0.06], [r * 0.3, 0.06], [r * 0.62, 0.02], [r * 0.62, -0.06], [0, -0.04]], n), at[0], at[1], at[2]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    p.add('dark', turned([[0, 0.075], [0.025, 0.075], [0.025, 0.05], [0, 0.05]], 8), at[0] + Math.cos(a) * r * 0.2, at[1] + Math.sin(a) * r * 0.2, at[2]);
  }
}

/** A lamp: a dark housing with a chrome reflector cup and a glowing lens, facing +z. */
function lamp(p: Parts, at: V3, r: number, mat: string, c: PartCtx, depth = 0.08, dir = 0) {
  const n = segs(c, 16);
  p.add('dark', turned([[0, -depth], [r * 1.1, -depth + 0.01], [r * 1.25, -0.01], [r * 1.25, 0.01], [r * 1.05, 0.012]], n), at[0], at[1], at[2], 0, dir);
  p.add('chrome', turned([[r * 0.25, -depth * 0.6], [r * 0.95, -0.005], [r, 0.004]], n, false), at[0], at[1], at[2], 0, dir);
  p.add(mat, turned([[0, 0.022], [r * 0.6, 0.018], [r, 0.004], [r * 0.98, 0], [0, 0]], n, false), at[0], at[1], at[2], 0, dir);
}

/* ---------- Front ---------- */

export function frontBumper(p: Parts, c: PartCtx) {
  const w = c.fr.w, z = c.nose, yb = c.fr.b;
  const lip = (mat: string, drop: number, reach: number, width: number) =>
    p.add(mat, slab([[z + reach, yb + 0.02 - drop], [z + reach + 0.02, yb + 0.06 - drop], [z - 0.02, yb + 0.15], [z - 0.28, yb + 0.13], [z - 0.28, yb + 0.02 - drop]], width, 0.018));
  switch (c.l.frontBumper) {
    case 'splitter':
      p.add('dark', plate([[-w * 0.98, z - 0.3], [w * 0.98, z - 0.3], [w * 0.98, z + 0.06], [w * 0.7, z + 0.13], [-w * 0.7, z + 0.13], [-w * 0.98, z + 0.06]], 0.025, 0.006), 0, yb - 0.01, 0);
      p.both('dark', () => slab([[z + 0.08, yb - 0.01], [z + 0.03, yb + 0.12], [z - 0.24, yb + 0.1], [z - 0.28, yb - 0.01]], 0.02, 0.004), w * 0.97);
      for (const x of [-0.35, 0.35]) p.add('dark', slab([[z - 0.06, yb], [z - 0.06, yb + 0.1], [z - 0.12, yb + 0.1], [z - 0.12, yb]], 0.02, 0.004), x);
      break;
    case 'rally': {
      // A curved aluminium skid plate and two spot lamps on a bar.
      p.add('chrome', slab([[z + 0.04, yb - 0.04], [z + 0.13, yb + 0.06], [z + 0.07, yb + 0.12], [z - 0.5, yb + 0.04], [z - 0.5, yb - 0.05]], w * 1.4, 0.02));
      for (let i = -2; i <= 2; i++) p.add('dark', chamferBox(0.012, 0.012, 0.42, 0.003), i * 0.14, yb + 0.03, z - 0.2);
      p.add('dark', tube([[-0.42, yb + 0.28, z + 0.06], [0.42, yb + 0.28, z + 0.06]], 0.018, 6));
      for (const s of [1, -1]) lamp(p, [s * 0.3, yb + 0.28, z + 0.11], 0.08, 'lampW', c);
      break;
    }
    case 'canard':
      lip('dark', 0, 0.04, w * 1.7);
      p.both('carbon', () => plate([[0, 0.05], [0.23, -0.02], [0.23, -0.16], [0, -0.18]], 0.014, 0.003), w - 0.03, yb + 0.16, z - 0.16, 0, 0, 0.28);
      p.both('carbon', () => plate([[0, 0.04], [0.18, -0.02], [0.18, -0.13], [0, -0.14]], 0.012, 0.003), w - 0.05, yb + 0.26, z - 0.22, 0, 0, 0.36);
      p.both('dark', () => face(roundRect(0.26, 0.12, 0.04), 0.03, 0.008), w * 0.55, yb + 0.2, z + 0.01);
      break;
    case 'round':
      // A chrome bar that wraps round the corners, with two rubber-tipped overriders.
      p.add('chrome', tube([[-w * 0.98, yb + 0.12, z - 0.3], [-w * 0.92, yb + 0.12, z - 0.02], [-w * 0.5, yb + 0.12, z + 0.06], [w * 0.5, yb + 0.12, z + 0.06], [w * 0.92, yb + 0.12, z - 0.02], [w * 0.98, yb + 0.12, z - 0.3]], 0.05, 10));
      for (const s of [1, -1]) p.add('rubber', turned([[0, 0.12], [0.035, 0.11], [0.04, 0.02], [0.03, -0.02], [0, -0.03]], 10), s * 0.32, yb + 0.12, z + 0.09, up);
      break;
    case 'wide': {
      // One big intake: a bevelled surround with a honeycomb mesh behind it.
      const hole = roundRect(w * 1.15, 0.2, 0.06);
      p.add('dark', face(roundRect(w * 1.4, 0.32, 0.09), 0.06, 0.015, [hole]), 0, yb + 0.16, z + 0.03);
      p.add('mesh', face(roundRect(w * 1.16, 0.21, 0.06), 0.01), 0, yb + 0.16, z - 0.04);
      break;
    }
    case 'lip':
      lip('carbon', 0.02, 0.07, w * 1.8);
      break;
    case 'grille': {
      // A tall chrome grille: a polished surround and vertical bars.
      p.add('chrome', face(roundRect(w * 1.05, 0.28, 0.05), 0.04, 0.012, [roundRect(w * 0.93, 0.2, 0.03)]), 0, yb + 0.26, z + 0.02);
      for (let i = 0; i < 11; i++) p.add('chrome', chamferBox(0.018, 0.2, 0.025, 0.004), (i / 10 - 0.5) * w * 0.88, yb + 0.26, z - 0.005);
      p.add('mesh', face(roundRect(w * 0.94, 0.21, 0.03), 0.01), 0, yb + 0.26, z - 0.02);
      lip('dark', 0, 0.02, w * 1.6);
      break;
    }
    case 'push': {
      // A tubular push bar: a frame and two uprights, bolted under the nose.
      const fz = z + 0.16;
      p.add('dark', tube([[-0.5, yb, z - 0.1], [-0.5, yb + 0.02, fz], [-0.5, yb + 0.4, fz], [-0.4, yb + 0.48, fz], [0.4, yb + 0.48, fz], [0.5, yb + 0.4, fz], [0.5, yb + 0.02, fz], [0.5, yb, z - 0.1]], 0.03, 8));
      for (const x of [-0.22, 0.22]) p.add('dark', tube([[x, yb + 0.02, fz], [x, yb + 0.46, fz]], 0.022, 6));
      p.add('dark', tube([[-0.5, yb + 0.2, fz], [0.5, yb + 0.2, fz]], 0.022, 6));
      p.add('rubber', chamferBox(0.5, 0.06, 0.05, 0.015), 0, yb + 0.2, fz + 0.03);
      break;
    }
    case 'plow': {
      // A curved blade on two arms, hazard stripes along the top edge.
      const blade: P2[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        blade.push([z + 0.3 + Math.sin(t * Math.PI * 0.5) * 0.14 - t * 0.05, yb - 0.08 + t * 0.4]);
      }
      for (let i = 8; i >= 0; i--) {
        const t = i / 8;
        blade.push([z + 0.26 + Math.sin(t * Math.PI * 0.5) * 0.14 - t * 0.05, yb - 0.08 + t * 0.4]);
      }
      p.add('yellow', slab(blade, w * 2.3, 0.01));
      p.add('dark', slab([[z + 0.37, yb + 0.31], [z + 0.37, yb + 0.35], [z + 0.33, yb + 0.35], [z + 0.33, yb + 0.31]], w * 2.32, 0.005));
      for (const x of [-0.35, 0.35]) p.add('dark', tube([[x, yb + 0.08, z - 0.15], [x, yb + 0.12, z + 0.3]], 0.03, 6));
      break;
    }
    default:
      // The stock bumper: a moulded lip, a grille slot and fog lamps.
      lip('dark', 0, 0.02, w * 1.6);
      p.add('dark', face(roundRect(w * 0.9, 0.09, 0.035), 0.03, 0.008, [roundRect(w * 0.82, 0.05, 0.02)]), 0, yb + 0.25, z + 0.005);
      p.add('mesh', face(roundRect(w * 0.84, 0.06, 0.02), 0.01), 0, yb + 0.25, z - 0.01);
      if (c.kind !== 'cockpit') for (const s of [1, -1]) lamp(p, [s * w * 0.62, yb + 0.12, z + 0.015], 0.035, 'lampW', c, 0.04);
  }
}

/* ---------- Rear ---------- */

export function rearBumper(p: Parts, c: PartCtx) {
  const w = c.bk.w, z = c.tail, yb = c.bk.b;
  switch (c.l.rearBumper) {
    case 'sport':
      p.add('dark', slab([[z - 0.03, yb + 0.02], [z - 0.05, yb + 0.12], [z + 0.25, yb + 0.14], [z + 0.25, yb + 0.02]], w * 1.6, 0.015));
      for (const s of [1, -1]) {
        p.add('dark', face(roundRect(0.22, 0.07, 0.025), 0.03, 0.006, [roundRect(0.18, 0.04, 0.015)]), s * w * 0.62, yb + 0.2, z + 0.02, 0, Math.PI);
        for (let i = 0; i < 3; i++) p.add('dark', chamferBox(0.004, 0.035, 0.02, 0.001), s * w * 0.62 + (i - 1) * 0.05, yb + 0.2, z + 0.01);
      }
      break;
    case 'tow': {
      p.add('dark', slab([[z - 0.02, yb + 0.02], [z - 0.04, yb + 0.12], [z + 0.2, yb + 0.12], [z + 0.2, yb + 0.02]], w * 1.4, 0.015));
      // A tow eye and a bright strap looped through it.
      p.add('chrome', new THREE.TorusGeometry(0.04, 0.012, 6, 14), 0.42, yb + 0.12, z - 0.06, 0, Math.PI / 2);
      p.add('accent', tube([[0.42, yb + 0.12, z - 0.06], [0.44, yb + 0.06, z - 0.1], [0.43, yb + 0.02, z - 0.06]], 0.012, 5));
      break;
    }
    case 'race':
      p.add('carbon', plate([[-w * 0.9, z - 0.12], [w * 0.9, z - 0.12], [w * 0.8, z + 0.3], [-w * 0.8, z + 0.3]], 0.02, 0.005), 0, yb + 0.03, 0);
      break;
    case 'retro':
      p.add('chrome', tube([[-w * 0.98, yb + 0.12, z + 0.3], [-w * 0.9, yb + 0.12, z + 0.02], [-w * 0.5, yb + 0.12, z - 0.06], [w * 0.5, yb + 0.12, z - 0.06], [w * 0.9, yb + 0.12, z + 0.02], [w * 0.98, yb + 0.12, z + 0.3]], 0.05, 10));
      break;
    case 'step': {
      // A chrome step with a ribbed rubber tread.
      p.add('chrome', slab([[z + 0.04, yb + 0.02], [z - 0.16, yb + 0.03], [z - 0.18, yb + 0.12], [z + 0.04, yb + 0.12]], w * 1.85, 0.02));
      for (let i = 0; i < 4; i++) p.add('rubber', chamferBox(w * 1.5, 0.012, 0.022, 0.004), 0, yb + 0.125, z - 0.03 - i * 0.04);
      break;
    }
    case 'hitch':
      p.add('dark', chamferBox(0.08, 0.08, 0.3, 0.012), 0, yb + 0.02, z - 0.08);
      p.add('chrome', turned([[0, 0.06], [0.025, 0.055], [0.035, 0.03], [0.025, 0], [0.012, -0.01], [0.012, -0.05], [0.03, -0.06], [0.03, -0.07], [0, -0.07]], 12), 0, yb + 0.1, z - 0.2, up);
      break;
    case 'spare': {
      // Swing-out carrier with the spare tyre on it, facing backwards.
      p.add('dark', tube([[w * 0.6, yb + 0.12, z - 0.02], [w * 0.6, yb + 0.12, z - 0.12], [-w * 0.3, yb + 0.12, z - 0.12]], 0.02, 6));
      const g = new Parts();
      spareWheel(g, [0, 0, 0], 0.33, c);
      for (const [m, geo] of g.merged()) p.add(m, geo, 0, yb + 0.42, z - 0.2, 0, Math.PI / 2);
      break;
    }
    default:
      p.add('dark', slab([[z - 0.02, yb + 0.02], [z - 0.03, yb + 0.1], [z + 0.22, yb + 0.12], [z + 0.22, yb + 0.02]], w * 1.55, 0.015));
      for (const s of [1, -1]) p.add('lampR', face(roundRect(0.08, 0.025, 0.01), 0.012), s * w * 0.66, yb + 0.07, z - 0.025, 0, Math.PI);
  }
  // Diffuser fins under the tail.
  const fins = (n: number, h: number, span: number) => {
    for (let i = 0; i < n; i++) p.add('carbon', slab([[z - 0.02, yb], [z + 0.5, yb], [z + 0.5, yb + 0.02], [z - 0.02, yb + h]], 0.016, 0.004), (i / (n - 1) - 0.5) * span);
  };
  switch (c.l.diffuser) {
    case 'small':
      fins(3, 0.1, w * 1.1);
      break;
    case 'race':
      fins(5, 0.18, w * 1.4);
      p.add('carbon', plate([[-w * 0.75, z + 0.5], [w * 0.75, z + 0.5], [w * 0.75, z - 0.02], [-w * 0.75, z - 0.02]], 0.015, 0.003), 0, yb, 0);
      break;
    case 'light':
      fins(5, 0.14, w * 1.3);
      p.add('lampR', face(roundRect(0.1, 0.05, 0.012), 0.015, 0.004), 0, yb + 0.06, z - 0.02, 0, Math.PI);
      break;
    case 'double':
      fins(7, 0.16, w * 1.4);
      p.add('carbon', plate([[-w * 0.72, z + 0.45], [w * 0.72, z + 0.45], [w * 0.72, z], [-w * 0.72, z]], 0.012, 0.003), 0, yb + 0.12, 0);
      break;
    case 'blade':
      p.add('carbon', slab([[z - 0.06, yb], [z + 0.6, yb], [z + 0.6, yb + 0.02], [z - 0.06, yb + 0.22]], 0.03, 0.006));
      p.add('carbon', plate([[-w * 0.85, z + 0.55], [w * 0.85, z + 0.55], [w * 0.85, z - 0.03], [-w * 0.85, z - 0.03]], 0.015, 0.003), 0, yb, 0);
      break;
    case 'tunnel': {
      // Two arched Venturi tunnels between tall strakes.
      for (const x of [-w * 0.7, 0, w * 0.7]) p.add('carbon', slab([[z - 0.04, yb], [z + 0.55, yb], [z + 0.55, yb + 0.02], [z - 0.04, yb + 0.24]], 0.02, 0.005), x);
      for (const x of [-w * 0.35, w * 0.35]) {
        const arch: P2[] = [];
        for (let i = 0; i <= 8; i++) arch.push([Math.cos((i / 8) * Math.PI) * w * 0.33, Math.sin((i / 8) * Math.PI) * 0.18]);
        for (let i = 8; i >= 0; i--) arch.push([Math.cos((i / 8) * Math.PI) * w * 0.3, Math.sin((i / 8) * Math.PI) * 0.15]);
        p.add('carbon', face(arch, 0.5, 0.004), x, yb, z + 0.5, 0, Math.PI);
      }
      break;
    }
  }
}

/* ---------- Exhaust ---------- */

/** Builds the exhaust and returns where flames come out (car space). */
export function exhaust(p: Parts, c: PartCtx): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const z = c.tail, y = c.bk.b + 0.1, w = c.bk.w;
  const n = segs(c, 14);
  const tip = (x: number, r: number, yy = y) => {
    // A rolled-lip tip with a dark bore and a perforated baffle.
    p.add('chrome', turned([[r * 0.82, 0.04], [r, 0.04], [r * 1.08, 0.02], [r * 1.1, -0.04], [r * 1.05, -0.2], [r * 0.85, -0.2], [r * 0.85, 0.035]], n), x, yy, z + 0.12, 0, Math.PI);
    p.add('dark', turned([[0, 0.1], [r * 0.84, 0.1], [r * 0.84, 0.0], [0, 0.0]], n), x, yy, z + 0.12, 0, Math.PI);
    out.push(new THREE.Vector3(x, yy, z - 0.1));
  };
  switch (c.l.exhaust) {
    case 'single': tip(w * 0.55, 0.045); break;
    case 'quad': for (const x of [0.64, 0.48, -0.48, -0.64]) tip(x * w, 0.038); break;
    case 'center': tip(0, 0.08); break;
    case 'shotgun': tip(0.09, 0.062); tip(-0.09, 0.062); break;
    case 'tri': for (const x of [-0.13, 0, 0.13]) tip(x, 0.05); break;
    case 'side':
      for (const s of [1, -1]) {
        // Sill pipes under a perforated heat shield.
        p.add('chrome', tube([[s * 0.98, -0.33, 0.9], [s * 1.0, -0.34, 0.3], [s * 1.0, -0.34, -0.6], [s * 0.99, -0.33, -0.82]], 0.05, 10));
        p.add('chrome', slab([[0.6, -0.27], [-0.45, -0.27], [-0.5, -0.3], [0.65, -0.3]], 0.08, 0.01), s * 1.02);
        out.push(new THREE.Vector3(s * 0.99, -0.33, -0.86));
      }
      break;
    case 'stack': {
      const sz = c.cabin.z0 - 0.12;
      for (const s of [1, -1]) {
        p.add('chrome', turned([[0.055, 0], [0.055, 0.9], [0.065, 0.92], [0.065, 1.0], [0.055, 1.0]], n), s * (c.cabin.wb - 0.05), c.cabin.yb - 0.1, sz, up);
        // A rain flap on top.
        p.add('dark', plate(circle(0.06, 10), 0.01, 0.002), s * (c.cabin.wb - 0.05), c.cabin.yb + 0.91, sz - 0.02, 0.5);
        out.push(new THREE.Vector3(s * (c.cabin.wb - 0.05), c.cabin.yb + 0.9, sz));
      }
      break;
    }
    default: tip(w * 0.55, 0.045); tip(-w * 0.55, 0.045);
  }
  return out;
}

/* ---------- Bonnet ---------- */

export function hood(p: Parts, c: PartCtx) {
  const y = c.hoodY, z = c.nose - (c.nose - c.cabin.z1) * 0.5, len = (c.nose - c.cabin.z1) * 0.7;
  const scoop = (x: number, wide: number, h: number) => {
    p.add('body', slab([[z + len * 0.25, y - 0.02], [z - len * 0.35, y - 0.02], [z - len * 0.35, y + h], [z + len * 0.05, y + h * 0.92], [z + len * 0.22, y + h * 0.3]], wide, 0.025), x);
    p.add('dark', face(roundRect(wide * 0.78, h * 0.62, h * 0.2), 0.03), x, y + h * 0.55, z + len * 0.06, -0.08);
  };
  switch (c.l.hood) {
    case 'scoop':
      scoop(0, 0.44, 0.1);
      break;
    case 'twin':
      for (const x of [-0.3, 0.3]) scoop(x, 0.24, 0.07);
      break;
    case 'vents':
      for (const s of [1, -1]) {
        p.add('dark', plate(roundRect(0.3, 0.34, 0.04), 0.012, 0.003), s * 0.35, y + 0.005, z);
        for (let i = 0; i < 5; i++) p.add('body', slab(foil(0.07, 0.15, z + 0.13 - i * 0.065, y + 0.012, 0.35), 0.26, 0.002), s * 0.35);
      }
      break;
    case 'louvres':
      for (const s of [1, -1])
        for (let r = 0; r < 2; r++)
          for (let i = 0; i < 6; i++) p.add('body', slab([[z + 0.2 - i * 0.07, y], [z + 0.2 - i * 0.07 - 0.045, y + 0.03], [z + 0.2 - i * 0.07 - 0.05, y]], 0.13, 0.003), s * (0.2 + r * 0.17));
      break;
    case 'bulge': {
      const prof: P2[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        prof.push([z + len * 0.5 - t * len * 1.1, y - 0.02 + Math.sin(t * Math.PI) ** 0.6 * 0.07]);
      }
      prof.push([z - len * 0.6, y - 0.03], [z + len * 0.5, y - 0.03]);
      p.add('body', slab(prof, 0.62, 0.03));
      break;
    }
    case 'carbon':
      p.add('carbon', plate(roundRect(1.1, len, 0.08), 0.014, 0.004), 0, y + 0.006, z);
      break;
    case 'pins':
      for (const s of [1, -1]) {
        p.add('chrome', turned([[0, 0.03], [0.018, 0.028], [0.022, 0.012], [0.012, 0], [0, 0]], 10), s * 0.5, y + 0.005, z + len * 0.42, up);
        p.add('chrome', tube([[s * 0.5, y + 0.03, z + len * 0.42], [s * 0.54, y + 0.05, z + len * 0.32], [s * 0.52, y + 0.035, z + len * 0.25]], 0.004, 4));
      }
      break;
    case 'blower': {
      // A supercharger: a ribbed casing on an intake manifold, belt pulley at the front, a hat on top.
      const by = y + 0.02;
      p.add('chrome', chamferBox(0.32, 0.08, 0.5, 0.02), 0, by + 0.04, z);
      const ribs: P2[] = [[0.1, 0.22]];
      for (let i = 0; i < 6; i++) ribs.push([0.1, 0.18 - i * 0.06], [0.112, 0.17 - i * 0.06], [0.112, 0.16 - i * 0.06], [0.1, 0.15 - i * 0.06]);
      ribs.push([0.1, -0.2]);
      for (const x of [-0.07, 0.07]) p.add('chrome', turned(ribs, 14), x, by + 0.16, z);
      p.add('dark', turned([[0, 0.03], [0.07, 0.03], [0.075, 0.02], [0.075, -0.02], [0.07, -0.03], [0, -0.03]], 14), 0, by + 0.16, z + 0.27);
      p.add('dark', chamferBox(0.28, 0.12, 0.2, 0.02), 0, by + 0.32, z + 0.02);
      for (let i = 0; i < 3; i++) p.add('chrome', chamferBox(0.004, 0.08, 0.16, 0.001), (i - 1) * 0.08, by + 0.33, z + 0.12);
      break;
    }
    case 'snorkel': {
      const s = -1, x = s * (c.cabin.wb + 0.04);
      p.add('dark', tube([[x - s * 0.02, c.fr.b + 0.3, c.cabin.z1 + 0.2], [x, c.cabin.yb, c.cabin.z1], [x, c.cabin.yt - 0.05, c.cabin.r1 + 0.05], [x, c.cabin.yt + 0.06, c.cabin.r1]], 0.045, 10));
      p.add('dark', turned([[0.05, 0.04], [0.07, 0.03], [0.075, -0.06], [0.05, -0.07]], 12), x, c.cabin.yt + 0.08, c.cabin.r1);
      break;
    }
  }
}

/* ---------- Wings and spoilers ---------- */

export function spoiler(p: Parts, c: PartCtx) {
  const z = c.tail + 0.42, y = c.bootY, w = c.bk.w;
  const wing = (mat: string, span: number, chord: number, wy: number, wz = z, aoa = 0.12) => p.add(mat, slab(foil(chord, 0.12, wz, wy, aoa), span, 0.004));
  const pylon = (x: number, h: number, wz = z) => p.add('dark', slab([[wz + 0.02, y - 0.02], [wz - 0.12, y - 0.02], [wz - 0.16, y + h], [wz - 0.04, y + h]], 0.025, 0.006), x);
  const plates = (span: number, wy: number, wz = z, h = 0.18) => p.both('dark', () => slab([[wz + 0.04, wy - h * 0.55], [wz - 0.38, wy - h * 0.55], [wz - 0.42, wy + h * 0.45], [wz - 0.02, wy + h * 0.35]], 0.012, 0.003), span / 2);
  switch (c.l.spoiler) {
    case 'lip':
      p.add('body', slab([[z - 0.25, y - 0.02], [z - 0.25, y + 0.04], [z - 0.4, y + 0.06], [z - 0.42, y - 0.02]], w * 1.4, 0.012));
      break;
    case 'gurney':
      p.add('body', slab([[z - 0.25, y - 0.02], [z - 0.25, y + 0.04], [z - 0.4, y + 0.06], [z - 0.42, y - 0.02]], w * 1.4, 0.012));
      p.add('dark', slab([[z - 0.4, y + 0.05], [z - 0.4, y + 0.09], [z - 0.415, y + 0.09], [z - 0.415, y + 0.05]], w * 1.4, 0.003));
      break;
    case 'ducktail':
      p.add('body', slab([[z - 0.05, y - 0.02], [z - 0.15, y + 0.02], [z - 0.38, y + 0.11], [z - 0.44, y + 0.12], [z - 0.44, y - 0.02]], w * 1.45, 0.02));
      break;
    case 'whale':
      p.add('body', slab([[z, y - 0.02], [z - 0.12, y + 0.06], [z - 0.46, y + 0.12], [z - 0.5, y + 0.12], [z - 0.5, y - 0.02]], w * 1.65, 0.03));
      p.add('rubber', slab([[z - 0.47, y + 0.105], [z - 0.47, y + 0.14], [z - 0.52, y + 0.14], [z - 0.52, y + 0.105]], w * 1.67, 0.008));
      break;
    case 'wing':
      for (const s of [1, -1]) pylon(s * 0.45, 0.2);
      wing('body', 1.6, 0.3, y + 0.2);
      break;
    case 'gt':
      for (const s of [1, -1]) pylon(s * 0.42, 0.32);
      wing('dark', 1.85, 0.36, y + 0.32, z, 0.18);
      plates(1.85, y + 0.33);
      break;
    case 'swan':
      // Hung from above: two swan necks reaching over the wing.
      for (const s of [1, -1]) p.add('dark', tube([[s * 0.4, y, z - 0.08], [s * 0.4, y + 0.3, z - 0.02], [s * 0.4, y + 0.43, z - 0.14], [s * 0.4, y + 0.41, z - 0.22]], 0.016, 6));
      wing('dark', 1.7, 0.32, y + 0.36, z, 0.15);
      plates(1.7, y + 0.37);
      break;
    case 'double':
      for (const s of [1, -1]) pylon(s * 0.42, 0.3);
      wing('body', 1.7, 0.28, y + 0.25);
      wing('body', 1.7, 0.2, y + 0.36, z - 0.12, 0.3);
      plates(1.7, y + 0.31, z, 0.26);
      break;
    case 'split':
      for (const s of [1, -1]) {
        pylon(s * 0.42, 0.24);
        p.add('body', slab(foil(0.3, 0.12, z, y + 0.24, 0.14), 0.72, 0.004), s * 0.48);
      }
      plates(1.7, y + 0.25);
      break;
    case 'drag':
      for (const s of [1, -1]) p.add('dark', slab([[z + 0.02, y - 0.02], [z - 0.06, y - 0.02], [z - 0.16, y + 0.62], [z - 0.06, y + 0.62]], 0.03, 0.006), s * 0.46);
      wing('dark', 1.75, 0.4, y + 0.62, z - 0.02, 0.22);
      plates(1.75, y + 0.63, z - 0.02, 0.22);
      break;
    case 'light':
      for (const s of [1, -1]) pylon(s * 0.45, 0.26);
      wing('glow', 1.7, 0.12, y + 0.27);
      break;
  }
}

/* ---------- Roof ---------- */

export function roof(p: Parts, c: PartCtx) {
  const cb = c.cabin, y = cb.yt + 0.03, mid = (cb.r0 + cb.r1) / 2, len = Math.max(0.6, cb.r1 - cb.r0);
  const rails = () => {
    for (const s of [1, -1]) {
      p.add('dark', tube([[s * 0.5, y - 0.02, mid - len * 0.45], [s * 0.5, y + 0.05, mid - len * 0.4], [s * 0.5, y + 0.05, mid + len * 0.4], [s * 0.5, y - 0.02, mid + len * 0.45]], 0.016, 6));
    }
  };
  switch (c.l.roof) {
    case 'scoop':
      p.add('body', slab([[mid + 0.25, y - 0.03], [mid - 0.2, y - 0.03], [mid - 0.2, y + 0.1], [mid + 0.18, y + 0.08]], 0.36, 0.02));
      p.add('dark', face(roundRect(0.27, 0.06, 0.02), 0.02), 0, y + 0.06, mid + 0.18);
      break;
    case 'rack':
      rails();
      for (const dz of [-0.3, 0.3]) p.add('dark', tube([[-0.5, y + 0.06, mid + dz], [0.5, y + 0.06, mid + dz]], 0.014, 6));
      break;
    case 'lightbar':
      p.add('dark', slab([[cb.r1 + 0.04, y], [cb.r1 - 0.08, y], [cb.r1 - 0.08, y + 0.1], [cb.r1 + 0.05, y + 0.1]], 1.0, 0.015));
      for (let i = 0; i < 4; i++) lamp(p, [-0.36 + i * 0.24, y + 0.06, cb.r1 + 0.05], 0.045, 'lampW', c, 0.05);
      break;
    case 'fin':
      p.add('body', slab([[cb.r0 + 0.5, y - 0.02], [cb.r0 - 0.35, y - 0.02], [cb.r0 - 0.25, y + 0.24], [cb.r0 - 0.12, y + 0.24]], 0.02, 0.006));
      break;
    case 'spoiler':
      p.add('body', slab(foil(0.2, 0.12, cb.r0 + 0.02, y + 0.01, 0.2), 1.0, 0.004));
      break;
    case 'box': {
      p.add('dark', chamferBox(0.72, 0.24, 1.1, 0.07), 0, y + 0.15, mid);
      p.add('steel', chamferBox(0.735, 0.012, 1.11, 0.004), 0, y + 0.16, mid);
      for (const dz of [-0.3, 0.3]) p.add('dark', tube([[-0.5, y + 0.02, mid + dz], [0.5, y + 0.02, mid + dz]], 0.012, 6));
      break;
    }
    case 'sunroof':
      p.add('glass', plate(roundRect(0.6, Math.min(0.7, len * 0.6), 0.06), 0.01, 0.003), 0, y - 0.015, mid);
      p.add('dark', plate(roundRect(0.64, Math.min(0.74, len * 0.6 + 0.04), 0.07), 0.006, 0.002), 0, y - 0.02, mid);
      break;
    case 'vents':
      for (const s of [1, -1]) {
        p.add('body', slab([[mid + 0.18, y - 0.03], [mid - 0.1, y - 0.03], [mid - 0.1, y + 0.04], [mid + 0.12, y + 0.035]], 0.2, 0.015), s * 0.25);
        p.add('dark', face(roundRect(0.15, 0.03, 0.01), 0.02), s * 0.25, y + 0.02, mid + 0.12);
      }
      break;
    case 'basket': {
      rails();
      const h = 0.14, bw = 0.42, bl = len * 0.42;
      p.add('dark', tube([[-bw, y + h, mid - bl], [bw, y + h, mid - bl], [bw, y + h, mid + bl], [-bw, y + h, mid + bl], [-bw, y + h, mid - bl]], 0.014, 6));
      p.add('dark', tube([[-bw, y + 0.06, mid - bl], [bw, y + 0.06, mid - bl], [bw, y + 0.06, mid + bl], [-bw, y + 0.06, mid + bl], [-bw, y + 0.06, mid - bl]], 0.012, 6));
      for (const [x, z] of [[-bw, -bl], [bw, -bl], [bw, bl], [-bw, bl]] as const) p.add('dark', tube([[x, y + 0.06, mid + z], [x, y + h, mid + z]], 0.012, 5));
      for (let i = -2; i <= 2; i++) p.add('dark', tube([[-bw, y + 0.06, mid + (i * bl) / 2.5], [bw, y + 0.06, mid + (i * bl) / 2.5]], 0.008, 4));
      // A bag strapped in.
      p.add('cloth', chamferBox(0.5, 0.12, 0.4, 0.05), 0.05, y + 0.12, mid - 0.1);
      break;
    }
    case 'surf': {
      rails();
      for (const dz of [-0.3, 0.3]) p.add('dark', tube([[-0.5, y + 0.06, mid + dz], [0.5, y + 0.06, mid + dz]], 0.014, 6));
      // A longboard: a pointed outline, a rocker, a stringer and a fin.
      const half = 1.15, wid = 0.24, board: P2[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, zz = -half + t * 2 * half, ww = wid * Math.sin(Math.PI * (0.06 + t * 0.88)) ** 0.7 * (t > 0.7 ? 1 - (t - 0.7) * 0.9 : 1);
        board.push([ww, zz]);
      }
      for (let i = 16; i >= 0; i--) board.push([-board[i][0], board[i][1]]);
      p.add('accent', plate(board, 0.035, 0.012), 0, y + 0.1, mid, 0.04);
      p.add('white', plate([[-0.006, -half + 0.05], [0.006, -half + 0.05], [0.006, half - 0.05], [-0.006, half - 0.05]], 0.037, 0.001), 0, y + 0.1, mid, 0.04);
      p.add('dark', slab([[mid - half + 0.12, y + 0.08], [mid - half + 0.3, y + 0.08], [mid - half + 0.16, y - 0.02]], 0.01, 0.002));
      break;
    }
  }
}

/* ---------- Mirrors ---------- */

export function mirrors(p: Parts, c: PartCtx) {
  const cb = c.cabin;
  if (c.l.mirrors === 'none' || c.kind === 'cockpit') return;
  const y = cb.yb + 0.1, z = cb.z1 - 0.2;
  for (const s of [1, -1]) {
    const x = s * (cb.wb + 0.08);
    switch (c.l.mirrors) {
      case 'round':
        p.add('chrome', tube([[s * (cb.wb - 0.02), y - 0.03, z], [s * (cb.wb + 0.04), y + 0.02, z], [x, y + 0.04, z]], 0.008, 4));
        p.add('chrome', turned([[0, 0.04], [0.055, 0.03], [0.065, 0], [0.06, -0.01], [0, -0.01]], 12), x, y + 0.04, z, 0, Math.PI);
        p.add('glass', turned([[0, 0.0], [0.058, 0.0]], 12, false), x, y + 0.04, z - 0.011, 0, Math.PI);
        break;
      case 'aero':
      case 'carbon': {
        const mat = c.l.mirrors === 'carbon' ? 'carbon' : 'body';
        p.add(mat, slab([[z + 0.08, y - 0.06], [z + 0.02, y - 0.06], [z - 0.02, y - 0.005], [z + 0.04, y]], 0.014, 0.004), s * (cb.wb + 0.03));
        p.add(mat, slab([[z + 0.08, y - 0.02], [z + 0.03, y + 0.035], [z - 0.06, y + 0.03], [z - 0.06, y - 0.03], [z + 0.03, y - 0.035]], 0.15, 0.012), x + s * 0.03);
        p.add('glass', face(roundRect(0.13, 0.05, 0.02), 0.004), x + s * 0.03, y, z - 0.062, 0, Math.PI);
        break;
      }
      case 'camera':
        p.add('dark', slab([[z + 0.06, y - 0.06], [z + 0.02, y - 0.06], [z, y], [z + 0.04, y]], 0.012, 0.003), s * (cb.wb + 0.03));
        p.add('dark', turned([[0, 0.04], [0.025, 0.035], [0.028, -0.04], [0, -0.045]], 10), x, y + 0.01, z + 0.01);
        p.add('glass', turned([[0, 0.0], [0.016, 0.0]], 10, false), x, y + 0.01, z - 0.036, 0, Math.PI);
        break;
      default:
        // Stock: a rounded housing in body colour on a short arm, glass on the back.
        p.add('body', slab([[z + 0.08, y - 0.06], [z + 0.01, y - 0.06], [z - 0.01, y - 0.01], [z + 0.06, y - 0.01]], 0.03, 0.008), s * (cb.wb + 0.03));
        p.add('body', chamferBox(0.19, 0.1, 0.09, 0.03), x + s * 0.03, y + 0.01, z - 0.02);
        p.add('glass', face(roundRect(0.16, 0.075, 0.025), 0.004), x + s * 0.03, y + 0.01, z - 0.065, 0, Math.PI);
    }
  }
}

/* ---------- Toppers and mascots ---------- */

export function accessory(p: Parts, c: PartCtx): { prop?: THREE.BufferGeometry; propAt?: V3 } {
  const cb = c.cabin, y = cb.yt + 0.03, mid = (cb.r0 + cb.r1) / 2;
  const n = segs(c, 14);
  switch (c.l.accessory) {
    case 'antenna':
      p.add('dark', tube([[-0.4, y - 0.02, mid - 0.3], [-0.4, y + 0.3, mid - 0.32], [-0.4, y + 0.58, mid - 0.38]], 0.006, 4));
      p.add('yellow', new THREE.SphereGeometry(0.06, 14, 10), -0.4, y + 0.62, mid - 0.38);
      p.add('dark', turned([[0, 0.02], [0.02, 0.015], [0.025, 0], [0, 0]], 8), -0.4, y - 0.02, mid - 0.3, up);
      break;
    case 'flag': {
      p.add('chrome', turned([[0, 0.72], [0.012, 0.7], [0.01, 0], [0, 0]], 8), -0.42, y - 0.02, mid - 0.4, up);
      // A cloth flag with a wave in it.
      const g = new THREE.PlaneGeometry(0.32, 0.2, 8, 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) + 0.16) * 14) * 0.025 * (pos.getX(i) + 0.16) * 3);
      g.computeVertexNormals();
      p.add('identity', g, -0.42, y + 0.56, mid - 0.56, 0, Math.PI / 2);
      break;
    }
    case 'duck': {
      // A rubber duck on the dash: turned body, round head, flat beak.
      const dz = cb.z1 - 0.22, dy = cb.yb + 0.04;
      p.add('yellow', turned([[0, -0.1], [0.06, -0.09], [0.1, -0.03], [0.1, 0.04], [0.07, 0.1], [0.02, 0.13], [0, 0.13]], n).scale(1, 0.75, 1), 0.3, dy + 0.06, dz);
      p.add('yellow', new THREE.SphereGeometry(0.06, 12, 10), 0.3, dy + 0.16, dz + 0.05);
      p.add('orange', slab([[dz + 0.11, dy + 0.15], [dz + 0.16, dy + 0.155], [dz + 0.16, dy + 0.14], [dz + 0.11, dy + 0.13]], 0.05, 0.008), 0.3);
      for (const s of [1, -1]) p.add('dark', new THREE.SphereGeometry(0.01, 6, 5), 0.3 + s * 0.035, dy + 0.18, dz + 0.1);
      break;
    }
    case 'crown': {
      const band: P2[] = [[0.15, 0], [0.165, 0], [0.165, 0.06], [0.15, 0.06]];
      p.add('gold', turned(band, 18), 0, y, mid, up);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        p.add('gold', slab([[0.04, 0], [0, 0.11], [-0.04, 0]], 0.014, 0.003), Math.cos(a) * 0.157, y + 0.055, mid + Math.sin(a) * 0.157, 0, -a + Math.PI / 2);
        p.add('identity', new THREE.OctahedronGeometry(0.018), Math.cos(a) * 0.168, y + 0.03, mid + Math.sin(a) * 0.168);
      }
      break;
    }
    case 'dice':
      for (const [x, r] of [[-0.05, 0.3], [0.05, -0.4]] as const) {
        p.add('accent', chamferBox(0.07, 0.07, 0.07, 0.016), 0.2 + x, cb.yt - 0.2, cb.r1 - 0.05, r, r * 0.5);
        p.add('dark', tube([[0.2 + x, cb.yt - 0.17, cb.r1 - 0.05], [0.2, cb.yt - 0.05, cb.r1 - 0.06]], 0.003, 3));
      }
      break;
    case 'cone':
      p.add('orange', turned([[0, 0.4], [0.025, 0.4], [0.13, 0.04], [0.13, 0.03], [0, 0.03]], n), 0, y, mid, up);
      p.add('white', turned([[0.06, 0.26], [0.085, 0.18], [0.083, 0.18], [0.058, 0.26]], n), 0, y + 0.002, mid, up);
      p.add('dark', plate(roundRect(0.32, 0.32, 0.05), 0.03, 0.006), 0, y + 0.015, mid);
      break;
    case 'propeller': {
      // A beanie cap; the blades spin (built separately).
      p.add('accent', turned([[0, 0.09], [0.06, 0.08], [0.1, 0.04], [0.11, 0], [0, 0]], n), 0, y, mid, up);
      p.add('dark', turned([[0, 0.03], [0.012, 0.03], [0.012, 0], [0, 0]], 8), 0, y + 0.09, mid, up);
      const blade = new Parts();
      for (const s of [1, -1]) blade.add('x', slab(foil(0.06, 0.1, 0.03, 0, 0), 0.26, 0.002), s * 0.15, 0, 0, 0, 0, s * 0.18);
      const g = blade.merged().get('x')!;
      return { prop: g, propAt: [0, y + 0.13, mid] };
    }
    case 'halo':
      p.add('glow', new THREE.TorusGeometry(0.42, 0.028, 10, 36), 0, y + 0.45, mid, Math.PI / 2);
      break;
    case 'palm': {
      p.add('wood', turned([[0, 0.12], [0.08, 0.12], [0.07, 0], [0, 0]], n), 0, y, mid - 0.2, up);
      p.add('wood', tube([[0, y + 0.1, mid - 0.2], [0.02, y + 0.28, mid - 0.2], [0, y + 0.42, mid - 0.21]], 0.016, 6));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        p.add('green', slab([[0, 0], [0.08, 0.04], [0.2, -0.02], [0.24, -0.08], [0.12, -0.02], [0.02, -0.02]], 0.04, 0.004), 0, y + 0.42, mid - 0.21, 0, a);
      }
      break;
    }
    case 'cactus': {
      // A terracotta pot with a little saguaro in it: ribbed trunk, two arms.
      p.add('wood', turned([[0, 0.13], [0.085, 0.13], [0.09, 0.11], [0.07, 0], [0, 0]], n), 0, y, mid - 0.2, up);
      p.add('green', turned([[0, 0.44], [0.03, 0.43], [0.04, 0.38], [0.04, 0.1], [0, 0.1]], 8), 0, y, mid - 0.2, up);
      p.add('green', tube([[0.035, y + 0.22, mid - 0.2], [0.09, y + 0.23, mid - 0.2], [0.1, y + 0.33, mid - 0.2]], 0.02, 6));
      p.add('green', tube([[-0.035, y + 0.28, mid - 0.2], [-0.08, y + 0.29, mid - 0.2], [-0.085, y + 0.37, mid - 0.2]], 0.018, 6));
      p.add('accent', new THREE.SphereGeometry(0.018, 8, 6), 0, y + 0.45, mid - 0.2);
      break;
    }
    case 'cowboy': {
      // A ten-gallon hat: a curled brim and a pinched crown with a band.
      const brim: P2[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, r = 0.12 + t * 0.2;
        brim.push([r, 0.03 + (t > 0.6 ? (t - 0.6) ** 2 * 0.5 : 0) - t * 0.01]);
      }
      p.add('leather', turned([[0.12, 0.01], ...brim, [0.32, 0.075], [0.31, 0.06], [0.12, 0.005]], 24, false).scale(1, 1, 0.82), 0, y + 0.03, mid, up);
      p.add('leather', turned([[0.12, 0.03], [0.13, 0.15], [0.115, 0.2], [0.06, 0.21], [0.03, 0.18], [0, 0.19]], 20).scale(1, 1, 0.82), 0, y + 0.03, mid, up);
      p.add('dark', turned([[0.126, 0.04], [0.131, 0.04], [0.133, 0.075], [0.128, 0.075]], 20).scale(1, 1, 0.82), 0, y + 0.03, mid, up);
      break;
    }
    case 'longhorns': {
      // Steer horns on a leather-wrapped boss on the bonnet.
      const hz = c.nose - (c.nose - cb.z1) * 0.35, hy = c.hoodY + 0.04;
      p.add('leather', turned([[0, 0.05], [0.08, 0.045], [0.09, 0], [0, -0.005]], 12), 0, hy, hz, up);
      for (const s of [1, -1]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          pts.push([s * (0.06 + t * 0.62), hy + 0.04 + Math.sin(t * Math.PI * 0.85) * 0.16 + t * t * 0.12, hz + t * 0.12 - t * t * 0.18]);
        }
        p.add('bone', tube(pts, 0.03, 8).scale(1, 1, 1));
        p.add('dark', new THREE.SphereGeometry(0.012, 8, 6), pts[8][0], pts[8][1], pts[8][2]);
      }
      break;
    }
    case 'dish': {
      p.add('dark', tube([[0, y, mid - 0.2], [0, y + 0.16, mid - 0.2]], 0.015, 6));
      p.add('white', turned([[0, 0], [0.08, 0.012], [0.15, 0.045], [0.16, 0.06], [0.152, 0.062], [0.075, 0.025], [0, 0.012]], 18), 0, y + 0.2, mid - 0.2, -0.5);
      p.add('dark', tube([[0, y + 0.22, mid - 0.18], [0, y + 0.3, mid - 0.04]], 0.006, 4));
      break;
    }
  }
  return {};
}

/* ---------- Built-ins for some body types ---------- */

/** Front and rear wings, sidepod inlets, a halo and an airbox for the open-wheel car. */
export function formulaKit(p: Parts, c: PartCtx) {
  const z = c.nose, t = c.tail;
  // Front wing: a main plane and a flap, endplates outboard of the wheels.
  p.add('dark', slab(foil(0.32, 0.1, z + 0.1, -0.68, -0.04), 1.9, 0.004));
  p.add('accent', slab(foil(0.18, 0.1, z - 0.14, -0.63, 0.35), 1.85, 0.003));
  p.both('dark', () => slab([[z + 0.14, -0.72], [z - 0.36, -0.72], [z - 0.4, -0.52], [z + 0.02, -0.56]], 0.015, 0.004), 0.96);
  p.add('dark', tube([[0, -0.4, z - 0.3], [0, -0.62, z - 0.05]], 0.02, 5));
  // Rear wing on a centre pylon, with endplates.
  p.add('dark', slab(foil(0.34, 0.12, t + 0.36, 0.42, 0.2), 1.3, 0.004));
  p.add('accent', slab(foil(0.18, 0.12, t + 0.14, 0.5, 0.5), 1.28, 0.003));
  p.both('dark', () => slab([[t + 0.42, 0.18], [t - 0.06, 0.18], [t - 0.1, 0.62], [t + 0.36, 0.6]], 0.015, 0.004), 0.65);
  p.add('dark', slab([[t + 0.42, -0.1], [t + 0.24, -0.1], [t + 0.26, 0.42], [t + 0.36, 0.42]], 0.03, 0.006));
  // Airbox over the driver's head, and the halo.
  p.add('body', slab([[-0.25, 0.08], [-0.25, 0.42], [-0.45, 0.46], [-1.3, 0.14], [-1.3, 0.04]], 0.24, 0.05));
  p.add('dark', face(roundRect(0.15, 0.12, 0.05), 0.04), 0, 0.37, -0.24);
  p.add('dark', tube([[-0.22, 0.12, -0.4], [-0.22, 0.32, -0.2], [-0.16, 0.36, 0.02], [0, 0.36, 0.08], [0.16, 0.36, 0.02], [0.22, 0.32, -0.2], [0.22, 0.12, -0.4]], 0.022, 6));
  p.add('dark', tube([[0, 0.36, 0.08], [0, 0.2, 0.28]], 0.02, 6));
  // Sidepod inlets.
  for (const s of [1, -1]) p.add('dark', face(roundRect(0.16, 0.1, 0.04), 0.03), s * 0.6, -0.12, -0.38);
  // Front suspension arms out to the wheels.
  for (const s of [1, -1])
    for (const [dy, dz] of [[0.05, 0.08], [-0.12, -0.04]] as const) p.add('carbon', tube([[s * 0.2, -0.34 + dy, 1.38 + dz], [s * 0.78, -0.38 + dy * 0.5, 1.38]], 0.012, 4));
  for (const s of [1, -1])
    for (const [dy, dz] of [[0.05, 0.08], [-0.12, -0.04]] as const) p.add('carbon', tube([[s * 0.4, -0.34 + dy, -1.38 + dz], [s * 0.78, -0.38 + dy * 0.5, -1.38]], 0.012, 4));
}

/** A tube roll cage following the cabin, for the buggy. */
export function rollCage(p: Parts, c: PartCtx) {
  const cb = c.cabin, r = 0.024;
  for (const s of [1, -1]) {
    const x0 = s * cb.wb, x1 = s * cb.wt;
    p.add('cage', tube([[x0, cb.yb, cb.z1], [x1, cb.yt, cb.r1], [x1, cb.yt, cb.r0], [x0, cb.yb, cb.z0]], r, 8));
    p.add('cage', tube([[x0, cb.yb, cb.r0 - 0.05], [x1 * 0.98, cb.yt - 0.02, cb.r0 + 0.02]], r * 0.9, 6));
    p.add('cage', tube([[x0, cb.yb, cb.z1], [x0, cb.yb, cb.z0]], r * 0.9, 6));
  }
  for (const z of [cb.r0, cb.r1]) p.add('cage', tube([[-cb.wt, cb.yt, z], [cb.wt, cb.yt, z]], r, 6));
  p.add('cage', tube([[-cb.wt, cb.yt, cb.r0], [cb.wt, cb.yt, cb.r1]], r * 0.8, 6));
  p.add('cage', tube([[-cb.wb, cb.yb, cb.z0], [cb.wb, cb.yb + 0.5, cb.z0 + 0.05]], r * 0.8, 6));
  // A spare tyre strapped behind, and a whip flag.
  const g = new Parts();
  spareWheel(g, [0, 0, 0], 0.3, c);
  for (const [m, geo] of g.merged()) p.add(m, geo, 0, cb.yb + 0.15, cb.z0 - 0.22, 0, Math.PI / 2, Math.PI / 2 - 0.4);
  p.add('dark', tube([[-cb.wt, cb.yt, cb.r0], [-cb.wt - 0.05, cb.yt + 0.9, cb.r0 - 0.1]], 0.006, 3));
  p.add('accent', slab([[cb.r0 - 0.1, cb.yt + 0.9], [cb.r0 - 0.3, cb.yt + 0.84], [cb.r0 - 0.1, cb.yt + 0.76]], 0.006, 0.001), -cb.wt - 0.05);
}

/** Roll hoops behind the seats of an open car. */
export function rollHoops(p: Parts, c: PartCtx, seatZ: number) {
  for (const s of [1, -1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      pts.push([s * 0.34 + Math.cos(a) * 0.2, c.cabin.yb + Math.sin(a) * 0.36, seatZ - 0.28]);
    }
    p.add('chrome', tube(pts, 0.022, 6));
    // A fairing behind each hoop.
    p.add('body', slab([[seatZ - 0.26, c.cabin.yb - 0.02], [seatZ - 0.3, c.cabin.yb + 0.3], [seatZ - 1.1, c.cabin.yb - 0.02]], 0.22, 0.04), s * 0.34);
  }
}

/** A seat: base, back and headrest cut from one side profile. */
export function seat(p: Parts, x: number, y: number, z: number, h = 0.5, mat = 'cloth') {
  p.add(mat, slab([[z + 0.22, y], [z + 0.22, y + 0.08], [z - 0.05, y + 0.1], [z - 0.12, y + h * 0.75], [z - 0.1, y + h * 0.82], [z - 0.07, y + h], [z - 0.18, y + h], [z - 0.2, y + h * 0.82], [z - 0.22, y]], 0.38, 0.04), x);
}

/** A front-engined V8 out in the air (hot rod): block, rocker covers, headers, air cleaner. */
export function openEngine(p: Parts, c: PartCtx) {
  const z = c.nose - 0.75, y = c.hoodY;
  p.add('accent', chamferBox(0.34, 0.18, 0.6, 0.03), 0, y + 0.09, z);
  for (const s of [1, -1]) {
    p.add('chrome', chamferBox(0.1, 0.06, 0.56, 0.02), s * 0.14, y + 0.21, z, 0, 0, s * 0.5);
    // Headers: four pipes each side sweeping down into a collector.
    for (let i = 0; i < 4; i++) p.add('chrome', tube([[s * 0.18, y + 0.1, z + 0.2 - i * 0.13], [s * 0.36, y + 0.06, z + 0.2 - i * 0.13], [s * 0.44, y - 0.12, z - 0.1], [s * 0.46, y - 0.3, z - 0.35]], 0.018, 6));
  }
  p.add('chrome', turned([[0, 0.02], [0.17, 0.02], [0.18, 0.0], [0.18, -0.07], [0.17, -0.09], [0.03, -0.09], [0, -0.1]], 18), 0, y + 0.36, z, up);
  p.add('dark', turned([[0.16, -0.005], [0.165, -0.005], [0.165, -0.075], [0.16, -0.075]], 18), 0, y + 0.36, z, up);
  p.add('dark', turned([[0, 0.025], [0.07, 0.025], [0.075, 0.01], [0.075, -0.01], [0.07, -0.025], [0, -0.025]], 14), 0, y + 0.1, z + 0.33);
}

/** The lens shapes for headlights and tail-lights. */
export function lensOutline(shape: string, scale = 1): P2[] {
  switch (shape) {
    case 'round':
    case 'ring':
      return circle(0.1 * scale, 18);
    case 'slim':
      return [[-0.17, -0.02], [0.17, -0.035], [0.17, 0.03], [-0.15, 0.04]].map(([x, y]) => [x * scale, y * scale] as P2);
    case 'bar':
      return roundRect(0.42 * scale, 0.045 * scale, 0.02 * scale);
    case 'twin':
      return roundRect(0.3 * scale, 0.1 * scale, 0.05 * scale);
    case 'split':
      return roundRect(0.34 * scale, 0.05 * scale, 0.02 * scale);
    default:
      return roundRect(0.3 * scale, 0.12 * scale, 0.03 * scale);
  }
}

export { face };
