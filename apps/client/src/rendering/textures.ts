import * as THREE from 'three';
import type { MaterialId } from '@chromashift/shared';

// Procedural, original surface textures. Greyscale detail only: colour comes from each map's theme.
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

/*
 * Each arena material is drawn as a height field over one 2 m tile (u, v in 0 … 1): paving with
 * bevelled joints, cast concrete panels with tie holes, riveted plate, planked crates … From the
 * height come three maps: tone (what the colour is multiplied by), normal (how it catches light)
 * and roughness (worn high spots are smoother). `flat` is the height of the untouched surface, so
 * the average brightness stays where the colours of each theme were chosen.
 */
interface Relief {
  height(u: number, v: number): number;
  flat: number;
  /** Strength of the bumps, of the darkening in the low parts, and of the roughness change. */
  bump: number;
  tone: number;
  rough: number;
}

const tri = (t: number) => 1 - Math.abs((((t % 1) + 1) % 1) * 2 - 1);
/** 0 in a joint of half-width `w`, rising smoothly to 1 on the flat. */
const joint = (d: number, w: number) => {
  const t = Math.min(1, Math.max(0, d / w));
  return t * t * (3 - 2 * t);
};
/** Distance (0 … 0.5) from the nearest line of a grid with `n` cells across. */
const toLine = (t: number, n: number) => {
  const f = (((t * n) % 1) + 1) % 1;
  return Math.min(f, 1 - f) / n;
};

const RELIEF: Partial<Record<MaterialId, Relief>> = {
  // Paving: four slabs to the tile, slightly uneven, with chamfered joints and a fine speckle.
  floor: {
    flat: 0.78, bump: 1.1, tone: 0.34, rough: 0.3,
    height(u, v) {
      const j = Math.min(joint(toLine(u, 2), 0.012), joint(toLine(v, 2), 0.012));
      const slab = hash(Math.floor(u * 2), Math.floor(v * 2), 3) * 0.06;
      return j * (0.72 + slab) + (fbm(u, v, 24, 1) - 0.5) * 0.1 + (fbm(u, v, 5, 2) - 0.5) * 0.08;
    },
  },
  // Cast concrete: panels a metre high, staggered seams, tie holes, soft blotches.
  wall: {
    flat: 0.76, bump: 1, tone: 0.36, rough: 0.28,
    height(u, v) {
      const row = Math.floor(v * 2), fu = u + (row % 2) * 0.25;
      const seam = Math.min(joint(toLine(v, 2), 0.008), joint(toLine(fu, 2), 0.008));
      const hx = toLine(fu + 0.125, 4), hy = toLine(v + 0.125, 4);
      const hole = Math.hypot(hx, hy) < 0.012 ? -0.45 : 0;
      return seam * 0.76 + hole + (fbm(u, v, 6, 5) - 0.5) * 0.14 + (fbm(u, v, 40, 6) - 0.5) * 0.07;
    },
  },
  // Steel plate: a rolled-in border, rivets, and brushing along the plate.
  metal: {
    flat: 0.74, bump: 0.9, tone: 0.3, rough: 0.4,
    height(u, v) {
      const edge = Math.min(joint(toLine(u, 1), 0.016), joint(toLine(v, 1), 0.016));
      let rivet = 0;
      for (const [x, y] of [[0.07, 0.07], [0.5, 0.07], [0.93, 0.07], [0.07, 0.5], [0.93, 0.5], [0.07, 0.93], [0.5, 0.93], [0.93, 0.93]]) {
        const d = Math.hypot(u - x, v - y);
        if (d < 0.022) rivet = Math.max(rivet, Math.cos((d / 0.022) * Math.PI * 0.5) * 0.3);
      }
      const brush = (valueNoise(u * 3, v * 90, 90, 9) - 0.5) * 0.07;
      return edge * 0.74 + rivet + brush + (fbm(u, v, 4, 10) - 0.5) * 0.06;
    },
  },
  // Trim: pressed diagonal chevrons, as on a kick plate.
  trim: {
    flat: 0.8, bump: 0.8, tone: 0.24, rough: 0.3,
    height(u, v) {
      const band = tri((u + v) * 4);
      return 0.68 + (band > 0.5 ? 0.14 : 0) * joint(Math.abs(band - 0.5), 0.06) + (fbm(u, v, 28, 12) - 0.5) * 0.06;
    },
  },
  // Base pad: anti-slip plate, a fine grid of low round studs.
  base: {
    flat: 0.7, bump: 0.7, tone: 0.2, rough: 0.3,
    height(u, v) {
      const fu = ((u * 10) % 1) - 0.5, fv = ((v * 10) % 1) - 0.5, d = Math.hypot(fu, fv);
      const stud = d < 0.3 ? Math.cos((d / 0.3) * Math.PI * 0.5) * 0.16 : 0;
      return 0.7 + stud + (fbm(u, v, 20, 14) - 0.5) * 0.06;
    },
  },
  // Crate: planks with grain, a raised frame and a cross brace.
  crate: {
    flat: 0.62, bump: 1.4, tone: 0.42, rough: 0.3,
    height(u, v) {
      const plank = joint(toLine(v, 5), 0.01);
      const grain = (valueNoise(u * 60, v * 5 + Math.floor(v * 5) * 7.3, 60, 16) - 0.5) * 0.12 + (fbm(u, v, 3, 17) - 0.5) * 0.1;
      const frame = Math.min(u, 1 - u, v, 1 - v) < 0.07 ? 0.3 : 0;
      const brace = Math.abs(u - v) < 0.05 ? 0.26 : 0;
      return plank * 0.55 + grain + Math.max(frame, brace);
    },
  },
  // Grass: tufts in clumps.
  island: {
    flat: 0.62, bump: 1.2, tone: 0.5, rough: 0.2,
    height(u, v) {
      const clump = fbm(u, v, 5, 20);
      const blade = valueNoise(u * 70, v * 22, 70, 21) * valueNoise(u * 31, v * 64, 64, 22);
      return 0.3 + clump * 0.45 + blade * 0.5;
    },
  },
};

