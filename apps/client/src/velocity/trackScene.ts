import * as THREE from 'three';
import { SURFACES, type TrackPath, type TrackTheme, type RoadSurface } from '@chromashift/shared';
import { SHADOW_LAYER } from '../characters/compact';
import { Ocean } from '../rendering/ocean';
import { SummerSky, type SkyLook } from '../rendering/sky';
import { facadeTexture } from '../rendering/textures';
import { treeParts } from '../rendering/props';
import { chamferBox, Parts, roughen, tube, turned } from '../modeling/kit';

/*
 * What a track looks like: the road with its markings and kerbs, the verges, the walls, bridges
 * and tunnels, the start gantry, and scenery that sets each theme: the summer sky and sea from
 * the shooter, palms on the coast, containers and cranes at the docks, towers in the city, red
 * rock in the canyon, pines in the snow, neon at dusk. Scenery is instanced, so it stays cheap.
 */

interface ThemeLook {
  sun: [number, number, number];
  clouds: number;
  haze: number;
  sunI: number;
  ground: number;
  /** Lights on (dusk). */
  night?: boolean;
  wall: 'barrier' | 'tyres' | 'rail' | 'neon' | 'rock' | 'hedge' | 'snow';
  accent: number;
}

const LOOKS: Record<TrackTheme, ThemeLook> = {
  coast: { sun: [0.45, 0.8, 0.35], clouds: 0.38, haze: 2, sunI: 3.1, ground: 0xe8d3a2, wall: 'barrier', accent: 0xff3f8e },
  neon: { sun: [-0.7, 0.13, 0.4], clouds: 0.28, haze: 2.6, sunI: 2.1, ground: 0x3a3848, night: true, wall: 'neon', accent: 0x40fff0 },
  canyon: { sun: [0.3, 0.7, -0.55], clouds: 0.22, haze: 2.4, sunI: 3.3, ground: 0xc77a4a, wall: 'rock', accent: 0xffc21a },
  city: { sun: [-0.4, 0.72, 0.5], clouds: 0.36, haze: 2.1, sunI: 3, ground: 0x8a8f99, wall: 'rail', accent: 0x19d3be },
  docks: { sun: [0.6, 0.62, -0.3], clouds: 0.4, haze: 2.3, sunI: 3, ground: 0x9a9da4, wall: 'tyres', accent: 0xffc21a },
  garden: { sun: [0.2, 0.78, 0.55], clouds: 0.42, haze: 1.9, sunI: 3, ground: 0x5fa64a, wall: 'hedge', accent: 0xff7ab8 },
  core: { sun: [-0.3, 0.5, -0.6], clouds: 0.3, haze: 2.5, sunI: 2.2, ground: 0x3a3f4c, night: true, wall: 'neon', accent: 0x8b5cff },
  arcade: { sun: [0.5, 0.75, 0.4], clouds: 0.34, haze: 2, sunI: 3, ground: 0x7a5cd0, wall: 'barrier', accent: 0xffc21a },
  snow: { sun: [0.35, 0.45, 0.6], clouds: 0.5, haze: 1.7, sunI: 2.6, ground: 0xeef3fa, wall: 'snow', accent: 0x2f6dff },
  sunset: { sun: [0.85, 0.12, 0.2], clouds: 0.32, haze: 2.8, sunI: 2.2, ground: 0xd9b27a, night: false, wall: 'barrier', accent: 0xff7a1a },
};
export const themeLook = (t: TrackTheme) => LOOKS[t];

const C = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Asphalt with grain, edge lines and a dashed centre line. u across the road, v along (10 m). */
function roadTexture(surface: RoadSurface, size: number) {
  return canvasTex(size, size, (g) => {
    const r = rnd(7);
    const base = { asphalt: 0x3b3d44, dirt: 0x9b6a42, sand: 0xd8be8a, grass: 0x4f8f3a, ice: 0xbfe0f2, snow: 0xe6edf5, metal: 0x5b616d }[surface];
    g.fillStyle = C(base);
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 6; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
    }
    if (surface === 'asphalt' || surface === 'metal') {
      g.fillStyle = '#f2f2ee';
      g.fillRect(size * 0.035, 0, size * 0.018, size);
      g.fillRect(size * 0.947, 0, size * 0.018, size);
      for (let y = 0; y < size; y += size / 2) g.fillRect(size * 0.493, y, size * 0.014, size / 4);
    }
    if (surface === 'ice') {
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 30; i++) {
        g.beginPath();
        g.moveTo(r() * size, r() * size);
        g.lineTo(r() * size, r() * size);
        g.stroke();
      }
    }
    if (surface === 'dirt' || surface === 'sand') {
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 3;
      for (const x of [0.3, 0.38, 0.62, 0.7]) {
        g.beginPath();
        g.moveTo(size * x, 0);
        g.lineTo(size * x + 6, size);
        g.stroke();
      }
    }
  });
}

function vergeTexture(surface: RoadSurface) {
  return canvasTex(128, 128, (g) => {
    const r = rnd(3);
    const base = { asphalt: 0x55575e, dirt: 0xa77a50, sand: 0xe9d4a4, grass: 0x5ea548, ice: 0xd8eef8, snow: 0xf2f6fb, metal: 0x6a707c }[surface];
    g.fillStyle = C(base);
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
      g.fillRect(r() * 128, r() * 128, 2, 2);
    }
  });
}

const kerbTex = () =>
  canvasTex(16, 64, (g) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#f2f2ee' : '#d7192f';
      g.fillRect(0, i * 16, 16, 16);
    }
  });

