import * as THREE from 'three';

/*
 * The head and everything worn on it.
 *
 * One analytic surface defines the head. Hair and headgear are solid layers built on that same
 * surface, pushed outwards in order (skin → hair → headgear), so nothing sinks into the skull,
 * floats above it, or covers the face, whatever the combination.
 *
 * Heading φ: 0 = the face (−z), +π/2 = the character's right (+x), ±π = the back.
 * Elevation t: −π/2 = chin, 0 ≈ eye line, +π/2 = crown.
 */

const CY = 0.2, R = 0.225, UP = 0.215, DOWN = 0.22, DEPTH = 0.94;
const TOP = Math.PI / 2;
const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Radius and height of the head surface at elevation t, pushed out by o. */
function headAt(t: number, o = 0): [number, number] {
  const s = Math.sin(t), c = Math.cos(t);
  const jaw = s < 0 ? 1 - 0.18 * s * s : 1;
  return [(R + o) * Math.max(0, c) * jaw, CY + ((s > 0 ? UP : DOWN) + o) * s];
}

function headPoint(phi: number, t: number, o: number, out = new THREE.Vector3()) {
  const [r, y] = headAt(t, o);
  return out.set(r * Math.sin(phi), y, -r * Math.cos(phi) * DEPTH);
}

/** Outward normal, taken from the surface itself so it matches the jaw shaping. */
function headNormal(phi: number, t: number, o: number, out = new THREE.Vector3()) {
  if (t > TOP - 2e-3) return out.set(0, 1, 0);
  const p = headPoint(phi, t, o, _a);
  const dp = headPoint(phi + 1e-3, t, o, _b).sub(p);
  const dt = headPoint(phi, t + 1e-3, o, _c).sub(p);
  return out.crossVectors(dt, dp).normalize();
}

/** Collects triangle grids into one geometry. Each grid has its own vertices, so creases stay sharp. */
class Builder {
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

interface Layer {
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
  flare?: (t: number) => number;
}

function layer(b: Builder, L: Layer, nPhi: number, nT: number) {
  const full = !L.arc;
  const [pa, pb] = L.arc ?? [-Math.PI, Math.PI];
  const phiOf = (i: number) => pa + ((pb - pa) * i) / nPhi;
  const tOf = (phi: number, j: number) => {
    const lo = L.lo(phi), hi = L.hi ? L.hi(phi) : TOP;
    return lo + ((hi - lo) * j) / nT;
  };
  const off = (t: number, inner: boolean) => (inner ? L.o - L.th : L.o) + (L.flare?.(t) ?? 0);
  const crown = !L.hi;
  b.grid(nPhi, nT, full, false, (i, j) => {
    const phi = phiOf(i), t = tOf(phi, j);
    return headPoint(phi, t, off(t, false));
  }, crown ? new THREE.Vector3(0, 1, 0) : undefined);
  b.grid(nPhi, nT, full, true, (i, j) => {
    const phi = phiOf(i), t = tOf(phi, j);
    return headPoint(phi, t, off(t, true));
  }, crown ? new THREE.Vector3(0, -1, 0) : undefined);
  b.grid(nPhi, 1, full, false, (i, j) => {
    const phi = phiOf(i), t = tOf(phi, 0);
    return headPoint(phi, t, off(t, j === 0));
  });
  if (L.hi)
    b.grid(nPhi, 1, full, true, (i, j) => {
      const phi = phiOf(i), t = tOf(phi, nT);
      return headPoint(phi, t, off(t, j === 0));
    });
  if (!full) {
    b.grid(nT, 1, false, false, (i, j) => {
      const t = tOf(pb, i);
      return headPoint(pb, t, off(t, j === 0));
    });
    b.grid(nT, 1, false, true, (i, j) => {
      const t = tOf(pa, i);
      return headPoint(pa, t, off(t, j === 0));
    });
  }
}

/** Hairline that stays above the brows at the front and drops towards the nape. */
function hairline(front: number, side: number, back: number, fringe = 0) {
  return (phi: number) => {
    const a = Math.abs(phi);
    const t = a < TOP ? front + (side - front) * smooth(0.45, TOP, a) : side + (back - side) * smooth(TOP, Math.PI, a);
    return t + fringe * Math.abs(Math.sin(phi * 7)) * (1 - smooth(0.7, 1.2, a));
  };
}

/** Point on the centre line, from the forehead (a = 0) over the crown to the back (a = 1). */
function midline(a: number, front: number, back: number, o: number, out: THREE.Vector3, normal: THREE.Vector3) {
  const up = TOP - front, down = TOP - back, s = a * (up + down);
  const [phi, t] = s <= up ? [0, front + s] : [Math.PI, TOP - (s - up)];
  headPoint(phi, t, o, out);
  headNormal(phi, t, o, normal);
}

/** Places an object on the head surface, its local +y along the surface normal. */
function stand(obj: THREE.Object3D, phi: number, t: number, o: number, lean = 0) {
  headPoint(phi, t, o, obj.position);
  const n = headNormal(phi, t, o, _a);
  // Lean backwards (towards +z) so spikes and crests sweep instead of standing bolt upright.
  n.z += lean;
  obj.quaternion.setFromUnitVectors(Y, n.normalize());
}

/** Places a face feature flush with the skin, facing outwards. */
function onFace(obj: THREE.Object3D, phi: number, t: number, o: number) {
  headPoint(phi, t, o, obj.position);
  obj.rotation.set(t * 0.8, -phi, 0, 'YXZ');
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
  /** Glossy see-through team colour for the visor. */
  glass: THREE.Material;
}

interface HairStyle {
  /** Outer offset of the hair at elevation t, so headgear can sit just outside it. */
  outer: (t: number) => number;
  /** Tall pieces on top that a hat or headphones would cut through. */
  top: THREE.Object3D[];
}

/** Builds the head, face, hair and headgear into `head`. Geometries are reported through `track`. */
export function buildHead(head: THREE.Object3D, hairId: string, gearId: string, m: HeadParts, detail: number, track: (g: THREE.BufferGeometry) => void) {
  const seg = (lo: number, hi: number) => Math.round(lo + ((hi - lo) * detail) / 2);
  const nPhi = seg(18, 40), nT = seg(6, 14);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    track(geo);
    const me = new THREE.Mesh(geo, mat);
    me.castShadow = true;
    return me;
  };
  const shellMesh = (layers: Layer[], mat: THREE.Material) => {
    const b = new Builder();
    for (const L of layers) layer(b, L, nPhi, nT);
    return mesh(b.geometry(), mat);
  };

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
  const mark = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), m.team);
  onFace(mark, 0.62, -0.32, 0.002);
  head.add(mark);

  const hair = buildHair(hairId, m, nPhi, nT, mesh, shellMesh);
  head.add(...hair.group.children.slice());
  const covers = gearId === 'cap' || gearId === 'beanie' || gearId === 'phones';
  if (covers) for (const o of hair.style.top) o.removeFromParent();
  buildGear(head, gearId, hair.style, m, mesh, shellMesh, seg);
}

