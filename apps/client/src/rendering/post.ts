import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { GraphicsSettings } from '../settings/settings';

/**
 * The summer grade, in linear light before tone mapping: a warm white balance, a little more
 * colour, a soft vignette and, on the top presets, heat shimmer just above the horizon.
 */
const SummerShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uHorizon: { value: 0.5 },
    uWarm: { value: new THREE.Vector3(1.045, 1.0, 0.94) },
    uSat: { value: 1.1 },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uHorizon;
uniform vec3 uWarm;
uniform float uSat;
uniform float uVignette;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  #ifdef HEAT
  // Hot air over the distant sea and sand bends the light into a faint shimmer.
  float d = uv.y - uHorizon;
  float band = exp(-d * d * 260.0) * smoothstep(-0.02, 0.01, d + 0.02);
  vec2 w = vec2(sin(uv.y * 170.0 + uTime * 3.4) * 0.6 + sin(uv.y * 101.0 - uTime * 2.2 + uv.x * 27.0) * 0.4, cos(uv.x * 150.0 + uTime * 2.8) * 0.5);
  uv += w * band * 0.0012;
  #endif
  vec4 c = texture2D(tDiffuse, uv);
  vec3 col = c.rgb * uWarm;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSat), 0.0);
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * uVignette;
  gl_FragColor = vec4(col, c.a);
}`,
};

const euler = new THREE.Euler();

/** Optional post-processing chain. Disabled entirely on VERY LOW / LOW (direct rendering). */
export class Post {
  private composer: EffectComposer | null = null;
  private fxaa: ShaderPass | null = null;
  private summer: ShaderPass | null = null;
  private time = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    g: GraphicsSettings,
    /** Share of the screen width this view covers (0.5 for one side of split screen). */
    private share = 1,
  ) {
    const wantFxaa = g.antiAliasing === 'fxaa';
    if (!g.postProcessing) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(size.x * share)), size.y, {
      type: THREE.HalfFloatType,
      samples: g.antiAliasing === 'msaa' ? 4 : 0,
    });
    const c = new EffectComposer(renderer, rt);
    c.addPass(new RenderPass(scene, camera));
    if (g.ambientOcclusion) {
      const ao = new GTAOPass(scene, camera, Math.round(size.x * share), size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.8;
      c.addPass(ao);
    }
    this.summer = new ShaderPass(SummerShader);
    if (g.bloom) this.summer.material.defines.HEAT = '';
    c.addPass(this.summer);
    // Only real highlights bloom: the sun, its glitter on the sea, glossy paint and glowing lights.
    if (g.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2((size.x * share) / 2, size.y / 2), 0.45, 0.45, 2.4));
    c.addPass(new OutputPass());
    if (wantFxaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      c.addPass(this.fxaa);
    }
    this.composer = c;
    this.setSize();
  }

  get active() {
    return !!this.composer;
  }

  setSize() {
    if (!this.composer) return;
    const s = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    const w = Math.max(1, Math.round(s.x * this.share));
    this.composer.setSize(w, s.y);
    this.fxaa?.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (s.y * pr));
  }

  /** Compiles the scene's shaders for where they'll really be drawn (the composer's buffer, or the screen). */
  warm() {
    const r = this.renderer,
      prev = r.getRenderTarget();
    r.setRenderTarget(this.composer ? this.composer.readBuffer : null);
    r.compile(this.scene, this.camera);
    r.setRenderTarget(prev);
  }

  render(dt: number) {
    if (this.summer) {
      // Where the horizon crosses the screen, for the heat shimmer.
      this.time += dt;
      const cam = this.camera as THREE.PerspectiveCamera;
      euler.setFromQuaternion(cam.quaternion, 'YXZ');
      const ndc = -Math.tan(euler.x) / Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 70) / 2));
      this.summer.uniforms.uHorizon.value = 0.5 + ndc * 0.5;
      this.summer.uniforms.uTime.value = this.time;
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
  }
}
