import * as THREE from 'three';
import { bake, Builder, crownY, headAt, headPoint, onFace, smooth, stand, surfaceTube, tilted, TOP, type HairStyle, type Kit } from './head';

/** Headgear with a crown or band over the top: tall hair pieces would poke through it. */
export const COVERS_TOP = new Set([
  'cap', 'backcap', 'flatbrim', 'trucker', 'longbill', 'beanie', 'slouch', 'pombeanie', 'tallbeanie', 'flaps',
  'phones', 'muffs', 'headset', 'neonphones', 'bucket', 'fisher', 'beret', 'painterberet', 'tophat', 'bikehelmet',
  'hardhat', 'bandana', 'propeller', 'wizard', 'chef', 'sunhat', 'tricorn', 'ranch', 'cone', 'bucketpaint',
]);

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GOLD = 0xe0b03a;

/** Bends a geometry towards +z along its height (horns, wizard hats). */
function bend(g: THREE.BufferGeometry, k: number) {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + k * p.getY(i) * p.getY(i));
  g.computeVertexNormals();
  return g;
}

/** Twists a geometry around its height axis (a unicorn horn). */
function twist(g: THREE.BufferGeometry, turns: number, h: number) {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const a = (p.getY(i) / h) * turns * Math.PI * 2, x = p.getX(i), z = p.getZ(i);
    p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a));
  }
  g.computeVertexNormals();
  return g;
}

