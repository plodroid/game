import * as THREE from 'three';
import { ATLAS_COLS, CELL_BLOCKED, type PaintGrid, type Team, type Vec3 } from '@chromashift/shared';

/** Texels per paint cell for each paint-quality level. */
const DENSITY = [3, 5, 8, 10];
const MAX_STAMPS = 4096;

const stampVert = /* glsl */ `
attribute vec4 iRect;
attribute vec4 iClip;
attribute vec4 iMisc;
varying vec2 vLocal;
varying vec2 vPx;
varying vec4 vClip;
varying vec4 vMisc;
void main() {
  float c = cos(iMisc.w), s = sin(iMisc.w);
  vec2 p = position.xy * 1.45;
  vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 px = iRect.xy + r * iRect.zw;
  vLocal = p;
  vPx = px;
  vClip = iClip;
  vMisc = iMisc;
  gl_Position = projectionMatrix * vec4(px, 0.0, 1.0);
}`;

const stampFrag = /* glsl */ `
varying vec2 vLocal;
varying vec2 vPx;
varying vec4 vClip;
varying vec4 vMisc;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  if (vPx.x < vClip.x || vPx.y < vClip.y || vPx.x > vClip.z || vPx.y > vClip.w) discard;
  float seed = vMisc.y;
  float kind = vMisc.z;
  float d = length(vLocal);
  float a = atan(vLocal.y, vLocal.x) + 3.14159;
  // Periodic wobble around the rim so the outline never shows a seam.
  float wob = (n1(a * 2.5 + seed) - 0.5) * 0.24 + (n1(mod(a * 6.0, 37.699) + seed * 1.7) - 0.5) * 0.1;
  if (kind > 0.5 && kind < 2.5) wob *= 0.35;
  float edge = 0.9 + wob;
  float shape = 1.0 - smoothstep(edge - 0.06, edge + 0.02, d);
  if (kind < 0.5 || kind > 2.5) {
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float ang = h1(seed + fi * 3.1) * 6.2831;
      float rad = 1.0 + h1(seed + fi * 7.3) * 0.34;
      float sz = 0.06 + h1(seed + fi * 1.9) * 0.1;
      vec2 cc = vec2(cos(ang), sin(ang)) * rad;
      shape = max(shape, 1.0 - smoothstep(sz * 0.65, sz, length(vLocal - cc)));
    }
  }
  if (shape <= 0.002) discard;
  vec2 tc = vMisc.x < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  gl_FragColor = vec4(tc * shape, 0.0, shape);
}`;

const rebuildFrag = /* glsl */ `
uniform sampler2D grid;
uniform vec2 texSize;
varying vec2 vUv;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec4 g = texture2D(grid, vUv);
  float n = (vn(vUv * texSize * 0.6) - 0.5) * 0.35;
  float a = smoothstep(0.35, 0.65, g.r + n), b = smoothstep(0.35, 0.65, g.g + n);
  gl_FragColor = vec4(a, b, 0.0, max(a, b));
}`;

/**
 * Visual paint. The simulation owns ownership; this only draws it. Every paint event becomes
 * one instanced stamp per affected surface, all rendered in a single draw call per frame.
 */
