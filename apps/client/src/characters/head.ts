import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildFace } from './face';
import { buildGear, COVERS_TOP } from './gear';
import { buildHair } from './hair';

/*
 * The head and everything worn on it.
 *
 * One analytic surface defines the head. Hair, headgear and face pieces are built on that same
 * surface, pushed outwards in order (skin → face → hair → headgear), so nothing sinks into the
 * skull, floats above it, or covers the eyes, whatever the combination.
 *
 * Heading φ: 0 = the face (−z), +π/2 = the character's right (+x), ±π = the back.
 * Elevation t: −π/2 = chin, 0 ≈ eye line, +π/2 = crown.
 */

export const CY = 0.2, R = 0.225, UP = 0.215, DOWN = 0.23, DEPTH = 0.94;
export const TOP = Math.PI / 2;
export const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Radius and height of the head surface at elevation t, pushed out by o. */
export function headAt(t: number, o = 0): [number, number] {
  const s = Math.sin(t), c = Math.cos(t);
  const jaw = s < 0 ? 1 - 0.3 * s * s : 1 - 0.04 * s * s;
  return [(R + o) * Math.max(0, c) * jaw, CY + ((s > 0 ? UP : DOWN) + o) * s];
}

export function headPoint(phi: number, t: number, o: number, out = new THREE.Vector3()) {
  const [r, y] = headAt(t, o);
  return out.set(r * Math.sin(phi), y, -r * Math.cos(phi) * DEPTH);
}

/** Outward normal, taken from the surface itself so it matches the jaw shaping. */
export function headNormal(phi: number, t: number, o: number, out = new THREE.Vector3()) {
  if (t > TOP - 2e-3) return out.set(0, 1, 0);
  const p = headPoint(phi, t, o, _a);
  const dp = headPoint(phi + 1e-3, t, o, _b).sub(p);
  const dt = headPoint(phi, t + 1e-3, o, _c).sub(p);
  return out.crossVectors(dt, dp).normalize();
}

/** Height of the crown when pushed out by o. */
export const crownY = (o: number) => headAt(TOP, o)[1];

/** Collects triangle grids into one geometry. Each grid has its own vertices, so creases stay sharp. */
export class Builder {
  private pos: number[] = [];
  private idx: number[] = [];
  private fixed = new Map<number, THREE.Vector3>();

  /**
   * (n+1)×(m+1) points, or n×(m+1) when `wrap` closes the i direction. Triangles face along
   * d/dj × d/di; `flip` reverses them. `cap` pins the normal of the last row (a pole).
   */
  grid(n: number, m: number, wrap: boolean, flip: boolean, at: (i: number, j: number) => THREE.Vector3, cap?: THREE.Vector3) {
    const cols = wrap ? n : n + 1;
    const base = this.pos.length / 3;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j <= m; j++) {
        const p = at(i, j);
        if (cap && j === m) this.fixed.set(this.pos.length / 3, cap);
        this.pos.push(p.x, p.y, p.z);
      }
    const id = (i: number, j: number) => base + (wrap ? i % n : i) * (m + 1) + j;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const a = id(i, j), b = id(i, j + 1), c = id(i + 1, j), d = id(i + 1, j + 1);
        if (flip) this.idx.push(a, c, b, c, d, b);
        else this.idx.push(a, b, c, c, b, d);
      }
  }

  /** A closed slab: outer and inner sheets plus every edge, from one point function. */
  slab(nI: number, nJ: number, wrap: boolean, at: (i: number, j: number, inner: boolean) => THREE.Vector3) {
    this.grid(nI, nJ, wrap, false, (i, j) => at(i, j, false));
    this.grid(nI, nJ, wrap, true, (i, j) => at(i, j, true));
    this.grid(nI, 1, wrap, false, (i, k) => at(i, 0, k === 0));
    this.grid(nI, 1, wrap, true, (i, k) => at(i, nJ, k === 0));
    if (!wrap) {
      this.grid(nJ, 1, false, false, (j, k) => at(nI, j, k === 0));
      this.grid(nJ, 1, false, true, (j, k) => at(0, j, k === 0));
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const nor = g.getAttribute('normal');
    for (const [i, n] of this.fixed) nor.setXYZ(i, n.x, n.y, n.z);
    return g;
  }
}