type MeshFn = (geo: THREE.BufferGeometry, mat: THREE.Material) => THREE.Mesh;
type ShellFn = (layers: Layer[], mat: THREE.Material) => THREE.Mesh;

function buildHair(id: string, m: HeadParts, nPhi: number, nT: number, mesh: MeshFn, shell: ShellFn): { group: THREE.Group; style: HairStyle } {
  const group = new THREE.Group();
  const top: THREE.Object3D[] = [];
  const short = 0.016;

  if (id === 'bob') {
    // Chin-length all round, open at the face, flaring out at the ends, with a scalloped fringe.
    const flare = (t: number) => (t < 0.1 ? (0.1 - t) * 0.06 : 0);
    const lo = (phi: number) => {
      const a = Math.abs(phi);
      return 0.46 + (-0.56 - 0.46) * smooth(0.8, 1.15, a) + (-0.62 + 0.56) * smooth(TOP, Math.PI, a);
    };
    group.add(shell([{ o: 0.03, th: 0.014, lo, flare }], m.hair));
    group.add(shell([{ o: 0.038, th: 0.01, lo: (phi) => 0.45 + 0.04 * Math.abs(Math.sin(phi * 7)), hi: () => 0.8, arc: [-0.9, 0.9] }], m.hair));
    return { group, style: { outer: (t) => 0.04 + flare(t), top } };
  }

  // Every other style starts from a close crop with a short fringe.
  group.add(shell([{ o: short, th: 0.012, lo: hairline(0.52, 0.06, -0.32, 0.03) }], m.hair));

  const b = new THREE.Vector3(), n = new THREE.Vector3();
  if (id === 'fin') {
    // A swept crest along the centre line, rooted in the hair and curling back past the crown.
    const K = 14, pts: { base: THREE.Vector3; tip: THREE.Vector3; w: number }[] = [];
    for (let k = 0; k <= K; k++) {
      const a = 0.04 + (0.84 * k) / K;
      midline(a, 0.55, 0.15, short - 0.01, b, n);
      const h = 0.025 + 0.1 * smooth(0, 0.7, a) - 0.05 * smooth(0.75, 1, a);
      const tip = b.clone().addScaledVector(n, h).add(new THREE.Vector3(0, 0, 0.06 * a * a));
      pts.push({ base: b.clone(), tip, w: 0.014 + 0.016 * Math.sin(Math.PI * Math.min(1, a * 1.2)) });
    }
    const side = (sx: number) => (i: number, j: number) => {
      const p = pts[i];
      return (j === 0 ? p.base : p.tip).clone().setX(sx * p.w * (j === 0 ? 1 : 0.55));
    };
    const B = new Builder();
    B.grid(K, 1, false, false, side(1));
    B.grid(K, 1, false, true, side(-1));
    B.grid(K, 1, false, true, (i, j) => pts[i].tip.clone().setX((j === 0 ? -1 : 1) * pts[i].w * 0.55));
    B.grid(1, 1, false, false, (i, j) => (j === 0 ? pts[0].base : pts[0].tip).clone().setX((i === 0 ? -1 : 1) * pts[0].w * (j === 0 ? 1 : 0.55)));
    B.grid(1, 1, false, true, (i, j) => (j === 0 ? pts[K].base : pts[K].tip).clone().setX((i === 0 ? -1 : 1) * pts[K].w * (j === 0 ? 1 : 0.55)));
    const crest = mesh(B.geometry(), m.hair);
    group.add(crest);
    top.push(crest);
  } else if (id === 'spikes') {
    const spots: [number, number, number][] = [
      [0, 0.86, 0.17], [-0.75, 0.95, 0.15], [0.75, 0.95, 0.15], [-1.7, 0.8, 0.14], [1.7, 0.8, 0.14],
      [-2.5, 0.75, 0.13], [2.5, 0.75, 0.13], [Math.PI, 0.9, 0.16], [0, 1.35, 0.15],
    ];
    for (const [phi, t, h] of spots) {
      const cone = mesh(new THREE.ConeGeometry(0.055, h, 7).translate(0, h / 2, 0), m.hair);
      stand(cone, phi, t, short - 0.012, 0.35);
      group.add(cone);
      top.push(cone);
    }
  } else if (id === 'mohawk') {
    // Overlapping tapered blades, so it reads as one ridge from every side.
    const K = 8;
    for (let k = 0; k < K; k++) {
      const a = 0.08 + (0.78 * k) / (K - 1);
      midline(a, 0.55, 0.2, short - 0.012, b, n);
      const h = 0.07 + 0.05 * Math.sin(Math.PI * a);
      const blade = mesh(new THREE.CylinderGeometry(0.008, 0.034, h, 4, 1).rotateY(Math.PI / 4).scale(0.8, 1, 1.7).translate(0, h / 2, 0), m.hair);
      blade.position.copy(b);
      blade.quaternion.setFromUnitVectors(Y, n);
      group.add(blade);
      top.push(blade);
    }
  } else if (id === 'tails') {
    // Two drop-shaped tails hanging from the back, each with a tie.
    for (const sx of [-1, 1]) {
      const drop = new THREE.LatheGeometry(
        ([[0.001, 0], [0.055, 0.05], [0.075, 0.14], [0.055, 0.24], [0.001, 0.3]] as const).map(([x, y]) => new THREE.Vector2(x, y)),
        12,
      ).translate(0, -0.3, 0);
      const tail = mesh(drop, m.hair);
      const at = headPoint(sx * 2.35, -0.05, short - 0.01);
      const dir = headNormal(sx * 2.35, -0.05, short).multiplyScalar(0.5).add(new THREE.Vector3(0, -1, 0.15)).normalize();
      tail.position.copy(at);
      tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      group.add(tail);
      const tie = mesh(new THREE.TorusGeometry(0.03, 0.012, 5, 10).rotateX(Math.PI / 2).translate(0, -0.035, 0), m.accent);
      tie.position.copy(at);
      tie.quaternion.copy(tail.quaternion);
      group.add(tie);
    }
  }
  return { group, style: { outer: () => short, top } };
}