function wallTexture(style: ThemeLook['wall'], accent: number) {
  return canvasTex(64, 64, (g) => {
    switch (style) {
      case 'tyres':
        for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) {
          g.fillStyle = (x + y) % 32 ? '#22242a' : '#2c2f36';
          g.beginPath();
          g.arc(x + 8, y + 8, 8, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = C(accent);
        g.fillRect(0, 30, 64, 4);
        break;
      case 'rail':
        g.fillStyle = '#c9ced6';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#8d939e';
        for (const y of [14, 40]) g.fillRect(0, y, 64, 10);
        break;
      case 'neon':
        g.fillStyle = '#1b1d26';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = C(accent);
        g.fillRect(0, 6, 64, 6);
        g.fillRect(0, 52, 64, 4);
        break;
      case 'rock':
        g.fillStyle = '#b5663f';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        for (let i = 0; i < 6; i++) g.fillRect(0, i * 11, 64, 3);
        break;
      case 'hedge':
        g.fillStyle = '#2f7a3a';
        g.fillRect(0, 0, 64, 64);
        for (let i = 0; i < 160; i++) {
          g.fillStyle = i % 2 ? '#3f9a48' : '#24642e';
          g.fillRect(Math.random() * 64, Math.random() * 64, 4, 4);
        }
        break;
      case 'snow':
        g.fillStyle = '#e8eef6';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#d7192f';
        g.fillRect(0, 26, 64, 8);
        break;
      default:
        g.fillStyle = '#e8e6e0';
        g.fillRect(0, 0, 64, 64);
        for (let x = 0; x < 64; x += 32) {
          g.fillStyle = C(accent);
          g.fillRect(x, 10, 16, 44);
        }
    }
  });
}

const checkerTex = () =>
  canvasTex(64, 16, (g) => {
    for (let x = 0; x < 64; x += 8) for (let y = 0; y < 16; y += 8) {
      g.fillStyle = (x + y) % 16 ? '#15161b' : '#f2f2ee';
      g.fillRect(x, y, 8, 8);
    }
  });

/** Builds a strip between two lateral offsets along the whole loop. */
function strip(p: TrackPath, from: (i: number) => number, to: (i: number) => number, vScale: number, lift = 0, uFrom = 0, uTo = 1, only?: (i: number) => boolean) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = p.n;
  let v = 0;
  let prev = -1;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (only && !only(k)) {
      prev = -1;
      continue;
    }
    if (i > 0) v += (p.length / n) / vScale;
    for (const [off, u] of [
      [from(k), uFrom],
      [to(k), uTo],
    ] as const) {
      pos.push(p.px[k] + p.lx[k] * off + p.ux[k] * lift, p.py[k] + p.ly[k] * off + p.uy[k] * lift, p.pz[k] + p.lz[k] * off + p.uz[k] * lift);
      uv.push(u, v);
    }
    const cur = pos.length / 3 - 2;
    if (prev >= 0) idx.push(prev, prev + 1, cur, prev + 1, cur + 1, cur);
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface TrackOptions {
  tier: number;
  lambert: boolean;
  shadows: boolean;
  shadowResolution: number;
  drawDistance: number;
  reflections: boolean;
  textureQuality: number;
}

export interface TrackScene {
  group: THREE.Group;
  sky: SummerSky;
  sun: THREE.DirectionalLight;
  ocean: Ocean | null;
  look: ThemeLook;
  envMap: THREE.Texture | null;
  /** Keep the sun's shadow box around a point (the camera's car). */
  follow(x: number, y: number, z: number): void;
  update(dt: number): void;
  setFar(far: number): void;
  dispose(): void;
}

export function buildTrackScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer, p: TrackPath, o: TrackOptions): TrackScene {
  const def = p.def, look = LOOKS[def.theme];
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const keep = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T) => (disposables.push(x), x);
  const M = (opts: THREE.MeshStandardMaterialParameters) =>
    keep(o.lambert ? new THREE.MeshLambertMaterial({ color: opts.color, map: opts.map, emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity }) : new THREE.MeshStandardMaterial(opts));
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    keep(g);
    const x = new THREE.Mesh(g, m);
    x.receiveShadow = o.shadows;
    x.castShadow = o.shadows && shadow;
    group.add(x);
    return x;
  };

  // Sky, light and fog.
  const skyLook: SkyLook = { sunDir: new THREE.Vector3(...look.sun).normalize(), turbidity: look.haze, clouds: look.clouds, seed: def.id.length * 1.37 };
  const sky = new SummerSky(renderer, skyLook, o.tier);
  group.add(sky.mesh);
  let far = Math.max(260, o.drawDistance * 2.2);
  const fog = new THREE.FogExp2(sky.light.haze.clone(), 1.25 / far);
  scene.fog = fog;
  let envMap: THREE.Texture | null = null;
  if (o.reflections && !o.lambert) {
    envMap = sky.environment();
    scene.environment = envMap;
    scene.environmentIntensity = look.night ? 0.35 : 0.6;
  }
  const skyTint = sky.light.skyAmbient.clone().multiplyScalar(1 / Math.max(sky.light.skyAmbient.r, sky.light.skyAmbient.g, sky.light.skyAmbient.b, 1e-4)).lerp(new THREE.Color(1, 1, 1), 0.4);
  group.add(new THREE.HemisphereLight(skyTint, new THREE.Color(look.ground), (envMap ? 0.45 : 1.25) * (look.night ? 0.8 : 1)));
  const sun = new THREE.DirectionalLight(sky.light.sunColor, look.sunI);
  group.add(sun, sun.target);
  if (o.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(o.shadowResolution, o.shadowResolution);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -55;
    cam.right = cam.top = 55;
    cam.near = 5;
    cam.far = 260;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2.4;
    cam.layers.enable(SHADOW_LAYER);
  }

  const texSize = [256, 512, 512, 1024][o.textureQuality] ?? 512;
  // Road: one strip per surface run (the surface can change along the lap).
  const surfaces = new Set<number>([...p.surf]);
  for (const s of surfaces) {
    const surf = SURFACES[s] ?? 'asphalt';
    const tex = keep(roadTexture(surf, texSize));
    const g = strip(p, (i) => p.w[i], (i) => -p.w[i], 10, 0.02, 0, 1, (i) => p.surf[i] === s || p.surf[(i + 1) % p.n] === s);
    mesh(g, M({ map: tex, roughness: surf === 'ice' ? 0.15 : surf === 'asphalt' ? 0.82 : 0.95, metalness: surf === 'metal' ? 0.5 : 0 }), false);
  }
  // Verges.
  const vtex = keep(vergeTexture(def.verge));
  vtex.repeat.set(1, 1);
  const vmat = M({ map: vtex, roughness: 0.95 });
  mesh(strip(p, (i) => p.w[i] + def.shoulder, (i) => p.w[i], 6, 0.01), vmat, false);
  mesh(strip(p, (i) => -p.w[i], (i) => -p.w[i] - def.shoulder, 6, 0.01), vmat, false);
  // Kerbs on corners.
  const ktex = keep(kerbTex());
  const kmat = M({ map: ktex, roughness: 0.6 });
  const corner = (i: number) => Math.abs(p.curv[i]) > 1 / 70;
  mesh(strip(p, (i) => p.w[i] + 0.9, (i) => p.w[i] - 0.1, 4, 0.05, 0, 1, corner), kmat, false);
  mesh(strip(p, (i) => -p.w[i] + 0.1, (i) => -p.w[i] - 0.9, 4, 0.05, 0, 1, corner), kmat, false);
  // Start/finish line.
  {
    const ctex = keep(checkerTex());
    ctex.repeat.set(4, 1);
    const g = strip(p, (i) => p.w[i], (i) => -p.w[i], 1, 0.035, 0, 1, (i) => i === 0 || i === 1);
    mesh(g, M({ map: ctex, roughness: 0.7 }), false);
  }
  barriers(group, p, look, o, keep, M);
  // Under the road: a deck edge where it's raised, and pillars down to the ground.
  const deckMat = M({ color: 0x8a8d96, roughness: 0.85 });
  const raised = (i: number) => p.py[i] - def.ground > 1.2;
  if (p.py.some((_, i) => raised(i))) {
    mesh(strip(p, (i) => p.w[i] + def.shoulder + 0.6, (i) => -(p.w[i] + def.shoulder + 0.6), 10, -0.65, 0, 1, raised), deckMat, true);
    const pillarG = keep(new THREE.BoxGeometry(1.4, 1, 1.4));
    const spots: THREE.Matrix4[] = [];
    for (let i = 0; i < p.n; i += 9) {
      const h = p.py[i] - def.ground;
      if (h < 2) continue;
      // Not where another stretch of road runs underneath.
      let clear = true;
      for (let j = 0; j < p.n; j += 3) {
        if (Math.abs(j - i) < 20 || Math.abs(j - i) > p.n - 20) continue;
        if (Math.hypot(p.px[j] - p.px[i], p.pz[j] - p.pz[i]) < p.w[j] + def.shoulder + 3 && p.py[j] < p.py[i] - 3) clear = false;
      }
      if (!clear) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.px[i], def.ground + h / 2 - 0.4, p.pz[i]), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      spots.push(m);
    }
    if (spots.length) {
      const im = new THREE.InstancedMesh(pillarG, deckMat, spots.length);
      spots.forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = o.shadows;
      im.receiveShadow = o.shadows;
      group.add(im);
    }
  }
  // Tunnels: an arch over the road.
  if (p.tunnel.some((t) => t)) {
    const tunMat = M({ color: 0x2c2f38, roughness: 0.7, side: THREE.BackSide });
    const lightMat = keep(new THREE.MeshBasicMaterial({ color: look.accent }));
    const seg = 12;
    const pos: number[] = [], idx: number[] = [];
    const lights: THREE.Matrix4[] = [];
    let prev = -1;
    for (let i = 0; i <= p.n; i++) {
      const k = i % p.n;
      if (!p.tunnel[k]) {
        prev = -1;
        continue;
      }
      const r = p.w[k] + def.shoulder + 0.6;
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI;
        const off = Math.cos(a) * r, up = Math.sin(a) * Math.max(6, r * 0.75);
        pos.push(p.px[k] + p.lx[k] * off + p.ux[k] * up, p.py[k] + p.ly[k] * off + p.uy[k] * up - 0.3, p.pz[k] + p.lz[k] * off + p.uz[k] * up);
      }
      const cur = pos.length / 3 - (seg + 1);
      if (prev >= 0) for (let j = 0; j < seg; j++) idx.push(prev + j, cur + j, prev + j + 1, prev + j + 1, cur + j, cur + j + 1);
      prev = cur;
      if (k % 6 === 0) lights.push(new THREE.Matrix4().compose(new THREE.Vector3(p.px[k] + p.ux[k] * 5.6, p.py[k] + 5.6, p.pz[k] + p.uz[k] * 5.6), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.tx[k], p.tz[k])), new THREE.Vector3(1, 1, 1)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    mesh(g, tunMat, false);
    if (lights.length) {
      const im = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(2.5, 0.12, 0.6)), lightMat, lights.length);
      lights.forEach((m, k) => im.setMatrixAt(k, m));
      group.add(im);
    }
  }
  // Start gantry.
  {
    const i = 0;
    const w = p.w[i] + def.shoulder + 0.6;
    const postMat = M({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
    for (const s of [1, -1]) {
      const post = mesh(new THREE.BoxGeometry(0.5, 7, 0.5), postMat);
      post.position.set(p.px[i] + p.lx[i] * w * s, p.py[i] + 3.5, p.pz[i] + p.lz[i] * w * s);
    }
    const bannerTex = keep(
      canvasTex(512, 64, (g) => {
        g.fillStyle = '#15161b';
        g.fillRect(0, 0, 512, 64);
        for (let x = 0; x < 512; x += 16) for (let y = 0; y < 16; y += 8) {
          g.fillStyle = (x / 16 + y / 8) % 2 ? '#15161b' : '#f2f2ee';
          g.fillRect(x, y, 16, 8);
          g.fillRect(x, 48 + y, 16, 8);
        }
        g.fillStyle = '#ff3f8e';
        g.font = '900 italic 30px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('VELOCITY', 256, 42);
      }),
    );
    bannerTex.wrapS = THREE.ClampToEdgeWrapping;
    const banner = mesh(new THREE.BoxGeometry(w * 2, 1.4, 0.3), M({ map: bannerTex, roughness: 0.6, emissive: new THREE.Color(0x222222) }));
    banner.position.set(p.px[i], p.py[i] + 6.6, p.pz[i]);
    banner.rotation.y = Math.atan2(p.lx[i], p.lz[i]) + Math.PI / 2;
  }

  // Ground and sea.
  const b = p.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 300;
  let ocean: Ocean | null = null;
  const groundTex = keep(vergeTexture(def.theme === 'snow' ? 'snow' : def.theme === 'garden' ? 'grass' : def.theme === 'canyon' ? 'dirt' : def.theme === 'coast' || def.theme === 'sunset' ? 'sand' : 'asphalt'));
  groundTex.repeat.set(span / 12, span / 12);
  const sea = def.sea !== null;
  const gw = sea ? b.maxX - b.minX + 90 : span, gd = sea ? b.maxZ - b.minZ + 90 : span;
  const groundGeo = sea ? new THREE.CircleGeometry(0.5, 64).scale(gw, gd, 1) : new THREE.PlaneGeometry(span, span);
  if (sea) groundTex.repeat.set(gw / 12, gd / 12);
  const ground = mesh(groundGeo, M({ map: groundTex, color: look.ground, roughness: 0.95 }), false);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, def.ground - 0.3, cz);
  if (sea) {
    // A sandy shelf sloping into the water all round the island.
    const shelf = mesh(new THREE.RingGeometry(0.5, 0.62, 64).scale(gw, gd, 1), M({ color: 0xe6cf9c, roughness: 0.95 }), false);
    shelf.rotation.x = -Math.PI / 2;
    shelf.position.set(cx, (def.ground - 0.3 + (def.sea ?? 0)) / 2, cz);
  }
  if (def.sea !== null) {
    // Land around the track, sea beyond it.
    ocean = new Ocean(sky, { tier: o.tier, level: def.sea, x: cx, z: cz, far, shores: [{ x: cx, z: cz, r: Math.max(gw, gd) * 0.55 }] });
    group.add(ocean.mesh);
  }

  scenery(group, p, look, o, keep, M);
  roadside(group, p, look, o, keep, M);

  scene.add(group);
  const sunDir = skyLook.sunDir;
  return {
    group,
    sky,
    sun,
    ocean,
    look,
    envMap,
    follow(x, y, z) {
      sun.position.set(x + sunDir.x * 120, y + sunDir.y * 120, z + sunDir.z * 120);
      sun.target.position.set(x, y, z);
    },
    update(dt) {
      sky.update(dt);
      ocean?.update(dt);
    },
    setFar(f) {
      far = f;
      fog.density = 1.25 / f;
      ocean?.setFar(f);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      sky.dispose();
      ocean?.dispose();
      envMap?.dispose();
      scene.environment = null;
      group.removeFromParent();
    },
  };
}

