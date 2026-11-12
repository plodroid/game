import * as THREE from 'three';
import { ATMOSPHERE_GLSL, type SummerSky } from './sky';

/*
 * The sea around the arena. It reflects the real sky (atmosphere and clouds, by the Fresnel law),
 * glitters where the sun hits the waves, turns turquoise over the sand near islands and breaks into
 * foam on their beaches. Far away it melts into the same haze as the horizon.
 *
 * Cost by tier: very low is a flat gradient; low adds one layer of ripples and the sun's glint;
 * medium and up reflect the clouds and add foam; ultra also rolls a gentle swell in the geometry.
 */

export interface Shore {
  x: number;
  z: number;
  r: number;
}

const vert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  #ifdef SWELL
  float near = 1.0 - smoothstep(120.0, 700.0, length(p.xz - cameraPosition.xz));
  p.y += (sin(dot(p.xz, vec2(0.093, 0.041)) + uTime * 0.9) * 0.22 + sin(dot(p.xz, vec2(-0.052, 0.117)) + uTime * 0.71) * 0.16) * near;
  #endif
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform samplerCube uClouds;
uniform mat3 uCloudTurn;
uniform vec3 uHaze;
uniform sampler2D uNormals;
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSand;
uniform vec4 uShores[10];
uniform int uShoreCount;
uniform float uFar;
varying vec3 vWorld;
#include <fog_pars_fragment>

vec3 ripples(vec2 uv) { return texture2D(uNormals, uv).xyz * 2.0 - 1.0; }