function buildGear(head: THREE.Object3D, id: string, hair: HairStyle, m: HeadParts, mesh: MeshFn, shell: ShellFn, seg: (lo: number, hi: number) => number) {
  switch (id) {
    case 'cap': {
      // Crown tilted like a real cap (higher at the forehead, lower at the back) with a curved brim.
      const o = hair.outer(0.3) + 0.016;
      const band = (phi: number) => 0.44 + (0.1 - 0.44) * (1 - Math.cos(phi)) * 0.5;
      head.add(shell([{ o, th: 0.014, lo: band }], m.accent));
      const n = seg(10, 20), w = 0.85, B = new Builder();
      const brim = (i: number, j: number, dy: number) => {
        const phi = -w + (2 * w * i) / n;
        const p = headPoint(phi, band(phi), o - 0.01);
        const len = 0.012 + 0.14 * Math.cos((phi / w) * (Math.PI / 2)) * j;
        const out = new THREE.Vector3(p.x, 0, p.z).normalize();
        return p.addScaledVector(out, len).add(new THREE.Vector3(0, dy - len * 0.22, 0));
      };
      B.grid(n, 1, false, true, (i, j) => brim(i, j, 0.006));
      B.grid(n, 1, false, false, (i, j) => brim(i, j, -0.006));
      B.grid(n, 1, false, false, (i, j) => brim(i, 1, j === 0 ? -0.006 : 0.006));
      head.add(mesh(B.geometry(), m.teamFlat));
      const button = mesh(new THREE.SphereGeometry(0.022, 8, 6), m.teamFlat);
      button.position.set(0, headAt(TOP, o)[1], 0);
      head.add(button);
      break;
    }
    case 'beanie': {
      const o = hair.outer(0.2) + 0.02;
      const band = (phi: number) => 0.46 + (0.02 - 0.46) * (1 - Math.cos(phi)) * 0.5;
      const slouch = (t: number) => 0.03 * Math.max(0, Math.sin(t)) ** 2;
      head.add(shell([{ o, th: 0.016, lo: band, flare: slouch }], m.accent));
      head.add(shell([{ o: o + 0.014, th: 0.02, lo: band, hi: (phi) => band(phi) + 0.2 }], m.accent));
      const pom = mesh(new THREE.IcosahedronGeometry(0.06, 1), m.teamFlat);
      pom.position.set(0, headAt(TOP, o + slouch(TOP))[1] + 0.045, 0);
      head.add(pom);
      break;
    }
    case 'phones': {
      // Band over the top of the hair, cups outside it at ear height.
      const o = hair.outer(0.8) + 0.024;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const s = k / 16;
        const t = 0.15 + (TOP - 0.15) * (1 - Math.abs(1 - 2 * s));
        pts.push(headPoint(s < 0.5 ? -TOP : TOP, t, o));
      }
      head.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg(16, 32), 0.017, 6), m.dark));
      for (const sx of [-1, 1]) {
        const x = sx * (headAt(0.05, hair.outer(0.05))[0] + 0.03);
        const y = headAt(0.05)[1];
        const cushion = mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.034, seg(10, 18)).rotateZ(Math.PI / 2), m.dark);
        cushion.position.set(x - sx * 0.008, y, 0);
        const cup = mesh(new THREE.CylinderGeometry(0.076, 0.07, 0.034, seg(10, 18)).rotateZ(Math.PI / 2), m.teamFlat);
        cup.position.set(x + sx * 0.022, y, 0);
        head.add(cushion, cup);
      }
      break;
    }
    case 'visor': {
      // A tinted wrap-around shade over the eyes, held by a strap round the back.
      head.add(shell([{ o: 0.036, th: 0.006, lo: () => -0.34, hi: () => 0.27, arc: [-1.3, 1.3] }], m.glass));
      const strap = hair.outer(0.03) + 0.01;
      head.add(shell([{ o: strap, th: 0.008, lo: () => -0.02, hi: () => 0.08, arc: [1.25, 2 * Math.PI - 1.25] }], m.dark));
      for (const sx of [-1, 1]) {
        const hinge = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), m.dark);
        onFace(hinge, sx * 1.27, -0.03, 0.036);
        hinge.rotateY(sx * 0.2);
        head.add(hinge);
      }
      break;
    }
    case 'halo': {
      // Float clear of whatever hair is underneath, measured in head space.
      const box = new THREE.Box3();
      for (const c of head.children)
        if (c instanceof THREE.Mesh) {
          c.updateMatrix();
          c.geometry.computeBoundingBox();
          box.union(c.geometry.boundingBox!.clone().applyMatrix4(c.matrix));
        }
      const ring = mesh(new THREE.TorusGeometry(0.17, 0.016, 6, seg(20, 36)).rotateX(Math.PI / 2), m.team);
      ring.position.set(0, box.max.y + 0.07, 0.02);
      ring.rotation.x = 0.12;
      head.add(ring);
      break;
    }
  }
}
