import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { GraphicsSettings } from '../settings/settings';

/** Optional post-processing chain. Disabled entirely on VERY LOW / LOW (direct rendering). */
export class Post {
  private composer: EffectComposer | null = null;
  private fxaa: ShaderPass | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    g: GraphicsSettings,
    /** Share of the screen width this view covers (0.5 for one side of split screen). */
    private share = 1,
  ) {
    const wantFxaa = g.antiAliasing === 'fxaa';
    if (!g.postProcessing || (!g.bloom && !wantFxaa && !g.ambientOcclusion)) return;
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
    if (g.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2((size.x * share) / 2, size.y / 2), 0.32, 0.5, 0.88));
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
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
  }
}
