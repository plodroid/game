import * as THREE from 'three';
import type { MaterialId } from '@chromashift/shared';

// Procedural, original surface textures. Greyscale detail only — colour comes from each map's theme.
const cache = new Map<string, THREE.Texture>();

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable fractal noise in 0..1. */
function fbm(x: number, y: number, base: number, seed: number) {
  let v = 0, amp = 0.5, f = base;
  for (let o = 0; o < 4; o++) {
    v += valueNoise(x * f, y * f, f, seed + o) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

type Painter = (ctx: CanvasRenderingContext2D, n: number, img: ImageData) => void;

const painters: Partial<Record<MaterialId, Painter>> = {
  floor(ctx, n, img) {
    noiseFill(img, n, 6, 1, 0.86, 0.12);
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1, n / 128);
    for (let i = 0; i <= 2; i++) {
      line(ctx, (i * n) / 2, 0, (i * n) / 2, n);
      line(ctx, 0, (i * n) / 2, n, (i * n) / 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i <= 2; i++) line(ctx, (i * n) / 2 + 1.5, 0, (i * n) / 2 + 1.5, n);
  },
  wall(ctx, n, img) {
    noiseFill(img, n, 4, 2, 0.84, 0.16);
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, n * 0.48, n, Math.max(1, n / 96));
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, n, n * 0.06);
  },
  metal(ctx, n, img) {
    noiseFill(img, n, 16, 3, 0.8, 0.08, 4);
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(1, n / 160);
    ctx.strokeRect(n * 0.02, n * 0.02, n * 0.96, n * 0.96);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const r = n / 64;
    for (const [x, y] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) {
      ctx.beginPath();
      ctx.arc(x * n, y * n, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  trim(ctx, n, img) {
    noiseFill(img, n, 8, 4, 0.9, 0.06);
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo((i * n) / 4, n);
      ctx.lineTo((i * n) / 4 + n / 8, n);
      ctx.lineTo((i * n) / 4 + n / 8 + n / 2, 0);
      ctx.lineTo((i * n) / 4 + n / 2, 0);
      ctx.fill();
    }
  },
  base(ctx, n, img) {
    noiseFill(img, n, 6, 5, 0.86, 0.1);
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = Math.max(1, n / 90);
    ctx.beginPath();
    ctx.arc(n / 2, n / 2, n * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  },
  crate(ctx, n, img) {
    noiseFill(img, n, 3, 6, 0.82, 0.14, 0.25);
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 1; i < 4; i++) ctx.fillRect(0, (i * n) / 4, n, Math.max(1, n / 128));
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(2, n / 40);
    ctx.strokeRect(0, 0, n, n);
  },
  island(ctx, n, img) {
    noiseFill(img, n, 5, 7, 0.82, 0.22);
    ctx.putImageData(img, 0, 0);
  },
};

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function noiseFill(img: ImageData, n: number, scale: number, seed: number, base: number, amp: number, stretch = 1) {
  const d = img.data;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = base + (fbm(x / n, (y / n) * stretch, scale, seed) - 0.5) * amp * 2;
      const c = Math.max(0, Math.min(255, v * 255));
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = c;
      d[i + 3] = 255;
    }
}

/** Size per texture-quality level. */
export const textureSize = (q: number) => [128, 256, 512, 1024][Math.max(0, Math.min(3, q))];

export function surfaceTexture(mat: MaterialId, quality: number, anisotropy: number): THREE.Texture | null {
  const paint = painters[mat];
  if (!paint) return null;
  const n = textureSize(quality);
  const key = `${mat}:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, n, ctx.createImageData(n, n));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, tex);
  return tex;
}

/** Lit-window facade for background buildings. */
export function windowsTexture(seed: number): THREE.Texture {
  const key = `win:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#20223a';
  ctx.fillRect(0, 0, n, n);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 8; x++) {
      const r = hash(x, y, seed);
      ctx.fillStyle = r > 0.62 ? `rgba(255,${190 + Math.floor(r * 50)},140,${0.55 + r * 0.4})` : 'rgba(80,90,140,0.35)';
      ctx.fillRect(x * 16 + 4, y * 8 + 2, 8, 4);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** CHROMASHIFT wordmark for billboards and the menu. */
export function logoTexture(): THREE.Texture {
  const hit = cache.get('logo');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#14152a';
  ctx.fillRect(0, 0, 512, 256);
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, '#ff4f8b');
  g.addColorStop(1, '#2fe0c6');
  ctx.fillStyle = g;
  ctx.font = '800 64px "Bricolage Grotesque Variable", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CHROMA', 256, 104);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillText('SHIFT', 256, 168);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('logo', tex);
  return tex;
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
