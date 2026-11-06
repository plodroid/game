import * as THREE from 'three';
import { shapeOf } from './gear';
import { bake, headPoint, onFace, smooth, surfaceTube, type Kit } from './head';

/** The eyes sit at these headings and elevation; everything worn on the face is placed from them. */
const EYE = 0.37, EYE_T = -0.05;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Builds a face item; returns its meshes (the head adds them). */
export function buildFace(id: string, k: Kit): THREE.Object3D[] {
  const { m, mesh, shell, seg } = k;
  const out: THREE.Object3D[] = [];
  const add = (...o: THREE.Object3D[]) => out.push(...o);
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, phi: number, t: number, o: number) => {
    const x = mesh(geo, mat);
    onFace(x, phi, t, o);
    add(x);
    return x;
  };
  /** Paint on the skin: flat pieces just above it. */
  const decal = (geo: THREE.BufferGeometry, mat: THREE.Material, spots: [number, number, number?][]) => {
    // Flat shapes face +z; the face looks down -z.
    geo.rotateY(Math.PI);
    const parts: [THREE.BufferGeometry, THREE.Object3D][] = spots.map(([phi, t, rot = 0]) => {
      const o = new THREE.Object3D();
      onFace(o, phi, t, 0.003);
      o.rotateZ(rot);
      return [geo.clone(), o];
    });
    geo.dispose();
    add(mesh(bake(parts), mat));
  };
  /** Frames and lenses over both eyes, a bridge and arms back to the ears. */
  const glasses = (frame: (sx: number) => THREE.BufferGeometry | null, lens: ((sx: number) => THREE.BufferGeometry) | null, frameMat: THREE.Material, lensMat: THREE.Material, o = 0.034) => {
    for (const sx of [-1, 1]) {
      const f = frame(sx);
      if (f) put(f, frameMat, sx * EYE, EYE_T, o);
      if (lens) put(lens(sx), lensMat, sx * EYE, EYE_T, o - 0.002);
    }
    add(mesh(surfaceTube(-0.2, 0.2, () => EYE_T + 0.03, o + 0.004, 0.007, 8), frameMat));
    for (const sx of [-1, 1]) add(mesh(surfaceTube(sx * 0.62, sx * 1.55, () => EYE_T + 0.02, o * 0.6, 0.006, 10), frameMat));
  };
  const ring = (r: number, tube: number, sides = 20) => new THREE.TorusGeometry(r, tube, 5, sides);
  const disc = (r: number, sides = 18) => new THREE.CircleGeometry(r, sides).rotateY(Math.PI);
  const flat = (s: THREE.Shape) => new THREE.ShapeGeometry(s);
  const darkGlass = m.make(0x1a1822, { transparent: true, opacity: 0.82, roughness: 0.05, metalness: 0.3 });

  switch (id) {
    case 'round':
      glasses(() => ring(0.058, 0.008), () => disc(0.055), m.dark, m.make(0xdff2ff, { transparent: true, opacity: 0.2, roughness: 0.05 }));
      break;
    case 'nerd': {
      glasses(() => ring(0.062, 0.014), () => disc(0.056), m.dark, m.make(0xdff2ff, { transparent: true, opacity: 0.2, roughness: 0.05 }));
      put(new THREE.BoxGeometry(0.03, 0.03, 0.02), m.white, 0, EYE_T + 0.03, 0.04);
      break;
    }
    case 'square':
      glasses(() => ring(0.07, 0.008, 4).rotateZ(Math.PI / 4).scale(1, 0.78, 1), () => new THREE.PlaneGeometry(0.094, 0.072).rotateY(Math.PI), m.dark, m.make(0xdff2ff, { transparent: true, opacity: 0.2, roughness: 0.05 }));
      break;
    case 'cateye':
      glasses((sx) => ring(0.058, 0.01).scale(1.25, 0.82, 1).rotateZ(sx * -0.25), (sx) => disc(0.055).scale(1.2, 0.8, 1).rotateZ(sx * -0.25), m.teamFlat, m.make(0x2a2030, { transparent: true, opacity: 0.6 }));
      break;
    case 'aviators':
      glasses(() => ring(0.06, 0.006).scale(1, 1.12, 1).translate(0, -0.008, 0), () => disc(0.058).scale(1, 1.12, 1).translate(0, -0.008, 0), m.make(0xe0b03a, { metalness: 0.85, roughness: 0.25 }), darkGlass);
      break;
    case 'shades': {
      add(shell([{ o: 0.032, th: 0.006, lo: () => -0.2, hi: () => 0.1, arc: [-1.05, 1.05] }], darkGlass));
      for (const sx of [-1, 1]) add(mesh(surfaceTube(sx * 1.0, sx * 1.55, () => EYE_T + 0.03, 0.02, 0.006, 8), m.dark));
      break;
    }
    case 'starshades':
    case 'heartshades': {
      const s = shapeOf(id === 'starshades' ? 'star' : 'heart', 0.07);
      glasses(() => null, () => new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false }), m.dark, m.make(id === 'starshades' ? 0xffc532 : 0xff4d94, { transparent: true, opacity: 0.88, roughness: 0.15, emissive: id === 'starshades' ? 0xffc532 : 0xff4d94, emissiveIntensity: 0.25 }));
      break;
    }
    case 'monocle': {
      const gold = m.make(0xe0b03a, { metalness: 0.85, roughness: 0.25 });
      put(ring(0.062, 0.008), gold, EYE, EYE_T, 0.032);
      put(disc(0.058), m.make(0xdff2ff, { transparent: true, opacity: 0.25 }), EYE, EYE_T, 0.03);
      const p = headPoint(EYE + 0.06, EYE_T - 0.2, 0.034);
      const chain = [p, headPoint(EYE + 0.2, -0.55, 0.05), v(0.12, -0.12, -0.2)];
      add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(chain), 10, 0.003, 4), gold));
      break;
    }
    case 'patch': {
      put(disc(0.07).scale(1, 1.1, 1), m.dark, -EYE, EYE_T, 0.012);
      add(mesh(surfaceTube(-EYE - 0.05, -EYE - 0.05 - 2 * Math.PI + 0.9, (phi) => EYE_T + 0.32 * Math.sin(((phi + EYE + 0.05) / (2 * Math.PI - 0.9)) * -Math.PI), 0.02, 0.008, 24), m.dark));
      break;
    }
    case 'pencil':
      put(new THREE.CapsuleGeometry(0.008, 0.08, 2, 6).rotateZ(Math.PI / 2), m.hair, 0, -0.36, 0.008);
      break;
    case 'handlebar': {
      const pts = [v(-0.075, 0.02, 0), v(-0.05, -0.008, 0), v(0, 0, 0), v(0.05, -0.008, 0), v(0.075, 0.02, 0)];
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.013, 6);
      put(g, m.hair, 0, -0.38, 0.012);
      break;
    }
    case 'walrus':
      put(new THREE.SphereGeometry(0.055, 12, 8).scale(1.4, 0.55, 0.45), m.hair, 0, -0.42, 0.01);
      break;
    case 'goatee':
      put(new THREE.ConeGeometry(0.03, 0.06, 8).rotateX(Math.PI).scale(1, 1, 0.6), m.hair, 0, -0.95, 0.012);
      break;
    case 'beard':
      add(shell([{ o: 0.016, th: 0.014, lo: () => -1.5, hi: (phi) => -0.62 + 0.62 * smooth(0.25, 1.4, Math.abs(phi)), arc: [-1.55, 1.55] }], m.hair));
      break;
    case 'bandanamask': {
      add(shell([{ o: 0.014, th: 0.01, lo: () => -1.45, hi: () => -0.2, arc: [-1.75, 1.75] }], m.accent));
      const knot = mesh(new THREE.ConeGeometry(0.05, 0.1, 4).rotateX(Math.PI), m.accent);
      knot.position.set(0, -0.12, -0.235);
      add(knot);
      break;
    }
    case 'stripes':
      decal(new THREE.PlaneGeometry(0.07, 0.016), m.team, [[0.62, -0.28], [0.62, -0.36], [-0.62, -0.28], [-0.62, -0.36]]);
      break;
    case 'warpaint':
      add(shell([{ o: 0.004, th: 0.002, lo: () => -0.26, hi: () => -0.17, arc: [-1.0, 1.0] }], m.team));
      break;
    case 'freckles': {
      const spots: [number, number][] = [];
      for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) spots.push([sx * (0.36 + (i % 3) * 0.1), -0.27 - Math.floor(i / 3) * 0.07 + (i % 2) * 0.02]);
      decal(new THREE.CircleGeometry(0.009, 6), m.make(0x8a5a33, { roughness: 0.9 }), spots);
      break;
    }
    case 'blush':
      decal(new THREE.CircleGeometry(0.04, 16).scale(1.25, 0.8, 1), m.make(0xff8fae, { transparent: true, opacity: 0.6, roughness: 0.9 }), [[0.6, -0.33], [-0.6, -0.33]]);
      break;
    case 'bandaid':
      decal(new THREE.PlaneGeometry(0.075, 0.025), m.make(0xe8c49a, { roughness: 0.8 }), [[0.55, -0.32, 0.5]]);
      break;
    case 'splatmark':
      decal(flat(shapeOf('splat', 0.04)), m.team, [[-0.6, -0.3]]);
      break;
    case 'starcheek':
      decal(flat(shapeOf('star', 0.035)), m.make(0xffc532, { emissive: 0xffc532, emissiveIntensity: 0.3 }), [[0.6, -0.3]]);
      break;
    case 'tear':
      decal(flat(shapeOf('heart', 0.02)).rotateZ(Math.PI), m.make(0x35d0ff, { emissive: 0x35d0ff, emissiveIntensity: 0.3 }), [[-EYE, -0.3]]);
      break;
    case 'whiskers': {
      const parts: [THREE.BufferGeometry, THREE.Object3D][] = [];
      for (const sx of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const o = new THREE.Object3D();
          onFace(o, sx * 0.55, -0.33 - i * 0.05, 0.004);
          o.rotateZ(sx * (i - 1) * 0.18);
          parts.push([new THREE.BoxGeometry(0.1, 0.006, 0.006).translate(sx * 0.05, 0, 0), o]);
        }
      add(mesh(bake(parts), m.dark));
      break;
    }
    case 'nose':
      put(new THREE.SphereGeometry(0.035, seg(10, 16), seg(8, 12)), m.make(0xe8333f, { roughness: 0.3 }), 0, -0.2, 0.02);
      break;
    case 'gum':
      put(new THREE.SphereGeometry(0.055, seg(10, 16), seg(8, 12)), m.make(0xff8fc8, { transparent: true, opacity: 0.85, roughness: 0.2 }), 0, -0.45, 0.05);
      break;
  }
  return out;
}
