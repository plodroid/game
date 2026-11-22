/* eslint-disable @typescript-eslint/no-require-imports -- a plain node script */
/*
 * Turns the supplied car models (assets-src/cars-original/<Name>/<Name>.gltf, never modified) into
 * runtime models and a manifest.
 *
 *   node scripts/process-cars.cjs [--out apps/client/public/models/cars]
 *
 * For every car it:
 *  - bakes every node transform (the Blender export tips each car on its side with a root rotation),
 *    so the runtime model is Y up, metres, with no transforms to resolve;
 *  - turns the car round so the nose points to +Z, as the game's cars do;
 *  - splits the single "Tires" mesh and the two "Rims" meshes (each holds all four wheels) into four
 *    wheels, each its own node centred on its axle so it can steer and spin;
 *  - keeps the tyre scale in the 1.170 – 1.200 band (see TYRE_BAND) by scaling a wheel's tyre about
 *    its own centre, and records the resulting visual radius, so the ride height can follow it;
 *  - names every part and material by what it is (body, paint, trim, glass, headlights, taillights,
 *    rim_metal, rim_dark, tyre), and keeps the original names in the manifest;
 *  - writes a .glb and one manifest entry per car.
 *
 * It uses no dependencies.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets-src', 'cars-original');
const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(ROOT, argOut > 0 ? process.argv[argOut + 1] : 'apps/client/public/models/cars');
const MANIFEST = path.join(ROOT, 'assets-src', 'cars-manifest.json');

/** The tyre scale the game keeps to, as a factor on the model's own tyre size. */
const TYRE_BAND = [1.17, 1.2];
/** The wheel radius the physics uses for every car (WHEEL_R in packages/shared/src/velocity/config.ts). */
const PHYSICS_WHEEL_R = 0.36;

/* ---------- glTF reading ---------- */

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const Arr = COMP[a.componentType], n = WIDTH[a.type];
  const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
  const stride = view.byteStride && view.byteStride !== Arr.BYTES_PER_ELEMENT * n ? view.byteStride : 0;
  const out = new Arr(a.count * n);
  if (!stride) {
    const copy = bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + out.byteLength);
    out.set(new Arr(copy));
  } else {
    const dv = new DataView(bin.buffer, bin.byteOffset + offset);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < n; k++) out[i * n + k] = a.componentType === 5126 ? dv.getFloat32(i * stride + k * 4, true) : dv.getUint16(i * stride + k * 2, true);
  }
  return out;
}

/* ---------- maths ---------- */

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function local(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    tx, ty, tz, 1,
  ];
  for (let i = 0; i < 3; i++) {
    m[i] *= sx;
    m[4 + i] *= sy;
    m[8 + i] *= sz;
  }
  return m;
}
const point = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
/** The matrix that carries normals (inverse transpose of the upper 3x3), for uniform or not scale. */
function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}
const mulNormal = (n3, x, y, z) => {
  const v = [n3[0] * x + n3[3] * y + n3[6] * z, n3[1] * x + n3[4] * y + n3[7] * z, n3[2] * x + n3[5] * y + n3[8] * z];
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/* ---------- reading one car into baked parts ---------- */

/** Every primitive of the car as baked vertex arrays, in the file's world frame (still nose at -Z). */
function bakeCar(gltf, bin) {
  const world = new Map();
  const walk = (i, parent) => {
    const m = mul(parent, local(gltf.nodes[i]));
    world.set(i, m);
    (gltf.nodes[i].children || []).forEach((c) => walk(c, m));
  };
  gltf.scenes[gltf.scene || 0].nodes.forEach((r) => walk(r, I4));
  const prims = [];
  gltf.nodes.forEach((node, i) => {
    if (node.mesh == null) return;
    const m = world.get(i), nm = normalMatrix(m);
    for (const p of gltf.meshes[node.mesh].primitives) {
      const src = readAccessor(gltf, bin, p.attributes.POSITION);
      const pos = new Float32Array(src.length);
      for (let v = 0; v < src.length; v += 3) {
        const q = point(m, src[v], src[v + 1], src[v + 2]);
        pos[v] = q[0]; pos[v + 1] = q[1]; pos[v + 2] = q[2];
      }
      let nor = null;
      if (p.attributes.NORMAL != null) {
        const s = readAccessor(gltf, bin, p.attributes.NORMAL);
        nor = new Float32Array(s.length);
        for (let v = 0; v < s.length; v += 3) {
          const q = mulNormal(nm, s[v], s[v + 1], s[v + 2]);
          nor[v] = q[0]; nor[v + 1] = q[1]; nor[v + 2] = q[2];
        }
      }
      const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(gltf, bin, p.attributes.TEXCOORD_0) : null;
      const idx = p.indices != null ? readAccessor(gltf, bin, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);
      const mat = gltf.materials[p.material] || {};
      prims.push({ meshName: gltf.meshes[node.mesh].name, nodeName: node.name, materialName: mat.name, material: mat, pos, nor, uv, idx: Uint32Array.from(idx) });
    }
  });
  return prims;
}

const bounds = (pos) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < pos.length; v += 3) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], pos[v + k]);
    mx[k] = Math.max(mx[k], pos[v + k]);
  }
  return { mn, mx, size: mx.map((x, k) => x - mn[k]), ctr: mx.map((x, k) => (x + mn[k]) / 2) };
};

