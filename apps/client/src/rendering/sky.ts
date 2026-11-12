import * as THREE from 'three';
import type { GraphicsSettings } from '../settings/settings';

/*
 * A summer sky: a physically based atmosphere (the Preetham daylight model, as in three's Sky
 * example) with cumulus clouds.
 *
 * The clouds are the expensive part, so they are baked once per map into a cube map: a volumetric
 * ray march on the higher presets, a light 2D cloud layer on the lower ones. Each frame the sky only
 * evaluates the atmosphere and samples that cube, slowly turned so the clouds drift. The cube's
 * alpha holds how much light gets through the clouds, which also hides the sun when a cloud passes
 * in front of it (and, read back once, dims the sunlight in the arena at the same moments).
 */

/** Visual tier from the graphics settings: 0 very low, 1 low, 2 medium, 3 high, 4 ultra. */
export function visualTier(g: Pick<GraphicsSettings, 'reflections' | 'textureQuality' | 'shadowQuality' | 'postProcessing'>): number {
  if (!g.reflections) return g.textureQuality >= 1 ? 1 : 0;
  if (g.textureQuality < 3 || !g.postProcessing) return 2;
  return g.shadowQuality >= 4 ? 4 : 3;
}

export interface SkyLook {
  /** Towards the sun. */
  sunDir: THREE.Vector3;
  /** 1.6 crisp and deep blue … 6 hazy. */
  turbidity: number;
  /** Cloud cover, 0 … 1. */
  clouds: number;
  /** Picks the cloud layout. */
  seed: number;
}

// ---- The atmosphere, in JavaScript (light colours, fog) and GLSL (the sky itself). -------------

const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const RAYLEIGH = 1.6;
const MIE_COEFFICIENT = 0.004;
const MIE_G = 0.78;
/** Brings the model's radiance to this game's exposure. */
const SKY_SCALE = 0.2;

interface AtmosUniforms {
  betaR: THREE.Vector3;
  betaM: THREE.Vector3;
  sunE: number;
}

function sunIntensity(cosZenith: number) {
  const c = Math.max(-1, Math.min(1, cosZenith));
  return 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(c)) / 1.5)));
}

function atmosUniforms(look: SkyLook): AtmosUniforms {
  const mie = 0.434 * (0.2 * look.turbidity * 1e-17) * MIE_COEFFICIENT;
  return {
    betaR: new THREE.Vector3(...TOTAL_RAYLEIGH.map((x) => x * RAYLEIGH)),
    betaM: new THREE.Vector3(...MIE_CONST.map((x) => x * mie)),
    sunE: sunIntensity(look.sunDir.y),
  };
}

/** Extinction along a view ray (how much of the light behind gets through the air). */
function extinction(a: AtmosUniforms, dirY: number, out: number[]) {
  const zen = Math.acos(Math.max(0, dirY));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const r = [a.betaR.x, a.betaR.y, a.betaR.z], m = [a.betaM.x, a.betaM.y, a.betaM.z];
  for (let i = 0; i < 3; i++) out[i] = Math.exp(-(r[i] * 8400 * inv + m[i] * 1250 * inv));
  return out;
}

/** Less glare in the band of haze just above the horizon (the raw model makes it as bright as sunlit ground). */
const horizonDim = (y: number) => {
  const t = Math.max(0, Math.min(1, y / 0.45));
  return 0.68 + 0.32 * t * t * (3 - 2 * t);
};

/** Sky radiance seen in direction `d` (no sun disc), the same as the shader. */
export function skyRadiance(look: SkyLook, a: AtmosUniforms, d: THREE.Vector3, out = new THREE.Color()) {
  const fex = extinction(a, d.y, [0, 0, 0]);
  const cos = d.dot(look.sunDir);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cos * 0.5 + 0.5, 2));
  const g2 = MIE_G * MIE_G;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * MIE_G * cos + g2, 1.5));
  const r = [a.betaR.x, a.betaR.y, a.betaR.z], m = [a.betaM.x, a.betaM.y, a.betaM.z];
  const k = Math.max(0, Math.min(1, Math.pow(1 - look.sunDir.y, 5)));
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const beta = (r[i] * rPhase + m[i] * mPhase) / (r[i] + m[i]);
    let lin = Math.pow(a.sunE * beta * (1 - fex[i]), 1.5);
    lin *= 1 + (Math.sqrt(a.sunE * beta * fex[i]) - 1) * k;
    c[i] = ((lin + 0.1 * fex[i]) * 0.04 + [0, 0.0003, 0.00075][i]) * SKY_SCALE * horizonDim(d.y);
  }
  return out.setRGB(c[0], c[1], c[2]);
}