export class PaintAtlas {
  readonly target: THREE.WebGLRenderTarget;
  readonly k: number;
  readonly width: number;
  readonly height: number;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private geo = new THREE.InstancedBufferGeometry();
  private rect: THREE.InstancedBufferAttribute;
  private clip: THREE.InstancedBufferAttribute;
  private misc: THREE.InstancedBufferAttribute;
  private count = 0;
  private rebuildScene: THREE.Scene | null = null;
  private gridTex: THREE.DataTexture | null = null;
  private seedCounter = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private grid: PaintGrid,
    quality: number,
  ) {
    const maxTex = Math.min(renderer.capabilities.maxTextureSize, 4096);
    let k = DENSITY[Math.max(0, Math.min(3, quality))];
    while (k > 2 && (ATLAS_COLS * k > maxTex || grid.atlasRows * k > maxTex)) k--;
    this.k = k;
    this.width = ATLAS_COLS * k;
    this.height = Math.max(1, grid.atlasRows) * k;
    const mips = quality >= 2;
    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      depthBuffer: false,
      generateMipmaps: mips,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.OrthographicCamera(0, this.width, this.height, 0, -1, 1);

    const plane = new THREE.PlaneGeometry(2, 2);
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.clip = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.misc = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iRect', this.rect);
    this.geo.setAttribute('iClip', this.clip);
    this.geo.setAttribute('iMisc', this.misc);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: stampVert,
      fragmentShader: stampFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.clear();
  }

  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
    this.count = 0;
  }

  /** Queues the visuals for one simulation paint event. */
  stamp(c: Vec3, r: number, team: Team, kind: number) {
    const k = this.k;
    const seed = (this.seedCounter = (this.seedCounter * 16807) % 2147483647) % 1000;
    this.grid.forEachSurfaceInSphere(c, r, (s, u0, v0, rr) => {
      if (this.count >= MAX_STAMPS) this.flush();
      const i = this.count++ * 4;
      const ox = (s.ax + 1) * k, oy = (s.ay + 1) * k;
      this.rect.array[i] = ox + (u0 / s.cu) * k;
      this.rect.array[i + 1] = oy + (v0 / s.cv) * k;
      this.rect.array[i + 2] = (rr / s.cu) * k;
      this.rect.array[i + 3] = (rr / s.cv) * k;
      this.clip.array[i] = ox;
      this.clip.array[i + 1] = oy;
      this.clip.array[i + 2] = ox + s.cols * k;
      this.clip.array[i + 3] = oy + s.rows * k;
      this.misc.array[i] = team;
      this.misc.array[i + 1] = seed + s.id * 0.37;
      this.misc.array[i + 2] = kind;
      this.misc.array[i + 3] = (seed % 628) / 100;
    });
  }

  /** Redraws everything from the ownership grid (late join, quality change, resync). */
  rebuildFromGrid() {
    const W = ATLAS_COLS, H = Math.max(1, this.grid.atlasRows);
    const data = new Uint8Array(W * H * 4);
    const cells = this.grid.cells;
    for (const s of this.grid.surfaces) {
      for (let j = -1; j <= s.rows; j++)
        for (let i = -1; i <= s.cols; i++) {
          const ci = Math.max(0, Math.min(s.cols - 1, i)), cj = Math.max(0, Math.min(s.rows - 1, j));
          const v = cells[s.offset + cj * s.cols + ci];
          const o = ((s.ay + 1 + j) * W + (s.ax + 1 + i)) * 4;
          if (v === CELL_BLOCKED) continue;
          data[o] = v === 1 ? 255 : 0;
          data[o + 1] = v === 2 ? 255 : 0;
          data[o + 3] = 255;
        }
    }
    this.gridTex?.dispose();
    this.gridTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    this.gridTex.magFilter = this.gridTex.minFilter = THREE.LinearFilter;
    this.gridTex.needsUpdate = true;
    if (!this.rebuildScene) {
      this.rebuildScene = new THREE.Scene();
      const m = new THREE.ShaderMaterial({
        uniforms: { grid: { value: null }, texSize: { value: new THREE.Vector2(W, H) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: rebuildFrag,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
      q.frustumCulled = false;
      this.rebuildScene.add(q);
    }
    ((this.rebuildScene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.grid.value = this.gridTex;
    this.count = 0;
    this.pendingRebuild = true;
  }
  private pendingRebuild = false;

  /** Renders queued stamps into the atlas. Call once per frame before the main render. */
  flush() {
    if (!this.count && !this.pendingRebuild) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    if (this.pendingRebuild && this.rebuildScene) {
      r.render(this.rebuildScene, this.camera);
      this.pendingRebuild = false;
    }
    if (this.count) {
      for (const a of [this.rect, this.clip, this.misc]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.count * 4);
        a.needsUpdate = true;
      }
      this.geo.instanceCount = this.count;
      r.render(this.scene, this.camera);
      this.count = 0;
    }
    r.setRenderTarget(prev);
    r.autoClear = auto;
  }

  /** UV of an atlas cell coordinate (for geometry building). */
  uvOf(cellX: number, cellY: number, out: THREE.Vector2) {
    return out.set(cellX / ATLAS_COLS, cellY / Math.max(1, this.grid.atlasRows));
  }

  dispose() {
    this.target.dispose();
    this.geo.dispose();
    this.gridTex?.dispose();
    for (const s of [this.scene, this.rebuildScene])
      s?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        m?.dispose();
      });
  }
}

/** Paint shading injected into the map's standard/lambert materials. */
export interface PaintUniforms {
  paintMap: { value: THREE.Texture };
  teamA: { value: THREE.Color };
  teamB: { value: THREE.Color };
  paintTexel: { value: THREE.Vector2 };
  paintRelief: { value: number };
}

export function injectPaint(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, u: PaintUniforms, relief: boolean) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paintUv;\nvarying vec2 vPaintUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPaintUv = paintUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D paintMap;
uniform vec3 teamA;
uniform vec3 teamB;
uniform vec2 paintTexel;
uniform float paintRelief;
varying vec2 vPaintUv;
float paintMask = 0.0;
float paintCov(vec2 uv) { vec4 t = texture2D(paintMap, uv); return t.r + t.g; }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 pt = texture2D(paintMap, vPaintUv);
float cov = pt.r + pt.g;
paintMask = smoothstep(0.42, 0.56, cov);
vec3 paintCol = mix(teamA, teamB, smoothstep(0.45, 0.55, pt.g / max(cov, 1e-4)));
diffuseColor.rgb = mix(diffuseColor.rgb, paintCol, paintMask);`,
      );
    if (relief)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // Raised paint rims: bump from the coverage gradient (screen-space derivative method).
  float h = smoothstep(0.3, 0.7, paintCov(vPaintUv));
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * paintRelief;
  vec3 vSigmaX = dFdx(-vViewPosition), vSigmaY = dFdy(-vViewPosition);
  vec3 R1 = cross(vSigmaY, normal), R2 = cross(normal, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  normal = normalize(abs(fDet) * normal - vGrad);
}`,
      );
    if (mat instanceof THREE.MeshStandardMaterial)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, paintMask);',
      );
  };
  mat.customProgramCacheKey = () => `paint:${relief ? 1 : 0}:${mat.type}`;
}
