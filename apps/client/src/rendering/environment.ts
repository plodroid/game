import * as THREE from 'three';
import { SHADOW_LAYER } from '../characters/compact';
import type { MapDef, PropDef } from '@chromashift/shared';
import { buildBeach, buildStilts, seedOf, type Beach } from './beach';
import { Ocean } from './ocean';
import { SummerSky, type SkyLook } from './sky';
import { facadeTexture, logoTexture, puffTexture } from './textures';

export interface EnvOptions {
  shadowQuality: number;
  shadowResolution: number;
  drawDistance: number;
  reflections: boolean;
  lambert: boolean;
  /** Visual tier, 0 very low … 4 ultra (see visualTier). */
  tier: number;
}

export interface Environment {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  envMap: THREE.Texture | null;
  sky: SummerSky;
  /** Sea level, or null when there is no sea (indoor maps). */
  seaLevel: number | null;
  /** Clouds drift, the sea moves, and the sunlight dims while a cloud covers the sun. */
  update(dt: number): void;
  /** Switches the air for the water (call per camera, before it draws). */
  underwater(on: boolean): void;
  setDrawDistance(d: number): void;
  dispose(): void;
}

/** The camera's far plane for a draw distance. */
export const farFor = (drawDistance: number) => Math.max(200, drawDistance * 1.6);
/** Summer haze: a few percent across the arena, most of the way to white at the far plane. */
const fogDensity = (far: number) => 1.35 / far;

/** Sea level for a map: its theme's, or just under the lowest part of the arena. */
export function seaLevelOf(map: MapDef): number | null {
  const t = map.theme;
  if (t.sea !== undefined) return t.sea;
  if (t.indoor) return null;
  let low = Infinity;
  for (const b of map.blocks) if (b.visible && b.mat !== 'invisible') low = Math.min(low, b.c.y - b.h.y);
  return Math.max(map.killY + 1, (Number.isFinite(low) ? low : 0) - 0.45);
}

/** The summer sky for a map. */
export function skyLookOf(map: MapDef): SkyLook {
  const t = map.theme;
  return { sunDir: new THREE.Vector3(...t.sunDir).normalize(), turbidity: t.haze ?? 2.3, clouds: t.clouds ?? 0.42, seed: (seedOf(map.id) % 997) / 97 };
}

/** Sky colour without the strongest channel: what the hemisphere light gives as fill. */
const lightColour = (c: THREE.Color) => c.clone().multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-4));