/** What the sky gives the rest of the scene: sun colour, the haze at the horizon (fog), and ambient colours. */
export interface SkyLight {
  /** Sunlight reaching the ground, normalised to a brightest channel of 1. */
  sunColor: THREE.Color;
  /** The horizon haze, used as the fog colour so the sea and the sky meet without a seam. */
  haze: THREE.Color;
  /** Average light from the upper sky (the hemisphere light's sky colour). */
  skyAmbient: THREE.Color;
}

export function skyLight(look: SkyLook): SkyLight {
  const a = atmosUniforms(look);
  const fex = extinction(a, look.sunDir.y, [0, 0, 0]);
  const top = Math.max(...fex);
  const sunColor = new THREE.Color(fex[0] / top, fex[1] / top, fex[2] / top);
  const d = new THREE.Vector3(), c = new THREE.Color(), haze = new THREE.Color(0, 0, 0), amb = new THREE.Color(0, 0, 0);
  for (let i = 0; i < 24; i++) {
    const az = (i / 24) * Math.PI * 2;
    d.set(Math.cos(az) * 0.9994, 0.035, Math.sin(az) * 0.9994);
    haze.add(skyRadiance(look, a, d, c));
    for (const el of [0.35, 0.7, 1.2]) {
      d.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      amb.add(skyRadiance(look, a, d, c));
    }
  }
  haze.multiplyScalar(1 / 24);
  amb.multiplyScalar(1 / 72);
  return { sunColor, haze, skyAmbient: amb };
}

