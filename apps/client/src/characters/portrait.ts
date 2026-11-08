import * as THREE from 'three';
import { COSMETIC_SLOTS, type Cosmetics, type WeaponId } from '@chromashift/shared';
import { engine } from '../game/engine';
import { teamColors } from '../rendering/palette';
import { buildWeapon } from '../weapons/models';
import { buildCharacter } from './model';

const OUT = 128;
const RENDER = OUT * 2; // rendered at 2× and downscaled for smooth edges
const cache = new Map<string, string>();
let stage: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; target: THREE.WebGLRenderTarget } | null = null;

/** Head and shoulders, down to the waist ('bust') to show an outfit, or from behind ('back'). */
export type Frame = 'head' | 'hat' | 'side' | 'bust' | 'back';

export const portraitKey = (c: Cosmetics, team: 0 | 1, frame: Frame) => `${frame}:${team}:${c.skin}:${COSMETIC_SLOTS.map((s) => c[s]).join(':')}`;
export const weaponKey = (id: WeaponId, finish: string) => `weapon:${id}:${finish}`;
/** A portrait already drawn, without drawing one. */
export const peek = (key: string) => cache.get(key) ?? null;
/** Forgets drawn weapon portraits (after the owner edits a weapon). */
export const dropWeaponPortraits = () => [...cache.keys()].forEach((k) => k.startsWith('weapon:') && cache.delete(k));

function getStage() {
  if (!stage) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe6e9ff, 0x3a3048, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.9);
    key.position.set(1.4, 2.6, -2.6);
    const back = new THREE.DirectionalLight(0xffffff, 1.6);
    back.position.set(-1, 2, 3);
    scene.add(key, back);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    const target = new THREE.WebGLRenderTarget(RENDER, RENDER);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    stage = { scene, camera, target };
  }
  return stage;
}

/** Renders `obj` from the stage camera into a cached data URL. */
function snap(key: string, obj: THREE.Object3D): string | null {
  const r = engine.renderer;
  if (!r) return null;
  const st = getStage();
  st.scene.add(obj);
  const prev = r.getRenderTarget();
  const prevColor = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  const px = new Uint8Array(RENDER * RENDER * 4);
  try {
    r.setRenderTarget(st.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(st.scene, st.camera);
    r.readRenderTargetPixels(st.target, 0, 0, RENDER, RENDER, px);
  } finally {
    r.setRenderTarget(prev);
    r.setClearColor(prevColor, prevAlpha);
    st.scene.remove(obj);
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

/**
 * Portrait of the actual character model, rendered offscreen on the game's own WebGL context and
 * cached as a data URL. Used for avatars, lobby previews and every item in the locker.
 */
export function portrait(c: Cosmetics, team: 0 | 1, frame: Frame = 'head'): string | null {
  const key = portraitKey(c, team, frame);
  const hit = cache.get(key);
  if (hit || !engine.renderer) return hit ?? null;
  const st = getStage();
  const rig = buildCharacter({ cosmetics: c, team: teamColors()[team], weapon: 'pulse', detail: 2, lambert: false });
  rig.weapon.group.visible = false;
  rig.root.rotation.y = frame === 'back' ? Math.PI + 0.5 : frame === 'side' ? -0.95 : -0.22;
  rig.head.rotation.set(0.04, 0.12, 0);
  if (frame === 'bust') {
    st.camera.position.set(0.35, 1.42, -2.25);
    st.camera.lookAt(0, 1.3, 0);
  } else if (frame === 'hat') {
    // Room above the head for halos, bulbs and tall hats.
    st.camera.position.set(0.25, 1.86, -1.95);
    st.camera.lookAt(0, 1.76, 0);
  } else if (frame === 'back') {
    st.camera.position.set(0.3, 1.5, -2.7);
    st.camera.lookAt(0, 1.3, 0);
  } else {
    // Tall headgear needs a little more room above the head.
    st.camera.position.set(0.2, 1.72, -1.45);
    st.camera.lookAt(0, 1.64, 0);
  }
  try {
    return snap(key, rig.root);
  } finally {
    rig.dispose();
  }
}

/** A weapon on its own, side on, in a finish. */
export function weaponPortrait(id: WeaponId, finish: string): string | null {
  const key = weaponKey(id, finish);
  const hit = cache.get(key);
  if (hit || !engine.renderer) return hit ?? null;
  const st = getStage();
  const team = new THREE.MeshStandardMaterial({ color: teamColors()[0], emissive: teamColors()[0], emissiveIntensity: 0.35, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23252f, roughness: 0.8 });
  const light = new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.5 });
  const w = buildWeapon(id, team, dark, light, 2, false, finish);
  const holder = new THREE.Group();
  holder.add(w.group);
  w.group.rotation.set(0, 0, 0);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  w.group.position.sub(mid);
  holder.rotation.y = Math.PI / 2 - 0.35;
  const dist = Math.max(size.x, size.y, size.z) * 2.5 + 0.2;
  st.camera.position.set(0, 0.18, -dist);
  st.camera.lookAt(0, 0, 0);
  try {
    return snap(key, holder);
  } finally {
    w.dispose();
    team.dispose();
    dark.dispose();
    light.dispose();
  }
}