/** Theme scenery beside the track, instanced. */
function scenery(
  group: THREE.Group,
  p: TrackPath,
  look: ThemeLook,
  o: TrackOptions,
  keep: <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T) => T,
  M: (opts: THREE.MeshStandardMaterialParameters) => THREE.Material,
) {
  const def = p.def, r = rnd(def.id.length * 977 + 13);
  const density = [0.35, 0.6, 1, 1.3, 1.6][o.tier] ?? 1;
  /** Spots beside the road, not on any part of it. */
  const spots = (count: number, near: number, farOff: number) => {
    const out: { x: number; y: number; z: number; yaw: number; s: number }[] = [];
    for (let k = 0; k < count * 3 && out.length < count; k++) {
      const i = Math.floor(r() * p.n);
      const side = r() < 0.5 ? 1 : -1;
      const off = side * (p.w[i] + def.shoulder + near + r() * (farOff - near));
      const x = p.px[i] + p.lx[i] * off, z = p.pz[i] + p.lz[i] * off;
      // Keep clear of every stretch of road.
      let ok = true;
      for (let j = 0; j < p.n; j += 4) if (Math.hypot(p.px[j] - x, p.pz[j] - z) < p.w[j] + def.shoulder + near * 0.8) {
        ok = false;
        break;
      }
      if (ok) out.push({ x, y: def.ground, z, yaw: r() * Math.PI * 2, s: 0.7 + r() * 0.6 });
    }
    return out;
  };
  const instanced = (g: THREE.BufferGeometry, m: THREE.Material, list: { x: number; y: number; z: number; yaw: number; s: number }[], scale: (s: number) => THREE.Vector3, lift = 0, shadow = true) => {
    if (!list.length) return;
    keep(g);
    const im = new THREE.InstancedMesh(g, m, list.length);
    const q = new THREE.Quaternion();
    list.forEach((s, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      const sc = scale(s.s);
      im.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y + lift * sc.y, s.z), q, sc));
    });
    im.castShadow = o.shadows && shadow;
    im.receiveShadow = o.shadows;
    group.add(im);
  };
  const trunk = (h: number) => new THREE.CylinderGeometry(0.18, 0.28, h, 7).translate(0, h / 2, 0);
  const n = (k: number) => Math.round(k * density);

  // Modelled scenery, one merged shape per kind (colours baked into the vertices), drawn instanced.
  const tint = keep(o.lambert ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
  const smooth = keep(o.lambert ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }));
  const uni = (s: number) => new THREE.Vector3(s, s, s);
  const one = () => new THREE.Vector3(1, 1, 1);
  const up = -Math.PI / 2;

  switch (def.theme) {
    case 'coast':
    case 'sunset': {
      const palms = spots(n(90), 3, 40);
      instanced(trunk(7), M({ color: 0x8a6a48, roughness: 0.9 }), palms, uni);
      instanced(palmCrown(), M({ color: 0x2f9a4a, roughness: 0.75, side: THREE.DoubleSide }), palms, uni);
      instanced(new THREE.SphereGeometry(0.35, 8, 6).translate(0, 7.05, 0), M({ color: 0x7a5a2a, roughness: 0.9 }), palms, uni);
      // Beach huts: boarded walls on a plinth, a hipped roof with eaves, a door, a window and a striped awning.
      const hut = new Parts();
      hut.add('wall', chamferBox(4, 2.7, 4, 0.08), 0, 1.55, 0);
      hut.add('base', chamferBox(4.5, 0.25, 4.5, 0.06), 0, 0.12, 0);
      hut.add('roof', new THREE.ConeGeometry(3.5, 1.7, 4).rotateY(Math.PI / 4), 0, 3.75, 0);
      hut.add('trim', chamferBox(4.5, 0.14, 4.5, 0.04), 0, 2.94, 0);
      hut.add('dark', chamferBox(0.95, 1.9, 0.08, 0.02), -0.8, 1.2, 2.02);
      hut.add('glass', chamferBox(1.1, 0.9, 0.08, 0.02), 0.95, 1.75, 2.02);
      hut.add('trim', chamferBox(1.3, 0.1, 0.16, 0.02), 0.95, 1.25, 2.05);
      hut.add('accent', chamferBox(1.5, 0.06, 0.9, 0.02), 0.95, 2.4, 2.4, 0.35);
      for (const sx of [-1.9, 1.9]) hut.add('trim', chamferBox(0.16, 2.7, 0.16, 0.03), sx, 1.55, 1.95);
      instanced(hut.colored({ wall: 0xf4ead6, base: 0xcbb994, roof: look.accent, trim: 0xffffff, dark: 0x6a4a34, glass: 0x8fd0e6, accent: 0xff7ab8 }), tint, spots(n(12), 8, 45), one);
      const umbrellas = spots(n(30), 3, 25);
      instanced(new THREE.ConeGeometry(1.6, 0.6, 8).translate(0, 2.4, 0), M({ color: 0xff7ab8, roughness: 0.7 }), umbrellas.filter((_, k) => k % 2 === 0), one, 0, false);
      instanced(new THREE.ConeGeometry(1.6, 0.6, 8).translate(0, 2.4, 0), M({ color: 0x19d3be, roughness: 0.7 }), umbrellas.filter((_, k) => k % 2 === 1), one, 0, false);
      instanced(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6).translate(0, 1.2, 0), M({ color: 0xf2f2ee, roughness: 0.5 }), umbrellas, one, 0, false);
      break;
    }
    case 'neon':
    case 'core':
    case 'city': {
      const city = def.theme === 'city';
      const towers = spots(n(city ? 80 : 60), city ? 30 : 24, city ? 160 : 130);
      const tex = keep(facadeTexture(city ? 5 : def.id.length));
      const facade = city ? M({ map: tex, color: 0xb9c6d8, roughness: 0.3, metalness: 0.45 }) : M({ map: tex, color: 0x3a3f58, roughness: 0.3, metalness: 0.6, emissive: new THREE.Color(look.accent), emissiveIntensity: 0.03 });
      const size = (s: number) => (city ? new THREE.Vector3(12 + s * 8, 30 + s * 80, 12 + s * 8) : new THREE.Vector3(9 + s * 6, 18 + s * 46, 9 + s * 6));
      instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), facade, towers, size);
      // Each tower gets a plinth, a set-back top storey and a parapet, so none is a bare box.
      const stone = M({ color: city ? 0xd9dee4 : 0x23263a, roughness: 0.8 });
      instanced(new THREE.BoxGeometry(1.06, 0.04, 1.06).translate(0, 0.02, 0), stone, towers, size);
      instanced(new THREE.BoxGeometry(1.04, 0.016, 1.04).translate(0, 1.008, 0), stone, towers, size);
      instanced(new THREE.BoxGeometry(0.7, 0.1, 0.7).translate(0, 1.066, 0), facade, towers, size);
      instanced(new THREE.BoxGeometry(0.74, 0.012, 0.74).translate(0, 1.122, 0), stone, towers, size);
      if (!city) {
        const pylons = spots(n(50), 2, 10);
        const py = new Parts();
        py.add('dark', turned([[0.3, 0], [0.34, 0.1], [0.16, 0.4], [0.1, 5.6], [0.2, 5.75], [0.2, 6], [0, 6]], 6), 0, 0, 0, up);
        instanced(py.colored({ dark: 0x1c1e2a }), smooth, pylons, one, 0, false);
        instanced(turned([[0.12, 0.6], [0.2, 0.62], [0.2, 5.4], [0.12, 5.42]], 6).rotateX(up), keep(new THREE.MeshBasicMaterial({ color: look.accent })), pylons, () => new THREE.Vector3(0.75, 1, 0.75), 0, false);
        const rings = spots(n(14), 1, 3);
        instanced(new THREE.TorusGeometry(4, 0.2, 6, 24).translate(0, 4, 0), keep(new THREE.MeshBasicMaterial({ color: 0xff3f8e })), rings, one, 0, false);
      }
      break;
    }
    case 'docks': {
      // Shipping containers: corrugated sides, corner posts and door bars; stacked two high here and there.
      const box = new Parts();
      box.add('body', chamferBox(2.44, 2.6, 6.06, 0.04), 0, 1.3, 0);
      for (let z = -2.8; z <= 2.8; z += 0.35) for (const sx of [-1.23, 1.23]) box.add('rib', chamferBox(0.05, 2.3, 0.16, 0.02), sx, 1.3, z);
      for (const sx of [-1.19, 1.19]) for (const sz of [-3, 3]) box.add('post', chamferBox(0.16, 2.66, 0.16, 0.02), sx, 1.3, sz);
      for (const sx of [-0.7, -0.25, 0.25, 0.7]) box.add('post', chamferBox(0.05, 2.3, 0.05, 0.01), sx, 1.3, 3.06);
      box.add('post', chamferBox(0.04, 2.4, 0.03, 0.01), 0, 1.3, 3.05);
      const boxGeo = box.colored({ body: 0xffffff, rib: 0xd9d9d9, post: 0x8c8c8c });
      const boxes = spots(n(140), 3, 40);
      const cols = [0xd7192f, 0x1f5fe0, 0xffc21a, 0x19d3be, 0x2fbf4f, 0xff7a1a];
      for (let c = 0; c < cols.length; c++) {
        const m = keep(o.lambert ? new THREE.MeshLambertMaterial({ vertexColors: true, color: cols[c] }) : new THREE.MeshStandardMaterial({ vertexColors: true, color: cols[c], roughness: 0.65, metalness: 0.3 }));
        const mine = boxes.filter((_, k) => k % cols.length === c);
        instanced(c === 0 ? boxGeo : boxGeo.clone(), m, mine, one);
        instanced(boxGeo.clone(), m, mine.filter((b) => b.s > 1.1), one, 2.62);
      }
      // Gantry cranes: braced legs, a cab, a boom with a trolley and a hook block.
      const crane = new Parts();
      for (const sx of [-4, 4]) for (const sz of [-3, 3]) crane.add('steel', chamferBox(0.7, 26, 0.7, 0.1), sx, 13, sz);
      for (const sx of [-4, 4]) {
        crane.add('steel', chamferBox(0.6, 0.8, 6.6, 0.08), sx, 25.6, 0);
        crane.add('steel', tube([[sx, 2, -3], [sx, 14, 3]], 0.16, 5));
        crane.add('steel', tube([[sx, 14, -3], [sx, 25, 3]], 0.16, 5));
      }
      crane.add('steel', chamferBox(8.6, 0.9, 0.7, 0.08), 0, 25.6, -3);
      crane.add('steel', chamferBox(8.6, 0.9, 0.7, 0.08), 0, 25.6, 3);
      crane.add('steel', chamferBox(1.4, 1.6, 38, 0.12), 0, 27.2, 6);
      crane.add('steel', tube([[0, 33, 0], [0, 28, 22]], 0.14, 5));
      crane.add('steel', tube([[0, 33, 0], [0, 28, -10]], 0.14, 5));
      crane.add('steel', chamferBox(0.8, 6.5, 0.8, 0.1), 0, 30, 0);
      crane.add('cab', chamferBox(2.6, 2.4, 3, 0.15), 0, 25.4, 12);
      crane.add('glass', chamferBox(2.3, 1.1, 0.1, 0.02), 0, 25.6, 13.5);
      crane.add('dark', chamferBox(1.6, 0.7, 1.6, 0.1), 0, 26.1, 18);
      crane.add('dark', tube([[0, 26, 18], [0, 12, 18]], 0.05, 4));
      crane.add('dark', chamferBox(1.2, 1, 0.6, 0.1), 0, 11.6, 18);
      instanced(crane.colored({ steel: 0xffc21a, cab: 0xf2f2ee, glass: 0x7ac0dc, dark: 0x2c2f38 }), smooth, spots(n(8), 20, 60), one);
      break;
    }
    case 'garden': {
      const tree = new Parts();
      treeParts(tree, 2.6, 11);
      const tree2 = new Parts();
      treeParts(tree2, 3.1, 29);
      const leaf = { bark: 0x7a5a3a, leaf: 0x358a40, leaf2: 0x4aa550 };
      const trees = spots(n(110), 3, 50);
      instanced(tree.colored(leaf), tint, trees.filter((_, k) => k % 2 === 0), (s) => uni(0.8 + s * 0.3));
      instanced(tree2.colored({ ...leaf, leaf: 0x2f7d44, leaf2: 0x5bb04e }), tint, trees.filter((_, k) => k % 2 === 1), (s) => uni(0.8 + s * 0.3));
      const beds = spots(n(80), 1, 14);
      const fl = [0xff7ab8, 0xffd23f, 0xff5a3a, 0xb98cff];
      for (let c = 0; c < fl.length; c++) instanced(new THREE.SphereGeometry(0.9, 8, 6).scale(1, 0.4, 1), M({ color: fl[c], roughness: 0.8 }), beds.filter((_, k) => k % fl.length === c), (s) => new THREE.Vector3(s * 1.4, s, s * 1.4), 0, false);
      break;
    }
    case 'canyon': {
      // Mesas: stepped strata, weathered.
      const mesa = new Parts();
      mesa.add('rock', roughen(turned([[0, 0], [1.25, 0], [1.1, 0.16], [1.12, 0.3], [0.96, 0.36], [0.98, 0.58], [0.84, 0.64], [0.86, 0.86], [0.7, 0.92], [0.62, 1], [0, 1]], 9, false), 0.1, 2.2, 5), 0, 0, 0, up);
      instanced(mesa.colored({ rock: 0xb5663f }), tint, spots(n(70), 6, 90), (s) => new THREE.Vector3(8 + s * 10, 10 + s * 30, 8 + s * 10));
      // Saguaro cacti: a ribbed trunk and two upturned arms.
      const cactus = new Parts();
      cactus.add('green', turned([[0, 0], [0.3, 0], [0.33, 0.3], [0.33, 2.7], [0.24, 3.05], [0, 3.15]], 8), 0, 0, 0, up);
      cactus.add('green', tube([[0.3, 1.3, 0], [0.75, 1.35, 0], [0.85, 1.7, 0], [0.85, 2.4, 0]], 0.17, 6));
      cactus.add('green', tube([[-0.3, 1.7, 0], [-0.7, 1.75, 0], [-0.78, 2.05, 0], [-0.78, 2.6, 0]], 0.15, 6));
      cactus.add('green', new THREE.SphereGeometry(0.17, 6, 5), 0.85, 2.4, 0);
      cactus.add('green', new THREE.SphereGeometry(0.15, 6, 5), -0.78, 2.6, 0);
      instanced(cactus.colored({ green: 0x3f8f4a }), tint, spots(n(60), 2, 25), uni);
      break;
    }
    case 'snow': {
      // Pines: a trunk and three drooping tiers of boughs, each with snow lying on it.
      const pine = new Parts();
      pine.add('bark', turned([[0, 0], [0.3, 0], [0.2, 0.3], [0.14, 2.2], [0, 2.2]], 6), 0, 0, 0, up);
      for (const [y, r, h] of [[1.6, 2.3, 2.6], [3.3, 1.75, 2.3], [4.9, 1.15, 2.2]]) {
        pine.add('green', roughen(turned([[0, h], [r * 0.5, h * 0.45], [r, 0], [r * 0.55, 0.22], [0, 0.3]], 8, false), 0.18, 1.6, y), 0, y, 0, up);
        pine.add('snow', roughen(turned([[0, h + 0.05], [r * 0.34, h * 0.62], [r * 0.2, h * 0.6], [0, h * 0.7]], 8, false), 0.08, 2, y + 3), 0, y, 0, up);
      }
      instanced(pine.colored({ bark: 0x5a3f2a, green: 0x24543a, snow: 0xf2f6fb }), tint, spots(n(160), 2, 60), uni);
      const peak = new Parts();
      peak.add('rock', roughen(new THREE.ConeGeometry(1, 1, 9, 4).translate(0, 0.5, 0), 0.16, 2.4, 3));
      peak.add('snow', roughen(new THREE.ConeGeometry(0.46, 0.46, 9, 2).translate(0, 0.79, 0), 0.05, 3, 4));
      instanced(peak.colored({ rock: 0xb9c6d6, snow: 0xffffff }), tint, spots(n(16), 80, 160), (s) => new THREE.Vector3(60 + s * 40, 40 + s * 50, 60 + s * 40));
      break;
    }
    case 'arcade': {
      const blocks = spots(n(90), 4, 60);
      const cols = [0xff3f8e, 0x19d3be, 0xffc21a, 0x8b5cff, 0x2fbf4f];
      // Toy blocks with chamfered edges and a raised stud on top.
      const block = new Parts();
      block.add('body', chamferBox(1, 1, 1, 0.06), 0, 0.5, 0);
      block.add('body', turned([[0, 0.12], [0.26, 0.12], [0.3, 0.08], [0.3, 0], [0, 0]], 10), 0, 1, 0, up);
      const blockGeo = block.colored({ body: 0xffffff });
      for (let c = 0; c < cols.length; c++)
        instanced(c === 0 ? blockGeo : blockGeo.clone(), keep(o.lambert ? new THREE.MeshLambertMaterial({ vertexColors: true, color: cols[c] }) : new THREE.MeshStandardMaterial({ vertexColors: true, color: cols[c], roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(cols[c]), emissiveIntensity: 0.15 })), blocks.filter((_, k) => k % cols.length === c), (s) => new THREE.Vector3(3 + s * 6, 3 + s * 14, 3 + s * 6));
      const arches = spots(n(10), 0.5, 2);
      instanced(new THREE.TorusGeometry(10, 0.5, 8, 32, Math.PI).translate(0, 0, 0), keep(new THREE.MeshBasicMaterial({ color: 0xffc21a })), arches, one, 0, false);
      break;
    }
  }
  // Low bushes and rocks between the big things, so the ground is never bare.
  const fill = { coast: 0x4faa54, sunset: 0x6a9a48, garden: 0x3a8f44, arcade: 0x8a6ae0, snow: 0xdde6f0, canyon: 0xa8552e, docks: 0x7a7e86, city: 0x6f7480, neon: 0x2a2c3c, core: 0x2c3040 }[def.theme];
  instanced(new THREE.IcosahedronGeometry(0.9, 0).translate(0, 0.45, 0), M({ color: fill, roughness: 0.95, flatShading: true }), spots(n(170), 2.5, 55), (s) => new THREE.Vector3(s * 1.3, s, s * 1.3));
  instanced(new THREE.IcosahedronGeometry(0.8, 0).translate(0, 0.3, 0), M({ color: def.theme === 'snow' ? 0xc8d4e2 : 0x9a968f, roughness: 0.95, flatShading: true }), spots(n(70), 3, 60), (s) => new THREE.Vector3(s * 1.6, s * 0.9, s * 1.3));
}

