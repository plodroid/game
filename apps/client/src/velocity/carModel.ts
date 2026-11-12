import * as THREE from 'three';
import {
  BOOST_FX, CAR_FINISHES, DRIFT_FX, HEADLIGHTS, PART_INDEX, PLATES, RACE_IDENTITIES, RIM_FINISHES, TAILLIGHTS, TINTS, TIRES,
  UNDERGLOWS, WHEEL_FX, WHEEL_R, WHEEL_X, WHEEL_Y, WHEEL_Z, WHEELS, DEFAULT_HANDLING, type CarLoadout,
} from '@chromashift/shared';
import { bodyMaterial, hex, paintTexture, scratch, type Paint } from './finishes';

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

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

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
    this.paint = paintTexture(l, o.identity, o.showIdentity ? identColor : hex(l.accent), o.texSize);
    this.disposables.push(this.paint.texture);
    this.bodyMat = this.mat(bodyMaterial(finish, this.paint.texture, o.lambert));
    const z0 = sh.tailZ, z1 = sh.noseZ;
    const seg = o.detail > 0 ? 28 : 16;
    const hullGeo = loft(sampleStations(sh.hull, o.detail > 0 ? 6 : 3), sh.n, seg, z0, z1);
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
    const cab = cabinStations(sh.cabin);
    const cabGeo = loft(cab, sh.n * 0.9, seg, z0, z1);
    this.disposables.push(cabGeo);
    const cabin = new THREE.Mesh(cabGeo, o.lambert ? this.mat(new THREE.MeshLambertMaterial({ color: tint.color, transparent: true, opacity: 0.9 })) : this.glassMat);
    this.group.add(cabin);
    const c = sh.cabin;
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
    const roof = new THREE.Mesh(roofGeo, this.bodyMat);
    roof.castShadow = true;
    this.group.add(roof);
    // A dark interior behind the glass (seats and dash), so the windows read as glass, not holes.
    for (const sx of [0.32, -0.32]) {
      const seat = new THREE.Mesh(box(0.38, (c.yt - c.yb) * 0.55, 0.1), this.std(0x2a2433, 0.7, 0));
      seat.position.set(sx, c.yb + (c.yt - c.yb) * 0.3, (c.r0 + c.r1) / 2 - 0.1);
      seat.rotation.x = -0.25;
      this.group.add(seat);
      this.disposables.push(seat.geometry);
    }
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

  private buildLights() {
    const l = this.loadout, sh = this.shape;
    const hl = HEADLIGHTS[l.headlights] ?? HEADLIGHTS.standard;
    const front = sh.hull[sh.hull.length - 2];
    const nose = sh.noseZ - 0.08;
    const yH = (front.b + front.t) / 2 + (front.t - front.b) * 0.18;
    for (const side of [1, -1]) {
      const m = this.std(hl.color, 0.2, 0, 2.2);
      this.headMats.push(m as THREE.MeshStandardMaterial);
      let g: THREE.BufferGeometry;
      if (hl.shape === 'round') g = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16).rotateX(Math.PI / 2);
      else if (hl.shape === 'slim') g = box(0.34, 0.06, 0.05);
      else if (hl.shape === 'bar') g = box(0.42, 0.04, 0.05);
      else if (hl.shape === 'twin') g = box(0.3, 0.1, 0.05);
      else g = box(0.3, 0.12, 0.05);
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(side * front.w * 0.62, yH, nose - 0.02);
      mesh.rotation.y = side * 0.25;
      this.group.add(mesh);
    }
    const tl = TAILLIGHTS[l.taillights] ?? TAILLIGHTS.standard;
    const back = sh.hull[1];
    const tail = sh.tailZ + 0.12;
    const yT = (back.b + back.t) / 2 + (back.t - back.b) * 0.22;
    const tailShapes = tl.shape === 'bar' ? [0] : [1, -1];
    for (const side of tailShapes) {
      const m = this.std(0xff2030, 0.3, 0, 1.0);
      this.tailMats.push(m as THREE.MeshStandardMaterial);
      let g: THREE.BufferGeometry;
      if (tl.shape === 'bar') g = box(back.w * 1.7, 0.06, 0.05);
      else if (tl.shape === 'round' || tl.shape === 'ring') g = tl.shape === 'ring' ? new THREE.TorusGeometry(0.08, 0.025, 6, 16) : new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14).rotateX(Math.PI / 2);
      else if (tl.shape === 'split') g = box(0.36, 0.05, 0.05);
      else g = box(0.3, 0.12, 0.05);
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(side * back.w * 0.62, yT, tail);
      this.group.add(mesh);
      if (tl.shape === 'split') {
        const m2 = new THREE.Mesh(g, m);
        m2.position.set(side * back.w * 0.62, yT - 0.09, tail);
        this.group.add(m2);
      }
    }
  }

  private buildParts() {
    const l = this.loadout, sh = this.shape, o = this.o;
    const paint = hex(l.paint), accent = hex(l.accent);
    const body = this.bodyMat;
    const dark = this.std(0x1a1b20, 0.6, 0.2);
    const chrome = this.std(0xdfe4ec, 0.12, 1);
    const accentMat = this.std(accent, 0.35, 0.2);
    const nose = sh.noseZ, tail = sh.tailZ;
    const fr = sh.hull[sh.hull.length - 2], bk = sh.hull[1];
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group) => {
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = o.detail > 0;
      parent.add(mesh);
      return mesh;
    };
    // Front bumper.
    const fb = new THREE.Group();
    this.frontBumper = fb;
    this.group.add(fb);
    const yLow = fr.b + 0.08;
    switch (l.frontBumper) {
      case 'splitter':
        add(box(fr.w * 1.9, 0.03, 0.3), dark, 0, fr.b + 0.02, nose - 0.05, fb);
        break;
      case 'rally':
        add(box(fr.w * 1.6, 0.05, 0.5), chrome, 0, fr.b + 0.02, nose - 0.2, fb);
        for (const s of [1, -1]) add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14).rotateX(Math.PI / 2), this.std(0xfff4e0, 0.2, 0, 1.6), s * 0.32, yLow + 0.12, nose + 0.02, fb);
        break;
      case 'canard':
        for (const s of [1, -1]) {
          const c = add(box(0.25, 0.02, 0.18), dark, s * (fr.w - 0.05), yLow + 0.08, nose - 0.2, fb);
          c.rotation.z = s * 0.3;
        }
        add(box(fr.w * 1.6, 0.14, 0.04), dark, 0, yLow + 0.04, nose - 0.01, fb);
        break;
      case 'round':
        add(new THREE.CylinderGeometry(0.05, 0.05, fr.w * 1.9, 12).rotateZ(Math.PI / 2), chrome, 0, yLow + 0.05, nose + 0.02, fb);
        break;
      case 'wide':
        add(box(fr.w * 1.3, 0.2, 0.05), dark, 0, yLow + 0.1, nose - 0.02, fb);
        break;
      default:
        add(box(fr.w * 1.2, 0.08, 0.04), dark, 0, yLow + 0.06, nose - 0.04, fb);
    }
    // Rear bumper and diffuser.
    const rb = new THREE.Group();
    this.rearBumper = rb;
    this.group.add(rb);
    const yRear = bk.b + 0.1;
    if (l.rearBumper === 'retro') add(new THREE.CylinderGeometry(0.05, 0.05, bk.w * 1.9, 12).rotateZ(Math.PI / 2), chrome, 0, yRear, tail - 0.02, rb);
    else if (l.rearBumper === 'tow') add(box(0.08, 0.1, 0.1), this.std(0xff3f8e, 0.5), 0.4, yRear, tail - 0.02, rb);
    else if (l.rearBumper === 'race') add(box(bk.w * 1.6, 0.05, 0.1), dark, 0, yRear - 0.05, tail + 0.05, rb);
    else if (l.rearBumper === 'sport') for (const s of [1, -1]) add(box(0.22, 0.06, 0.05), dark, s * bk.w * 0.6, yRear, tail, rb);
    if (l.diffuser !== 'none') {
      const fins = l.diffuser === 'small' ? 3 : l.diffuser === 'double' ? 7 : 5;
      for (let i = 0; i < fins; i++) add(box(0.02, l.diffuser === 'race' ? 0.18 : 0.11, 0.4), dark, (i / (fins - 1) - 0.5) * bk.w * 1.3, bk.b + 0.06, tail + 0.2, rb);
      if (l.diffuser === 'light') add(box(0.12, 0.06, 0.03), this.std(0xff2030, 0.3, 0, 1.4), 0, bk.b + 0.08, tail - 0.01, rb);
      if (l.diffuser === 'double') add(box(bk.w * 1.3, 0.015, 0.4), dark, 0, bk.b + 0.13, tail + 0.2, rb);
    }
    // Exhausts.
    const pipe = (x: number, r: number) => {
      add(new THREE.CylinderGeometry(r, r, 0.22, 12).rotateX(Math.PI / 2), chrome, x, bk.b + 0.1, tail - 0.02);
      this.exhausts.push(new THREE.Vector3(x, bk.b + 0.1, tail - 0.12));
    };
    switch (l.exhaust) {
      case 'single':
        pipe(bk.w * 0.55, 0.045);
        break;
      case 'quad':
        for (const x of [0.62, 0.48, -0.48, -0.62]) pipe(x * bk.w, 0.04);
        break;
      case 'center':
        pipe(0, 0.08);
        break;
      case 'shotgun':
        pipe(0.09, 0.065);
        pipe(-0.09, 0.065);
        break;
      case 'side':
        for (const s of [1, -1]) {
          add(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 12).rotateX(Math.PI / 2), chrome, s * 0.98, -0.35, 0);
          this.exhausts.push(new THREE.Vector3(s * 0.98, -0.35, -0.7));
        }
        break;
      default:
        pipe(bk.w * 0.55, 0.045);
        pipe(-bk.w * 0.55, 0.045);
    }
    // Bonnet.
    const hz = nose - (nose - sh.cabin.z1) * 0.5;
    switch (l.hood) {
      case 'scoop':
        add(box(0.4, 0.09, 0.5), body, 0, sh.hoodY + 0.04, hz);
        add(box(0.3, 0.06, 0.02), dark, 0, sh.hoodY + 0.05, hz + 0.25);
        break;
      case 'vents':
        for (const s of [1, -1]) add(box(0.28, 0.02, 0.3), dark, s * 0.35, sh.hoodY + 0.02, hz);
        break;
      case 'bulge':
        add(box(0.6, 0.06, 0.9), body, 0, sh.hoodY + 0.02, hz);
        break;
      case 'carbon': {
        const m = this.std(0x2a2d33, 0.35, 0.3);
        add(box(1.1, 0.015, (nose - sh.cabin.z1) * 0.7), m, 0, sh.hoodY + 0.01, hz);
        break;
      }
      case 'blower':
        add(box(0.36, 0.22, 0.4), chrome, 0, sh.hoodY + 0.1, hz);
        add(box(0.3, 0.12, 0.3), dark, 0, sh.hoodY + 0.26, hz);
        break;
    }
    // Spoiler.
    const sz = tail + 0.18, sy = sh.bootY;
    const plane = (w: number, d: number, y: number, z: number, m: THREE.Material = body) => add(box(w, 0.03, d), m, 0, y, z);
    const stands = (h: number, y: number, z: number) => {
      for (const s of [1, -1]) add(box(0.04, h, 0.12), dark, s * 0.45, y + h / 2, z);
    };
    const ends = (y: number, z: number, h: number, w: number) => {
      for (const s of [1, -1]) add(box(0.02, h, 0.36), dark, s * w / 2, y, z);
    };
    switch (l.spoiler) {
      case 'lip':
        plane(bk.w * 1.6, 0.12, sy + 0.04, sz);
        break;
      case 'ducktail': {
        const m = add(box(bk.w * 1.8, 0.04, 0.35), body, 0, sy + 0.07, sz + 0.05);
        m.rotation.x = -0.25;
        break;
      }
      case 'wing':
        stands(0.2, sy, sz + 0.05);
        plane(1.6, 0.3, sy + 0.21, sz);
        break;
      case 'gt':
        stands(0.32, sy, sz + 0.05);
        plane(1.85, 0.36, sy + 0.33, sz - 0.02, dark);
        ends(sy + 0.3, sz - 0.02, 0.16, 1.85);
        break;
      case 'swan':
        for (const s of [1, -1]) add(box(0.03, 0.34, 0.08), dark, s * 0.4, sy + 0.2, sz + 0.12);
        plane(1.7, 0.32, sy + 0.38, sz + 0.02, dark);
        ends(sy + 0.36, sz + 0.02, 0.14, 1.7);
        break;
      case 'double':
        stands(0.3, sy, sz + 0.05);
        plane(1.7, 0.28, sy + 0.24, sz);
        plane(1.7, 0.24, sy + 0.36, sz - 0.04);
        ends(sy + 0.3, sz, 0.2, 1.7);
        break;
      case 'light': {
        stands(0.26, sy, sz + 0.05);
        const m = this.std(accent, 0.2, 0, 1.6);
        plane(1.7, 0.1, sy + 0.27, sz, m);
        break;
      }
    }
    // Roof.
    const ry = sh.cabin.yt + 0.03, rz = (sh.cabin.r0 + sh.cabin.r1) / 2;
    switch (l.roof) {
      case 'scoop':
        add(box(0.36, 0.1, 0.4), body, 0, ry + 0.04, rz + 0.1);
        break;
      case 'rack':
        for (const s of [1, -1]) add(box(0.03, 0.05, 1.1), dark, s * 0.5, ry + 0.06, rz);
        for (const z of [-0.35, 0.35]) add(box(1.04, 0.03, 0.04), dark, 0, ry + 0.09, rz + z);
        break;
      case 'lightbar':
        add(box(1.0, 0.08, 0.1), dark, 0, ry + 0.06, sh.cabin.r1 - 0.05);
        for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateX(Math.PI / 2), this.std(0xfff4e0, 0.2, 0, 1.4), -0.36 + i * 0.24, ry + 0.06, sh.cabin.r1 - 0.0);
        break;
      case 'fin':
        add(box(0.02, 0.22, 0.9), body, 0, ry + 0.1, sh.cabin.r0 + 0.1);
        break;
      case 'spoiler':
        plane(1.0, 0.18, ry + 0.02, sh.cabin.r0 - 0.08);
        break;
      case 'box':
        add(box(0.7, 0.24, 1.1), this.std(0x2a2d33, 0.5, 0.2), 0, ry + 0.14, rz);
        break;
    }
    // Mirrors.
    if (l.mirrors !== 'none') {
      const m = l.mirrors === 'round' ? chrome : body;
      for (const s of [1, -1]) {
        const g = l.mirrors === 'round' ? new THREE.SphereGeometry(0.07, 10, 8) : box(0.18, 0.09, l.mirrors === 'aero' ? 0.14 : 0.1);
        add(g, m, s * (sh.cabin.wb + 0.05), sh.cabin.yb + 0.1, sh.cabin.z1 - 0.2);
      }
    }
    // Number plates (front and back).
    const pl = PLATES[l.plate] ?? PLATES.white;
    const plateTex = textTexture(l.plateText, pl.bg, pl.fg);
    this.disposables.push(plateTex);
    const plateMat = this.mat(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4 }));
    const pf = add(new THREE.PlaneGeometry(0.42, 0.11), plateMat, 0, yLow + 0.12, nose + 0.005);
    void pf;
    const pr = add(new THREE.PlaneGeometry(0.42, 0.11), plateMat, 0, bk.b + 0.25, tail - 0.005);
    pr.rotation.y = Math.PI;
    // Badge on the bonnet front.
    if (l.badge !== 'none') {
      const bt = badgeTexture(l.badge);
      this.disposables.push(bt);
      const b = add(new THREE.PlaneGeometry(0.16, 0.16), this.mat(new THREE.MeshStandardMaterial({ map: bt, transparent: true, metalness: 0.8, roughness: 0.25 })), 0, (fr.b + fr.t) / 2 + 0.06, nose + 0.01);
      b.rotation.x = -0.2;
    }
    // Underglow.
    const ug = UNDERGLOWS[l.underglow];
    if (ug?.color != null) {
      this.glow = add(new THREE.PlaneGeometry(2.4, 4.6), this.mat(new THREE.MeshBasicMaterial({ map: glowTexture(), color: ug.color === -1 ? 0xffffff : ug.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), 0, -0.82, 0);
      this.glow.rotation.x = -Math.PI / 2;
      this.glow.castShadow = false;
    }
    // Fins on the concept body.
    if (sh.fins) for (const s of [1, -1]) add(box(0.03, 0.3, 0.7), body, s * 0.7, sh.bootY + 0.12, tail + 0.45);
    // Accessory.
    this.buildAccessory(ry, rz, accentMat);
    // Identity marker over the roof in races: a little shape in the identity colour, so racers stay
    // easy to tell apart whatever paint they chose.
    if (o.showIdentity) {
      const id = RACE_IDENTITIES[o.identity % 6];
      const g = identityGeometry(id.shape);
      const m = this.mat(new THREE.MeshBasicMaterial({ color: id.color }));
      this.identityMarker = add(g, m, 0, ry + 0.06, sh.cabin.r0 + 0.05);
      this.identityMarker.rotation.x = -Math.PI / 2;
    }
    void paint;
  }

  private buildAccessory(ry: number, rz: number, accentMat: THREE.Material) {
    const l = this.loadout;
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      this.disposables.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };
    const ident = RACE_IDENTITIES[this.o.identity % 6].color;
    switch (l.accessory) {
      case 'antenna':
        add(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 6), this.std(0x222222), -0.4, ry + 0.3, rz - 0.3);
        add(new THREE.SphereGeometry(0.06, 12, 8), this.std(0xffd23f, 0.4), -0.4, ry + 0.62, rz - 0.3);
        break;
      case 'flag':
        add(new THREE.CylinderGeometry(0.01, 0.01, 0.7, 6), this.std(0xdddddd, 0.3, 0.8), -0.42, ry + 0.35, rz - 0.4);
        add(new THREE.PlaneGeometry(0.3, 0.2), this.mat(new THREE.MeshStandardMaterial({ color: ident, side: THREE.DoubleSide })), -0.42, ry + 0.6, rz - 0.55).rotation.y = Math.PI / 2;
        break;
      case 'duck':
        add(new THREE.SphereGeometry(0.1, 12, 10), this.std(0xffd23f, 0.5), 0.3, this.shape.cabin.yb + 0.1, this.shape.cabin.z1 - 0.2);
        add(new THREE.SphereGeometry(0.06, 10, 8), this.std(0xffd23f, 0.5), 0.3, this.shape.cabin.yb + 0.2, this.shape.cabin.z1 - 0.15);
        add(new THREE.ConeGeometry(0.03, 0.06, 8).rotateX(Math.PI / 2), this.std(0xff7a1a, 0.5), 0.3, this.shape.cabin.yb + 0.2, this.shape.cabin.z1 - 0.08);
        break;
      case 'crown': {
        const m = this.std(0xffc21a, 0.25, 1);
        add(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12, 1, true), m, 0, ry + 0.06, rz);
        for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.03, 0.1, 6), m, Math.cos((i / 5) * Math.PI * 2) * 0.16, ry + 0.14, rz + Math.sin((i / 5) * Math.PI * 2) * 0.16);
        break;
      }
      case 'dice':
        for (const x of [-0.05, 0.05]) add(box(0.07, 0.07, 0.07), this.std(0xff3f8e, 0.9), 0.2 + x, this.shape.cabin.yt - 0.18, this.shape.cabin.r1 - 0.05);
        break;
      case 'cone':
        add(new THREE.ConeGeometry(0.14, 0.38, 14), this.std(0xff7a1a, 0.6), 0, ry + 0.2, rz);
        break;
      case 'propeller': {
        add(new THREE.SphereGeometry(0.08, 10, 8), accentMat, 0, ry + 0.06, rz);
        const p = add(box(0.6, 0.01, 0.06), this.std(0xff3f8e, 0.4), 0, ry + 0.14, rz);
        p.name = 'prop';
        break;
      }
      case 'halo': {
        const m = this.mat(new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
        const t = add(new THREE.TorusGeometry(0.42, 0.03, 8, 28), m, 0, ry + 0.45, rz);
        t.rotation.x = Math.PI / 2;
        break;
      }
      case 'palm':
        add(new THREE.CylinderGeometry(0.08, 0.06, 0.12, 10), this.std(0xb5653a, 0.8), 0, ry + 0.06, rz - 0.2);
        add(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 6), this.std(0x8a5a2b, 0.8), 0, ry + 0.27, rz - 0.2);
        for (let i = 0; i < 5; i++) {
          const leaf = add(box(0.03, 0.01, 0.22), this.std(0x2f9f4f, 0.7), 0, ry + 0.42, rz - 0.2);
          leaf.rotation.set(0.6, (i / 5) * Math.PI * 2, 0);
          leaf.translateZ(0.1);
        }
        break;
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
    for (const m of this.headMats) if (!m.userData.broken) m.emissiveIntensity = night ? 3.2 : 2.2;
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
