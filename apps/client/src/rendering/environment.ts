import * as THREE from 'three';
import type { MapDef, PropDef } from '@chromashift/shared';
import { logoTexture, windowsTexture } from './textures';

export interface EnvOptions {
  shadowQuality: number;
  shadowResolution: number;
  drawDistance: number;
  reflections: boolean;
  lambert: boolean;
}

export interface Environment {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  envMap: THREE.Texture | null;
  dispose(): void;
}

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
// A screen-printed sky: the gradient is laid down in flat bands, with a flat sun disc and halo,
// in the same printed language as the menus.
const skyFrag = `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
float band(float k, float n){ float x = k * n; return min(1.0, (floor(x) + smoothstep(0.92, 1.0, fract(x))) / (n - 1.0)); }
void main(){ float y = vDir.y;
  vec3 c = y > 0.0 ? mix(horizon, top, band(pow(min(1.0, y * 1.4), 0.7), 6.0)) : mix(horizon, bottom, band(pow(min(1.0, -y * 2.2), 0.6), 3.0));
  float s = max(0.0, dot(normalize(vDir), normalize(sunDir)));
  c = mix(c, c + sunColor * 0.16, smoothstep(0.975, 0.977, s));
  c = mix(c, sunColor * 1.6, smoothstep(0.9988, 0.999, s));
  gl_FragColor = vec4(c, 1.0); }`;

export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, map: MapDef, o: EnvOptions): Environment {
  const t = map.theme;
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(...t.sunDir).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(t.skyTop) },
        horizon: { value: new THREE.Color(t.skyHorizon) },
        bottom: { value: new THREE.Color(t.skyBottom) },
        sunDir: { value: sunDir },
        sunColor: { value: new THREE.Color(t.sunColor) },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  scene.fog = new THREE.Fog(t.fog, o.drawDistance * 0.3, o.drawDistance);
  group.add(new THREE.HemisphereLight(t.ambient, t.ground, t.indoor ? 1.6 : 1.25));
  const sun = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
  const ex = map.extent;
  const cx = (ex.minX + ex.maxX) / 2, cz = (ex.minZ + ex.maxZ) / 2;
  const span = Math.max(ex.maxX - ex.minX, ex.maxZ - ex.minZ) / 2 + 6;
  sun.position.set(cx + sunDir.x * 80, sunDir.y * 80, cz + sunDir.z * 80);
  sun.target.position.set(cx, 0, cz);
  group.add(sun, sun.target);
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
    sun.shadow.radius = o.shadowQuality >= 4 ? 3 : 1;
  }

  let envMap: THREE.Texture | null = null;
  if (o.reflections && !o.lambert) {
    // Reflections come from the sky itself: one PMREM bake per map.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    envMap = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = t.indoor ? 0.35 : 0.5;
  } else scene.environment = null;

  for (const p of map.props) {
    const prop = buildProp(p, map, o.lambert);
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
  return {
    group,
    sun,
    envMap,
    dispose() {
      group.traverse((x) => {
        const m = x as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      envMap?.dispose();
      group.removeFromParent();
    },
  };
}

const mat = (color: number, lambert: boolean, extra: THREE.MeshStandardMaterialParameters = {}) =>
  lambert ? new THREE.MeshLambertMaterial({ color, emissive: extra.emissive ?? 0, emissiveMap: extra.emissiveMap ?? null, map: extra.map ?? null }) : new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function buildProp(p: PropDef, map: MapDef, lambert: boolean): THREE.Object3D | null {
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
      const tex = windowsTexture(Math.round(p.x * 7 + p.z));
      tex.repeat.set(p.s / 8, h / 8);
      add(new THREE.BoxGeometry(p.s, h, p.s), mat(0xffffff, lambert, { map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }), 0, h / 2, 0);
      add(new THREE.BoxGeometry(p.s * 1.04, 1.2, p.s * 1.04), mat(0x2c2f45, lambert), 0, h + 0.6, 0);
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
      const m = mat(0xffffff, lambert, { roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 });
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