/** A palm crown: drooping leaves round the top of the trunk. */
function palmCrown() {
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.PlaneGeometry(0.7, 3.2, 1, 4);
    // Bend the leaf down along its length.
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) + 1.6;
      pos.setY(k, y);
      pos.setZ(k, -0.18 * y * y);
    }
    g.rotateX(-Math.PI / 2 + 0.35);
    g.rotateY((i / 8) * Math.PI * 2 + (i % 2) * 0.2);
    g.translate(0, 7.1, 0);
    leaves.push(g.index ? g.toNonIndexed() : g);
  }
  let n = 0;
  for (const g of leaves) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of leaves) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

export const surfaceAt = (p: TrackPath, i: number) => SURFACES[p.surf[i]] ?? 'asphalt';

type Keep = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T) => T;
type Mat = (opts: THREE.MeshStandardMaterialParameters) => THREE.Material;
interface Spot { x: number; y: number; z: number; yaw: number; s?: number; sx?: number; sy?: number; sz?: number; color?: number }

/** Instanced copies of one shape. */
function place(group: THREE.Group, o: TrackOptions, keep: Keep, g: THREE.BufferGeometry, m: THREE.Material, list: Spot[], shadow = true) {
  if (!list.length) return;
  keep(g);
  const im = new THREE.InstancedMesh(g, m, list.length);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  list.forEach((a, k) => {
    q.setFromAxisAngle(up, a.yaw);
    const s = a.s ?? 1;
    im.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(a.x, a.y, a.z), q, new THREE.Vector3((a.sx ?? 1) * s, (a.sy ?? 1) * s, (a.sz ?? 1) * s)));
    if (a.color !== undefined) im.setColorAt(k, c.setHex(a.color));
  });
  im.castShadow = o.shadows && shadow;
  im.receiveShadow = o.shadows;
  group.add(im);
}

