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
  ) {
    const wantFxaa = g.antiAliasing === 'fxaa';
    if (!g.postProcessing || (!g.bloom && !wantFxaa && !g.ambientOcclusion)) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: g.antiAliasing === 'msaa' ? 4 : 0,
    });
    const c = new EffectComposer(renderer, rt);
    c.addPass(new RenderPass(scene, camera));
    if (g.ambientOcclusion) {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.8;
      c.addPass(ao);
    }
    if (g.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.5, 0.88));
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
    this.composer.setSize(s.x, s.y);
    this.fxaa?.material.uniforms.resolution.value.set(1 / (s.x * pr), 1 / (s.y * pr));
  }

  render(dt: number) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
  }
}