/** Size per texture-quality level. */
export const textureSize = (q: number) => [128, 256, 512, 1024][Math.max(0, Math.min(3, q))];

export interface SurfaceSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}
const sets = new Map<string, SurfaceSet>();

/** Tone, normal and roughness maps of an arena material; null for glass and invisible walls. */
export function surfaceSet(mat: MaterialId, quality: number, anisotropy: number): SurfaceSet | null {
  const rel = RELIEF[mat];
  if (!rel) return null;
  // Past 512 the relief gains nothing and the maps cost four times the memory.
  const n = Math.min(512, textureSize(quality));
  const key = `${mat}:${n}`;
  const hit = sets.get(key);
  if (hit) return hit;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = rel.height(x / n, y / n);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d')!;
    return { c, ctx, img: ctx.createImageData(n, n) };
  };
  const tone = make(), nrm = make(), rgh = make();
  const k = rel.bump * (n / 128) * 1.6;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4, v = h[y * n + x];
      const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      nrm.img.data[i] = Math.round((-dx / l) * 127.5 + 127.5);
      nrm.img.data[i + 1] = Math.round((dy / l) * 127.5 + 127.5);
      nrm.img.data[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
      nrm.img.data[i + 3] = 255;
      const t = Math.max(0, Math.min(255, Math.round(255 * (0.86 + (v - rel.flat) * rel.tone * 2))));
      tone.img.data[i] = tone.img.data[i + 1] = tone.img.data[i + 2] = t;
      tone.img.data[i + 3] = 255;
      const r = Math.max(0, Math.min(255, Math.round(255 * (1 - Math.max(0, v - rel.flat + 0.1) * rel.rough))));
      rgh.img.data[i] = rgh.img.data[i + 1] = rgh.img.data[i + 2] = r;
      rgh.img.data[i + 3] = 255;
    }
  const tex = (m: ReturnType<typeof make>, srgb: boolean) => {
    m.ctx.putImageData(m.img, 0, 0);
    const t = new THREE.CanvasTexture(m.c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const set: SurfaceSet = { map: tex(tone, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false) };
  sets.set(key, set);
  return set;
}

export const surfaceTexture = (mat: MaterialId, quality: number, anisotropy: number): THREE.Texture | null => surfaceSet(mat, quality, anisotropy)?.map ?? null;

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
  // The game's poster, in the menus' language: card stock, two paint chips, condensed ink.
  ctx.fillStyle = '#efefec';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#ff2e88';
  ctx.fillRect(0, 0, 44, 256);
  ctx.fillStyle = '#13cbb5';
  ctx.fillRect(44, 0, 44, 256);
  ctx.fillStyle = '#111112';
  ctx.font = 'condensed 900 104px "Archivo Variable", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('CHROMA', 112, 124);
  ctx.fillText('SHIFT', 112, 222);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('logo', tex);
  return tex;
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
  for (const x of sets.values()) {
    x.map.dispose();
    x.normalMap.dispose();
    x.roughnessMap.dispose();
  }
  sets.clear();
}