void main() {
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  vec2 p = vWorld.xz;
  // Calmer (and less sparkly) with distance, so the far sea doesn't shimmer.
  float far = clamp(dist / 700.0, 0.0, 1.0);
  #if LAYERS > 0
  vec3 n = ripples(p * 0.019 + uTime * vec2(0.0095, 0.0061));
  #if LAYERS > 1
  n += ripples(p * 0.061 + uTime * vec2(-0.0157, 0.0109)) * 0.72;
  #endif
  #if LAYERS > 2
  n += ripples(p * 0.173 + uTime * vec2(0.0263, -0.0214)) * 0.45;
  #endif
  vec3 N = normalize(vec3(n.x, 2.4 + far * 9.0, n.y));
  #else
  vec3 N = vec3(0.0, 1.0, 0.0);
  #endif
  if (!gl_FrontFacing) N = -N;
  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  #ifdef SKY_REFLECT
  vec4 cl = textureCube(uClouds, uCloudTurn * R);
  vec3 refl = atmosphere(R) * cl.a + cl.rgb;
  #else
  vec3 refl = mix(uHaze, atmosphere(vec3(0.0, 1.0, 0.0)), pow(R.y, 0.55));
  #endif
  // Shallow, sunny turquoise over the sand around islands; deep blue out at sea.
  float shore = 1e5;
  for (int i = 0; i < 10; i++) {
    if (i >= uShoreCount) break;
    shore = min(shore, length(p - uShores[i].xy) - uShores[i].z);
  }
  float shallow = 1.0 - smoothstep(0.0, 34.0, shore);
  vec3 body = mix(uDeep, uShallow, shallow * shallow);
  body = mix(body, uSand, (1.0 - smoothstep(-1.5, 6.0, shore)) * 0.6);
  vec3 water = body * (uSunColor * 0.16 * max(uSunDir.y, 0.0) + uAmbient * 0.7);
  vec3 col = mix(water, refl, F);
  #ifdef GLINT
  float sd = max(dot(R, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 1100.0) * 160.0 + pow(sd, 120.0) * 1.1) * (1.0 - far * 0.85);
  #endif
  #ifdef FOAM
  float wave = sin(uTime * 1.25 - shore * 0.9) * 0.5 + 0.5;
  float foamBand = (1.0 - smoothstep(0.0, 1.6 + wave * 1.8, shore)) * smoothstep(-2.5, -0.4, shore);
  float speck = texture2D(uNormals, p * 0.21 + uTime * 0.013).b;
  col = mix(col, vec3(0.95, 0.97, 1.0) * (uAmbient * 1.2 + uSunColor * 0.75), clamp(foamBand * (0.55 + speck * 0.9), 0.0, 1.0));
  #endif
  if (!gl_FrontFacing) col = uDeep * (uAmbient + 0.15);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  // The sea's far edge melts into the horizon haze.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(uFar * 0.62, uFar * 0.97, dist));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A tileable ripple normal map, made once. */
let normals: THREE.DataTexture | null = null;
function rippleNormals(): THREE.DataTexture {
  if (normals) return normals;
  const n = 256;
  const h = new Float32Array(n * n);
  const hash = (x: number, y: number, s: number) => {
    let v = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x: number, y: number, period: number, s: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const w = (a: number) => ((a % period) + period) % period;
    const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0, amp = 1, f = 6;
      for (let o = 0; o < 5; o++) {
        // Sharpened crests read as wind-blown wavelets rather than soft blobs.
        const s = vnoise((x / n) * f, (y / n) * f, f, o + 1);
        v += (1 - Math.abs(s * 2 - 1)) * amp;
        amp *= 0.5;
        f *= 2;
      }
      h[y * n + x] = v;
    }
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const at = (xx: number, yy: number) => h[((yy + n) % n) * n + ((xx + n) % n)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      data[i] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  normals = t;
  return t;
}

/** A disc of rings that get wider towards the edge: fine detail near the arena, few triangles far out. */
function seaGeometry(radius: number, rings: number, segs: number) {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  const r0 = 1.5, k = Math.pow(radius / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(k, i);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++)
    for (let j = 0; j < segs; j++) {
      const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private time = Math.random() * 100;

  constructor(sky: SummerSky, o: { tier: number; level: number; x: number; z: number; far: number; shores: Shore[] }) {
    const t = o.tier;
    const su = sky.uniforms;
    const sun = sky.light.sunColor.clone().multiplyScalar(3.2);
    const amb = sky.light.skyAmbient;
    const shores = o.shores.slice(0, 10).map((s) => new THREE.Vector4(s.x, s.z, s.r, 0));
    while (shores.length < 10) shores.push(new THREE.Vector4(0, 0, -1e6, 0));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uSunDir: su.uSunDir,
        uBetaR: su.uBetaR,
        uBetaM: su.uBetaM,
        uSunE: su.uSunE,
        uClouds: su.uClouds,
        uCloudTurn: su.uCloudTurn,
        uHaze: su.uHaze,
        uNormals: { value: t > 0 ? rippleNormals() : null },
        uTime: { value: 0 },
        uSunColor: { value: new THREE.Vector3(sun.r, sun.g, sun.b) },
        uAmbient: { value: new THREE.Vector3(amb.r, amb.g, amb.b) },
        uDeep: { value: new THREE.Color(0x0b4f7a) },
        uShallow: { value: new THREE.Color(0x29d1c6) },
        uSand: { value: new THREE.Color(0xf3dfb4) },
        uShores: { value: shores },
        uShoreCount: { value: Math.min(10, o.shores.length) },
        uFar: { value: o.far },
      },
      defines: {
        LAYERS: [0, 1, 2, 3, 3][t],
        ...(t >= 1 ? { GLINT: '' } : {}),
        ...(t >= 2 ? { SKY_REFLECT: '', FOAM: '' } : {}),
        ...(t >= 4 ? { SWELL: '' } : {}),
      },
      vertexShader: vert,
      fragmentShader: frag,
      fog: true,
      side: THREE.DoubleSide,
    });
    const radius = Math.max(1600, o.far * 2.2);
    this.mesh = new THREE.Mesh(seaGeometry(radius, [30, 44, 64, 84, 110][t], [48, 64, 96, 128, 160][t]), this.material);
    this.mesh.position.set(o.x, o.level, o.z);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.name = 'sea';
  }

  setFar(far: number) {
    this.material.uniforms.uFar.value = far;
  }

  update(dt: number) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