/** The atmosphere in GLSL (needs the uniforms below). */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform float uSunE;
vec3 atmosphere(vec3 dir) {
  float zen = acos(max(0.0, dir.y));
  float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - zen * 57.29577951, -1.253));
  vec3 fex = exp(-(uBetaR * 8.4e3 * inv + uBetaM * 1.25e3 * inv));
  float c = dot(dir, uSunDir);
  float rPhase = 0.05968310365946075 * (1.0 + pow(c * 0.5 + 0.5, 2.0));
  float g2 = ${(MIE_G * MIE_G).toFixed(6)};
  float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - ${(2 * MIE_G).toFixed(6)} * c + g2, 1.5));
  vec3 beta = (uBetaR * rPhase + uBetaM * mPhase) / (uBetaR + uBetaM);
  vec3 lin = pow(uSunE * beta * (1.0 - fex), vec3(1.5));
  lin *= mix(vec3(1.0), sqrt(uSunE * beta * fex), clamp(pow(1.0 - uSunDir.y, 5.0), 0.0, 1.0));
  return ((lin + 0.1 * fex) * 0.04 + vec3(0.0, 0.0003, 0.00075)) * ${SKY_SCALE.toFixed(4)} * (0.68 + 0.32 * smoothstep(0.0, 0.45, dir.y));
}`;

function atmosphereUniforms(look: SkyLook) {
  const a = atmosUniforms(look);
  return {
    uSunDir: { value: look.sunDir.clone().normalize() },
    uBetaR: { value: a.betaR },
    uBetaM: { value: a.betaM },
    uSunE: { value: a.sunE },
  };
}

// ---- Clouds, baked into a cube map ---------------------------------------------------------------

const CLOUD_GLSL = /* glsl */ `
uniform float uCover;
uniform float uSeed;
uniform vec3 uSunLight;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform int uSteps;
uniform int uLightSteps;
uniform int uOctaves;
const float BOTTOM = 1400.0;
const float TOP = 4600.0;
const float PLANET = 600000.0;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise2(vec2 x) {
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// Round puffs: 1 at random points, falling to 0 between them (inverted cellular noise).
float puffs(vec3 p) {
  vec3 id = floor(p), f = fract(p);
  float m = 1.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 r = o + hash33(id + o) - f;
        m = min(m, dot(r, r));
      }
  return 1.0 - sqrt(m);
}
float valueFbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * vnoise3(p);
    n += a;
    p = p * 2.03 + vec3(11.7, -4.3, 7.9);
    a *= 0.5;
  }
  return s / n;
}
float remap(float x, float a, float b, float c, float d) { return c + (x - a) / (b - a) * (d - c); }
// Where the clouds are: separate cells with clear blue between them.
float weather(vec2 xz) {
  vec2 q = xz * 0.000105 + uSeed * 17.0;
  float n = vnoise2(q) * 0.58 + vnoise2(q * 2.6 + 13.1) * 0.28 + vnoise2(q * 6.3 - 7.7) * 0.14;
  return clamp((n - (1.0 - uCover) + 0.08) / 0.22, 0.0, 1.0);
}
// Cloud density at a point; oct sets how much detail (the light march uses a cheap version).
float density(vec3 p, int oct) {
  float h = (p.y - BOTTOM) / (TOP - BOTTOM);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  float w = weather(p.xz);
  if (w <= 0.0) return 0.0;
  // A flat base and a rounded top that rises with the size of the cell.
  float top = 0.28 + 0.72 * w;
  float profile = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(top * 0.35, top, h));
  if (profile <= 0.0) return 0.0;
  vec3 q = p * 0.00052 + vec3(uSeed * 31.0, 0.0, uSeed * 13.0);
  float env = w * profile;
  // The surface of the cloud follows round billows (cellular puffs) pushed out by the envelope,
  // with a little soft noise so no two puffs match.
  float puffy = oct >= 3 ? puffs(q * 1.4) * 0.62 + puffs(q * 2.9) * 0.25 + puffs(q * 6.1) * 0.13 : 0.48;
  float soft = valueFbm(q * 0.9, oct >= 3 ? 2 : 1);
  float raw = env * 1.4 - (1.0 - puffy) * 0.85 - (1.0 - soft) * 0.22;
  // Fine detail erodes only the edges: the cauliflower texture of cumulus.
  if (oct >= 4) raw -= (1.0 - (puffs(p * 0.0046 + uSeed) * 0.7 + vnoise3(p * 0.012) * 0.3)) * 0.13;
  // A crisp boundary: real cumulus go from clear air to dense cloud within metres.
  float d = smoothstep(0.0, 0.09, raw) * (0.65 + 0.35 * env);
  return d;
}
float hg(float c, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
// Height above a slightly curved ground, so the layer bends down to the horizon.
vec3 worldAt(vec3 rd, float t) {
  vec3 p = vec3(0.0, PLANET, 0.0) + rd * t;
  return vec3(p.x, length(p) - PLANET, p.z);
}
float hitShell(vec3 rd, float r) {
  float b = PLANET * rd.y;
  return -b + sqrt(b * b + r * r - PLANET * PLANET);
}
// Light reaching a point through the cloud towards the sun.
float towardsSun(vec3 p) {
  float sum = 0.0, stepL = 160.0;
  vec3 q = p;
  for (int i = 0; i < 8; i++) {
    if (i >= uLightSteps) break;
    q += uSunDir * stepL;
    sum += density(q, 1) * stepL;
    stepL *= 1.7;
  }
  return sum;
}
vec4 volumetric(vec3 rd) {
  if (rd.y <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = hitShell(rd, PLANET + BOTTOM), t1 = hitShell(rd, PLANET + TOP);
  t1 = min(t1, t0 + 26000.0);
  int steps = int(float(uSteps) * mix(1.0, 1.8, 1.0 - smoothstep(0.04, 0.35, rd.y)));
  float dt = (t1 - t0) / float(steps);
  // Interleaved-gradient jitter: hides banding without the grain of white noise.
  float t = t0 + dt * (0.25 + 0.5 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))));
  float mu = dot(rd, uSunDir);
  const float SIGMA = 0.0052;
  float T = 1.0;
  vec3 L = vec3(0.0);
  for (int i = 0; i < 128; i++) {
    if (i >= steps || T < 0.015) break;
    vec3 p = worldAt(rd, t);
    float d = density(p, uOctaves);
    if (d > 0.002) {
      float h = clamp((p.y - BOTTOM) / (TOP - BOTTOM), 0.0, 1.0);
      float od = towardsSun(p) * SIGMA;
      // Light through the cloud, with multiple scattering approximated by softer octaves.
      float ms = 0.0, aa = 1.0, bb = 1.0, cc = 1.0;
      for (int o = 0; o < 3; o++) {
        ms += aa * exp(-od * bb) * (mix(hg(mu, 0.72 * cc), hg(mu, -0.2 * cc), 0.3) * 2.4 + 0.1);
        aa *= 0.5;
        bb *= 0.42;
        cc *= 0.5;
      }
      // "Powder": the sunlit side of a dense puff is darker at its very edge, which rounds the billows.
      float powder = 1.0 - exp(-d * SIGMA * 1800.0);
      vec3 S = uSunLight * ms * mix(0.45, 1.0, powder) + mix(uAmbBottom, uAmbTop, h * h) * (0.25 + 0.75 * h);
      float Ti = exp(-d * SIGMA * dt);
      L += T * S * (1.0 - Ti);
      T *= Ti;
    }
    t += dt;
  }
  // Far clouds fade into the haze, and nothing hangs below the horizon.
  float fade = exp(-t0 / 52000.0) * smoothstep(0.0, 0.035, rd.y);
  return vec4(L * fade, 1.0 - (1.0 - T) * fade);
}
// The cheaper look: one layer of 2D cloud, lit from its own thickness.
vec4 cloudLayer(vec3 rd) {
  if (rd.y <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t = hitShell(rd, PLANET + 2200.0);
  vec2 p = (vec3(0.0, PLANET, 0.0) + rd * t).xz;
  float w = weather(p);
  float n = 0.0, a = 0.5;
  vec2 q = p * 0.00055 + uSeed * 9.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uOctaves) break;
    n += a * abs(vnoise2(q) * 2.0 - 1.0);
    q = q * 2.1 + 3.7;
    a *= 0.5;
  }
  float d = clamp((w * 1.25 - (1.0 - n) * 0.95) * 2.4, 0.0, 1.0);
  float alpha = 1.0 - exp(-d * 3.0);
  float mu = dot(rd, uSunDir);
  float silver = clamp(hg(mu, 0.7) * 3.0, 0.0, 2.5) * (1.0 - d);
  vec3 col = uAmbTop * 0.9 + uSunLight * (0.62 - 0.32 * d + silver * 0.35);
  float fade = exp(-t / 52000.0) * smoothstep(0.0, 0.035, rd.y);
  return vec4(col * alpha * fade, 1.0 - alpha * fade);
}
vec4 cloudsAlong(vec3 rd) {
  #ifdef VOLUMETRIC
  return volumetric(rd);
  #else
  return cloudLayer(rd);
  #endif
}`;

const bakeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vDir, 1.0);
}`;