/** A five-point star or a heart as a flat shape. */
export function shapeOf(kind: 'star' | 'heart' | 'splat', r: number) {
  const s = new THREE.Shape();
  if (kind === 'star') {
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  } else if (kind === 'heart') {
    s.moveTo(0, -r);
    s.bezierCurveTo(r * 1.3, -r * 0.2, r * 0.9, r * 1.05, 0, r * 0.45);
    s.bezierCurveTo(-r * 0.9, r * 1.05, -r * 1.3, -r * 0.2, 0, -r);
  } else {
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2, rr = r * (0.78 + 0.22 * Math.abs(Math.sin(i * 2.6)));
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  return s;
}

/** A brim following a band around the head; `len(phi)` its width, `lift(phi, s)` how it curls. */
function brim(k: Kit, band: (phi: number) => number, o: number, arc: [number, number] | null, len: (phi: number) => number, lift: (phi: number, s: number) => number, mat = k.m.teamFlat, th = 0.012) {
  const b = new Builder();
  const nI = k.seg(arc ? 10 : 18, arc ? 20 : 36), nJ = 3;
  const [pa, pb] = arc ?? [-Math.PI, Math.PI];
  b.slab(nI, nJ, !arc, (i, j, inner) => {
    const phi = pa + ((pb - pa) * i) / nI, s = j / nJ;
    const p = headPoint(phi, band(phi), o - 0.01);
    const out = v(p.x, 0, p.z).normalize();
    return p.addScaledVector(out, 0.012 + len(phi) * s).add(v(0, lift(phi, s) + (inner ? -th / 2 : th / 2), 0));
  });
  return k.mesh(b.geometry(), mat);
}

export function buildGear(head: THREE.Object3D, id: string, hair: HairStyle, k: Kit) {
  const { m, mesh, shell, seg } = k;
  const add = (...o: THREE.Object3D[]) => head.add(...o);
  const at = (o: THREE.Object3D, x: number, y: number, z: number) => (o.position.set(x, y, z), o);
  const cap = (back: boolean, len: number, flat: boolean, crownMat = m.accent, front?: THREE.Material) => {
    const o = hair.outer(0.3) + 0.016;
    const raw = tilted(0.44, 0.1);
    const band = back ? (phi: number) => raw(phi + Math.PI) : raw;
    add(shell([{ o, th: 0.014, lo: band, flare: flat ? (t) => 0.012 * smooth(0.9, TOP, t) : undefined }], crownMat));
    if (front) add(shell([{ o: o + 0.004, th: 0.006, lo: band, hi: () => 1.15, arc: back ? [Math.PI - 0.9, Math.PI + 0.9] : [-0.9, 0.9] }], front));
    const c = back ? Math.PI : 0;
    add(brim(k, band, o, [c - 0.85, c + 0.85], (phi) => len * Math.cos(((phi - c) / 0.85) * (Math.PI / 2)), (_, s) => (flat ? 0 : -s * len * 0.22) - 0.004));
    add(at(mesh(new THREE.SphereGeometry(0.022, 8, 6), m.teamFlat), 0, crownY(o), 0));
  };
  const beanie = (slouch: number, pom: number, tallness = 0, cuff = true) => {
    const o = hair.outer(0.2) + 0.02;
    const band = tilted(0.46, 0.02);
    const flare = (t: number) => slouch * Math.max(0, Math.sin(t)) ** 2 + tallness * smooth(0.7, TOP, t) ** 2;
    add(shell([{ o, th: 0.016, lo: band, flare }], m.accent));
    if (cuff) add(shell([{ o: o + 0.014, th: 0.02, lo: band, hi: (phi) => band(phi) + 0.2 }], m.accent));
    if (pom) add(at(mesh(new THREE.IcosahedronGeometry(pom, 1), m.teamFlat), 0, crownY(o + flare(TOP)) + pom * 0.75, 0));
    return o;
  };
  const phones = (cupR: number, cupMat: THREE.Material, fuzzy = false, mic = false) => {
    const o = hair.outer(0.8) + 0.024;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const s = i / 16, t = 0.15 + (TOP - 0.15) * (1 - Math.abs(1 - 2 * s));
      pts.push(headPoint(s < 0.5 ? -TOP : TOP, t, o));
    }
    add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg(16, 32), 0.017, 6), m.dark));
    for (const sx of [-1, 1]) {
      const x = sx * (headAt(0.05, hair.outer(0.05))[0] + 0.03), y = headAt(0.05)[1];
      if (fuzzy) add(at(mesh(new THREE.IcosahedronGeometry(cupR, 1).scale(0.7, 1, 1), cupMat), x + sx * 0.01, y, 0));
      else {
        add(at(mesh(new THREE.CylinderGeometry(cupR * 0.9, cupR * 0.9, 0.034, seg(10, 18)).rotateZ(Math.PI / 2), m.dark), x - sx * 0.008, y, 0));
        add(at(mesh(new THREE.CylinderGeometry(cupR, cupR * 0.92, 0.034, seg(10, 18)).rotateZ(Math.PI / 2), cupMat), x + sx * 0.022, y, 0));
      }
    }
    if (mic) {
      const x = -(headAt(0.05, hair.outer(0.05))[0] + 0.05);
      const pts2 = [v(x, headAt(0.05)[1], 0), v(x + 0.02, headAt(-0.5)[1], -0.12), v(-0.05, headAt(-0.5)[1], -0.21)];
      add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 12, 0.008, 5), m.dark));
      add(at(mesh(new THREE.SphereGeometry(0.02, 8, 6), m.teamFlat), -0.05, headAt(-0.5)[1], -0.215));
    }
  };
  const ringOf = (r: number, tube: number, mat: THREE.Material, y: number, tilt = 0.12) => {
    const ring = mesh(new THREE.TorusGeometry(r, tube, 6, seg(20, 36)).rotateX(Math.PI / 2), mat);
    ring.position.set(0, y, 0.02);
    ring.rotation.x = tilt;
    return ring;
  };
  /** Height just clear of everything on the head so far. */
  const clear = () => {
    const box = new THREE.Box3();
    for (const c of head.children)
      if (c instanceof THREE.Mesh) {
        c.updateMatrix();
        c.geometry.computeBoundingBox();
        box.union(c.geometry.boundingBox!.clone().applyMatrix4(c.matrix));
      }
    return box.max.y;
  };
  /** A cylinder-crowned hat resting on the head: radius r at its base. */
  const restY = (r: number, o: number) => {
    const t = Math.acos(Math.min(1, r / (headAt(0, o)[0] || 1)));
    return headAt(t, o)[1];
  };
  const ears = (geo: () => THREE.BufferGeometry, mat: THREE.Material, phi: number, t: number, lean: number, inner?: () => THREE.BufferGeometry) => {
    const o = hair.outer(t);
    for (const sx of [-1, 1]) {
      const e = mesh(geo(), mat);
      stand(e, sx * phi, t, o - 0.01, lean);
      add(e);
      if (inner) {
        const i = mesh(inner(), m.white);
        stand(i, sx * phi, t, o - 0.005, lean);
        i.translateZ(-0.012);
        add(i);
      }
    }
  };
  const flowers = (n: number, t: number, r: number, arc: [number, number]) => {
    const petals: [THREE.BufferGeometry, THREE.Object3D][] = [];
    const hearts: [THREE.BufferGeometry, THREE.Object3D][] = [];
    for (let i = 0; i < n; i++) {
      const phi = n === 1 ? arc[0] : arc[0] + ((arc[1] - arc[0]) * i) / (arc[1] - arc[0] > 6 ? n : n - 1);
      const base = new THREE.Object3D();
      stand(base, phi, t, hair.outer(t) + 0.012);
      base.updateMatrix();
      for (let p = 0; p < 5; p++) {
        const o = new THREE.Object3D();
        o.position.set(Math.cos((p / 5) * Math.PI * 2) * r, 0.006, Math.sin((p / 5) * Math.PI * 2) * r).applyMatrix4(base.matrix);
        o.quaternion.copy(base.quaternion);
        petals.push([new THREE.SphereGeometry(r * 0.8, 6, 4).scale(1, 0.45, 1), o]);
      }
      const c = new THREE.Object3D();
      c.position.set(0, 0.012, 0).applyMatrix4(base.matrix);
      hearts.push([new THREE.SphereGeometry(r * 0.6, 6, 4), c]);
    }
    add(mesh(bake(petals), m.make(0xffffff, { roughness: 0.6 })), mesh(bake(hearts), m.make(0xffc532, { roughness: 0.5 })));
  };

  switch (id) {
    case 'cap':
      cap(false, 0.14, false);
      break;
    case 'backcap':
      cap(true, 0.13, false);
      break;
    case 'flatbrim':
      cap(false, 0.16, true, m.dark);
      break;
    case 'trucker':
      cap(false, 0.14, false, m.dark, m.white);
      break;
    case 'longbill':
      cap(false, 0.23, false);
      break;
    case 'beanie':
      beanie(0.03, 0);
      break;
    case 'slouch':
      beanie(0.075, 0, 0, false);
      break;
    case 'pombeanie':
      beanie(0.03, 0.06);
      break;
    case 'tallbeanie':
      beanie(0.02, 0.035, 0.11);
      break;
    case 'flaps': {
      const o = beanie(0.025, 0.04);
      for (const sx of [-1, 1]) {
        const f = mesh(new THREE.CapsuleGeometry(0.045, 0.06, 3, 8).scale(0.45, 1, 1), m.accent);
        at(f, sx * (headAt(-0.15, o)[0] + 0.005), headAt(-0.25)[1], 0.02);
        f.rotation.z = sx * 0.1;
        add(f, at(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 4), m.white), sx * (headAt(-0.15, o)[0] + 0.005), headAt(-0.75)[1], 0.02));
      }
      break;
    }
    case 'phones':
      phones(0.076, m.teamFlat);
      break;
    case 'muffs':
      phones(0.075, m.make(0xf6efe6, { roughness: 0.95 }), true);
      break;
    case 'headset':
      phones(0.07, m.dark, false, true);
      break;
    case 'neonphones':
      phones(0.09, m.team);
      break;
    case 'visor': {
      // A tinted wrap-around shade over the eyes, held by a strap round the back.
      add(shell([{ o: 0.036, th: 0.006, lo: () => -0.34, hi: () => 0.27, arc: [-1.3, 1.3] }], m.glass));
      const strap = hair.outer(0.03) + 0.01;
      add(shell([{ o: strap, th: 0.008, lo: () => -0.02, hi: () => 0.08, arc: [1.25, 2 * Math.PI - 1.25] }], m.dark));
      for (const sx of [-1, 1]) {
        const hinge = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), m.dark);
        onFace(hinge, sx * 1.27, -0.03, 0.036);
        hinge.rotateY(sx * 0.2);
        add(hinge);
      }
      break;
    }
    case 'sportvisor': {
      const o = hair.outer(0.45) + 0.014;
      const band = () => 0.36;
      add(shell([{ o, th: 0.014, lo: band, hi: () => 0.52 }], m.white));
      add(brim(k, band, o, [-0.9, 0.9], (phi) => 0.13 * Math.cos((phi / 0.9) * (Math.PI / 2)), (_, s) => -s * 0.025));
      break;
    }
    case 'sweatband': {
      const o = hair.outer(0.45) + 0.012;
      add(shell([{ o, th: 0.018, lo: () => 0.36, hi: () => 0.55 }], m.white));
      add(shell([{ o: o + 0.004, th: 0.006, lo: () => 0.43, hi: () => 0.48 }], m.teamFlat));
      break;
    }
    case 'bandana': {
      const o = hair.outer(0.4) + 0.014;
      add(shell([{ o, th: 0.012, lo: tilted(0.42, 0.05) }], m.accent));
      for (const sx of [-1, 1]) {
        const knot = mesh(new THREE.CapsuleGeometry(0.02, 0.09, 3, 6), m.accent);
        at(knot, sx * 0.03, headAt(0.05)[1], headAt(0.05, o)[0] * 0.94 + 0.02);
        knot.rotation.set(0.5, 0, sx * 0.5);
        add(knot);
      }
      break;
    }
    case 'goggles': {
      const o = hair.outer(0.62) + 0.012;
      add(shell([{ o, th: 0.008, lo: () => 0.56, hi: () => 0.66 }], m.dark));
      for (const sx of [-1, 1]) {
        const rim = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.035, seg(10, 18)).rotateX(Math.PI / 2), m.make(0x8a5a33, { roughness: 0.6 }));
        const lens = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, seg(10, 18)).rotateX(Math.PI / 2), m.glass);
        onFace(rim, sx * 0.36, 0.62, o + 0.012);
        onFace(lens, sx * 0.36, 0.62, o + 0.03);
        add(rim, lens);
      }
      break;
    }
    case 'bow': {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) g.add(at(mesh(new THREE.ConeGeometry(0.05, 0.08, 4).rotateZ((sx * Math.PI) / 2).scale(1, 1, 0.5), m.teamFlat), sx * 0.04, 0, 0));
      g.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), m.teamFlat));
      stand(g, 0.95, 0.85, hair.outer(0.85) + 0.02);
      add(g);
      break;
    }
    case 'flower':
      flowers(1, 0.7, 0.028, [-1.15, -1.15]);
      break;
    case 'flowercrown':
      flowers(9, 0.62, 0.022, [-Math.PI, Math.PI]);
      break;
    case 'bucket':
    case 'fisher': {
      const o = hair.outer(0.5) + 0.018;
      const band = tilted(0.28, 0.12);
      add(shell([{ o, th: 0.014, lo: band, flare: (t) => 0.01 * smooth(1.0, TOP, t) }], m.accent));
      if (id === 'fisher') add(shell([{ o: o + 0.004, th: 0.008, lo: band, hi: (phi) => band(phi) + 0.12 }], m.dark));
      add(brim(k, band, o, null, () => (id === 'fisher' ? 0.13 : 0.09), (_, s) => -s * (id === 'fisher' ? 0.06 : 0.04), m.accent));
      break;
    }
    case 'beret':
    case 'painterberet': {
      const o = hair.outer(1) + 0.01;
      const b = mesh(new THREE.SphereGeometry(0.25, seg(14, 24), seg(8, 14)).scale(1, 0.32, 1), id === 'beret' ? m.accent : m.dark);
      b.position.set(0.04, crownY(o) - 0.03, 0.02);
      b.rotation.z = -0.22;
      add(b, at(mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.035, 6), m.dark), 0.02, crownY(o) + 0.055, 0.02));
      if (id === 'painterberet') {
        const dots: [THREE.BufferGeometry, THREE.Object3D][] = [];
        for (let i = 0; i < 6; i++) {
          const d = new THREE.Object3D();
          const a = i * 1.7, r = 0.06 + (i % 3) * 0.045;
          d.position.set(0.04 + Math.cos(a) * r, crownY(o) + 0.035 - r * 0.25 - Math.cos(a) * r * 0.2, 0.02 + Math.sin(a) * r);
          dots.push([new THREE.SphereGeometry(0.025 + (i % 2) * 0.012, 6, 4).scale(1, 0.35, 1), d]);
        }
        add(mesh(bake(dots), m.teamFlat));
      }
      break;
    }
    case 'tophat':
    case 'minitop': {
      const big = id === 'tophat';
      const r = big ? 0.15 : 0.085, h = big ? 0.27 : 0.14;
      const o = hair.outer(1) + 0.01;
      const y = restY(r, o);
      const g = new THREE.Group();
      g.add(at(mesh(new THREE.CylinderGeometry(r, r * 0.95, h, seg(14, 24)), m.dark), 0, h / 2, 0));
      g.add(at(mesh(new THREE.CylinderGeometry(r * 1.01, r * 0.96, h * 0.18, seg(14, 24)), m.teamFlat), 0, h * 0.12, 0));
      g.add(at(mesh(new THREE.CylinderGeometry(r * 1.75, r * 1.75, 0.012, seg(16, 28)), m.dark), 0, 0.006, 0));
      g.position.set(big ? 0 : 0.07, y - 0.01, big ? 0.01 : 0);
      g.rotation.z = big ? -0.05 : -0.32;
      add(g);
      break;
    }
    case 'crown':
    case 'tiara': {
      const gold = m.make(GOLD, { metalness: 0.85, roughness: 0.25 });
      if (id === 'crown') {
        const o = hair.outer(0.9) + 0.012;
        const r = headAt(0.9, o)[0], y = headAt(0.9, o)[1];
        const g = new THREE.CylinderGeometry(r * 1.02, r, 0.12, 16, 1, true);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + (i % 2 ? 0.055 : -0.02));
        g.computeVertexNormals();
        const c = mesh(g, gold);
        (c.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        add(at(c, 0, y + 0.03, 0));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          add(at(mesh(new THREE.OctahedronGeometry(0.016), m.team), Math.sin(a) * r * 1.03, y + 0.02, -Math.cos(a) * r * 1.03 * 0.94));
        }
      } else {
        const o = hair.outer(0.75) + 0.012;
        add(mesh(surfaceTube(-1.2, 1.2, () => 0.72, o, 0.008, 20), gold));
        const tip = mesh(new THREE.ConeGeometry(0.03, 0.07, 4), gold);
        stand(tip, 0, 0.72, o);
        const gem = mesh(new THREE.OctahedronGeometry(0.022), m.team);
        stand(gem, 0, 0.74, o + 0.03);
        add(tip, gem);
        for (const sx of [-1, 1]) {
          const t2 = mesh(new THREE.ConeGeometry(0.018, 0.045, 4), gold);
          stand(t2, sx * 0.5, 0.72, o);
          add(t2);
        }
      }
      break;
    }
    case 'bikehelmet':
    case 'hardhat': {
      const hard = id === 'hardhat';
      const o = hair.outer(0.5) + (hard ? 0.03 : 0.035);
      const mat = hard ? m.make(0xffc532, { roughness: 0.4 }) : m.accent;
      const band = hard ? () => 0.3 : tilted(0.5, 0.02);
      add(shell([{ o, th: 0.03, lo: band }], mat));
      if (hard) add(brim(k, band, o, null, (phi) => 0.03 + 0.06 * Math.max(0, Math.cos(phi)), () => -0.005, mat));
      const ridges: [THREE.BufferGeometry, THREE.Object3D][] = [];
      for (const phi of hard ? [0] : [-0.45, 0, 0.45])
        for (let i = 0; i < 7; i++) {
          const t = 0.55 + (i / 6) * (TOP - 0.55);
          const r = new THREE.Object3D();
          stand(r, phi, t, o);
          ridges.push([new THREE.BoxGeometry(0.02, 0.016, 0.05), r]);
        }
      add(mesh(bake(ridges), hard ? mat : m.teamFlat));
      break;
    }
    case 'bubble': {
      const glass = m.make(0xdff2ff, { transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0.1 });
      add(at(mesh(new THREE.SphereGeometry(0.36, seg(18, 32), seg(12, 24)), glass), 0, 0.19, 0));
      add(at(mesh(new THREE.TorusGeometry(0.2, 0.035, 8, seg(16, 28)).rotateX(Math.PI / 2), m.white), 0, -0.1, 0));
      break;
    }
    case 'catears':
      ears(() => new THREE.ConeGeometry(0.06, 0.1, 4).scale(1, 1, 0.45), m.accent, 0.72, 1.08, 0.1, () => new THREE.ConeGeometry(0.035, 0.065, 4).scale(1, 1, 0.3));
      break;
    case 'fox':
      ears(() => new THREE.ConeGeometry(0.065, 0.15, 4).scale(1, 1, 0.4), m.make(0xe97a2b, { roughness: 0.7 }), 0.7, 1.05, 0.05, () => new THREE.ConeGeometry(0.04, 0.1, 4).scale(1, 1, 0.3));
      break;
    case 'bear':
      ears(() => new THREE.SphereGeometry(0.055, 10, 8).scale(1, 1, 0.55), m.accent, 0.95, 1.0, 0, () => new THREE.SphereGeometry(0.032, 8, 6).scale(1, 1, 0.4));
      break;
    case 'bunny':
      ears(() => new THREE.CapsuleGeometry(0.03, 0.22, 3, 8).translate(0, 0.13, 0).scale(1, 1, 0.5), m.white, 0.42, 1.15, 0.25);
      break;
    case 'imp':
      ears(() => bend(new THREE.ConeGeometry(0.03, 0.12, 8, 6).translate(0, 0.06, 0), -1.6), m.make(0xc3263d, { roughness: 0.4 }), 0.55, 0.95, 0.1);
      break;
    case 'rams':
      for (const sx of [-1, 1]) {
        const h = mesh(new THREE.TorusGeometry(0.06, 0.025, 6, 14, Math.PI * 1.6), m.make(0xd8c39a, { roughness: 0.7 }));
        const p = headPoint(sx * 1.45, 0.55, hair.outer(0.55) + 0.02);
        h.position.copy(p);
        h.rotation.set(0, (sx * Math.PI) / 2, sx * 0.5);
        add(h);
      }
      break;
    case 'unicorn': {
      const g = twist(new THREE.ConeGeometry(0.035, 0.2, 10, 8).translate(0, 0.1, 0), 2, 0.2);
      const u = mesh(g, m.make(0xf4efe9, { roughness: 0.3, metalness: 0.3, emissive: 0xffd6f0, emissiveIntensity: 0.15 }));
      stand(u, 0, 0.88, hair.outer(0.88) - 0.005, -0.55);
      add(u);
      break;
    }
    case 'antennae':
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        g.add(at(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 5), m.dark), 0, 0.08, 0));
        g.add(at(mesh(new THREE.SphereGeometry(0.028, 10, 8), m.team), 0, 0.17, 0));
        stand(g, sx * 0.5, 1.2, hair.outer(1.2) - 0.005, 0.05);
        g.rotateZ(sx * -0.2);
        add(g);
      }
      break;
    case 'propeller': {
      const o = beanie(0.01, 0, 0, false);
      const y = crownY(o);
      add(at(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 5), m.dark), 0, y + 0.02, 0));
      const blades = mesh(new THREE.BoxGeometry(0.26, 0.006, 0.04), m.teamFlat);
      blades.rotation.y = 0.5;
      add(at(blades, 0, y + 0.046, 0), at(mesh(new THREE.SphereGeometry(0.016, 8, 6), m.white), 0, y + 0.05, 0));
      break;
    }
    case 'partyhat': {
      const c = mesh(new THREE.ConeGeometry(0.09, 0.24, seg(10, 18)).translate(0, 0.12, 0), m.teamFlat);
      stand(c, 0.35, 1.2, hair.outer(1.2) - 0.02, 0);
      const pom = mesh(new THREE.IcosahedronGeometry(0.03, 1), m.white);
      pom.position.copy(c.position).add(v(0, 0.24, 0).applyQuaternion(c.quaternion));
      const stripe = mesh(new THREE.TorusGeometry(0.06, 0.008, 4, 14).rotateX(Math.PI / 2).translate(0, 0.08, 0), m.white);
      stripe.position.copy(c.position);
      stripe.quaternion.copy(c.quaternion);
      add(c, pom, stripe);
      break;
    }
    case 'wizard': {
      const o = hair.outer(1) + 0.01;
      const r = 0.2, y = restY(r, o);
      add(at(mesh(bend(new THREE.ConeGeometry(r, 0.42, seg(12, 22), 8).translate(0, 0.21, 0), 0.9), m.make(0x3b2a7a, { roughness: 0.7 })), 0, y - 0.01, 0.01));
      add(at(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.012, seg(16, 28)), m.make(0x3b2a7a, { roughness: 0.7 })), 0, y - 0.005, 0.01));
      const star = mesh(new THREE.ShapeGeometry(shapeOf('star', 0.035)), m.make(0xffc532, { emissive: 0xffc532, emissiveIntensity: 0.4 }));
      add(at(star, 0.0, y + 0.12, -0.15));
      break;
    }
    case 'chef': {
      const o = hair.outer(0.6) + 0.014;
      const band = () => 0.45;
      add(shell([{ o, th: 0.016, lo: band, hi: () => 0.95 }], m.white));
      const puffs: [THREE.BufferGeometry, THREE.Object3D][] = [];
      for (let i = 0; i < 7; i++) {
        const p = new THREE.Object3D();
        const a = (i / 6) * Math.PI * 2;
        p.position.set(i === 6 ? 0 : Math.sin(a) * 0.11, crownY(o) + 0.08, i === 6 ? 0 : -Math.cos(a) * 0.11);
        puffs.push([new THREE.IcosahedronGeometry(i === 6 ? 0.12 : 0.09, 1), p]);
      }
      add(mesh(bake(puffs), m.white));
      break;
    }
    case 'sunhat':
    case 'ranch':
    case 'tricorn': {
      const o = hair.outer(1) + 0.012;
      const mat = id === 'sunhat' ? m.make(0xd9b26a, { roughness: 0.85 }) : id === 'ranch' ? m.make(0x8a5a33, { roughness: 0.7 }) : m.dark;
      const r = id === 'sunhat' ? 0.17 : 0.16, y = restY(r, o);
      const crownH = id === 'sunhat' ? 0.09 : 0.13;
      add(at(mesh(new THREE.CylinderGeometry(r * 0.9, r, crownH, seg(14, 24)), mat), 0, y + crownH / 2 - 0.01, 0));
      const wide = id === 'sunhat' ? 0.42 : id === 'ranch' ? 0.36 : 0.32;
      const disc = new THREE.RingGeometry(r * 0.9, wide, seg(18, 36), 3);
      const p = disc.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), yy = p.getY(i), d = Math.hypot(x, yy), a = Math.atan2(yy, x);
        const s = (d - r) / (wide - r);
        const lift = id === 'ranch' ? 0.07 * s * s * Math.abs(Math.cos(a)) : id === 'tricorn' ? 0.09 * s * s * (0.5 + 0.5 * Math.cos(3 * a - Math.PI / 2)) : -0.03 * s;
        p.setZ(i, lift);
      }
      disc.rotateX(-Math.PI / 2);
      disc.computeVertexNormals();
      const b = mesh(disc, mat);
      (b.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      add(at(b, 0, y - 0.005, 0));
      add(at(mesh(new THREE.CylinderGeometry(r * 1.005, r * 1.005, 0.025, seg(14, 24)), id === 'tricorn' ? m.make(GOLD, { metalness: 0.8, roughness: 0.3 }) : m.teamFlat), 0, y + 0.012, 0));
      break;
    }
    case 'halo':
      add(ringOf(0.17, 0.016, m.team, clear() + 0.07));
      break;
    case 'twinhalo': {
      const y = clear();
      add(ringOf(0.17, 0.014, m.team, y + 0.06), ringOf(0.12, 0.012, m.make(GOLD, { emissive: GOLD, emissiveIntensity: 0.5 }), y + 0.13, -0.15));
      break;
    }
    case 'starring': {
      const y = clear() + 0.08;
      const stars: [THREE.BufferGeometry, THREE.Object3D][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, s = new THREE.Object3D();
        s.position.set(Math.cos(a) * 0.2, y + Math.sin(a * 2) * 0.015, Math.sin(a) * 0.2);
        s.rotation.y = -a;
        stars.push([new THREE.ExtrudeGeometry(shapeOf('star', 0.035), { depth: 0.01, bevelEnabled: false }), s]);
      }
      add(mesh(bake(stars), m.make(0xffd23f, { emissive: 0xffd23f, emissiveIntensity: 0.55 })));
      break;
    }
    case 'sprout': {
      const o = hair.outer(TOP);
      const y = crownY(o) - 0.005;
      add(at(mesh(bend(new THREE.CylinderGeometry(0.006, 0.008, 0.1, 5, 4).translate(0, 0.05, 0), -2), m.make(0x3f9b3a)), 0, y, 0));
      for (const sx of [-1, 1]) {
        const leaf = mesh(new THREE.SphereGeometry(0.04, 8, 6).scale(1, 0.25, 0.55), m.make(0x6ccf4b, { roughness: 0.5 }));
        leaf.position.set(sx * 0.035, y + 0.09, -0.01);
        leaf.rotation.z = sx * 0.5;
        add(leaf);
      }
      break;
    }
    case 'cone': {
      const o = hair.outer(1) + 0.01;
      const r = 0.19, y = restY(r, o);
      const orange = m.make(0xff7a1a, { roughness: 0.55 });
      add(at(mesh(new THREE.ConeGeometry(r, 0.42, seg(12, 22), 1, true).translate(0, 0.21, 0), orange), 0, y - 0.02, 0));
      for (const [h, rr] of [[0.12, 0.135], [0.25, 0.08]]) add(at(mesh(new THREE.CylinderGeometry(rr, rr * 1.08, 0.04, seg(12, 22), 1, true), m.white), 0, y - 0.02 + h, 0));
      break;
    }
    case 'lightbulb': {
      const y = clear() + 0.09;
      add(at(mesh(new THREE.SphereGeometry(0.075, 14, 10), m.make(0xfff2b0, { emissive: 0xffe066, emissiveIntensity: 1.1, roughness: 0.1 })), 0, y + 0.06, 0));
      add(at(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.05, 10), m.make(0xb9bcc6, { metalness: 0.8, roughness: 0.3 })), 0, y - 0.015, 0));
      break;
    }
    case 'bucketpaint': {
      const o = hair.outer(0.6) + 0.02;
      const r = headAt(0.35, o)[0] + 0.012, y = headAt(0.35, o)[1];
      const tin = m.make(0xc9ced8, { metalness: 0.75, roughness: 0.35 });
      const pail = mesh(new THREE.CylinderGeometry(r * 0.82, r, 0.3, seg(14, 24), 1, true), tin);
      (pail.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      add(at(pail, 0, y + 0.13, 0), at(mesh(new THREE.CircleGeometry(r * 0.82, seg(14, 24)).rotateX(-Math.PI / 2), tin), 0, y + 0.28, 0));
      const drips: [THREE.BufferGeometry, THREE.Object3D][] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3, len = 0.04 + 0.05 * Math.abs(Math.sin(i * 2.7));
        const d = new THREE.Object3D();
        d.position.set(Math.sin(a) * r * 1.01, y - 0.02 - len / 2, -Math.cos(a) * r * 1.01);
        drips.push([new THREE.CapsuleGeometry(0.014, len, 2, 6), d]);
      }
      add(mesh(bake(drips), m.team), at(mesh(new THREE.TorusGeometry(r * 1.01, 0.014, 5, seg(14, 24)).rotateX(Math.PI / 2), m.team), 0, y - 0.015, 0));
      add(at(mesh(new THREE.TorusGeometry(r * 0.9, 0.006, 4, 16, Math.PI), m.dark), 0, y + 0.15, 0));
      break;
    }
    case 'cloud': {
      const y = clear() + 0.1;
      const puffs: [THREE.BufferGeometry, THREE.Object3D][] = [];
      for (const [x, yy, z, r] of [[0, 0, 0, 0.09], [0.1, -0.02, 0.02, 0.07], [-0.1, -0.02, -0.01, 0.07], [0.04, 0.05, -0.03, 0.06], [-0.05, 0.04, 0.04, 0.06]]) {
        const p = new THREE.Object3D();
        p.position.set(x, y + yy, z);
        puffs.push([new THREE.IcosahedronGeometry(r, 1), p]);
      }
      add(mesh(bake(puffs), m.make(0xffffff, { roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.08 })));
      break;
    }
  }
}