/** Turns a primitive half a turn about Y (nose -Z becomes +Z). Winding is kept: a rotation. */
function turnAround(p) {
  for (let v = 0; v < p.pos.length; v += 3) {
    p.pos[v] = -p.pos[v];
    p.pos[v + 2] = -p.pos[v + 2];
    if (p.nor) {
      p.nor[v] = -p.nor[v];
      p.nor[v + 2] = -p.nor[v + 2];
    }
  }
}

/** Connected pieces of a primitive (triangles that share vertices), as arrays of triangle indices. */
function pieces(p) {
  const nv = p.pos.length / 3, par = Array.from({ length: nv }, (_, i) => i);
  const find = (x) => {
    while (par[x] !== x) {
      par[x] = par[par[x]];
      x = par[x];
    }
    return x;
  };
  for (let i = 0; i < p.idx.length; i += 3) {
    const a = find(p.idx[i]);
    par[find(p.idx[i + 1])] = a;
    par[find(p.idx[i + 2])] = a;
  }
  const byRoot = new Map();
  for (let t = 0; t < p.idx.length / 3; t++) {
    const r = find(p.idx[t * 3]);
    (byRoot.get(r) || byRoot.set(r, []).get(r)).push(t);
  }
  return [...byRoot.values()];
}

/** A new primitive holding only the given triangles (vertices re-indexed), optionally moved and scaled. */
function subset(p, tris, move = [0, 0, 0], scale = 1) {
  const map = new Map(), pos = [], nor = [], uv = [], idx = [];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const v = p.idx[t * 3 + k];
      let n = map.get(v);
      if (n === undefined) {
        n = pos.length / 3;
        map.set(v, n);
        pos.push((p.pos[v * 3] - move[0]) * scale, (p.pos[v * 3 + 1] - move[1]) * scale, (p.pos[v * 3 + 2] - move[2]) * scale);
        if (p.nor) nor.push(p.nor[v * 3], p.nor[v * 3 + 1], p.nor[v * 3 + 2]);
        if (p.uv) uv.push(p.uv[v * 2], p.uv[v * 2 + 1]);
      }
      idx.push(n);
    }
  return { ...p, pos: Float32Array.from(pos), nor: p.nor ? Float32Array.from(nor) : null, uv: p.uv ? Float32Array.from(uv) : null, idx: Uint32Array.from(idx) };
}

/* ---------- GLB writing ---------- */