const bakeFrag = /* glsl */ `
${ATMOSPHERE_GLSL}
${CLOUD_GLSL}
varying vec3 vDir;
uniform float uTrack;
void main() {
  vec3 rd = normalize(vDir);
  if (uTrack > 0.5) {
    // One row of texels around the sun's circle: cloud transmittance as the clouds turn past it.
    float a = gl_FragCoord.x / 256.0 * 6.2831853;
    float c = cos(a), s = sin(a);
    rd = normalize(vec3(c * uSunDir.x + s * uSunDir.z, uSunDir.y, -s * uSunDir.x + c * uSunDir.z));
    gl_FragColor = vec4(vec3(cloudsAlong(rd).a), 1.0);
    return;
  }
  gl_FragColor = cloudsAlong(rd);
}`;

const TIERS = [
  { size: 128, volumetric: false, steps: 0, light: 0, octaves: 3 },
  { size: 256, volumetric: false, steps: 0, light: 0, octaves: 4 },
  { size: 384, volumetric: true, steps: 26, light: 3, octaves: 3 },
  { size: 768, volumetric: true, steps: 48, light: 4, octaves: 4 },
  { size: 1024, volumetric: true, steps: 72, light: 6, octaves: 5 },
];

function hdrType(renderer: THREE.WebGLRenderer) {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

function cloudMaterial(look: SkyLook, light: SkyLight, tier: (typeof TIERS)[number]) {
  const sun = light.sunColor.clone().multiplyScalar(4.4);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphereUniforms(look),
      uCover: { value: look.clouds },
      uSeed: { value: look.seed },
      uSunLight: { value: new THREE.Vector3(sun.r, sun.g, sun.b) },
      uAmbTop: { value: new THREE.Vector3(light.skyAmbient.r, light.skyAmbient.g, light.skyAmbient.b).multiplyScalar(1.35) },
      uAmbBottom: { value: new THREE.Vector3(light.haze.r, light.haze.g, light.haze.b).multiplyScalar(0.42) },
      uSteps: { value: tier.steps },
      uLightSteps: { value: tier.light },
      uOctaves: { value: tier.octaves },
      uTrack: { value: 0 },
    },
    defines: tier.volumetric ? { VOLUMETRIC: '' } : {},
    vertexShader: bakeVert,
    fragmentShader: bakeFrag,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
}