export interface Layer {
  /** Outer offset from the skin. */
  o: number;
  /** Thickness; the inside and edges are closed so it reads as a solid piece. */
  th: number;
  /** Lower edge elevation by heading. */
  lo: (phi: number) => number;
  /** Upper edge elevation by heading; defaults to the crown. */
  hi?: (phi: number) => number;
  /** Heading range; defaults to all the way round. */
  arc?: [number, number];
  /** Extra outward offset by elevation (a flared bob, a slouchy beanie). */
  flare?: (t: number, phi: number) => number;
}

function layer(b: Builder, L: Layer, nPhi: number, nT: number) {
  const full = !L.arc;
  const [pa, pb] = L.arc ?? [-Math.PI, Math.PI];
  const n = full ? nPhi : Math.max(4, Math.round((nPhi * (pb - pa)) / (2 * Math.PI)));
  const phiOf = (i: number) => pa + ((pb - pa) * i) / n;
  const tOf = (phi: number, j: number) => {
    const lo = L.lo(phi), hi = L.hi ? L.hi(phi) : TOP;
    return lo + ((hi - lo) * j) / nT;
  };
  const off = (t: number, phi: number, inner: boolean) => (inner ? L.o - L.th : L.o) + (L.flare?.(t, phi) ?? 0);
  const crown = !L.hi;
  b.grid(n, nT, full, false, (i, j) => {
    const phi = phiOf(i), t = tOf(phi, j);
    return headPoint(phi, t, off(t, phi, false));
  }, crown ? new THREE.Vector3(0, 1, 0) : undefined);
  b.grid(n, nT, full, true, (i, j) => {
    const phi = phiOf(i), t = tOf(phi, j);
    return headPoint(phi, t, off(t, phi, true));
  }, crown ? new THREE.Vector3(0, -1, 0) : undefined);
  b.grid(n, 1, full, false, (i, j) => {
    const phi = phiOf(i), t = tOf(phi, 0);
    return headPoint(phi, t, off(t, phi, j === 0));
  });
  if (L.hi)
    b.grid(n, 1, full, true, (i, j) => {
      const phi = phiOf(i), t = tOf(phi, nT);
      return headPoint(phi, t, off(t, phi, j === 0));
    });
  if (!full) {
    b.grid(nT, 1, false, false, (i, j) => {
      const t = tOf(pb, i);
      return headPoint(pb, t, off(t, pb, j === 0));
    });
    b.grid(nT, 1, false, true, (i, j) => {
      const t = tOf(pa, i);
      return headPoint(pa, t, off(t, pa, j === 0));
    });
  }
}

/** Hairline that stays above the brows at the front and drops towards the nape. */
export function hairline(front: number, side: number, back: number, fringe = 0) {
  return (phi: number) => {
    const a = Math.abs(phi);
    const t = a < TOP ? front + (side - front) * smooth(0.45, TOP, a) : side + (back - side) * smooth(TOP, Math.PI, a);
    return t + fringe * Math.abs(Math.sin(phi * 7)) * (1 - smooth(0.7, 1.2, a));
  };
}

/** A band that is higher at the forehead and lower at the back, like a hat sitting tilted. */
export const tilted = (front: number, back: number) => (phi: number) => front + (back - front) * (1 - Math.cos(phi)) * 0.5;

/** Point on the centre line, from the forehead (a = 0) over the crown to the back (a = 1). */
export function midline(a: number, front: number, back: number, o: number, out: THREE.Vector3, normal: THREE.Vector3) {
  const up = TOP - front, down = TOP - back, s = a * (up + down);
  const [phi, t] = s <= up ? [0, front + s] : [Math.PI, TOP - (s - up)];
  headPoint(phi, t, o, out);
  headNormal(phi, t, o, normal);
}

/** Places an object on the head surface, its local +y along the surface normal. */
export function stand(obj: THREE.Object3D, phi: number, t: number, o: number, lean = 0) {
  headPoint(phi, t, o, obj.position);
  const n = headNormal(phi, t, o, _a);
  // Lean backwards (towards +z) so spikes and crests sweep instead of standing bolt upright.
  n.z += lean;
  obj.quaternion.setFromUnitVectors(Y, n.normalize());
}

/** Places a face feature flush with the skin, facing outwards. */
export function onFace(obj: THREE.Object3D, phi: number, t: number, o: number) {
  headPoint(phi, t, o, obj.position);
  obj.rotation.set(t * 0.8, -phi, 0, 'YXZ');
}

/** A tube that follows the head surface from heading pa to pb at elevation t(phi). */
export function surfaceTube(pa: number, pb: number, t: (phi: number) => number, o: number, radius: number, segs: number) {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 16; k++) {
    const phi = pa + ((pb - pa) * k) / 16;
    pts.push(headPoint(phi, t(phi), o));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 6);
}

