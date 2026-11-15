/*
 * An editable polygon mesh: shared vertices and faces of any number of sides, each face with a
 * material slot. This is what vertex / edge / face editing works on; the operations here are the
 * modelling tools (extrude, inset, bevel, subdivide, loop cut, merge, mirror). All of them return
 * a new mesh, so undo is just keeping the old one.
 */

export interface PolyFace {
  /** Vertex indices, anticlockwise seen from outside. */
  v: number[];
  /** Material slot. */
  m: number;
}

export interface PolyMesh {
  /** x, y, z per vertex. */
  verts: number[];
  faces: PolyFace[];
}

type V3 = [number, number, number];

export const vert = (m: PolyMesh, i: number): V3 => [m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export const cloneMesh = (m: PolyMesh): PolyMesh => ({ verts: m.verts.slice(), faces: m.faces.map((f) => ({ v: f.v.slice(), m: f.m })) });

/** Face normal by Newell's method (works for any polygon, even slightly bent ones). */
export function faceNormal(m: PolyMesh, f: PolyFace): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < f.v.length; i++) {
    const a = vert(m, f.v[i]), b = vert(m, f.v[(i + 1) % f.v.length]);
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([x, y, z]);
}

export function faceCentre(m: PolyMesh, f: PolyFace): V3 {
  let c: V3 = [0, 0, 0];
  for (const i of f.v) c = add(c, vert(m, i));
  return mul(c, 1 / f.v.length);
}

export interface PolyEdge {
  a: number;
  b: number;
  /** Faces that use this edge. */
  faces: number[];
}

/** Every edge once, with the faces on it. */
export function meshEdges(m: PolyMesh): PolyEdge[] {
  const map = new Map<string, PolyEdge>();
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i], b = f.v[(i + 1) % f.v.length];
      const k = ek(a, b);
      let e = map.get(k);
      if (!e) map.set(k, (e = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }));
      e.faces.push(fi);
    }
  });
  return [...map.values()];
}

/* ---------- Primitives ---------- */

export function boxMesh(w = 1, h = 1, d = 1): PolyMesh {
  const x = w / 2, y = h / 2, z = d / 2;
  return {
    verts: [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z],
    faces: [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]].map((v) => ({ v, m: 0 })),
  };
}

/** A prism or cone frustum around the y axis; r1 = 0 makes a cone. */
export function cylinderMesh(r0 = 0.5, r1 = 0.5, h = 1, seg = 12): PolyMesh {
  const verts: number[] = [], faces: PolyFace[] = [];
  const top = r1 > 1e-6;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    verts.push(Math.cos(a) * r0, -h / 2, Math.sin(a) * r0);
  }
  if (top)
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      verts.push(Math.cos(a) * r1, h / 2, Math.sin(a) * r1);
    }
  else verts.push(0, h / 2, 0);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    if (top) faces.push({ v: [i, seg + i, seg + j, j], m: 0 });
    else faces.push({ v: [i, seg, j], m: 0 });
  }
  faces.push({ v: Array.from({ length: seg }, (_, i) => i), m: 0 });
  if (top) faces.push({ v: Array.from({ length: seg }, (_, i) => seg + seg - 1 - i), m: 0 });
  return { verts, faces };
}

export function sphereMesh(r = 0.5, seg = 12, rings = 8): PolyMesh {
  const verts: number[] = [0, -r, 0], faces: PolyFace[] = [];
  for (let j = 1; j < rings; j++) {
    const p = -Math.PI / 2 + (j / rings) * Math.PI;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      verts.push(Math.cos(a) * Math.cos(p) * r, Math.sin(p) * r, Math.sin(a) * Math.cos(p) * r);
    }
  }
  verts.push(0, r, 0);
  const topI = verts.length / 3 - 1;
  const at = (j: number, i: number) => 1 + (j - 1) * seg + (i % seg);
  for (let i = 0; i < seg; i++) {
    faces.push({ v: [0, at(1, i), at(1, i + 1)], m: 0 });
    for (let j = 1; j < rings - 1; j++) faces.push({ v: [at(j, i), at(j + 1, i), at(j + 1, i + 1), at(j, i + 1)], m: 0 });
    faces.push({ v: [at(rings - 1, i), topI, at(rings - 1, i + 1)], m: 0 });
  }
  return { verts, faces };
}