function writeGlb(file, doc) {
  const chunks = [], views = [], accessors = [];
  let len = 0;
  const add = (data, target) => {
    const pad = (4 - (len % 4)) % 4;
    if (pad) chunks.push(Buffer.alloc(pad));
    len += pad;
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    views.push({ buffer: 0, byteOffset: len, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    len += buf.length;
    return views.length - 1;
  };
  const meshes = [], materials = [], matIndex = new Map();
  const nodes = [];
  const matOf = (m) => {
    if (!matIndex.has(m.name)) {
      matIndex.set(m.name, materials.length);
      materials.push({ name: m.name, ...(m.extras ? { extras: m.extras } : {}), pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metal, roughnessFactor: m.rough }, ...(m.alpha ? { alphaMode: 'BLEND' } : {}), ...(m.emissive ? { emissiveFactor: m.emissive } : {}), ...(m.double ? { doubleSided: true } : {}) });
    }
    return matIndex.get(m.name);
  };
  const meshOf = (prim, name) => {
    const bb = bounds(prim.pos);
    const attrs = {};
    const acc = (data, type, ct, extra = {}) => {
      accessors.push({ bufferView: add(data, 34962), componentType: ct, count: data.length / WIDTH[type], type, ...extra });
      return accessors.length - 1;
    };
    attrs.POSITION = acc(prim.pos, 'VEC3', 5126, { min: bb.mn, max: bb.mx });
    if (prim.nor) attrs.NORMAL = acc(prim.nor, 'VEC3', 5126);
    if (prim.uv) attrs.TEXCOORD_0 = acc(prim.uv, 'VEC2', 5126);
    const idx = prim.pos.length / 3 > 65535 ? prim.idx : Uint16Array.from(prim.idx);
    accessors.push({ bufferView: add(idx, 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    meshes.push({ name, primitives: [{ attributes: attrs, indices: accessors.length - 1, material: matOf(prim.out) }] });
    return meshes.length - 1;
  };
  const build = (n) => {
    const node = { name: n.name };
    if (n.t) node.translation = n.t;
    if (n.extras) node.extras = n.extras;
    if (n.prim) node.mesh = meshOf(n.prim, n.name);
    const i = nodes.push(node) - 1;
    if (n.children) node.children = n.children.map(build);
    return i;
  };
  const root = build(doc.root);
  const json = {
    asset: { version: '2.0', generator: 'chromashift process-cars', extras: { source: doc.source } },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes, meshes, materials, accessors, bufferViews: views,
    buffers: [{ byteLength: len }],
  };
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const body = Buffer.concat(chunks);
  const bodyPad = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + bodyPad.length, 8);
  const ch = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, ch(0x4e4f534a, j), ch(0x004e4942, bodyPad)]));
}

/* ---------- the cars ---------- */

const SECTION = {
  Body: 'body', Paint: 'paint', Trim: 'trim', Window: 'glass', Front: 'headlights', Rear: 'taillights',
};
const kind = (meshName) => meshName.split('_')[0].replace(/\.\d+$/, '');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const colour = (m) => (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor) || [0.5, 0.5, 0.5, 1];

