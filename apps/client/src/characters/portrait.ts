import * as THREE from 'three';
import type { Cosmetics } from '@chromashift/shared';
import { engine } from '../game/engine';
import { teamColors } from '../rendering/palette';
import { buildCharacter } from './model';

const OUT = 128;
const RENDER = OUT * 2; // rendered at 2× and downscaled for smooth edges
const cache = new Map<string, string>();
let stage: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; target: THREE.WebGLRenderTarget } | null = null;

/**
 * Head-and-shoulders portrait of the actual character model, rendered offscreen on the
 * game's own WebGL context and cached as a data URL. Used for avatars and lobby previews.
 */
/** Head and shoulders, or down to the waist ('bust') to show an outfit. */
export function portrait(c: Cosmetics, team: 0 | 1, frame: 'head' | 'bust' = 'head'): string | null {
  const r = engine.renderer;
  if (!r) return null;
  const key = `${frame}:${team}:${c.hair}:${c.headgear}:${c.outfit}:${c.accent}:${c.skin}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (!stage) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe6e9ff, 0x3a3048, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.9);
    key.position.set(1.4, 2.6, -2.6);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    camera.position.set(0.2, 1.68, -1.3);
    camera.lookAt(0, 1.6, 0);
    const target = new THREE.WebGLRenderTarget(RENDER, RENDER);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    stage = { scene, camera, target };
  }

  const rig = buildCharacter({ cosmetics: c, team: teamColors()[team], weapon: 'pulse', detail: 2, lambert: false });
  rig.weapon.group.visible = false;
  rig.root.rotation.y = -0.22;
  rig.head.rotation.set(0.04, 0.12, 0);
  stage.scene.add(rig.root);

  if (frame === 'bust') {
    stage.camera.position.set(0.35, 1.42, -2.25);
    stage.camera.lookAt(0, 1.3, 0);
  } else {
    stage.camera.position.set(0.2, 1.68, -1.3);
    stage.camera.lookAt(0, 1.6, 0);
  }
  const prev = r.getRenderTarget();
  const prevColor = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  const px = new Uint8Array(RENDER * RENDER * 4);
  try {
    r.setRenderTarget(stage.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(stage.scene, stage.camera);
    r.readRenderTargetPixels(stage.target, 0, 0, RENDER, RENDER, px);
  } finally {
    r.setRenderTarget(prev);
    r.setClearColor(prevColor, prevAlpha);
    stage.scene.remove(rig.root);
    rig.dispose();
  }

  // WebGL rows are bottom-up; flip into a canvas, then downscale.
  const big = document.createElement('canvas');
  big.width = big.height = RENDER;
  const bctx = big.getContext('2d')!;
  const img = bctx.createImageData(RENDER, RENDER);
  const row = RENDER * 4;
  for (let y = 0; y < RENDER; y++) img.data.set(px.subarray((RENDER - 1 - y) * row, (RENDER - y) * row), y * row);
  bctx.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(big, 0, 0, OUT, OUT);
  const url = out.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