/** A ramp: a box with the top front edge pulled down to the base. */
export function wedgeMesh(w = 1, h = 1, d = 1): PolyMesh {
  const x = w / 2, y = h / 2, z = d / 2;
  return {
    verts: [-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, -x, y, -z, x, y, -z],
    faces: [{ v: [0, 1, 2, 3], m: 0 }, { v: [1, 0, 4, 5], m: 0 }, { v: [3, 2, 5, 4], m: 0 }, { v: [0, 3, 4], m: 0 }, { v: [2, 1, 5], m: 0 }],
  };
}

/* ---------- Editing ---------- */

export function translateVerts(m: PolyMesh, ids: Iterable<number>, d: V3): PolyMesh {
  const out = cloneMesh(m);
  for (const i of ids) {
    out.verts[i * 3] += d[0];
    out.verts[i * 3 + 1] += d[1];
    out.verts[i * 3 + 2] += d[2];
  }
  return out;
}

/** Applies a 3×4 matrix (row-major: x' = m0 x + m1 y + m2 z + m3 …) to some vertices. */
export function transformVerts(m: PolyMesh, ids: Iterable<number>, t: number[]): PolyMesh {
  const out = cloneMesh(m);
  for (const i of ids) {
    const x = m.verts[i * 3], y = m.verts[i * 3 + 1], z = m.verts[i * 3 + 2];
    out.verts[i * 3] = t[0] * x + t[1] * y + t[2] * z + t[3];
    out.verts[i * 3 + 1] = t[4] * x + t[5] * y + t[6] * z + t[7];
    out.verts[i * 3 + 2] = t[8] * x + t[9] * y + t[10] * z + t[11];
  }
  return out;
}

/** Drops unused vertices and faces with fewer than three distinct corners. */
export function tidy(m: PolyMesh): PolyMesh {
  const faces: PolyFace[] = [];
  for (const f of m.faces) {
    const v = f.v.filter((x, i) => x !== f.v[(i + 1) % f.v.length]);
    if (new Set(v).size >= 3) faces.push({ v, m: f.m });
  }
  const used = new Map<number, number>();
  const verts: number[] = [];
  for (const f of faces)
    f.v = f.v.map((i) => {
      let n = used.get(i);
      if (n === undefined) {
        n = verts.length / 3;
        used.set(i, n);
        verts.push(m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]);
      }
      return n;
    });
  return { verts, faces };
}

/**
 * Extrudes a set of faces as one region: the faces move out by `dist` along their average normal
 * (or by `offset`), and walls are built along the region's outline. Returns the new mesh; the same
 * face indices are the moved faces.
 */
export function extrudeFaces(m: PolyMesh, sel: number[], dist: number, offset?: V3): PolyMesh {
  const out = cloneMesh(m);
  const chosen = new Set(sel.filter((i) => i >= 0 && i < m.faces.length));
  if (!chosen.size) return out;
  let n: V3 = [0, 0, 0];
  for (const fi of chosen) n = add(n, faceNormal(m, m.faces[fi]));
  const move = offset ?? mul(norm(n), dist);
  // Outline: edges used by exactly one chosen face, in that face's direction.
  const count = new Map<string, number>();
  for (const fi of chosen) {
    const f = m.faces[fi];
    for (let i = 0; i < f.v.length; i++) {
      const k = ek(f.v[i], f.v[(i + 1) % f.v.length]);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const dup = new Map<number, number>();
  const copy = (i: number) => {
    let j = dup.get(i);
    if (j === undefined) {
      j = out.verts.length / 3;
      dup.set(i, j);
      const p = add(vert(m, i), move);
      out.verts.push(p[0], p[1], p[2]);
    }
    return j;
  };
  for (const fi of chosen) {
    const f = m.faces[fi];
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i], b = f.v[(i + 1) % f.v.length];
      if (count.get(ek(a, b)) === 1) out.faces.push({ v: [a, b, copy(b), copy(a)], m: f.m });
    }
    out.faces[fi] = { v: f.v.map(copy), m: f.m };
  }
  return out;
}

