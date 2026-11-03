import * as THREE from 'three';
import type { Preset } from './settings';

export interface HardwareReport {
  webgl2: boolean;
  renderer: string;
  vendor: string;
  maxTexture: number;
  memoryGb: number | null;
  cores: number;
  mobile: boolean;
  software: boolean;
  benchmarkMs: number | null;
  recommended: Exclude<Preset, 'custom'>;
  reason: string;
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Capability probe. GPU names are hints only — the benchmark has the final say. */
export function probeHardware(gl?: WebGL2RenderingContext): Omit<HardwareReport, 'benchmarkMs' | 'recommended' | 'reason'> {
  let ctx = gl ?? null;
  if (!ctx) {
    try {
      ctx = document.createElement('canvas').getContext('webgl2');
    } catch {
      ctx = null;
    }
  }
  let renderer = 'Unknown', vendor = 'Unknown', maxTexture = 0;
  if (ctx) {
    maxTexture = ctx.getParameter(ctx.MAX_TEXTURE_SIZE) as number;
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    renderer = String(dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
    vendor = String(dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR));
  }
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return {
    webgl2: !!ctx,
    renderer,
    vendor,
    maxTexture,
    memoryGb: nav.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency || 4,
    mobile,
    software: /SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer),
  };
}

/**
 * Renders `scene` offscreen at 1280×720 and forces GPU completion with a 1-pixel readback,
 * so the timing isn't capped by vsync.
 */
export function benchmark(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, frames = 24): number {
  const rt = new THREE.WebGLRenderTarget(1280, 720);
  const px = new Uint8Array(4);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera); // warm-up: shader compilation
  renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) renderer.render(scene, camera);
  renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
  const ms = (performance.now() - t0) / frames;
  renderer.setRenderTarget(prev);
  rt.dispose();
  return ms;
}

const WEAK = /GT 7[0-4]0|GT 6\d0|GT 5\d0|HD Graphics [2-5]\d{2,3}|HD Graphics$|Mali-[4T]|Adreno \(TM\) [3-5]\d{2}|PowerVR|GeForce 9|Radeon HD [5-7]/i;
const STRONG = /RTX|RX [67]\d{3}|RX 9\d{3}|Radeon Pro|Apple M[2-9]|Arc A7/i;

export function recommend(h: Omit<HardwareReport, 'recommended' | 'reason'>): Pick<HardwareReport, 'recommended' | 'reason'> {
  if (h.software) return { recommended: 'veryLow', reason: 'Software rendering detected (no GPU acceleration).' };
  const ms = h.benchmarkMs;
  let rec: Exclude<Preset, 'custom'>;
  if (ms == null) rec = h.mobile ? 'low' : WEAK.test(h.renderer) ? 'veryLow' : 'medium';
  else if (ms > 14) rec = 'veryLow';
  else if (ms > 7.5) rec = 'low';
  else if (ms > 3.5) rec = 'medium';
  else if (ms > 1.6 || h.mobile) rec = 'high';
  else rec = STRONG.test(h.renderer) ? 'ultra' : 'high';
  if ((h.memoryGb != null && h.memoryGb <= 2) || h.maxTexture < 4096) rec = rec === 'veryLow' ? 'veryLow' : 'low';
  if (WEAK.test(h.renderer) && (rec === 'high' || rec === 'ultra')) rec = 'medium';
  const reason = ms != null ? `Benchmark: ${ms.toFixed(1)} ms per test frame on ${h.renderer}.` : `Based on ${h.renderer}.`;
  return { recommended: rec, reason };
}
