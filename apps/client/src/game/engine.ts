import * as THREE from 'three';
import { audio } from '../audio/audio';
import { syncPaletteCss } from '../rendering/palette';
import { PRESETS, useSettings, type GraphicsSettings, type Preset } from '../settings/settings';
import { useHud, useUi } from '../state/ui';
import { InputManager } from './input';
import { registerPrimary, useSplit } from './split';

export interface View {
  readonly kind: 'menu' | 'match';
  update(dt: number): void;
  render(dt: number): void;
  resize(): void;
  /** Live-applicable graphics changes (resolution, post, shadows, fog…). */
  applyGraphics(g: GraphicsSettings): void;
  /** Re-upload GPU-only state after a lost WebGL context. */
  restore(): void;
  dispose(): void;
}

const ORDER: Exclude<Preset, 'custom'>[] = ['veryLow', 'low', 'medium', 'high', 'ultra'];

/** Owns the WebGL renderer and the frame loop. React never drives rendering. */
class Engine {
  renderer!: THREE.WebGLRenderer;
  readonly input = new InputManager();
  view: View | null = null;
  fps = 0;
  /** AA mode baked into the current context; MSAA without post needs a reload to change. */
  contextAA = false;
  private stage!: HTMLElement;
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private frames = 0;
  private fpsT = 0;
  private slowWindows = 0;
  private hinted = false;
  private lost = false;
  private reported = false;
  /** Automatic resolution scale (1 = full): lowered while the frame rate is short, raised back when it recovers. */
  private dyn = 1;
  private calm = 0;
  private slow = 0;
  private since = 0;
  /** The highest scale worth trying again (a level that failed soon after being raised is not retried). */
  private ceiling = 1;