const hash2 = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Sweeps a cross-section along one side of the loop: d is how far outside the wall's inner face
 * (the face the physics wall has), h is the height above the road. Every face is flat-shaded.
 */
function sweep(p: TrackPath, side: 1 | -1, profile: [number, number][], uMetres: number, jitter = 0) {
  const n = p.n, m = profile.length, sh = p.def.shoulder;
  const per = [0];
  for (let q = 1; q <= m; q++) per.push(per[q - 1] + Math.hypot(profile[q % m][0] - profile[q - 1][0], profile[q % m][1] - profile[q - 1][1]));
  const row = (i: number) => {
    const k = i % n;
    return profile.map(([d, h], q) => {
      const j = jitter && h > 0.3 ? (hash2(k, q) - 0.5) * jitter : 0;
      const off = side * (p.w[k] + sh + d + j * 0.6);
      return [p.px[k] + p.lx[k] * off, p.py[k] + p.ly[k] * off + h + j * 0.5, p.pz[k] + p.lz[k] * off];
    });
  };
  const pos: number[] = [], uv: number[] = [];
  let prev = row(0), u = 0;
  for (let i = 1; i <= n; i++) {
    const cur = row(i);
    const u0 = u, u1 = u + p.length / n / uMetres;
    u = u1;
    for (let q = 0; q < m; q++) {
      const r = (q + 1) % m, v0 = per[q] / 2, v1 = per[q + 1] / 2;
      pos.push(...prev[q], ...prev[r], ...cur[q], ...prev[r], ...cur[r], ...cur[q]);
      uv.push(u0, v0, u0, v1, u1, v0, u0, v1, u1, v1, u1, v0);
    }
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A stripe that alternates two colours along the track (u). */
const stripeTex = (a: number, b: number) =>
  canvasTex(64, 4, (g) => {
    g.fillStyle = C(a);
    g.fillRect(0, 0, 32, 4);
    g.fillStyle = C(b);
    g.fillRect(32, 0, 32, 4);
  });

/**
 * The barriers that line both edges: solid 3D shapes whose inner face sits exactly where the physics
 * wall is, so what you see is what you hit. One style per theme.
 */
function barriers(group: THREE.Group, p: TrackPath, look: ThemeLook, o: TrackOptions, keep: Keep, M: Mat) {
  const def = p.def, H = Math.max(0.9, def.wall || 1);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    keep(g);
    const x = new THREE.Mesh(g, m);
    x.castShadow = o.shadows && shadow;
    x.receiveShadow = o.shadows;
    group.add(x);
  };
  const both = (profile: [number, number][], m: THREE.Material, u = 4, jitter = 0, shadow = true) => {
    for (const side of [1, -1] as const) add(sweep(p, side, profile, u, jitter), m, shadow);
  };
  const glow = (c: number) => keep(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  const doubled = { side: THREE.DoubleSide } as const;
  switch (look.wall) {
    case 'barrier': {
      // Concrete blocks with a painted band.
      both([[0, 0], [0, 0.3], [0.18, 0.78], [0.18, H], [0.6, H], [0.6, 0]], M({ color: 0xdedbd3, roughness: 0.85, ...doubled }));
      const band = keep(stripeTex(look.accent, 0xf4f4ef));
      both([[-0.015, 0.42], [-0.015, 0.62], [0, 0.62], [0, 0.42]], M({ map: band, roughness: 0.7, ...doubled }), 4, 0, false);
      break;
    }
    case 'neon': {
      both([[0, 0], [0, H], [0.6, H], [0.6, 0]], M({ color: 0x16171f, roughness: 0.5, metalness: 0.4, ...doubled }));
      const g = glow(look.accent);
      both([[-0.025, H * 0.76], [-0.025, H * 0.9], [0, H * 0.9], [0, H * 0.76]], g, 4, 0, false);
      both([[0, H], [0, H + 0.04], [0.6, H + 0.04], [0.6, H]], g, 4, 0, false);
      break;
    }
    case 'hedge': {
      const tex = keep(wallTexture('hedge', look.accent));
      both([[0, 0], [0, H * 0.5], [0.1, H * 0.85], [0.3, H * 1.12], [0.5, H * 0.85], [0.6, H * 0.5], [0.6, 0]], M({ map: tex, roughness: 0.95, ...doubled }), 3, 0.12);
      break;
    }
    case 'snow': {
      both([[0, 0], [0, H * 0.4], [0.2, H * 0.82], [0.5, H * 0.98], [0.95, H * 0.72], [1.4, H * 0.36], [1.7, 0]], M({ color: 0xf4f8fc, roughness: 0.6, ...doubled }), 4, 0.1);
      // Red marker poles.
      const poles: Spot[] = [];
      for (let i = 0; i < p.n; i += 4) for (const side of [1, -1]) {
        const off = side * (p.w[i] + def.shoulder + 0.8);
        poles.push({ x: p.px[i] + p.lx[i] * off, y: p.py[i] + p.ly[i] * off + 0.9, z: p.pz[i] + p.lz[i] * off, yaw: 0 });
      }
      place(group, o, keep, new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), M({ color: 0xd7192f, roughness: 0.6 }), poles, false);
      break;
    }
    case 'rock': {
      const tex = keep(wallTexture('rock', look.accent));
      both([[0, 0], [0, H], [0.4, H * 1.7], [1.4, H * 2.9], [3.6, H * 3.6], [5.5, H * 3.1], [5.5, 0]], M({ map: tex, roughness: 0.97, flatShading: true, ...doubled }), 5, 0.7);
      break;
    }
    case 'rail': {
      const steel = M({ color: 0xc9ced6, roughness: 0.4, metalness: 0.7, ...doubled });
      both([[0, 0], [0, 0.34], [0.32, 0.34], [0.32, 0]], M({ color: 0x9aa0aa, roughness: 0.85, ...doubled }));
      both([[-0.03, 0.46], [-0.03, 0.72], [0.1, 0.72], [0.1, 0.46]], steel, 4, 0, false);
      both([[-0.03, 0.76], [-0.03, 0.98], [0.1, 0.98], [0.1, 0.76]], steel, 4, 0, false);
      const posts: Spot[] = [];
      for (let i = 0; i < p.n; i += 2) for (const side of [1, -1]) {
        const off = side * (p.w[i] + def.shoulder + 0.18);
        posts.push({ x: p.px[i] + p.lx[i] * off, y: p.py[i] + p.ly[i] * off + 0.5, z: p.pz[i] + p.lz[i] * off, yaw: Math.atan2(p.tx[i], p.tz[i]) });
      }
      place(group, o, keep, new THREE.BoxGeometry(0.12, 1.0, 0.12), M({ color: 0x80868f, roughness: 0.6, metalness: 0.5 }), posts, false);
      break;
    }
    case 'tyres': {
      // Stacks of tyres, two abreast, three or four high, with red and white ones mixed in.
      const layers = Math.ceil(H / 0.34);
      const list: Spot[] = [];
      const dark = [0x1f2126, 0x2a2d34, 0x24262c];
      for (let i = 0; i < p.n; i++) for (const side of [1, -1]) for (const along of [-0.5, 0.5]) {
        const off = side * (p.w[i] + def.shoulder + 0.45);
        const bx = p.px[i] + p.lx[i] * off + p.tx[i] * along, bz = p.pz[i] + p.lz[i] * off + p.tz[i] * along;
        const by = p.py[i] + p.ly[i] * off;
        for (let l = 0; l < layers; l++) {
          const r = hash2(i * 2 + side + along, l);
          list.push({ x: bx, y: by + 0.17 + l * 0.34, z: bz, yaw: 0, color: r > 0.93 ? 0xd7192f : r > 0.88 ? 0xf2f2ee : dark[(i + l) % 3] });
        }
      }
      place(group, o, keep, new THREE.CylinderGeometry(0.47, 0.47, 0.32, 14), M({ color: 0xffffff, roughness: 0.9 }), list, false);
      break;
    }
  }
}

/** Everything beside the track that isn't a barrier: lamps, billboards, a grandstand, verge props. */
function roadside(group: THREE.Group, p: TrackPath, look: ThemeLook, o: TrackOptions, keep: Keep, M: Mat) {
  const def = p.def, sh = def.shoulder;
  const out = (i: number, side: number, d: number) => {
    const off = side * (p.w[i] + sh + d);
    return { x: p.px[i] + p.lx[i] * off, y: p.py[i] + p.ly[i] * off, z: p.pz[i] + p.lz[i] * off };
  };
  const yawOf = (i: number) => Math.atan2(p.tx[i], p.tz[i]);
  // Not beside a stretch of road that passes close by, above or below.
  const open = (i: number, side: number, d: number, clear: number) => {
    const q = out(i, side, d);
    for (let j = 0; j < p.n; j += 3) {
      const gap = Math.min(Math.abs(j - i), p.n - Math.abs(j - i));
      if (gap < 20) continue;
      if (Math.abs(p.py[j] - q.y) < 7 && Math.hypot(p.px[j] - q.x, p.pz[j] - q.z) < p.w[j] + sh + clear) return false;
    }
    return !p.tunnel[i];
  };

  // Street lamps, alternating sides.
  const poles: Spot[] = [], heads: Spot[] = [], bulbs: Spot[] = [];
  for (let i = 9, k = 0; i < p.n; i += 17, k++) {
    const side = k % 2 ? 1 : -1;
    if (!open(i, side, 1.8, 3)) continue;
    const q = out(i, side, 1.8);
    poles.push({ ...q, y: q.y + 3.6, yaw: 0 });
    const hx = q.x - p.lx[i] * side * 0.9, hz = q.z - p.lz[i] * side * 0.9;
    heads.push({ x: (q.x + hx) / 2, y: q.y + 7.1, z: (q.z + hz) / 2, yaw: Math.atan2(-p.lx[i] * side, -p.lz[i] * side) });
    bulbs.push({ x: hx, y: q.y + 7.0, z: hz, yaw: yawOf(i) });
  }
  place(group, o, keep, new THREE.CylinderGeometry(0.07, 0.12, 7.2, 6), M({ color: 0x4a4e57, roughness: 0.5, metalness: 0.6 }), poles);
  place(group, o, keep, new THREE.BoxGeometry(0.1, 0.1, 0.95), M({ color: 0x4a4e57, roughness: 0.5, metalness: 0.6 }), heads, false);
  place(group, o, keep, new THREE.BoxGeometry(0.6, 0.12, 0.34), keep(new THREE.MeshBasicMaterial({ color: look.night ? look.accent : 0xfff1c9 })), bulbs, false);

  // Billboards on the straights.
  const banners = ['VELOCITY', 'CHROMASHIFT', 'DRIFT', 'BOOST'].map((text, k) =>
    keep(
      canvasTex(512, 160, (g) => {
        const grad = g.createLinearGradient(0, 0, 512, 160);
        grad.addColorStop(0, C([look.accent, 0x1f5fe0, 0xff3f8e, 0x19d3be][k]));
        grad.addColorStop(1, C([0x15161b, 0x15161b, 0x2a1030, 0x0c2a30][k]));
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 160);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        for (let x = -160; x < 512; x += 64) {
          g.beginPath();
          g.moveTo(x, 160);
          g.lineTo(x + 40, 160);
          g.lineTo(x + 120, 0);
          g.lineTo(x + 80, 0);
          g.fill();
        }
        g.fillStyle = '#ffffff';
        g.font = '900 italic 76px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 256, 86);
      }),
    ),
  );
  const boards: Spot[][] = [[], [], [], []];
  const bpost: Spot[] = [];
  for (let i = 40, k = 0; i < p.n; i += 70, k++) {
    const side = k % 2 ? 1 : -1;
    if (Math.abs(p.curv[i]) > 1 / 220 || !open(i, side, 4.5, 8)) continue;
    const q = out(i, side, 4.5);
    const yaw = Math.atan2(-p.lx[i] * side, -p.lz[i] * side);
    boards[k % 4].push({ ...q, y: q.y + 4.3, yaw });
    for (const a of [-3.4, 3.4]) bpost.push({ x: q.x + p.tx[i] * a, y: q.y + 2.1, z: q.z + p.tz[i] * a, yaw: 0 });
  }
  boards.forEach((list, k) => place(group, o, keep, new THREE.PlaneGeometry(9, 2.8), M({ map: banners[k], roughness: 0.6, emissive: new THREE.Color(0xffffff), emissiveIntensity: look.night ? 0.5 : 0.12, emissiveMap: banners[k], side: THREE.DoubleSide }), list, false));
  place(group, o, keep, new THREE.BoxGeometry(0.2, 4.2, 0.2), M({ color: 0x3a3d45, roughness: 0.6, metalness: 0.5 }), bpost);

  // Grandstands at the start.
  const crowd = keep(
    canvasTex(256, 32, (g) => {
      const r = rnd(11);
      g.fillStyle = '#2b2e36';
      g.fillRect(0, 0, 256, 32);
      const cols = ['#ff3f8e', '#19d3be', '#ffc21a', '#2f6dff', '#f2f2ee', '#8b5cff', '#ff7a1a'];
      for (let x = 2; x < 256; x += 6) for (let y = 4; y < 32; y += 9) {
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.beginPath();
        g.arc(x + r() * 2, y + r() * 2, 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  crowd.repeat.set(8, 1);
  const stand = M({ map: crowd, roughness: 0.9 });
  const concrete = M({ color: 0x8e9199, roughness: 0.9 });
  for (const side of [1, -1]) {
    if (!open(0, side, 8, 6)) continue;
    const len = side === 1 ? 46 : 30;
    for (let t = 0; t < 3; t++) {
      const q = out(0, side, 7 + t * 2.4);
      const m = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, 1.0, len)), t === 0 ? concrete : stand);
      m.position.set(q.x, q.y + 0.5 + t * 1.1, q.z);
      m.rotation.y = yawOf(0);
      m.castShadow = o.shadows;
      m.receiveShadow = o.shadows;
      group.add(m);
    }
    const q = out(0, side, 7 + 2.4);
    const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(8.5, 0.25, len + 2)), M({ color: look.accent, roughness: 0.5, metalness: 0.2 }));
    roof.position.set(q.x, q.y + 5.2, q.z);
    roof.rotation.y = yawOf(0);
    roof.castShadow = o.shadows;
    group.add(roof);
    const legs: Spot[] = [];
    for (const a of [-len / 2 + 1, 0, len / 2 - 1]) for (const d of [4.4, 9.6]) {
      const lq = out(0, side, d);
      legs.push({ x: lq.x + p.tx[0] * a, y: lq.y + 2.6, z: lq.z + p.tz[0] * a, yaw: 0 });
    }
    place(group, o, keep, new THREE.BoxGeometry(0.3, 5.2, 0.3), M({ color: 0x3a3d45, roughness: 0.6, metalness: 0.5 }), legs, false);
  }

  // Cones, crates and tyre stacks left on the verge (scenery only).
  const cones: Spot[] = [], crates: Spot[] = [], tyres: Spot[] = [];
  for (const ob of p.obstacles) {
    const x = p.px[ob.i] + p.lx[ob.i] * ob.off, y = p.py[ob.i] + p.ly[ob.i] * ob.off, z = p.pz[ob.i] + p.lz[ob.i] * ob.off;
    const yaw = yawOf(ob.i);
    if (ob.kind === 'cone') for (let k = 0; k < 3; k++) cones.push({ x: x + p.tx[ob.i] * (k - 1) * 1.6, y: y + 0.35, z: z + p.tz[ob.i] * (k - 1) * 1.6, yaw });
    else if (ob.kind === 'crate') {
      crates.push({ x, y: y + 0.55, z, yaw });
      crates.push({ x: x + p.tx[ob.i] * 1.3, y: y + 0.55, z: z + p.tz[ob.i] * 1.3, yaw: yaw + 0.3 });
      crates.push({ x: x + p.tx[ob.i] * 0.6, y: y + 1.65, z: z + p.tz[ob.i] * 0.6, yaw: yaw + 0.15 });
    } else for (let l = 0; l < 3; l++) tyres.push({ x, y: y + 0.2 + l * 0.38, z, yaw, color: l === 1 ? 0xd7192f : 0x24262c });
  }
  place(group, o, keep, new THREE.ConeGeometry(0.28, 0.7, 10), M({ color: 0xff7a1a, roughness: 0.6 }), cones, false);
  place(group, o, keep, new THREE.BoxGeometry(1.1, 1.1, 1.1), M({ color: 0xb8864f, roughness: 0.85 }), crates);
  place(group, o, keep, new THREE.CylinderGeometry(0.55, 0.55, 0.36, 16), M({ color: 0xffffff, roughness: 0.9 }), tyres, false);
}