function processCar(dir) {
  const gltfPath = path.join(SRC, dir, `${dir}.gltf`);
  const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  const bin = fs.readFileSync(path.join(SRC, dir, decodeURIComponent(gltf.buffers[0].uri)));
  const id = slug(dir);
  const prims = bakeCar(gltf, bin);
  const problems = [];

  // Which way is the nose? "Front" is the lamp / grille mesh: it sits at the front.
  const front = prims.find((p) => kind(p.meshName) === 'Front');
  const body0 = prims.find((p) => kind(p.meshName) === 'Body');
  if (!front || !body0) problems.push('no Front or Body mesh to find the nose from');
  const noseAtMinusZ = !front || bounds(front.pos).ctr[2] < bounds(body0.pos).ctr[2];
  if (noseAtMinusZ) prims.forEach(turnAround);

  const wheels = {};
  const tyreSrc = prims.filter((p) => kind(p.meshName) === 'Tires');
  const rimSrc = prims.filter((p) => kind(p.meshName) === 'Rims');
  if (tyreSrc.length !== 1) problems.push(`expected one Tires mesh, found ${tyreSrc.length}`);
  if (rimSrc.length < 1) problems.push('no Rims mesh');

  // Split the wheels: every connected piece belongs to the wheel whose corner it sits in.
  const corner = (c) => `${c[2] > 0 ? 'F' : 'R'}${c[0] > 0 ? 'L' : 'R'}`;
  const sourceTyreScale = (() => {
    // The Blender export holds the tyre scale on the parent node of the tyre mesh.
    const n = gltf.nodes.find((x) => /^Tires/.test(x.name) && x.scale);
    return n ? n.scale[0] * (gltf.nodes[gltf.scenes[0].nodes[0]].scale ? gltf.nodes[gltf.scenes[0].nodes[0]].scale[0] : 1) : 1;
  })();
  const k = Math.min(TYRE_BAND[1], Math.max(TYRE_BAND[0], sourceTyreScale)) / sourceTyreScale;
  for (const p of tyreSrc) for (const tris of pieces(p)) {
    const c = bounds(subset(p, tris).pos).ctr;
    (wheels[corner(c)] ||= { tyre: [], rim: [] }).tyre.push({ p, tris });
  }
  for (const p of rimSrc) for (const tris of pieces(p)) {
    const c = bounds(subset(p, tris).pos).ctr;
    (wheels[corner(c)] ||= { tyre: [], rim: [] }).rim.push({ p, tris });
  }
  const corners = ['FL', 'FR', 'RL', 'RR'];
  for (const c of corners) if (!wheels[c] || !wheels[c].tyre.length) problems.push(`no tyre found for ${c}`);

  // Wheel centres from the tyre pieces.
  const info = {};
  for (const c of corners) {
    const w = wheels[c];
    if (!w) continue;
    const all = { pos: Float32Array.from(w.tyre.flatMap((t) => [...subset(t.p, t.tris).pos])) };
    const b = bounds(all.pos);
    info[c] = { centre: b.ctr, radius: (b.size[1] / 2) * k, width: b.size[0] * k, radiusSource: b.size[1] / 2 };
  }

  const matDefs = {};
  const out = (name, m, extra = {}) => ({ name, color: colour(m), metal: (m.pbrMetallicRoughness || {}).metallicFactor ?? 0, rough: (m.pbrMetallicRoughness || {}).roughnessFactor ?? 0.8, ...extra });

  // Body-side parts, named by what they are.
  const sections = [];
  for (const p of prims) {
    const kd = kind(p.meshName);
    if (kd === 'Tires' || kd === 'Rims') continue;
    const name = SECTION[kd] || kd.toLowerCase();
    let mat;
    if (name === 'paint') mat = out('paint', p.material, { rough: 0.35, metal: 0.25, extras: { channel: 'paint' } });
    else if (name === 'glass') mat = out('glass', p.material, { color: [0.04, 0.05, 0.07, 0.72], rough: 0.08, metal: 0.4, alpha: true, double: true, extras: { channel: 'glass' } });
    else if (name === 'headlights') mat = out('headlights', p.material, { color: [1, 0.96, 0.86, 1], rough: 0.2, metal: 0, emissive: [0.25, 0.24, 0.2], extras: { channel: 'headlights' } });
    else if (name === 'taillights') mat = out('taillights', p.material, { color: [0.85, 0.04, 0.06, 1], rough: 0.3, metal: 0, emissive: [0.15, 0, 0], extras: { channel: 'taillights' } });
    else if (name === 'trim') mat = out('trim', p.material, { color: [0.05, 0.05, 0.06, 1], rough: 0.6, metal: 0.2, extras: { channel: 'trim' } });
    else mat = out('underbody', p.material, { color: [0.04, 0.04, 0.05, 1], rough: 0.7, metal: 0.1, extras: { channel: 'underbody' } });
    sections.push({ name, prim: { ...p, out: mat }, source: { mesh: p.meshName, node: p.nodeName, material: p.materialName }, tris: p.idx.length / 3, bbox: bounds(p.pos) });
  }
  void matDefs;

  const wheelNodes = [];
  const wheelReport = {};
  for (const c of corners) {
    const w = wheels[c];
    if (!w) continue;
    const ctr = info[c].centre;
    const kids = [];
    // Tyre pieces of this wheel as one mesh, scaled about the wheel centre.
    const tyrePieces = w.tyre.map((t) => subset(t.p, t.tris, ctr, k));
    kids.push({ name: `tyre_${c}`, prim: mergePrims(tyrePieces, out('tyre', w.tyre[0].p.material, { color: [0.045, 0.045, 0.05, 1], rough: 0.9, metal: 0, extras: { channel: 'tyre' } })) });
    // Rim pieces, grouped by their source material (one is bright metal, one the dark insert).
    const bySource = new Map();
    for (const r of w.rim) (bySource.get(r.p.materialName) || bySource.set(r.p.materialName, []).get(r.p.materialName)).push(subset(r.p, r.tris, ctr, 1));
    const sourceNames = [...bySource.keys()].sort((a, b) => colour(rimMat(rimSrc, a))[0] < colour(rimMat(rimSrc, b))[0] ? 1 : -1);
    sourceNames.forEach((sn, i) => {
      const m = rimMat(rimSrc, sn);
      const name = i === 0 ? 'rim_metal' : 'rim_dark';
      kids.push({ name: `${name}_${c}`, prim: mergePrims(bySource.get(sn), out(name, m, i === 0 ? { color: [0.78, 0.8, 0.84, 1], rough: 0.3, metal: 0.9, extras: { channel: 'rim_metal' } } : { color: [0.12, 0.12, 0.14, 1], rough: 0.5, metal: 0.4, extras: { channel: 'rim_dark' } }) ) });
    });
    wheelNodes.push({ name: `wheel_${c}`, t: ctr, children: kids, extras: { radius: info[c].radius, width: info[c].width } });
    wheelReport[c] = { centre: ctr.map((x) => +x.toFixed(3)), radius: +info[c].radius.toFixed(3), radiusInSource: +info[c].radiusSource.toFixed(3), tyreWidth: +info[c].width.toFixed(3), tyreTriangles: tyrePieces.reduce((a, q) => a + q.idx.length / 3, 0) };
  }

  const bodyKids = sections.map((s) => ({ name: s.name, prim: s.prim }));
  const root = { name: id, children: [...bodyKids, ...wheelNodes] };
  const file = path.join(OUT, `${id}.glb`);
  writeGlb(file, { root, source: { name: dir, file: `${dir}/${dir}.gltf` } });

  // The whole car.
  const everything = [...prims.filter((p) => !['Tires', 'Rims'].includes(kind(p.meshName)))].map((p) => p.pos);
  everything.push(...Object.values(wheels).flatMap((w) => [...w.tyre, ...w.rim].map((t) => subset(t.p, t.tris).pos)));
  const all = bounds(Float32Array.from(everything.flatMap((a) => [...a])));
  const flat = (q) => q.map((x) => +x.toFixed(3));
  const radii = Object.values(info).map((i) => i.radius);
  const spread = Math.max(...radii) - Math.min(...radii);
  const wl = info.FL && info.RL ? Math.abs(info.FL.centre[2] - info.RL.centre[2]) : 0;
  const track = info.FL && info.FR ? Math.abs(info.FL.centre[0] - info.FR.centre[0]) : 0;
  const triangles = sections.reduce((a, s) => a + s.tris, 0) + Object.values(wheelReport).reduce((a, w) => a + w.tyreTriangles, 0) + Object.values(wheels).reduce((a, w) => a + w.rim.reduce((s, r) => s + r.tris.length, 0), 0);
  const customisable = sections.filter((s) => ['paint', 'trim', 'glass', 'headlights', 'taillights'].includes(s.name)).map((s) => s.name);
  const missing = ['roof (no separate roof mesh: it is part of the paint mesh)', 'spoiler (not a separate object; on some cars it is inside the trim mesh)', 'mirrors (not separate)', 'doors (not separate)', 'second body colour (the paint is one mesh)', 'brake calipers (none modelled)'];
  const cap = { paint: 'paint', trim: 'trim', glass: 'glass', headlights: 'headlights', taillights: 'taillights' };
  return {
    id,
    sourceName: dir,
    model: `models/cars/${id}.glb`,
    noseWasAtMinusZ: noseAtMinusZ,
    size: flat(all.size),
    bounds: { min: flat(all.mn), max: flat(all.mx) },
    triangles,
    parts: sections.map((s) => ({ node: s.name, triangles: s.tris, material: s.prim.out.name, source: s.source, bbox: { size: flat(s.bbox.size), centre: flat(s.bbox.ctr) } })),
    wheels: wheelReport,
    wheelbase: +wl.toFixed(3),
    trackWidth: +track.toFixed(3),
    tyre: { sourceScale: +sourceTyreScale.toFixed(3), runtimeScale: +(sourceTyreScale * k).toFixed(3), band: TYRE_BAND, scaleFactorApplied: +k.toFixed(4), radiusSpread: +spread.toFixed(4), physicsRadius: PHYSICS_WHEEL_R },
    materials: sections.map((s) => ({ name: s.prim.out.name, from: s.source.material })).concat([{ name: 'tyre', from: tyreSrc[0] && tyreSrc[0].materialName }, ...(rimSrc.map((r) => ({ name: 'rim (metal or dark)', from: r.materialName })))]),
    textures: gltf.images ? gltf.images.map((i) => i.uri) : [],
    uvNote: 'UVs repeat (about 400 distinct coordinates over 1,300–2,500 vertices on the paint mesh): not a unique unwrap. Decals and flags are projected, not UV-painted.',
    customisable: customisable.map((n) => cap[n]).concat(['rim_metal', 'rim_dark', 'tyre']),
    missing,
    licence: { status: 'owner-confirmed', note: 'The owner confirmed on 2026-11-22 that they hold the rights to redistribute these models. The files themselves carry no licence text.' },
    garageReady: problems.length === 0 && corners.every((c) => wheels[c]),
    problems,
  };
}

