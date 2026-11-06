import * as THREE from 'three';
import { bake, Builder, hairline, headNormal, headPoint, midline, smooth, stand, TOP, Y, type HairStyle, type Kit } from './head';

const SHORT = 0.016;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A close crop: the base of most styles. `part` lifts the hairline on one side. */
function crop(k: Kit, o = SHORT, front = 0.52, fringe = 0.03, part = 0) {
  const line = hairline(front, 0.06, -0.32, fringe);
  return k.shell([{ o, th: 0.012, lo: (phi) => line(phi) + part * smooth(0.05, 0.6, phi) * (1 - smooth(1.2, 1.8, phi)) }], k.m.hair);
}

/**
 * Hair hanging below the head at the back: a curtain from elevation t0 over headings `arc`,
 * dropping `len` metres and flaring out by `flare` at the ends.
 */
function drape(k: Kit, arc: [number, number], t0: number, len: number, flare: number, o = 0.03) {
  const b = new Builder();
  const nI = k.seg(10, 22), nJ = k.seg(3, 6);
  b.slab(nI, nJ, false, (i, j, inner) => {
    const phi = arc[0] + ((arc[1] - arc[0]) * i) / nI;
    const s = 1 - j / nJ; // j = 0 is the hanging end, j = nJ the root
    const p = headPoint(phi, t0, inner ? o - 0.014 : o);
    const out = v(p.x, 0, p.z).normalize();
    return p.addScaledVector(out, flare * s * s).add(v(0, -len * s, 0.02 * s));
  });
  return k.mesh(b.geometry(), k.m.hair);
}

