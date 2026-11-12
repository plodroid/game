import * as THREE from 'three';
import { SURFACES, type TrackPath, type TrackTheme, type RoadSurface } from '@chromashift/shared';
import { SHADOW_LAYER } from '../characters/compact';
import { Ocean } from '../rendering/ocean';
import { SummerSky, type SkyLook } from '../rendering/sky';
import { facadeTexture } from '../rendering/textures';

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
  // Walls: a vertical strip on each outer edge, with a cap.
  const wtex = keep(wallTexture(look.wall, look.accent));
  const wallMat = M({ map: wtex, roughness: 0.75, emissive: look.wall === 'neon' ? new THREE.Color(look.accent) : undefined, emissiveIntensity: look.wall === 'neon' ? 0.6 : 0, side: THREE.DoubleSide });
  if (look.wall === 'neon' && !o.lambert) (wallMat as THREE.MeshStandardMaterial).emissiveMap = wtex;
  const H = Math.max(0.8, def.wall);
  for (const side of [1, -1]) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let v = 0;
    for (let i = 0; i <= p.n; i++) {
      const k = i % p.n;
      const off = side * (p.w[k] + def.shoulder + 0.3);
      const x = p.px[k] + p.lx[k] * off, y = p.py[k] + p.ly[k] * off, z = p.pz[k] + p.lz[k] * off;
      if (i) v += p.length / p.n / 3;
      pos.push(x, y - 0.3, z, x, y + H, z);
      uv.push(v, 0, v, 1);
      if (i) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    mesh(g, wallMat, false);
  }
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

  switch (def.theme) {
    case 'coast':
    case 'sunset': {
      const palms = spots(n(90), 3, 40);
      instanced(trunk(7), M({ color: 0x8a6a48, roughness: 0.9 }), palms, (s) => new THREE.Vector3(s, s, s));
      instanced(palmCrown(), M({ color: 0x2f9a4a, roughness: 0.75, side: THREE.DoubleSide }), palms, (s) => new THREE.Vector3(s, s, s));
      instanced(new THREE.SphereGeometry(0.35, 8, 6).translate(0, 7.05, 0), M({ color: 0x7a5a2a, roughness: 0.9 }), palms, (s) => new THREE.Vector3(s, s, s));
      const huts = spots(n(12), 8, 45);
      instanced(new THREE.BoxGeometry(4, 3, 4).translate(0, 1.5, 0), M({ color: 0xf2e6cf, roughness: 0.8 }), huts, () => new THREE.Vector3(1, 1, 1));
      instanced(new THREE.ConeGeometry(3.4, 1.6, 4).translate(0, 3.8, 0).rotateY(Math.PI / 4), M({ color: look.accent, roughness: 0.7 }), huts, () => new THREE.Vector3(1, 1, 1));
      const umbrellas = spots(n(30), 3, 25);
      instanced(new THREE.ConeGeometry(1.6, 0.6, 8).translate(0, 2.4, 0), M({ color: 0xff7ab8, roughness: 0.7 }), umbrellas.filter((_, k) => k % 2 === 0), () => new THREE.Vector3(1, 1, 1), 0, false);
      instanced(new THREE.ConeGeometry(1.6, 0.6, 8).translate(0, 2.4, 0), M({ color: 0x19d3be, roughness: 0.7 }), umbrellas.filter((_, k) => k % 2 === 1), () => new THREE.Vector3(1, 1, 1), 0, false);
      instanced(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6).translate(0, 1.2, 0), M({ color: 0xf2f2ee, roughness: 0.5 }), umbrellas, () => new THREE.Vector3(1, 1, 1), 0, false);
      break;
    }
    case 'neon':
    case 'core': {
      const towers = spots(n(60), 24, 130);
      const tex = keep(facadeTexture(def.id.length));
      instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), M({ map: tex, color: 0x3a3f58, roughness: 0.3, metalness: 0.6, emissive: new THREE.Color(look.accent), emissiveIntensity: 0.03 }), towers, (s) => new THREE.Vector3(9 + s * 6, 18 + s * 46, 9 + s * 6));
      const pylons = spots(n(50), 2, 10);
      instanced(new THREE.BoxGeometry(0.3, 6, 0.3).translate(0, 3, 0), keep(new THREE.MeshBasicMaterial({ color: look.accent })), pylons, () => new THREE.Vector3(1, 1, 1), 0, false);
      const rings = spots(n(14), 1, 3);
      instanced(new THREE.TorusGeometry(4, 0.2, 6, 24).translate(0, 4, 0), keep(new THREE.MeshBasicMaterial({ color: 0xff3f8e })), rings, () => new THREE.Vector3(1, 1, 1), 0, false);
      break;
    }
    case 'city': {
      const towers = spots(n(80), 30, 160);
      const tex = keep(facadeTexture(5));
      instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), M({ map: tex, color: 0xb9c6d8, roughness: 0.3, metalness: 0.45 }), towers, (s) => new THREE.Vector3(12 + s * 8, 30 + s * 80, 12 + s * 8));
      break;
    }
    case 'docks': {
      const boxes = spots(n(140), 3, 40);
      const cols = [0xd7192f, 0x1f5fe0, 0xffc21a, 0x19d3be, 0x2fbf4f, 0xff7a1a];
      for (let c = 0; c < cols.length; c++)
        instanced(new THREE.BoxGeometry(2.5, 2.6, 6).translate(0, 1.3, 0), M({ color: cols[c], roughness: 0.7, metalness: 0.3 }), boxes.filter((_, k) => k % cols.length === c), (s) => new THREE.Vector3(1, s > 1.1 ? 2 : 1, 1));
      const cranes = spots(n(8), 20, 60);
      instanced(new THREE.BoxGeometry(1.2, 30, 1.2).translate(0, 15, 0), M({ color: 0xffc21a, roughness: 0.5, metalness: 0.5 }), cranes, () => new THREE.Vector3(1, 1, 1));
      instanced(new THREE.BoxGeometry(1, 1, 26).translate(0, 30, 8), M({ color: 0xffc21a, roughness: 0.5, metalness: 0.5 }), cranes, () => new THREE.Vector3(1, 1, 1));
      break;
    }
    case 'garden': {
      const trees = spots(n(110), 3, 50);
      instanced(trunk(4), M({ color: 0x7a5a3a, roughness: 0.9 }), trees, (s) => new THREE.Vector3(s, s, s));
      instanced(new THREE.IcosahedronGeometry(2.4, 1).translate(0, 5.2, 0), M({ color: 0x3f9a48, roughness: 0.85 }), trees, (s) => new THREE.Vector3(s, s, s));
      const beds = spots(n(80), 1, 14);
      const fl = [0xff7ab8, 0xffd23f, 0xff5a3a, 0xb98cff];
      for (let c = 0; c < fl.length; c++) instanced(new THREE.SphereGeometry(0.9, 8, 6).scale(1, 0.4, 1), M({ color: fl[c], roughness: 0.8 }), beds.filter((_, k) => k % fl.length === c), (s) => new THREE.Vector3(s * 1.4, s, s * 1.4), 0, false);
      break;
    }
    case 'canyon': {
      const rocks = spots(n(70), 6, 90);
      instanced(new THREE.CylinderGeometry(1, 1.3, 1, 7).translate(0, 0.5, 0), M({ color: 0xb5663f, roughness: 0.95 }), rocks, (s) => new THREE.Vector3(8 + s * 10, 10 + s * 30, 8 + s * 10));
      const cacti = spots(n(60), 2, 25);
      instanced(new THREE.CylinderGeometry(0.3, 0.35, 3, 8).translate(0, 1.5, 0), M({ color: 0x3f8f4a, roughness: 0.8 }), cacti, (s) => new THREE.Vector3(s, s, s));
      break;
    }
    case 'snow': {
      const pines = spots(n(160), 2, 60);
      instanced(trunk(2), M({ color: 0x5a3f2a, roughness: 0.9 }), pines, (s) => new THREE.Vector3(s, s, s));
      instanced(new THREE.ConeGeometry(2.2, 6, 8).translate(0, 5, 0), M({ color: 0x24543a, roughness: 0.85 }), pines, (s) => new THREE.Vector3(s, s, s));
      instanced(new THREE.ConeGeometry(1.4, 2.2, 8).translate(0, 7.2, 0), M({ color: 0xf2f6fb, roughness: 0.6 }), pines, (s) => new THREE.Vector3(s, s, s));
      const peaks = spots(n(16), 80, 160);
      instanced(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), M({ color: 0xdfe8f2, roughness: 0.8 }), peaks, (s) => new THREE.Vector3(60 + s * 40, 40 + s * 50, 60 + s * 40));
      break;
    }
    case 'arcade': {
      const blocks = spots(n(90), 4, 60);
      const cols = [0xff3f8e, 0x19d3be, 0xffc21a, 0x8b5cff, 0x2fbf4f];
      for (let c = 0; c < cols.length; c++) instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), M({ color: cols[c], roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(cols[c]), emissiveIntensity: 0.15 }), blocks.filter((_, k) => k % cols.length === c), (s) => new THREE.Vector3(3 + s * 6, 3 + s * 14, 3 + s * 6));
      const arches = spots(n(10), 0.5, 2);
      instanced(new THREE.TorusGeometry(10, 0.5, 8, 32, Math.PI).translate(0, 0, 0), keep(new THREE.MeshBasicMaterial({ color: 0xffc21a })), arches, () => new THREE.Vector3(1, 1, 1), 0, false);
      break;
    }
  }
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
