import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bevelEdges, boxMesh, meshEdges, polyBuffers, type PolyMesh } from '@chromashift/shared';

/*
 * The modelling kit the game's own assets are built with. Instead of stacking boxes and cylinders,
 * a model is made the way a low-poly artist would: side silhouettes cut out and given thickness
 * with chamfered edges, turned profiles for barrels and tanks, tubes bent along paths, lofted
 * shells. Parts are collected by material and merged, so a finished model is a handful of meshes.
 */

type P2 = [number, number];

/** Gives a geometry the three attributes every part needs, unindexed, so parts can be merged. */
function plain(g: THREE.BufferGeometry) {
  const out = g.index ? g.toNonIndexed() : g;
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((out.attributes.position.count * 2) | 0), 2));
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  if (out !== g) g.dispose();
  return out;
}

/**
 * A side silhouette given thickness: the outline is in the (z, y) plane (z runs along the model,
 * y is up), `width` is the thickness across x, and every edge gets a chamfer of `bevel`.
 * `holes` are cut right through.
 */
export function slab(outline: P2[], width: number, bevel = 0, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const b = Math.min(bevel, width / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, width - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, steps: 1, curveSegments: 6 });
  g.translate(0, 0, -(width - 2 * b) / 2);
  // Shape x → model z, thickness → model x.
  g.rotateY(-Math.PI / 2);
  return plain(g);
}

/** A flat plate lying in the (x, z) plane with a chamfered outline: floors, wings, roofs. */
export function plate(outline: P2[], thickness: number, bevel = 0): THREE.BufferGeometry {
  const g = slab(outline.map(([x, z]) => [x, z] as P2), thickness, bevel);
  // slab puts the outline in (z, y) with thickness on x: turn it so the outline is (x, z), thickness y.
  g.rotateZ(Math.PI / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/**
 * A turned shape: `profile` is a list of [radius, z] pairs revolved round the z axis (use it for
 * barrels, nozzles, tanks, wheels). Sharp steps in the profile stay crisp.
 */
export function turned(profile: P2[], seg = 12, crisp = true): THREE.BufferGeometry {
  // The surface must face away from the axis: that is the profile running anticlockwise in (r, z)
  // once closed along the axis. Profiles written the other way round are simply reversed.
  const loop: P2[] = [...profile, [0, profile[profile.length - 1][1]], [0, profile[0][1]]];
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const [r0, z0] = loop[i], [r1, z1] = loop[(i + 1) % loop.length];
    area += r0 * z1 - r1 * z0;
  }
  const pts = (area < 0 ? [...profile].reverse() : profile).map(([r, z]) => new THREE.Vector2(Math.max(0, r), z));
  let g: THREE.BufferGeometry = new THREE.LatheGeometry(pts, seg);
  // Lathe turns round y: lay it along z (profile "z" grows towards +z).
  g.rotateX(Math.PI / 2);
  g = plain(g);
  if (crisp) g = facet(g, 50);
  return g;
}

/** A round tube bent through the given points (in model space). */
export function tube(points: [number, number, number][], radius: number, seg = 6, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.35);
  const g = new THREE.TubeGeometry(curve, Math.max(4, points.length * 4), radius, seg, closed);
  return plain(g);
}