function mergePrims(list, outMat) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  let hasNor = true, hasUv = true;
  for (const q of list) {
    if (!q.nor) hasNor = false;
    if (!q.uv) hasUv = false;
  }
  for (const q of list) {
    pos.push(...q.pos);
    if (hasNor) nor.push(...q.nor);
    if (hasUv) uv.push(...q.uv);
    for (const i of q.idx) idx.push(i + base);
    base += q.pos.length / 3;
  }
  return { pos: Float32Array.from(pos), nor: hasNor ? Float32Array.from(nor) : null, uv: hasUv ? Float32Array.from(uv) : null, idx: Uint32Array.from(idx), out: outMat };
}
function rimMat(rims, name) {
  return (rims.find((r) => r.materialName === name) || rims[0]).material;
}

/** What each car is called in the game. Neutral names: the files carry no rights to use the makers' names or logos. */
const PUBLIC = {
  artura: ['Kestrel Supercar', 'Supercar', 'epic'],
  ferrari: ['Rosso Berlinetta', 'Grand tourer', 'epic'],
  ford: ['Tempo Hatch', 'Hatchback', 'common'],
  landrover: ['Ridge Explorer', 'SUV', 'rare'],
  mercedes: ['Meridian Saloon', 'Sedan', 'rare'],
  sterrato: ['Dust Devil', 'Rally', 'rare'],
  zenvo: ['Thunderbolt Hyper', 'Hypercar', 'legendary'],
};