/** Insets each chosen face on its own: a smaller copy inside, joined to the old outline by a rim. */
export function insetFaces(m: PolyMesh, sel: number[], amount: number): PolyMesh {
  const out = cloneMesh(m);
  for (const fi of new Set(sel)) {
    const f = m.faces[fi];
    if (!f) continue;
    const nrm = faceNormal(m, f), k = f.v.length;
    const inner: number[] = [];
    for (let i = 0; i < k; i++) {
      const p = vert(m, f.v[i]), prev = vert(m, f.v[(i + k - 1) % k]), next = vert(m, f.v[(i + 1) % k]);
      // Inward directions of the two edges at this corner; their sum, scaled, keeps the rim even.
      const e1 = norm(cross(nrm, norm(sub(p, prev)))), e2 = norm(cross(nrm, norm(sub(next, p))));
      const bis = add(e1, e2), s = 1 + dot(e1, e2);
      const q = add(p, mul(bis, amount / Math.max(0.2, s)));
      inner.push(out.verts.length / 3);
      out.verts.push(q[0], q[1], q[2]);
    }
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      out.faces.push({ v: [f.v[i], f.v[j], inner[j], inner[i]], m: f.m });
    }
    out.faces[fi] = { v: inner, m: f.m };
  }
  return out;
}

/**
 * Bevels edges: each chosen edge becomes a flat strip, with the corners at its ends sliding along
 * the neighbouring edges (and a small cap where three or more strips or edges meet). Edges on an
 * open border, or shared by more than two faces, are left alone.
 */