// ---- The sky as drawn each frame ------------------------------------------------------------------

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position * 600.0 + cameraPosition, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const skyFrag = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform samplerCube uClouds;
uniform mat3 uCloudTurn;
uniform vec3 uHaze;
uniform vec3 uSunDisc;
uniform float uShowSun;
uniform float uCloudBias;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  // A little mip bias smooths the ray-march dither when the view magnifies the clouds.
  vec4 cl = textureCube(uClouds, uCloudTurn * dir, uCloudBias);
  vec3 col = atmosphere(dir) * cl.a + cl.rgb;
  // The sun: a small, very bright disc (for the bloom) behind any passing cloud.
  float c = dot(dir, uSunDir);
  float disc = smoothstep(0.99989, 0.99993, c);
  col += uSunDisc * disc * cl.a * uShowSun;
  // At the horizon the sky melts into the same haze as the fog over the sea.
  col = mix(col, uHaze, 1.0 - smoothstep(-0.005, 0.11, dir.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SummerSky {
  readonly mesh: THREE.Mesh;
  readonly light: SkyLight;
  readonly cloudMap: THREE.CubeTexture;
  /** Turn of the clouds around the vertical axis (radians). */
  turn = 0;
  private rt: THREE.WebGLCubeRenderTarget;
  private track: Uint8Array | null = null;
  private material: THREE.ShaderMaterial;
  private turnMatrix = new THREE.Matrix3();
  private m4 = new THREE.Matrix4();
  private texelsPerDegree: number;

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly look: SkyLook,
    tier: number,
    /** Sharper clouds for narrow views (the menu camera magnifies the sky). */
    boost = 1,
  ) {
    const t = TIERS[Math.max(0, Math.min(4, tier))];
    const size = Math.min(1024, Math.max(Math.round(t.size * boost), boost > 1 && t.volumetric ? 768 : 0));
    this.light = skyLight(look);
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: hdrType(renderer), generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.cloudMap = this.rt.texture;
    this.texelsPerDegree = size / 90;
    const bake = cloudMaterial(look, this.light, t);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), bake);
    const scene = new THREE.Scene();
    scene.add(box);
    const cam = new THREE.CubeCamera(0.1, 10, this.rt);
    cam.update(renderer, scene);
    // The sun's circle: how much of it each cloud lets through, read once for the light in the arena.
    try {
      const rt = new THREE.WebGLRenderTarget(256, 1, { type: THREE.UnsignedByteType });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bake);
      bake.uniforms.uTrack.value = 1;
      bake.side = THREE.DoubleSide;
      const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const s2 = new THREE.Scene();
      s2.add(quad);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(s2, ortho);
      const px = new Uint8Array(256 * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, 256, 1, px);
      renderer.setRenderTarget(prev);
      this.track = px;
      rt.dispose();
      quad.geometry.dispose();
    } catch {
      this.track = null;
    }
    box.geometry.dispose();
    bake.dispose();

    const disc = this.light.sunColor.clone().multiplyScalar(42);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...atmosphereUniforms(look),
        uClouds: { value: this.cloudMap },
        uCloudTurn: { value: this.turnMatrix },
        uHaze: { value: this.light.haze.clone() },
        uSunDisc: { value: new THREE.Vector3(disc.r, disc.g, disc.b) },
        uShowSun: { value: 1 },
        uCloudBias: { value: 0 },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  /**
   * Matches the clouds' sharpness to the view: when the screen shows more pixels per degree than
   * the bake has texels, a mip bias blurs away the ray-march dither instead of magnifying it.
   */
  fitTo(camera: THREE.PerspectiveCamera, heightPx: number) {
    const pixelsPerDegree = heightPx / Math.max(1, camera.fov);
    this.material.uniforms.uCloudBias.value = Math.max(0, Math.log2(pixelsPerDegree / this.texelsPerDegree) + 0.75);
  }

  /** How much of the sun gets through the clouds right now, 0 … 1. */
  sunThrough(): number {
    const tr = this.track;
    if (!tr) return 1;
    const f = ((((-this.turn / (Math.PI * 2)) % 1) + 1) % 1) * 256;
    const i = Math.floor(f) % 256, j = (i + 1) % 256, k = f - Math.floor(f);
    return (tr[i * 4] * (1 - k) + tr[j * 4] * k) / 255;
  }

  update(dt: number) {
    this.turn += dt * 0.0028;
    this.m4.makeRotationY(-this.turn);
    this.turnMatrix.setFromMatrix4(this.m4);
  }

  /** An environment map (reflections and image-based light) from this sky, without the sun disc. */
  environment(): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const scene = new THREE.Scene();
    const m = new THREE.Mesh(this.mesh.geometry, this.material);
    m.frustumCulled = false;
    scene.add(m);
    this.material.uniforms.uShowSun.value = 0;
    const env = pmrem.fromScene(scene, 0.02).texture;
    this.material.uniforms.uShowSun.value = 1;
    pmrem.dispose();
    return env;
  }

  /** Shared with the sea, which reflects the same sky. */
  get uniforms() {
    return this.material.uniforms;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.rt.dispose();
  }
}