/**
 * Daytime facade for background towers, one 8 m tile: floor bands and mullions in pale concrete,
 * glass that picks up the sky in different amounts, blinds drawn here and there, a sill shadow
 * under every window.
 */
export function facadeTexture(seed: number): THREE.Texture {
  const key = `facade:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = 256, cols = 8, rows = 16, cw = n / cols, rh = n / rows;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const warm = hash(seed, 1, 3) > 0.5;
  ctx.fillStyle = warm ? '#efe6d6' : '#e3e8ec';
  ctx.fillRect(0, 0, n, n);
  // A darker spandrel band under each floor.
  ctx.fillStyle = warm ? '#d9cdb8' : '#cbd3da';
  for (let y = 0; y < rows; y++) ctx.fillRect(0, y * rh + rh - 3, n, 3);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const r = hash(x, y, seed), r2 = hash(x, y, seed + 9);
      const wx = x * cw + 4, wy = y * rh + 2, ww = cw - 8, wh = rh - 6;
      const l = 34 + Math.floor(r * 24);
      const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, `hsl(${warm ? 196 : 206}, 42%, ${l + 12}%)`);
      g.addColorStop(1, `hsl(${warm ? 200 : 210}, 40%, ${l - 4}%)`);
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);
      // Blinds part-way down on some, fully down on a few.
      if (r2 > 0.72) {
        ctx.fillStyle = warm ? '#e4dccb' : '#d6dce1';
        ctx.fillRect(wx, wy, ww, wh * (r2 > 0.93 ? 1 : 0.25 + (r2 - 0.72) * 2));
      }
      // Centre mullion, top highlight, sill shadow.
      ctx.fillStyle = warm ? '#f4eee2' : '#eef2f5';
      ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(wx, wy, ww, 1);
      ctx.fillStyle = 'rgba(40,50,70,0.3)';
      ctx.fillRect(wx, wy + wh, ww, 1.5);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** A soft cumulus puff for cloud sprites: sunlit on top, shaded underneath. */
export function puffTexture(): THREE.Texture {
  const hit = cache.get('puff');
  if (hit) return hit;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = x / n - 0.5, dy = y / n - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const edge = fbm(x / n, y / n, 4, 11) * 0.5;
      const a = Math.max(0, Math.min(1, (1 - d - edge * 0.55 + 0.18) * 2.2));
      const shade = 0.72 + (0.5 - y / n) * 0.5;
      const i = (y * n + x) * 4;
      img.data[i] = Math.round(255 * Math.min(1, shade + 0.06));
      img.data[i + 1] = Math.round(255 * Math.min(1, shade + 0.08));
      img.data[i + 2] = Math.round(255 * Math.min(1, shade + 0.14));
      img.data[i + 3] = Math.round(255 * a);
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('puff', tex);
  return tex;
}