/** Bakes each object's transform into its geometry and merges them into one. */
export function bake(parts: [THREE.BufferGeometry, THREE.Object3D][]) {
  const geos = parts.map(([g, o]) => {
    o.updateMatrix();
    const x = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(o.matrix);
    x.deleteAttribute('uv');
    g.dispose();
    return x;
  });
  const out = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return out;
}

export interface HeadParts {
  skin: THREE.Material;
  hair: THREE.Material;
  accent: THREE.Material;
  dark: THREE.Material;
  white: THREE.Material;
  eye: THREE.Material;
  team: THREE.Material;
  teamFlat: THREE.Material;
  /** Glossy see-through team colour for visors and lenses. */
  glass: THREE.Material;
  /** Make a one-off material (gold, straw, a dye). */
  make(color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.Material;
}

export interface HairStyle {
  /** Outer offset of the hair at elevation t, so headgear can sit just outside it. */
  outer: (t: number) => number;
  /** Tall pieces on top that a hat or headphones would cut through. */
  top: THREE.Object3D[];
}

export type MeshFn = (geo: THREE.BufferGeometry, mat: THREE.Material) => THREE.Mesh;
export type ShellFn = (layers: Layer[], mat: THREE.Material) => THREE.Mesh;

/** What every head piece builder gets. */
export interface Kit {
  m: HeadParts;
  mesh: MeshFn;
  shell: ShellFn;
  seg: (lo: number, hi: number) => number;
}

/** Builds the head, face, hair and headgear into `head`. Geometries are reported through `track`. */
export function buildHead(
  head: THREE.Object3D,
  look: { hair: string; headgear: string; face: string },
  m: HeadParts,
  detail: number,
  track: (g: THREE.BufferGeometry) => void,
  /** Colourways repaint a face piece or headgear: materials that replace the player's own. */
  tints: { face?: Partial<HeadParts>; gear?: Partial<HeadParts> } = {},
) {
  const seg = (lo: number, hi: number) => Math.round(lo + ((hi - lo) * detail) / 2);
  const nPhi = seg(18, 40), nT = seg(6, 14);
  const mesh: MeshFn = (geo, mat) => {
    track(geo);
    const me = new THREE.Mesh(geo, mat);
    me.castShadow = true;
    return me;
  };
  const shell: ShellFn = (layers, mat) => {
    const b = new Builder();
    for (const L of layers) layer(b, L, nPhi, nT);
    return mesh(b.geometry(), mat);
  };
  const kit: Kit = { m, mesh, shell, seg };

  // Skin: the head surface itself, from chin to crown.
  {
    const b = new Builder();
    const rows = seg(10, 22);
    b.grid(nPhi, rows, true, false, (i, j) => headPoint(-Math.PI + (2 * Math.PI * i) / nPhi, -TOP + (Math.PI * j) / rows, 0), new THREE.Vector3(0, 1, 0));
    head.add(mesh(b.geometry(), m.skin));
  }

  // Face: big readable eyes with highlights, brows and a chroma mark, all flush with the skin.
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.052, seg(8, 16), seg(6, 12)).scale(0.8, 1.15, 0.45), m.eye);
    onFace(eye, sx * 0.37, -0.05, -0.006);
    head.add(eye);
    const glint = mesh(new THREE.SphereGeometry(0.014, 6, 4), m.white);
    onFace(glint, sx * 0.37 + 0.07, 0.06, 0.012);
    head.add(glint);
    const brow = mesh(new THREE.CapsuleGeometry(0.012, 0.05, 2, 6).rotateZ(Math.PI / 2 + sx * 0.18), m.dark);
    onFace(brow, sx * 0.38, 0.33, 0.004);
    head.add(brow);
  }
  if (look.face !== 'stripes' && look.face !== 'warpaint') {
    const mark = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), m.team);
    onFace(mark, 0.62, -0.32, 0.002);
    head.add(mark);
  }

  const face = buildFace(look.face, { ...kit, m: { ...m, ...tints.face } });
  if (face.length) head.add(...face);
  const hair = buildHair(look.hair, kit);
  if (hair.group.children.length) head.add(...hair.group.children.slice());
  if (COVERS_TOP.has(look.headgear)) for (const o of hair.style.top) o.removeFromParent();
  buildGear(head, look.headgear, hair.style, { ...kit, m: { ...m, ...tints.gear } });
}