export function bevelEdges(m: PolyMesh, edges: [number, number][], amount: number): PolyMesh {
  const edgeFaces = new Map<string, number[]>();
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.v.length; i++) {
      const k = ek(f.v[i], f.v[(i + 1) % f.v.length]);
      (edgeFaces.get(k) ?? edgeFaces.set(k, []).get(k)!).push(fi);
    }
  });
  const bev = new Set<string>();
  for (const [a, b] of edges) {
    const k = ek(a, b);
    if (edgeFaces.get(k)?.length === 2) bev.add(k);
  }
  if (!bev.size) return cloneMesh(m);
  const touched = new Set<number>();
  for (const k of bev) k.split('_').forEach((s) => touched.add(Number(s)));
  // A vertex can only be bevelled if every edge at it has two faces (a closed fan).
  const ok = new Set<number>();
  for (const a of touched) {
    let closed = true;
    for (const [k, fs] of edgeFaces) {
      const [p, q] = k.split('_').map(Number);
      if ((p === a || q === a) && fs.length !== 2) closed = false;
    }
    if (closed) ok.add(a);
  }
  for (const k of [...bev]) {
    const [p, q] = k.split('_').map(Number);
    if (!ok.has(p) || !ok.has(q)) bev.delete(k);
  }
  if (!bev.size) return cloneMesh(m);

  const out: PolyMesh = { verts: m.verts.slice(), faces: [] };
  const push = (p: V3) => {
    out.verts.push(p[0], p[1], p[2]);
    return out.verts.length / 3 - 1;
  };
  // A point on an unbevelled edge next to a bevelled one, slid away from the vertex.
  const slid = new Map<string, number>();
  const slide = (a: number, other: number) => {
    const k = `${a}>${other}`;
    let i = slid.get(k);
    if (i === undefined) {
      const pa = vert(m, a), d = sub(vert(m, other), pa), l = len(d);
      i = push(add(pa, mul(d, Math.min(0.45, amount / Math.max(l, 1e-9)))));
      slid.set(k, i);
    }
    return i;
  };
  const isBev = (a: number, b: number) => bev.has(ek(a, b));
  /** Edges at `a`, in order round it, so "next to a bevelled edge" can be told. */
  const neighbourBevelled = (a: number, other: number) => {
    for (const fi of edgeFaces.get(ek(a, other)) ?? []) {
      const f = m.faces[fi], i = f.v.indexOf(a), k = f.v.length;
      const prev = f.v[(i + k - 1) % k], next = f.v[(i + 1) % k];
      const third = prev === other ? next : prev;
      if (isBev(a, third)) return true;
    }
    return false;
  };
  /** The point for an unbevelled edge end: slid if a bevel is next to it, else the vertex itself. */
  const edgePoint = (a: number, other: number) => (neighbourBevelled(a, other) ? slide(a, other) : a);

  // Corner replacement per face corner: one or two vertex indices (in face order).
  const corner = new Map<string, number[]>();
  m.faces.forEach((f, fi) => {
    const k = f.v.length;
    for (let i = 0; i < k; i++) {
      const a = f.v[i];
      if (!touched.has(a) || ![...bev].some((key) => key.split('_').map(Number).includes(a))) continue;
      const prev = f.v[(i + k - 1) % k], next = f.v[(i + 1) % k];
      const bp = isBev(a, prev), bn = isBev(a, next);
      let list: number[];
      if (bp && bn) {
        const pa = vert(m, a), u = norm(sub(vert(m, prev), pa)), w = norm(sub(vert(m, next), pa));
        const s = Math.max(0.3, len(cross(u, w)));
        list = [push(add(pa, mul(add(u, w), amount / s)))];
      } else if (bp) list = [edgePoint(a, next)];
      else if (bn) list = [edgePoint(a, prev)];
      else {
        const x = edgePoint(a, prev), y = edgePoint(a, next);
        list = x === y ? [x] : [x, y];
      }
      // A slid point only exists when a bevel is next to that edge; otherwise the corner stays.
      if (list.length === 1 && list[0] === a) continue;
      corner.set(`${fi}:${a}`, list);
    }
  });
  const cornerOf = (fi: number, a: number) => corner.get(`${fi}:${a}`) ?? [a];

  m.faces.forEach((f, fi) => {
    const v: number[] = [];
    for (const a of f.v) v.push(...cornerOf(fi, a));
    out.faces.push({ v, m: f.m });
  });
  // The strips.
  for (const key of bev) {
    const [fa, fb] = edgeFaces.get(key)!;
    const [p, q] = key.split('_').map(Number);
    const f1 = m.faces[fa];
    // Direction of the edge in the first face.
    const i = f1.v.indexOf(p);
    const forward = f1.v[(i + 1) % f1.v.length] === q;
    const a = forward ? p : q, b = forward ? q : p;
    // In face 1 the edge runs a → b: its corner at a ends with the point nearest the edge, at b it starts with it.
    const a1 = cornerOf(fa, a).at(-1)!, b1 = cornerOf(fa, b)[0];
    // In face 2 it runs b → a.
    const b2 = cornerOf(fb, b).at(-1)!, a2 = cornerOf(fb, a)[0];
    out.faces.push({ v: [b1, a1, a2, b2], m: f1.m });
  }
  // Caps where the points round a vertex leave a hole of three or more sides.
  for (const a of touched) {
    if (!ok.has(a)) continue;
    // Walk the fan of faces round a.
    const around = m.faces.map((f, fi) => (f.v.includes(a) ? fi : -1)).filter((fi) => fi >= 0);
    if (around.length < 3) continue;
    const order: number[] = [around[0]];
    while (order.length < around.length) {
      const f = m.faces[order.at(-1)!], i = f.v.indexOf(a);
      const prev = f.v[(i + f.v.length - 1) % f.v.length];
      const nextFace = (edgeFaces.get(ek(a, prev)) ?? []).find((x) => x !== order.at(-1));
      if (nextFace === undefined || order.includes(nextFace)) break;
      order.push(nextFace);
    }
    if (order.length !== around.length) continue;
    const ring: number[] = [];
    for (const fi of order) for (const p of [...cornerOf(fi, a)].reverse()) if (ring.at(-1) !== p && ring[0] !== p) ring.push(p);
    const uniq = ring.filter((p, i) => ring.indexOf(p) === i);
    if (uniq.length < 3 || uniq.includes(a) && uniq.length < 3) continue;
    // Skip when one face already spans all of these points (a plain cut corner).
    if (order.some((fi) => uniq.every((p) => cornerOf(fi, a).includes(p)))) continue;
    out.faces.push({ v: uniq, m: m.faces[order[0]].m });
    // Face it the way the surface faces.
    let avg: V3 = [0, 0, 0];
    for (const fi of order) avg = add(avg, faceNormal(m, m.faces[fi]));
    const cap = out.faces.at(-1)!;
    if (dot(faceNormal(out, cap), avg) < 0) cap.v.reverse();
  }
  return tidy(out);
}