const boxCache = new Map<string, PolyMesh>();
/** A box with real chamfered edges (not a texture trick): `r` is the chamfer width. */
export function chamferBox(w: number, h: number, d: number, r = 0): THREE.BufferGeometry {
  const c = Math.min(r, Math.min(w, h, d) * 0.45);
  if (c <= 1e-5) return plain(new THREE.BoxGeometry(w, h, d));
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${c.toFixed(4)}`;
  let m = boxCache.get(key);
  if (!m) {
    const box = boxMesh(w, h, d);
    m = bevelEdges(box, meshEdges(box).map((e) => [e.a, e.b] as [number, number]), c);
    if (boxCache.size < 400) boxCache.set(key, m);
  }
  return polyGeometry(m, 0);
}

/** Draws a polygon mesh from the shared modelling code as a geometry (uvs from box projection). */
export function polyGeometry(m: PolyMesh, smooth = 30): THREE.BufferGeometry {
  const b = polyBuffers(m, smooth);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((b.positions.length / 3) * 2), 2));
  return boxUV(g, 1);
}

/**
 * Lofts a skin through cross-sections. Each section is a closed ring of points (all the same
 * length); `caps` closes the two ends. Rings must run anticlockwise seen from the end (+axis).
 */
export function loft(sections: [number, number, number][][], caps = true): THREE.BufferGeometry {
  const n = sections[0].length;
  const pos: number[] = [], idx: number[] = [];
  for (const s of sections) for (const p of s) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i + 1 < sections.length; i++)
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n), c = a + n, d = b + n;
      idx.push(a, b, c, b, d, c);
    }
  if (caps)
    for (const [i, flip] of [[0, true], [sections.length - 1, false]] as const) {
      const c = pos.length / 3;
      const s = sections[i];
      const mid = s.reduce((m, p) => [m[0] + p[0] / n, m[1] + p[1] / n, m[2] + p[2] / n], [0, 0, 0]);
      pos.push(mid[0], mid[1], mid[2]);
      for (let j = 0; j < n; j++) {
        const a = i * n + j, b = i * n + ((j + 1) % n);
        if (flip) idx.push(c, b, a);
        else idx.push(c, a, b);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return plain(g);
}

/** Recomputes normals so that edges sharper than `angle` degrees are crisp and the rest smooth. */
export function facet(g: THREE.BufferGeometry, angle = 35): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.attributes.position;
  const n = pos.count;
  const face = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    ab.cross(ac);
    // Area-weighted: degenerate slivers contribute nothing.
    for (let k = 0; k < 3; k++) {
      face[(i + k) * 3] = ab.x;
      face[(i + k) * 3 + 1] = ab.y;
      face[(i + k) * 3 + 2] = ab.z;
    }
  }
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 4096)},${Math.round(pos.getY(i) * 4096)},${Math.round(pos.getZ(i) * 4096)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i);
  }
  const out = new Float32Array(n * 3);
  const limit = Math.cos((angle * Math.PI) / 180);
  const fi = new THREE.Vector3(), fj = new THREE.Vector3(), sum = new THREE.Vector3();
  for (const list of buckets.values())
    for (const i of list) {
      fi.set(face[i * 3], face[i * 3 + 1], face[i * 3 + 2]);
      const li = fi.length();
      sum.set(0, 0, 0);
      for (const j of list) {
        fj.set(face[j * 3], face[j * 3 + 1], face[j * 3 + 2]);
        const lj = fj.length();
        if (li < 1e-12 || lj < 1e-12 || fi.dot(fj) / (li * lj) >= limit) sum.add(fj);
      }
      sum.normalize();
      out[i * 3] = sum.x;
      out[i * 3 + 1] = sum.y;
      out[i * 3 + 2] = sum.z;
    }
  src.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  if (src !== g) g.dispose();
  return src;
}

/** UVs by box projection: each face is mapped along the axis it faces most. `scale` is repeats per unit. */
export function boxUV(g: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ax >= ay && ax >= az) {
      uv[i * 2] = z * scale;
      uv[i * 2 + 1] = y * scale;
    } else if (ay >= az) {
      uv[i * 2] = x * scale;
      uv[i * 2 + 1] = z * scale;
    } else {
      uv[i * 2] = x * scale;
      uv[i * 2 + 1] = y * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Moves, turns (radians) and scales a geometry in place and returns it. */
export function at(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): THREE.BufferGeometry {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc));
  return g;
}

/** Pushes vertices about by smooth noise, for rocks, bark and anything that shouldn't look machined. */
export function roughen(g: THREE.BufferGeometry, amount: number, scale = 1, seed = 1): THREE.BufferGeometry {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise3(x * scale + seed * 17.1, y * scale + seed * 3.7, z * scale - seed * 9.3) - 0.5;
    const l = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x + (x / l) * n * amount, y + (y / l) * n * amount * 0.8, z + (z / l) * n * amount);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

const hash3 = (x: number, y: number, z: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise in 0 … 1. The same in every place it is asked for, so shared corners stay shared. */
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), sx), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), sx), sy),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), sx), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), sx), sy),
    sz,
  );
}

/** A number from a string, the same every time: picks a weapon's or a prop's variations. */
export function seedOfText(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A repeatable random number source. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Collects parts by material name; `meshes` merges each material's parts into one geometry.
 * Geometries handed to `add` belong to the builder afterwards.
 */
export class Parts {
  private buckets = new Map<string, THREE.BufferGeometry[]>();

  add(mat: string, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1) {
    const p = plain(g);
    if (x || y || z || rx || ry || rz || s !== 1) at(p, x, y, z, rx, ry, rz, s);
    (this.buckets.get(mat) ?? this.buckets.set(mat, []).get(mat)!).push(p);
    return this;
  }

  /** Adds a part and its mirror image across x = 0 (the mirror is re-wound so it still faces out). */
  both(mat: string, make: () => THREE.BufferGeometry, x: number, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.add(mat, make(), x, y, z, rx, ry, rz);
    const m = plain(make());
    at(m, x, y, z, rx, ry, rz);
    mirror(m);
    (this.buckets.get(mat) ?? this.buckets.set(mat, []).get(mat)!).push(m);
    return this;
  }

  /** One merged geometry per material. */
  merged(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [mat, list] of this.buckets) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) continue;
      if (list.length > 1) for (const x of list) x.dispose();
      g.computeBoundingSphere();
      out.set(mat, g);
    }
    this.buckets.clear();
    return out;
  }
}

/** Flips a geometry across x = 0, keeping its faces pointing outwards. */
export function mirror(g: THREE.BufferGeometry) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    nor.setX(i, -nor.getX(i));
  }
  // Swap two corners of every triangle.
  for (let i = 0; i + 2 < pos.count; i += 3)
    for (const attr of [pos, nor, uv]) {
      if (!attr) continue;
      for (let k = 0; k < attr.itemSize; k++) {
        const a = attr.array[(i + 1) * attr.itemSize + k];
        attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k];
        attr.array[(i + 2) * attr.itemSize + k] = a;
      }
    }
  pos.needsUpdate = nor.needsUpdate = true;
  return g;
}

/** Triangle count of a geometry (for budgets and the inspector). */
export const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