export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, map: MapDef, o: EnvOptions): Environment {
  const t = map.theme;
  const group = new THREE.Group();
  const look = skyLookOf(map);
  const sky = new SummerSky(renderer, look, o.tier);
  group.add(sky.mesh);
  const ex = map.extent;
  const cx = (ex.minX + ex.maxX) / 2, cz = (ex.minZ + ex.maxZ) / 2;

  let far = farFor(o.drawDistance);
  const fog = new THREE.FogExp2(sky.light.haze.clone(), fogDensity(far));
  scene.fog = fog;
  scene.background = null;

  // Image-based light and reflections from the real sky (medium and up).
  let envMap: THREE.Texture | null = null;
  if (o.reflections && !o.lambert) {
    envMap = sky.environment();
    scene.environment = envMap;
    scene.environmentIntensity = t.indoor ? 0.4 : 0.6;
  } else scene.environment = null;

  // Key: the sun, warm and strong, casting soft shadows. Fill: the blue sky above and the sun-warmed
  // ground below. Rim: a little cool sky light from the opposite side so silhouettes stay readable.
  const skyTint = lightColour(sky.light.skyAmbient).lerp(new THREE.Color(t.ambient), 0.35).lerp(new THREE.Color(1, 1, 1), 0.4);
  const hemi = new THREE.HemisphereLight(skyTint, new THREE.Color(t.ground), (envMap ? 0.38 : 1.3) * (t.indoor ? 1.3 : 1));
  const sun = new THREE.DirectionalLight(sky.light.sunColor, t.sunIntensity);
  const sunDir = look.sunDir;
  const span = Math.max(ex.maxX - ex.minX, ex.maxZ - ex.minZ) / 2 + 6;
  sun.position.set(cx + sunDir.x * 80, sunDir.y * 80, cz + sunDir.z * 80);
  sun.target.position.set(cx, 0, cz);
  const rim = new THREE.DirectionalLight(skyTint, 0.42);
  rim.position.set(cx - sunDir.x * 60, 28, cz - sunDir.z * 60);
  rim.target.position.set(cx, 0, cz);
  group.add(hemi, sun, sun.target, rim, rim.target);
  if (o.shadowQuality > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(o.shadowResolution, o.shadowResolution);
    const cam = sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 10;
    cam.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    // PCF in this three.js release is the soft kind (rotated Vogel-disk taps); the radius sets the penumbra.
    sun.shadow.radius = [0, 1.4, 2, 2.6, 3.4][o.shadowQuality] ?? 2;
    // Characters cast their shadows from merged shadow-only copies on their own layer.
    cam.layers.enable(SHADOW_LAYER);
  }

  // The sea, islands and piers.
  const seaLevel = seaLevelOf(map);
  let ocean: Ocean | null = null;
  let beach: Beach | null = null;
  let stilts: THREE.InstancedMesh | null = null;
  if (seaLevel !== null) {
    // Towers that would stand straight in the water get a sandy islet each.
    const islets = map.props.filter((p) => p.kind === 'building' && p.y < seaLevel && t.land === undefined).map((p) => ({ x: p.x, z: p.z, r: p.s * 1.05 }));
    beach = buildBeach(map, { tier: o.tier, lambert: o.lambert, seaLevel, land: t.land ?? 0, islets });
    group.add(beach.group);
    stilts = buildStilts(map, seaLevel, o.lambert);
    if (stilts) group.add(stilts);
    ocean = new Ocean(sky, { tier: o.tier, level: seaLevel, x: cx, z: cz, far, shores: beach.shores });
    group.add(ocean.mesh);
  }

  for (const p of map.props) {
    const prop = buildProp(p, map, o.lambert, o.tier);
    if (prop) group.add(prop);
  }
  // Rock bellies under floating islands.
  if (map.id === 'float')
    for (const b of map.blocks) {
      if (b.mat !== 'island' || b.h.x < 2) continue;
      const r = Math.min(b.h.x, b.h.z) * 1.15;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.6, 7), mat(0x7a6b5c, o.lambert));
      cone.rotation.x = Math.PI;
      cone.scale.set(b.h.x / r, 1, b.h.z / r);
      cone.position.set(b.c.x, b.c.y - b.h.y - r * 0.8 + 0.05, b.c.z);
      group.add(cone);
    }
  scene.add(group);

  const sunPower = t.sunIntensity;
  const under = new THREE.FogExp2(new THREE.Color(0x0d5872), 0.075);
  const underColor = new THREE.Color(0x0d5872);
  let sunT = 1;
  return {
    group,
    sun,
    envMap,
    sky,
    seaLevel,
    update(dt) {
      sky.update(dt);
      ocean?.update(dt);
      // A passing cloud dims the sun and softens the shadows, easing in and out.
      sunT += (sky.sunThrough() - sunT) * (1 - Math.exp(-2.5 * dt));
      sun.intensity = sunPower * (0.62 + 0.38 * sunT);
      sun.shadow.intensity = 0.45 + 0.55 * sunT;
    },
    underwater(on) {
      scene.fog = on ? under : fog;
      scene.background = on ? underColor : null;
      sky.mesh.visible = !on;
    },
    setDrawDistance(d) {
      far = farFor(d);
      fog.density = fogDensity(far);
      ocean?.setFar(far);
    },
    dispose() {
      group.traverse((x) => {
        if (x === sky.mesh || x === ocean?.mesh || x === stilts) return;
        const m = x as THREE.Mesh;
        if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      if (stilts) {
        stilts.geometry.dispose();
        (stilts.material as THREE.Material).dispose();
        stilts.dispose();
      }
      beach?.dispose();
      ocean?.dispose();
      sky.dispose();
      envMap?.dispose();
      if (scene.environment === envMap) scene.environment = null;
      group.removeFromParent();
    },
  };
}

const mat = (color: number, lambert: boolean, extra: THREE.MeshStandardMaterialParameters = {}) =>
  lambert ? new THREE.MeshLambertMaterial({ color, emissive: extra.emissive ?? 0, emissiveMap: extra.emissiveMap ?? null, map: extra.map ?? null }) : new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function buildProp(p: PropDef, map: MapDef, lambert: boolean, tier: number): THREE.Object3D | null {
  const g = new THREE.Group();
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = p.yaw ?? 0;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    g.add(me);
    return me;
  };
  const h = p.h ?? 1;
  switch (p.kind) {
    case 'building': {
      // A sunlit tower: concrete frames and glass that reflects the sky.
      const tex = facadeTexture(Math.round(p.x * 7 + p.z));
      tex.repeat.set(p.s / 8, h / 8);
      add(new THREE.BoxGeometry(p.s, h, p.s), mat(0xffffff, lambert, { map: tex, roughness: 0.32, metalness: 0.35 }), 0, h / 2, 0);
      add(new THREE.BoxGeometry(p.s * 1.04, 1.2, p.s * 1.04), mat(0xe9e2d4, lambert, { roughness: 0.8 }), 0, h + 0.6, 0);
      break;
    }
    case 'tank':
      add(new THREE.CylinderGeometry(p.s, p.s, h, 20), mat(0x9aa4b5, lambert, { metalness: 0.3 }), 0, h / 2 + 0.6, 0);
      add(new THREE.ConeGeometry(p.s * 1.05, 1.1, 20), mat(0x5b6378, lambert), 0, h + 1.15, 0);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) add(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6), mat(0x3d4459, lambert), sx * p.s * 0.6, 0.35, sz * p.s * 0.6);
      break;
    case 'antenna':
      add(new THREE.CylinderGeometry(0.06, 0.12, h, 6), mat(0x8a93a6, lambert), 0, h / 2, 0);
      add(new THREE.SphereGeometry(0.16, 8, 6), mat(0xff3355, lambert, { emissive: 0xff3355, emissiveIntensity: 2 }), 0, h, 0);
      break;
    case 'billboard': {
      add(new THREE.BoxGeometry(5.2, 2.6, 0.2), mat(0x1b1d30, lambert), 0, 2.6, 0);
      const face = add(new THREE.PlaneGeometry(4.8, 2.3), new THREE.MeshBasicMaterial({ map: logoTexture(), toneMapped: false }), 0, 2.6, -0.11);
      face.rotation.y = Math.PI;
      for (const sx of [-2, 2]) add(new THREE.BoxGeometry(0.15, 1.4, 0.15), mat(0x3d4459, lambert), sx, 0.7, 0);
      break;
    }
    case 'lamp':
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), mat(0x3d4459, lambert), 0, 0.8, 0);
      add(new THREE.SphereGeometry(0.16, 10, 8), mat(0xffe2b0, lambert, { emissive: 0xffd28a, emissiveIntensity: 2.5 }), 0, 1.65, 0);
      break;
    case 'pipe':
      add(new THREE.CylinderGeometry(0.22, 0.22, h, 12), mat(0x7d8799, lambert, { metalness: 0.4 }), 0, h / 2, 0);
      break;
    case 'panel':
      add(new THREE.BoxGeometry(0.1, 3, 6), mat(0x1b2040, lambert), 0, 0, 0);
      for (const y of [-1, 0, 1]) add(new THREE.BoxGeometry(0.12, 0.08, 5.6), mat(0x5fd3ff, lambert, { emissive: 0x5fd3ff, emissiveIntensity: 1.6 }), 0, y, 0);
      break;
    case 'cloud': {
      if (tier >= 2) {
        // Soft cumulus made of sunlit puffs (sprites always face the camera, so it reads as volume from anywhere).
        const sm = new THREE.SpriteMaterial({ map: puffTexture(), color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, depthWrite: false, fog: true });
        for (let i = 0; i < 9; i++) {
          const sp = new THREE.Sprite(sm);
          const k = 0.55 + ((i * 37) % 10) / 22;
          sp.scale.set(p.s * k, p.s * k * 0.8, 1);
          sp.position.set((i - 4) * p.s * 0.16, Math.sin(i * 1.7) * p.s * 0.07 + (i % 3 === 1 ? p.s * 0.12 : 0), Math.cos(i * 2.3) * p.s * 0.14);
          g.add(sp);
        }
        break;
      }
      const m = mat(0xffffff, lambert, { roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35 });
      for (let i = 0; i < 6; i++)
        add(new THREE.IcosahedronGeometry(p.s * (0.25 + (i % 3) * 0.08), 1), m, (i - 2.5) * p.s * 0.22, Math.sin(i * 1.7) * p.s * 0.08, Math.cos(i * 2.3) * p.s * 0.15);
      break;
    }
    case 'crystal':
      add(new THREE.OctahedronGeometry(0.5 * p.s, 0), mat(0x9ff3ff, lambert, { emissive: 0x5fd3ff, emissiveIntensity: 1.2, roughness: 0.1 }), 0, 0.6 * p.s, 0).scale.y = 1.8;
      break;
    case 'tree':
      add(new THREE.CylinderGeometry(0.12 * p.s, 0.18 * p.s, 1.2 * p.s, 6), mat(0x7a5a3c, lambert), 0, 0.6 * p.s, 0);
      add(new THREE.IcosahedronGeometry(0.9 * p.s, 0), mat(map.theme.materials.island, lambert, { roughness: 0.9, flatShading: true }), 0, 1.7 * p.s, 0);
      break;
    case 'rock':
      add(new THREE.DodecahedronGeometry(p.s, 0), mat(0x8a7b6a, lambert, { flatShading: true }), 0, 0, 0);
      add(new THREE.ConeGeometry(p.s * 0.9, p.s * 1.8, 7), mat(0x7a6b5c, lambert, { flatShading: true }), 0, -p.s * 1.2, 0).rotation.x = Math.PI;
      break;
  }
  g.traverse((x) => {
    x.matrixAutoUpdate = false;
    x.updateMatrix();
  });
  return g;
}