  init(stage: HTMLElement) {
    this.stage = stage;
    const g = useSettings.getState().graphics;
    this.contextAA = g.antiAliasing === 'msaa' && !g.postProcessing;
    const r = new THREE.WebGLRenderer({
      antialias: this.contextAA,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.className = 'stage-canvas';
    stage.appendChild(r.domElement);
    this.renderer = r;
    this.applyPixelRatio(g);
    this.input.attach(r.domElement);
    registerPrimary(this.input);
    addEventListener('resize', this.onResize);
    r.domElement.addEventListener('webglcontextlost', this.onLost, false);
    r.domElement.addEventListener('webglcontextrestored', this.onRestored, false);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.view?.kind === 'match' && !useUi.getState().paused) useUi.getState().setPaused(true);
    });
    let prevG = g;
    useSettings.subscribe((s) => {
      if (s.graphics !== prevG) {
        prevG = s.graphics;
        this.applyPixelRatio(s.graphics);
        this.view?.applyGraphics(s.graphics);
      }
      syncPaletteCss();
    });
    syncPaletteCss();
    this.raf = requestAnimationFrame(this.frame);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    useUi.getState().toast({ text: 'Graphics context lost — recovering…', kind: 'warn', ttl: 0 });
  };
  private onRestored = () => {
    this.lost = false;
    for (const t of useUi.getState().toasts) if (t.text.startsWith('Graphics context lost')) useUi.getState().dismiss(t.id);
    this.view?.restore();
    useUi.getState().toast({ text: 'Graphics restored.', kind: 'success' });
  };

  private onResize = () => {
    this.applyPixelRatio(useSettings.getState().graphics);
    this.view?.resize();
  };

  applyPixelRatio(g: GraphicsSettings) {
    const r = this.renderer;
    if (!r) return;
    let pr = Math.min(devicePixelRatio || 1, 2) * g.renderScale;
    if (g.maxHeight > 0 && innerHeight * pr > g.maxHeight) pr = g.maxHeight / innerHeight;
    r.setPixelRatio(Math.max(0.35, pr * this.dyn));
    r.setSize(innerWidth, innerHeight, false);
    r.shadowMap.enabled = g.shadowQuality > 0;
  }

  get aspect() {
    return innerWidth / Math.max(1, innerHeight);
  }

  setView(v: View | null) {
    // A view that fails to clean up must not stop the next one from showing (that is a frozen black screen).
    try {
      this.view?.dispose();
    } catch (err) {
      console.error(err);
    }
    this.view = v;
    this.slowWindows = 0;
  }

  private frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (this.lost || !this.view) return;
    const cap = useSettings.getState().graphics.fpsCap;
    if (cap > 0) {
      const interval = 1000 / cap;
      if (t - this.lastDraw < interval - 1.5) return;
      this.lastDraw = t;
    }
    const dt = Math.min(0.1, Math.max(0, (t - (this.last || t)) / 1000));
    this.last = t;
    // A bug in one update must not freeze the picture: log it once and keep drawing.
    try {
      this.view.update(dt);
    } catch (e) {
      if (!this.reported) {
        this.reported = true;
        console.error(e);
      }
    }
    try {
      this.view.render(dt);
    } catch (e) {
      if (!this.reported) {
        this.reported = true;
        console.error(e);
      }
    }
    this.frames++;
    if (!this.fpsT) this.fpsT = t;
    if (t - this.fpsT >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (t - this.fpsT));
      this.frames = 0;
      this.fpsT = t;
      useHud.setState({ fps: this.fps });
      this.adaptiveCheck(cap);
      this.dynamicResolution(cap);
    }
  };

  /**
   * Keeps the frame rate up on weak machines without touching the chosen preset: the desktop app
   * (and split screen, which draws twice the view) quietly lowers the render resolution while it
   * runs short of its target, and raises it again once there is room. Shadows, effects and
   * textures stay as the player set them, so a low-end PC can still run Ultra.
   */
  private dynamicResolution(cap: number) {
    const desktop = !!(window as unknown as { __CHROMASHIFT_DESKTOP__?: boolean }).__CHROMASHIFT_DESKTOP__;
    const inMatch = (desktop || useSplit.getState().seated) && this.view?.kind === 'match';
    // Pausing or covering the window changes nothing; only leaving the match restores full resolution.
    if (!inMatch || useUi.getState().paused || document.hidden) {
      if (!inMatch && this.dyn !== 1) {
        this.dyn = 1;
        this.ceiling = 1;
        this.onResize();
      }
      return;
    }
    // Every change resizes the canvas, which can flicker and costs a hitch, so changes are rare:
    // down a step after the frame rate has stayed short for a few seconds, and back up only after a
    // long calm stretch (and never again for a level that just failed).
    const target = Math.min(cap || 60, 60);
    let next = this.dyn;
    this.since++;
    if (this.fps < target * 0.8) {
      this.slow++;
      this.calm = 0;
    } else {
      this.slow = 0;
      this.calm = this.fps >= target * 0.97 ? this.calm + 1 : 0;
    }
    if (this.slow >= 4 && this.dyn > 0.6) {
      this.ceiling = Math.min(this.ceiling, this.since < 15 ? this.dyn : 1);
      next = Math.max(0.6, +(this.dyn - 0.1).toFixed(2));
    } else if (this.calm >= 25 && this.dyn < this.ceiling) next = Math.min(this.ceiling, +(this.dyn + 0.1).toFixed(2));
    if (next !== this.dyn) {
      this.dyn = next;
      this.slow = this.calm = this.since = 0;
      this.onResize();
    }
  }

  /** Suggests (never forces) a lower preset after sustained low frame rates in a match. */
  private adaptiveCheck(cap: number) {
    const s = useSettings.getState();
    if (this.hinted || !s.graphics.adaptiveHints || this.view?.kind !== 'match' || useUi.getState().paused) return;
    const target = Math.min(cap || 60, 60);
    this.slowWindows = this.fps < target * 0.75 ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 8) return;
    const cur = s.graphics.preset === 'custom' ? 'medium' : s.graphics.preset;
    const lower = ORDER[ORDER.indexOf(cur) - 1];
    if (!lower) return;
    this.hinted = true;
    useUi.getState().toast({
      text: `Running at ${this.fps} FPS. Switch graphics to ${PRESET_LABEL[lower]}?`,
      kind: 'warn',
      ttl: 12000,
      action: { label: 'Switch', run: () => useSettings.getState().applyPreset(lower) },
    });
  }

  unlockAudio() {
    audio.unlock();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}

export const PRESET_LABEL: Record<Preset, string> = {
  veryLow: 'Very Low',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
  custom: 'Custom',
};

export { PRESETS };
export const engine = new Engine();