/**
 * Subdivides every face (or just the chosen ones' mesh-wide, when `smooth`): each face of n sides
 * becomes n quads round its centre. With `smooth` the result is rounded (Catmull-Clark).
 */
export function subdivide(m: PolyMesh, smooth = false): PolyMesh {
  const out: PolyMesh = { verts: m.verts.slice(), faces: [] };
  const fpts = m.faces.map((f) => faceCentre(m, f));
  const edges = new Map<string, { a: number; b: number; faces: number[]; i: number }>();
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i], b = f.v[(i + 1) % f.v.length], k = ek(a, b);
      (edges.get(k) ?? edges.set(k, { a, b, faces: [], i: -1 }).get(k)!).faces.push(fi);
    }
  });
  for (const e of edges.values()) {
    let p = mul(add(vert(m, e.a), vert(m, e.b)), 0.5);
    if (smooth && e.faces.length === 2) p = mul(add(add(vert(m, e.a), vert(m, e.b)), add(fpts[e.faces[0]], fpts[e.faces[1]])), 0.25);
    e.i = out.verts.length / 3;
    out.verts.push(p[0], p[1], p[2]);
  }
  const fi0 = out.verts.length / 3;
  for (const p of fpts) out.verts.push(p[0], p[1], p[2]);
  if (smooth) {
    const n = m.verts.length / 3;
    const fsum: V3[] = Array.from({ length: n }, () => [0, 0, 0]), esum: V3[] = Array.from({ length: n }, () => [0, 0, 0]);
    const fc = new Array<number>(n).fill(0), ec = new Array<number>(n).fill(0), border = new Array<boolean>(n).fill(false);
    m.faces.forEach((f, fi) => f.v.forEach((v) => ((fsum[v] = add(fsum[v], fpts[fi])), fc[v]++)));
    for (const e of edges.values()) {
      const mid = mul(add(vert(m, e.a), vert(m, e.b)), 0.5);
      for (const v of [e.a, e.b]) {
        esum[v] = add(esum[v], mid);
        ec[v]++;
        if (e.faces.length !== 2) border[v] = true;
      }
    }
    for (let v = 0; v < n; v++) {
      if (!fc[v] || border[v]) continue;
      const k = fc[v], F = mul(fsum[v], 1 / k), R = mul(esum[v], 1 / ec[v]), P = vert(m, v);
      const q = mul(add(add(F, mul(R, 2)), mul(P, k - 3)), 1 / k);
      out.verts[v * 3] = q[0];
      out.verts[v * 3 + 1] = q[1];
      out.verts[v * 3 + 2] = q[2];
    }
  }
  m.faces.forEach((f, fi) => {
    const k = f.v.length;
    for (let i = 0; i < k; i++) {
      const a = f.v[i], prev = f.v[(i + k - 1) % k], next = f.v[(i + 1) % k];
      out.faces.push({ v: [a, edges.get(ek(a, next))!.i, fi0 + fi, edges.get(ek(prev, a))!.i], m: f.m });
    }
  });
  return out;
}

/**
 * Loop cut: starting from one edge, cuts every four-sided face across to the opposite edge,
 * following the ring until it closes or runs into a face that isn't a quad.
 */