/** A swept crest along the centre line. */
function crest(k: Kit, height: number, sweep: number, width: number, mat = k.m.hair) {
  const K = 14, pts: { base: THREE.Vector3; tip: THREE.Vector3; w: number }[] = [];
  const b = v(), n = v();
  for (let i = 0; i <= K; i++) {
    const a = 0.04 + (0.84 * i) / K;
    midline(a, 0.55, 0.15, SHORT - 0.01, b, n);
    const h = (0.025 + 0.1 * smooth(0, 0.7, a) - 0.05 * smooth(0.75, 1, a)) * height;
    const tip = b.clone().addScaledVector(n, h).add(v(0, 0, sweep * a * a));
    pts.push({ base: b.clone(), tip, w: (0.014 + 0.016 * Math.sin(Math.PI * Math.min(1, a * 1.2))) * width });
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
  return k.mesh(B.geometry(), mat);
}

/** Cones standing out of the hair; `tip` gives them a second colour at the ends. */
function spikes(k: Kit, spots: [phi: number, t: number, h: number, lean: number][], r: number, tip?: THREE.Material) {
  const out: THREE.Mesh[] = [];
  const parts: [THREE.BufferGeometry, THREE.Object3D][] = [];
  const tips: [THREE.BufferGeometry, THREE.Object3D][] = [];
  for (const [phi, t, h, lean] of spots) {
    const o = new THREE.Object3D();
    stand(o, phi, t, SHORT - 0.012, lean);
    parts.push([new THREE.ConeGeometry(r, h, 7).translate(0, h / 2, 0), o]);
    if (tip) tips.push([new THREE.ConeGeometry(r * 0.42, h * 0.36, 7).translate(0, h * 0.82, 0), o.clone()]);
  }
  out.push(k.mesh(bake(parts), k.m.hair));
  if (tip) out.push(k.mesh(bake(tips), tip));
  return out;
}

/** Overlapping tapered blades along the centre line. */
function ridge(k: Kit, n: number, height: number, width: number) {
  const parts: [THREE.BufferGeometry, THREE.Object3D][] = [];
  const b = v(), nn = v();
  for (let i = 0; i < n; i++) {
    const a = 0.08 + (0.78 * i) / (n - 1);
    midline(a, 0.55, 0.2, SHORT - 0.012, b, nn);
    const h = (0.07 + 0.05 * Math.sin(Math.PI * a)) * height;
    const o = new THREE.Object3D();
    o.position.copy(b);
    o.quaternion.setFromUnitVectors(Y, nn);
    parts.push([new THREE.CylinderGeometry(0.008, 0.034 * width, h, 4, 1).rotateY(Math.PI / 4).scale(0.8, 1, 1.7).translate(0, h / 2, 0), o]);
  }
  return k.mesh(bake(parts), k.m.hair);
}

/** A drop-shaped tail tied at the root, hanging along `dir`. */
function tail(k: Kit, phi: number, t: number, size: number, len: number, out: number) {
  const pts = ([[0.001, 0], [0.055, 0.05], [0.075, 0.14], [0.055, 0.24], [0.001, 0.3]] as const).map(([x, y]) => new THREE.Vector2(x * size, y * len));
  const at = headPoint(phi, t, SHORT - 0.01);
  const dir = headNormal(phi, t, SHORT).multiplyScalar(out).add(v(0, -1, 0.15)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(v(0, -1, 0), dir);
  const m = k.mesh(new THREE.LatheGeometry(pts, k.seg(8, 14)).translate(0, -0.3 * len, 0), k.m.hair);
  m.position.copy(at);
  m.quaternion.copy(q);
  const tie = k.mesh(new THREE.TorusGeometry(0.03 * size, 0.012, 5, 10).rotateX(Math.PI / 2).translate(0, -0.035, 0), k.m.accent);
  tie.position.copy(at);
  tie.quaternion.copy(q);
  return [m, tie];
}

/** A round bun with a tie, sitting on the head. */
function bun(k: Kit, phi: number, t: number, r: number) {
  const g = k.mesh(new THREE.IcosahedronGeometry(r, 2).scale(1, 0.9, 1), k.m.hair);
  stand(g, phi, t, SHORT + r * 0.55);
  const tie = k.mesh(new THREE.TorusGeometry(r * 0.62, 0.012, 5, 12).rotateX(Math.PI / 2), k.m.accent);
  stand(tie, phi, t, SHORT + 0.006);
  return [g, tie];
}

/** Small curls scattered over the crop between elevations lo and hi. */
function curls(k: Kit, r: number, lo: number, hi: number, arc = Math.PI) {
  const parts: [THREE.BufferGeometry, THREE.Object3D][] = [];
  const rows = Math.round((hi - lo) / (r * 3.2)) + 1;
  for (let j = 0; j < rows; j++) {
    const t = lo + ((hi - lo) * j) / Math.max(1, rows - 1);
    const ring = Math.max(1, Math.round((Math.cos(t) * 2 * arc * 0.24) / (r * 2.6)));
    for (let i = 0; i < ring; i++) {
      const phi = -arc + ((2 * arc) * (i + (j % 2) * 0.5)) / ring;
      const o = new THREE.Object3D();
      stand(o, phi, t, SHORT + r * 0.3);
      parts.push([new THREE.IcosahedronGeometry(r, 0), o]);
    }
  }
  return k.mesh(bake(parts), k.m.hair);
}

/** Beads of hair along a path, like a braid. */
function braid(k: Kit, from: THREE.Vector3, to: THREE.Vector3, beads: number, r: number) {
  const parts: [THREE.BufferGeometry, THREE.Object3D][] = [];
  for (let i = 0; i < beads; i++) {
    const s = i / (beads - 1);
    const o = new THREE.Object3D();
    o.position.lerpVectors(from, to, s);
    o.position.x += Math.sin(i * 2.1) * r * 0.25;
    o.rotation.y = i * 0.9;
    parts.push([new THREE.IcosahedronGeometry(r * (1 - s * 0.35), 1).scale(1, 1.25, 1), o]);
  }
  const tie = new THREE.Object3D();
  tie.position.copy(to).add(v(0, -r * 0.9, 0));
  parts.push([new THREE.TorusGeometry(r * 0.55, 0.01, 4, 10).rotateX(Math.PI / 2), tie]);
  return k.mesh(bake(parts), k.m.hair);
}

/** Volume swept up at the front (quiff, pompadour, swoop): a rounded wave that dies away to the sides. */
function front(k: Kit, arc: [number, number], height: number, back: number) {
  const mid = (arc[0] + arc[1]) / 2, half = (arc[1] - arc[0]) / 2;
  const across = (phi: number) => Math.max(0, 1 - ((phi - mid) / half) ** 2);
  return k.shell(
    [{ o: SHORT + 0.004, th: 0.014, lo: () => 0.48, hi: () => 1.45, arc, flare: (t, phi) => across(phi) * (height * Math.sin(Math.PI * smooth(0.48, 1.45, t)) ** 1.4 + back * smooth(1.0, 1.45, t)) }],
    k.m.hair,
  );
}

export function buildHair(id: string, k: Kit): { group: THREE.Group; style: HairStyle } {
  const group = new THREE.Group();
  const top: THREE.Object3D[] = [];
  const add = (...o: THREE.Object3D[]) => group.add(...o);
  const tall = (...o: THREE.Object3D[]) => (group.add(...o), top.push(...o));
  let outer: (t: number) => number = () => SHORT;

  switch (id) {
    case 'none':
      outer = () => 0;
      break;
    case 'buzz':
      add(k.shell([{ o: 0.008, th: 0.007, lo: hairline(0.6, 0.08, -0.3) }], k.m.hair));
      outer = () => 0.008;
      break;
    case 'crop':
      add(crop(k));
      break;
    case 'fringe':
      add(crop(k, 0.02, 0.28, 0.07));
      outer = () => 0.02;
      break;
    case 'part':
      add(crop(k, SHORT, 0.4, 0.02, 0.28));
      add(k.shell([{ o: SHORT + 0.012, th: 0.014, lo: () => 0.42, hi: () => 1.15, arc: [-1.5, -0.05], flare: (t) => 0.012 * Math.sin(Math.PI * smooth(0.42, 1.15, t)) }], k.m.hair));
      break;
    case 'fin':
    case 'lowcrest':
    case 'tallcrest':
    case 'inferno': {
      add(crop(k));
      const [h, sweep, w] = { fin: [1, 0.06, 1], lowcrest: [0.6, 0.14, 1.5], tallcrest: [1.7, 0.1, 1.1], inferno: [2.1, 0.16, 1.3] }[id];
      tall(crest(k, h, sweep, w));
      if (id === 'inferno') tall(crest(k, h * 0.62, sweep * 0.8, w * 0.6, k.m.team));
      break;
    }
    case 'spikes':
    case 'frost': {
      add(crop(k));
      const spots: [number, number, number, number][] = [
        [0, 0.86, 0.17, 0.35], [-0.75, 0.95, 0.15, 0.35], [0.75, 0.95, 0.15, 0.35], [-1.7, 0.8, 0.14, 0.35], [1.7, 0.8, 0.14, 0.35],
        [-2.5, 0.75, 0.13, 0.35], [2.5, 0.75, 0.13, 0.35], [Math.PI, 0.9, 0.16, 0.35], [0, 1.35, 0.15, 0.35],
      ];
      tall(...spikes(k, spots, 0.055, id === 'frost' ? k.m.white : undefined));
      break;
    }
    case 'crownspikes': {
      add(crop(k));
      const spots: [number, number, number, number][] = Array.from({ length: 10 }, (_, i) => [(i / 10) * Math.PI * 2 - Math.PI, 0.78, 0.13, 0]);
      tall(...spikes(k, spots, 0.045));
      break;
    }
    case 'wild': {
      add(crop(k));
      const spots: [number, number, number, number][] = Array.from({ length: 15 }, (_, i) => {
        const phi = -Math.PI + (i / 15) * Math.PI * 2 + Math.sin(i * 3.7) * 0.2;
        return [phi, 0.6 + 0.6 * Math.abs(Math.sin(i * 1.9)), 0.12 + 0.09 * Math.abs(Math.sin(i * 2.3)), Math.sin(i * 1.3) * 0.6];
      });
      tall(...spikes(k, spots, 0.05));
      break;
    }
    case 'mohawk':
      add(crop(k, SHORT, 0.56, 0));
      tall(ridge(k, 8, 1, 1));
      break;
    case 'tallridge':
      add(crop(k, 0.009, 0.6, 0));
      tall(ridge(k, 10, 1.9, 1.1));
      outer = () => 0.009;
      break;
    case 'liberty': {
      add(crop(k, 0.009, 0.6, 0));
      const b = v(), n = v();
      const spots: [number, number, number, number][] = [];
      for (let i = 0; i < 6; i++) {
        midline(0.08 + (0.78 * i) / 5, 0.55, 0.2, 0, b, n);
        const a = 0.08 + (0.78 * i) / 5;
        const s = a * (TOP - 0.55 + TOP - 0.2);
        spots.push(s <= TOP - 0.55 ? [0, 0.55 + s, 0.2, 0.1] : [Math.PI, TOP - (s - (TOP - 0.55)), 0.2, 0.1]);
      }
      tall(...spikes(k, spots, 0.04));
      outer = () => 0.009;
      break;
    }
    case 'bob':
    case 'curtain':
    case 'longbob':
    case 'shoulder': {
      // Chin-length all round, open at the face, flaring out at the ends, with a fringe.
      const flare = (t: number) => (t < 0.1 ? (0.1 - t) * 0.06 : 0);
      const lo = (phi: number) => {
        const a = Math.abs(phi);
        return 0.46 + (-0.56 - 0.46) * smooth(0.8, 1.15, a) + (-0.62 + 0.56) * smooth(TOP, Math.PI, a);
      };
      add(k.shell([{ o: 0.03, th: 0.014, lo, flare }], k.m.hair));
      if (id === 'curtain')
        for (const arc of [[-0.95, -0.12], [0.12, 0.95]] as [number, number][])
          add(k.shell([{ o: 0.038, th: 0.01, lo: (phi) => 0.38 + 0.3 * smooth(0.12, 0.9, Math.abs(phi)), hi: () => 0.85, arc }], k.m.hair));
      else add(k.shell([{ o: 0.038, th: 0.01, lo: (phi) => 0.45 + 0.04 * Math.abs(Math.sin(phi * 7)), hi: () => 0.8, arc: [-0.9, 0.9] }], k.m.hair));
      if (id === 'longbob') add(drape(k, [1.35, 2 * Math.PI - 1.35], -0.45, 0.12, 0.03, 0.04));
      if (id === 'shoulder') add(drape(k, [1.1, 2 * Math.PI - 1.1], -0.3, 0.3, 0.05, 0.04));
      outer = (t) => 0.04 + flare(t);
      break;
    }
    case 'long':
      add(crop(k, 0.024, 0.42, 0.05));
      add(drape(k, [1.05, 2 * Math.PI - 1.05], 0.15, 0.55, 0.05, 0.03));
      outer = () => 0.03;
      break;
    case 'tails':
      add(crop(k));
      for (const sx of [-1, 1]) add(...tail(k, sx * 2.35, -0.05, 1, 1, 0.5));
      break;
    case 'pigtails':
      add(crop(k));
      for (const sx of [-1, 1]) add(...tail(k, sx * 1.85, 0.6, 0.9, 0.9, 1.3));
      break;
    case 'lowtails':
      add(crop(k));
      for (const sx of [-1, 1]) add(...tail(k, sx * 2.6, -0.42, 0.85, 1.25, 0.2));
      break;
    case 'pony':
      add(crop(k));
      add(...tail(k, Math.PI, 0.42, 1.1, 1.6, 0.9));
      break;
    case 'topbun':
      add(crop(k, SHORT, 0.55, 0));
      tall(...bun(k, Math.PI, 1.25, 0.085));
      break;
    case 'spacebuns':
      add(crop(k));
      for (const sx of [-1, 1]) tall(...bun(k, sx * 0.95, 0.95, 0.075));
      break;
    case 'lowbun':
      add(crop(k, SHORT, 0.55, 0));
      add(...bun(k, Math.PI, -0.12, 0.08));
      break;
    case 'puff':
    case 'bigpuff': {
      const o = id === 'puff' ? 0.075 : 0.12;
      add(k.shell([{ o, th: 0.03, lo: hairline(0.55, 0.0, -0.35), flare: (t) => o * 0.25 * Math.sin(Math.max(0, t)) }], k.m.hair));
      outer = (t) => o + o * 0.25 * Math.sin(Math.max(0, t));
      break;
    }
    case 'puffy':
      add(crop(k));
      for (const sx of [-1, 1]) {
        const p = k.mesh(new THREE.IcosahedronGeometry(0.1, 2), k.m.hair);
        stand(p, sx * 1.7, 0.6, SHORT + 0.06);
        add(p);
      }
      break;
    case 'curlcrop':
      add(crop(k, SHORT, 0.55, 0));
      add(curls(k, 0.028, 0.15, 1.45));
      outer = () => SHORT + 0.03;
      break;
    case 'curltop':
      add(crop(k, 0.01, 0.6, 0));
      tall(curls(k, 0.042, 0.75, 1.5, 1.3));
      outer = () => 0.01;
      break;
    case 'braid':
      add(crop(k, SHORT, 0.5, 0.02));
      add(braid(k, headPoint(Math.PI, 0.25, SHORT + 0.03), v(0, -0.32, 0.27), 7, 0.045));
      break;
    case 'twinbraids':
      add(crop(k, SHORT, 0.5, 0.02));
      for (const sx of [-1, 1]) add(braid(k, headPoint(sx * 1.95, -0.15, SHORT + 0.03), v(sx * 0.21, -0.3, 0.07), 6, 0.038));
      break;
    case 'quiff':
      add(crop(k, SHORT, 0.55, 0));
      tall(front(k, [-1.1, 1.1], 0.05, 0.005));
      break;
    case 'pompadour':
      add(crop(k, SHORT, 0.55, 0));
      tall(front(k, [-1.3, 1.3], 0.09, 0.02));
      break;
    case 'swoop':
      add(crop(k, SHORT, 0.5, 0.02, 0.2));
      tall(front(k, [-1.5, 0.45], 0.06, 0));
      break;
    default:
      add(crop(k));
  }
  return { group, style: { outer, top } };
}