const cars = fs.readdirSync(SRC).filter((d) => fs.existsSync(path.join(SRC, d, `${d}.gltf`))).sort();
const manifest = { generated: new Date().toISOString().slice(0, 10), source: 'assets-src/cars-original (unmodified)', cars: [] };
for (const dir of cars) {
  const entry = processCar(dir);
  manifest.cars.push(entry);
  console.log(`${entry.id.padEnd(10)} ${String(entry.triangles).padStart(5)} tris  ${entry.size.join(' x ')} m  tyre ${entry.tyre.sourceScale} -> ${entry.tyre.runtimeScale}  radius ${Object.values(entry.wheels).map((w) => w.radius).join('/')}  ${entry.garageReady ? 'ready' : 'PROBLEMS: ' + entry.problems.join('; ')}`);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
// The small file the game reads: what to list, and where each wheel is.
const runtime = manifest.cars.filter((c) => c.garageReady).map((c) => {
  const [name, type, rarity] = PUBLIC[c.id] || [c.sourceName, 'Coupé', 'rare'];
  return { id: 'x_' + c.id.slice(0, 5), file: c.id + '.glb', name, type, rarity, size: c.size, triangles: c.triangles, wheels: c.wheels, licence: c.licence.status };
});
fs.writeFileSync(path.join(OUT, 'cars.json'), JSON.stringify({ cars: runtime }));
console.log(`\nWrote ${cars.length} models to ${path.relative(ROOT, OUT)} and ${path.relative(ROOT, MANIFEST)}`);