export function loopCut(m: PolyMesh, a: number, b: number, t = 0.5): PolyMesh {
  const out = cloneMesh(m);
  const edgeFaces = new Map<string, number[]>();
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.v.length; i++) (edgeFaces.get(ek(f.v[i], f.v[(i + 1) % f.v.length])) ?? edgeFaces.set(ek(f.v[i], f.v[(i + 1) % f.v.length]), []).get(ek(f.v[i], f.v[(i + 1) % f.v.length]))!).push(fi);
  });
  const mids = new Map<string, number>();
  const mid = (p: number, q: number) => {
    const k = ek(p, q);
    let i = mids.get(k);
    if (i === undefined) {
      // Keep the cut the same distance from the same side all the way round.
      const A = vert(m, p), B = vert(m, q);
      const c = add(A, mul(sub(B, A), t));
      i = out.verts.length / 3;
      out.verts.push(c[0], c[1], c[2]);
      mids.set(k, i);
    }
    return i;
  };
  const cut = new Set<number>();
  const walk = (p: number, q: number, from: number) => {
    let ea = p, eb = q, last = from;
    for (let guard = 0; guard < m.faces.length + 2; guard++) {
      const fi = (edgeFaces.get(ek(ea, eb)) ?? []).find((x) => x !== last && !cut.has(x));
      if (fi === undefined) return;
      const f = m.faces[fi];
      if (f.v.length !== 4) return;
      const i = f.v.findIndex((v, k) => (v === ea && f.v[(k + 1) % 4] === eb) || (v === eb && f.v[(k + 1) % 4] === ea));
      const v0 = f.v[i], v1 = f.v[(i + 1) % 4], v2 = f.v[(i + 2) % 4], v3 = f.v[(i + 3) % 4];
      // v0-v1 is the entry edge; v2-v3 the opposite one. v0 pairs with v3, v1 with v2.
      const m1 = mid(v0, v1), m2 = v0 === ea ? mid(v3, v2) : mid(v2, v3);
      cut.add(fi);
      out.faces[fi] = { v: [v0, m1, m2, v3], m: f.m };
      out.faces.push({ v: [m1, v1, v2, m2], m: f.m });
      // Carry the side: the vertex paired with ea continues as the new ea.
      const na = v0 === ea ? v3 : v2, nb = v0 === ea ? v2 : v3;
      ea = na;
      eb = nb;
      last = fi;
    }
  };
  walk(a, b, -1);
  // The other way from the starting edge (for strips that don't close).
  const first = [...cut][0];
  if (first !== undefined) walk(a, b, first);
  if (!cut.size) return out;
  // Faces beside the cut that weren't split need the new point on their edge.
  out.faces.forEach((f, fi) => {
    if (cut.has(fi) || fi >= m.faces.length) return;
    const v: number[] = [];
    for (let i = 0; i < f.v.length; i++) {
      const p = f.v[i], q = f.v[(i + 1) % f.v.length];
      v.push(p);
      const x = mids.get(ek(p, q));
      if (x !== undefined) v.push(x);
    }
    f.v = v;
  });
  return out;
}

/** Joins vertices that are closer than `dist` (or all of the listed ones into their centre). */
export function mergeVerts(m: PolyMesh, ids?: number[], dist = 1e-4): PolyMesh {
  const out = cloneMesh(m);
  const remap = new Map<number, number>();
  if (ids?.length) {
    let c: V3 = [0, 0, 0];
    for (const i of ids) c = add(c, vert(m, i));
    c = mul(c, 1 / ids.length);
    const keep = ids[0];
    out.verts[keep * 3] = c[0];
    out.verts[keep * 3 + 1] = c[1];
    out.verts[keep * 3 + 2] = c[2];
    for (const i of ids) remap.set(i, keep);
  } else {
    const cellOf = new Map<string, number[]>();
    const n = m.verts.length / 3, s = Math.max(dist, 1e-9);
    for (let i = 0; i < n; i++) {
      const p = vert(m, i), key = `${Math.round(p[0] / s)},${Math.round(p[1] / s)},${Math.round(p[2] / s)}`;
      const hit = cellOf.get(key);
      if (hit) remap.set(i, hit[0]);
      else cellOf.set(key, [i]);
    }
  }
  for (const f of out.faces) f.v = f.v.map((i) => remap.get(i) ?? i);
  return tidy(out);
}

export function deleteFaces(m: PolyMesh, sel: number[]): PolyMesh {
  const gone = new Set(sel);
  return tidy({ verts: m.verts, faces: m.faces.filter((_, i) => !gone.has(i)) });
}

/** Removes vertices and every face that used them. */
export function deleteVerts(m: PolyMesh, ids: number[]): PolyMesh {
  const gone = new Set(ids);
  return tidy({ verts: m.verts, faces: m.faces.filter((f) => !f.v.some((i) => gone.has(i))) });
}

/** A new face through existing vertices (in the order given). */
export function addFace(m: PolyMesh, ids: number[], mat = 0): PolyMesh {
  const out = cloneMesh(m);
  if (new Set(ids).size >= 3) out.faces.push({ v: ids.slice(), m: mat });
  return out;
}

export function flipFaces(m: PolyMesh, sel?: number[]): PolyMesh {
  const out = cloneMesh(m);
  const which = sel ? new Set(sel) : null;
  out.faces.forEach((f, i) => {
    if (!which || which.has(i)) f.v.reverse();
  });
  return out;
}

/** Adds a mirror image across the plane x = 0 and welds the seam. */
export function mirrorX(m: PolyMesh): PolyMesh {
  const n = m.verts.length / 3;
  const out = cloneMesh(m);
  for (let i = 0; i < n; i++) out.verts.push(-m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]);
  for (const f of m.faces) out.faces.push({ v: f.v.map((i) => i + n).reverse(), m: f.m });
  return mergeVerts(out, undefined, 1e-4);
}

export function setFaceMaterial(m: PolyMesh, sel: number[], mat: number): PolyMesh {
  const out = cloneMesh(m);
  for (const i of sel) if (out.faces[i]) out.faces[i].m = mat;
  return out;
}

/* ---------- Drawing ---------- */

export interface PolyBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Face index of each triangle. */
  triFace: Uint32Array;
  /** Triangle ranges by material slot: [slot, firstVertex, vertexCount]. */
  groups: [number, number, number][];
}

/** Where each face sits in the paint texture: its own rectangle, all at the same scale. */
export interface FaceUV {
  /** Corner positions in the texture (0..1), in the order of the face's vertices. */
  uv: [number, number][];
  /** Rectangle, for clipping a brush to the face. */
  rect: [number, number, number, number];
  /** Face frame: origin and two unit axes, and texture units per world unit. */
  o: V3;
  u: V3;
  w: V3;
  scale: number;
}

/**
 * Automatic UVs: every face is laid flat and packed into the square in rows, all at one scale, with
 * a little gap. Good for painting: a brush stroke is the same size on every face.
 */
export function unwrap(m: PolyMesh, pad = 0.006): FaceUV[] {
  const flat = m.faces.map((f) => {
    const n = faceNormal(m, f), o = vert(m, f.v[0]);
    let u = norm(sub(vert(m, f.v[1] ?? f.v[0]), o));
    if (len(u) < 0.5) u = Math.abs(n[1]) < 0.9 ? norm(cross([0, 1, 0], n)) : [1, 0, 0];
    const w = norm(cross(n, u));
    const pts = f.v.map((i) => {
      const d = sub(vert(m, i), o);
      return [dot(d, u), dot(d, w)] as [number, number];
    });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { pts, x0, y0, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0), o, u, wAxis: w };
  });
  const order = flat.map((_, i) => i).sort((a, b) => flat[b].h - flat[a].h);
  // Find the largest scale at which everything fits, by trying to pack and shrinking.
  const area = flat.reduce((s, f) => s + f.w * f.h, 0);
  let scale = area > 0 ? Math.sqrt(0.7 / area) : 1;
  let placed: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    placed = [];
    let x = pad, y = pad, row = 0, fits = true;
    for (const i of order) {
      const w = flat[i].w * scale + pad, h = flat[i].h * scale + pad;
      if (x + w > 1) {
        x = pad;
        y += row;
        row = 0;
      }
      if (y + h > 1 || w > 1) {
        fits = false;
        break;
      }
      placed[i] = { x, y };
      x += w;
      row = Math.max(row, h);
    }
    if (fits) break;
    scale *= 0.9;
  }
  return flat.map((f, i) => {
    const at = placed[i] ?? { x: 0, y: 0 };
    return {
      uv: f.pts.map(([x, y]) => [at.x + (x - f.x0) * scale, at.y + (y - f.y0) * scale] as [number, number]),
      rect: [at.x, at.y, f.w * scale, f.h * scale] as [number, number, number, number],
      o: add(f.o, add(mul(f.u, f.x0), mul(f.wAxis, f.y0))),
      u: f.u,
      w: f.wAxis,
      scale,
    };
  });
}

/**
 * Triangles for drawing. Faces are fanned from their first corner; a vertex shared by faces whose
 * normals are within `smoothAngle` degrees is shaded smoothly, anything sharper stays a crisp edge.
 */
export function polyBuffers(m: PolyMesh, smoothAngle = 30, uvs?: FaceUV[]): PolyBuffers {
  const normals = m.faces.map((f) => faceNormal(m, f));
  const byVert = new Map<number, number[]>();
  m.faces.forEach((f, fi) => f.v.forEach((v) => (byVert.get(v) ?? byVert.set(v, []).get(v)!).push(fi)));
  const cosLimit = Math.cos((smoothAngle * Math.PI) / 180);
  const cornerNormal = (fi: number, v: number): V3 => {
    if (smoothAngle <= 0) return normals[fi];
    let n: V3 = [0, 0, 0];
    for (const other of byVert.get(v) ?? []) if (dot(normals[other], normals[fi]) >= cosLimit) n = add(n, normals[other]);
    return norm(n);
  };
  const slots = [...new Set(m.faces.map((f) => f.m))].sort((a, b) => a - b);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], tri: number[] = [];
  const groups: [number, number, number][] = [];
  for (const slot of slots) {
    const start = pos.length / 3;
    m.faces.forEach((f, fi) => {
      if (f.m !== slot || f.v.length < 3) return;
      const cn = f.v.map((v) => cornerNormal(fi, v));
      for (let i = 1; i + 1 < f.v.length; i++) {
        for (const c of [0, i, i + 1]) {
          const p = vert(m, f.v[c]);
          pos.push(p[0], p[1], p[2]);
          nor.push(cn[c][0], cn[c][1], cn[c][2]);
          const t = uvs?.[fi]?.uv[c];
          uv.push(t ? t[0] : 0, t ? t[1] : 0);
        }
        tri.push(fi);
      }
    });
    groups.push([slot, start, pos.length / 3 - start]);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv), triFace: new Uint32Array(tri), groups };
}

/** Is every edge shared by exactly two faces, running opposite ways (a closed, consistent surface)? */
export function isClosed(m: PolyMesh): boolean {
  const dir = new Map<string, number>();
  for (const f of m.faces)
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i], b = f.v[(i + 1) % f.v.length];
      dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1);
    }
  for (const [k, n] of dir) {
    const [a, b] = k.split('>');
    if (n !== 1 || dir.get(`${b}>${a}`) !== 1) return false;
  }
  return dir.size > 0;
}

/** Turns a voxel surface's quads into a polygon mesh (for editing a sculpt as vertices and faces). */
export function meshFromQuads(positions: Float32Array, normals: Float32Array, materials: Uint8Array, scale = 1): PolyMesh {
  const verts: number[] = [], faces: PolyFace[] = [], seen = new Map<string, number>();
  const id = (i: number) => {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2], k = `${x},${y},${z}`;
    let n = seen.get(k);
    if (n === undefined) {
      n = verts.length / 3;
      seen.set(k, n);
      verts.push(x * scale, y * scale, z * scale);
    }
    return n;
  };
  for (let q = 0; q + 3 < positions.length / 3; q += 4) {
    const v = [id(q), id(q + 1), id(q + 2), id(q + 3)];
    // Quads that look along a negative axis are stored the other way round.
    if (normals[q * 3] + normals[q * 3 + 1] + normals[q * 3 + 2] < 0) v.reverse();
    faces.push({ v, m: Math.max(0, materials[q] - 1) });
  }
  return { verts, faces };
}
