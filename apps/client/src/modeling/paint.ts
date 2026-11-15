import * as THREE from 'three';
import { ASSET_LIMITS, type FaceUV, type PaintData } from '@chromashift/shared';

/*
 * Painted textures. A mesh that has been painted carries a stack of colour layers (base, detail,
 * decals, weathering …) plus three optional channels painted in greys: roughness, metal and glow.
 * Layers are canvases; what the model wears is their composite. Saved as PNG data, reopened as
 * the same layers.
 */

export type PaintChannel = 'color' | 'rough' | 'metal' | 'glow';

export interface PaintLayer {
  name: string;
  hidden: boolean;
  opacity: number;
  canvas: HTMLCanvasElement;
}

export interface Brush {
  /** Radius in texture pixels. */
  radius: number;
  /** 0 soft … 1 hard edge. */
  hardness: number;
  /** How much paint one dab lays down, 0 … 1. */
  opacity: number;
  color: string;
  erase?: boolean;
}

const canvas = (n: number) => {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
};

export class PaintSurface {
  layers: PaintLayer[] = [];
  /** Grey channels, made when first painted. */
  channels: Partial<Record<Exclude<PaintChannel, 'color'>, HTMLCanvasElement>> = {};
  readonly composite: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  /** Roughness in green, metal in blue, as three.js reads them. */
  private orm: HTMLCanvasElement | null = null;
  ormTexture: THREE.CanvasTexture | null = null;
  glowTexture: THREE.CanvasTexture | null = null;
  /** What shows where nothing is painted: drawn under the layers (the faces' own material colours). */
  private under: HTMLCanvasElement;
  private underOrm: HTMLCanvasElement;

  constructor(readonly size = 256) {
    this.composite = canvas(size);
    this.under = canvas(size);
    this.underOrm = canvas(size);
    this.texture = new THREE.CanvasTexture(this.composite);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    const u = this.under.getContext('2d')!;
    u.fillStyle = '#ffffff';
    u.fillRect(0, 0, size, size);
  }

  /**
   * Fills each face's patch of the underlay with its material's colour, roughness and metalness,
   * so unpainted areas look exactly as they did before painting began.
   */
  setUnderlay(faces: FaceUV[], look: (face: number) => { color: number; rough: number; metal: number }) {
    const u = this.under.getContext('2d')!, o = this.underOrm.getContext('2d')!;
    const n = this.size;
    u.fillStyle = '#808080';
    u.fillRect(0, 0, n, n);
    faces.forEach((f, i) => {
      const l = look(i);
      const path = (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        f.uv.forEach(([x, y], k) => (k ? ctx.lineTo(x * n, y * n) : ctx.moveTo(x * n, y * n)));
        ctx.closePath();
      };
      for (const [ctx, style] of [[u, `#${l.color.toString(16).padStart(6, '0')}`], [o, `rgb(0,${Math.round(l.rough * 255)},${Math.round(l.metal * 255)})`]] as const) {
        ctx.fillStyle = ctx.strokeStyle = style;
        ctx.lineWidth = 3;
        path(ctx);
        ctx.fill();
        // Bleed past the edge a little so the seams don't show the background.
        ctx.stroke();
      }
    });
    this.refresh();
  }

  addLayer(name: string, at = this.layers.length): PaintLayer {
    const l: PaintLayer = { name, hidden: false, opacity: 1, canvas: canvas(this.size) };
    this.layers.splice(at, 0, l);
    return l;
  }

  channel(c: Exclude<PaintChannel, 'color'>) {
    let cv = this.channels[c];
    if (!cv) {
      cv = this.channels[c] = canvas(this.size);
      // Unpainted = transparent, so the underlay's own values show through.
    }
    return cv;
  }

  /** The canvas a brush should draw on. */
  target(channel: PaintChannel, layer: number) {
    return channel === 'color' ? (this.layers[layer] ?? this.layers[0] ?? this.addLayer('Base')).canvas : this.channel(channel);
  }

  /**
   * One dab of the brush at a texture position, kept inside `clip` (a face outline in pixels) so
   * paint never spills onto a neighbouring face's patch.
   */
  dab(target: HTMLCanvasElement, x: number, y: number, b: Brush, clip?: [number, number][]) {
    const ctx = target.getContext('2d')!;
    ctx.save();
    if (clip) {
      ctx.beginPath();
      clip.forEach(([cx, cy], k) => (k ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
      ctx.closePath();
      ctx.clip();
    }
    const r = Math.max(0.5, b.radius);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = b.erase ? '#000000' : b.color;
    const rgba = (a: number) => {
      const v = parseInt(col.slice(1), 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    };
    g.addColorStop(0, rgba(b.opacity));
    g.addColorStop(Math.min(0.999, Math.max(0, b.hardness)), rgba(b.opacity));
    g.addColorStop(1, rgba(0));
    ctx.globalCompositeOperation = b.erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  /** Fills a face patch (or everything when no outline is given). */
  fill(target: HTMLCanvasElement, color: string, clip?: [number, number][], erase = false) {
    const ctx = target.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = ctx.strokeStyle = color;
    if (clip) {
      ctx.beginPath();
      clip.forEach(([cx, cy], k) => (k ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
    } else ctx.fillRect(0, 0, this.size, this.size);
    ctx.restore();
  }

  /** Draws a decal (any canvas source) centred at a texture position, turned and sized. */
  stamp(target: HTMLCanvasElement, src: CanvasImageSource, x: number, y: number, size: number, angle = 0, clip?: [number, number][]) {
    const ctx = target.getContext('2d')!;
    ctx.save();
    if (clip) {
      ctx.beginPath();
      clip.forEach(([cx, cy], k) => (k ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
      ctx.closePath();
      ctx.clip();
    }
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(src, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /** Redraws the composite (and the roughness / metal / glow textures if those channels are in use). */
  refresh() {
    const ctx = this.composite.getContext('2d')!;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.under, 0, 0);
    for (const l of this.layers) {
      if (l.hidden) continue;
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(l.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
    if (this.channels.rough || this.channels.metal) {
      if (!this.orm) {
        this.orm = canvas(this.size);
        this.ormTexture = new THREE.CanvasTexture(this.orm);
        this.ormTexture.flipY = false;
      }
      const o = this.orm.getContext('2d', { willReadFrequently: true })!;
      o.globalCompositeOperation = 'source-over';
      o.drawImage(this.underOrm, 0, 0);
      const out = o.getImageData(0, 0, this.size, this.size);
      // Painted grey (with its own alpha) replaces the green (rough) or blue (metal) of the underlay.
      for (const [c, ch] of [['rough', 1], ['metal', 2]] as const) {
        const cv = this.channels[c];
        if (!cv) continue;
        const src = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, this.size, this.size).data;
        for (let i = 0; i < src.length; i += 4) {
          const a = src[i + 3] / 255;
          if (a) out.data[i + ch] = Math.round(out.data[i + ch] * (1 - a) + src[i] * a);
        }
      }
      o.putImageData(out, 0, 0);
      this.ormTexture!.needsUpdate = true;
    }
    if (this.channels.glow) {
      if (!this.glowTexture) {
        this.glowTexture = new THREE.CanvasTexture(this.channels.glow);
        this.glowTexture.colorSpace = THREE.SRGBColorSpace;
        this.glowTexture.flipY = false;
      }
      this.glowTexture.needsUpdate = true;
    }
  }

  /** True when nothing has been painted at all. */
  get empty() {
    return !this.layers.length && !this.channels.rough && !this.channels.metal && !this.channels.glow;
  }

  /** As saved in an asset. Layers that would be too big to store are skipped. */
  toData(): PaintData | undefined {
    if (this.empty) return undefined;
    const png = (c: HTMLCanvasElement) => {
      const s = c.toDataURL('image/png');
      return s.length <= ASSET_LIMITS.paintChars ? s : '';
    };
    const out: PaintData = {
      size: this.size,
      layers: this.layers.slice(0, ASSET_LIMITS.layers).map((l) => ({ name: l.name, ...(l.hidden ? { hidden: true } : {}), opacity: l.opacity, png: png(l.canvas) })).filter((l) => l.png),
    };
    for (const k of ['rough', 'metal', 'glow'] as const) {
      const c = this.channels[k];
      if (c) {
        const s = png(c);
        if (s) out[k] = s;
      }
    }
    return out;
  }

  /** Reopens saved paint. Resolves once every picture has loaded (a broken one is skipped). */
  static async from(data: PaintData | undefined, fallbackSize = 256): Promise<PaintSurface> {
    const s = new PaintSurface(data?.size ?? fallbackSize);
    if (!data) return s;
    const load = (src: string, into: HTMLCanvasElement) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload = () => {
          into.getContext('2d')!.drawImage(img, 0, 0, s.size, s.size);
          done();
        };
        img.onerror = () => done();
        img.src = src;
      });
    const jobs: Promise<void>[] = [];
    for (const l of data.layers) {
      const layer = s.addLayer(l.name);
      layer.hidden = !!l.hidden;
      layer.opacity = l.opacity;
      jobs.push(load(l.png, layer.canvas));
    }
    for (const k of ['rough', 'metal', 'glow'] as const) if (data[k]) jobs.push(load(data[k]!, s.channel(k)));
    await Promise.all(jobs);
    s.refresh();
    return s;
  }

  dispose() {
    this.texture.dispose();
    this.ormTexture?.dispose();
    this.glowTexture?.dispose();
  }
}

/** Ready-made decals, drawn on demand: stripes, numbers, marks. */
export const DECALS = ['stripe', 'chevrons', 'hazard', 'star', 'circle', 'arrow', 'number', 'splat', 'bolt', 'grime'] as const;
export type DecalId = (typeof DECALS)[number];

export function decalCanvas(id: DecalId, color: string, text = '7'): HTMLCanvasElement {
  const n = 128, c = canvas(n), g = c.getContext('2d')!;
  g.fillStyle = g.strokeStyle = color;
  g.lineJoin = 'round';
  switch (id) {
    case 'stripe':
      g.fillRect(0, 44, n, 14);
      g.fillRect(0, 66, n, 22);
      break;
    case 'chevrons':
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(10 + i * 38, 22);
        g.lineTo(34 + i * 38, 22);
        g.lineTo(58 + i * 38, 64);
        g.lineTo(34 + i * 38, 106);
        g.lineTo(10 + i * 38, 106);
        g.lineTo(34 + i * 38, 64);
        g.fill();
      }
      break;
    case 'hazard':
      g.save();
      g.beginPath();
      g.rect(0, 40, n, 48);
      g.clip();
      for (let x = -n; x < n * 2; x += 32) {
        g.beginPath();
        g.moveTo(x, 88);
        g.lineTo(x + 16, 88);
        g.lineTo(x + 64, 40);
        g.lineTo(x + 48, 40);
        g.fill();
      }
      g.restore();
      break;
    case 'star':
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 24 : 56;
        g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      g.fill();
      break;
    case 'circle':
      g.lineWidth = 12;
      g.beginPath();
      g.arc(64, 64, 46, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'arrow':
      g.beginPath();
      g.moveTo(8, 50);
      g.lineTo(70, 50);
      g.lineTo(70, 24);
      g.lineTo(120, 64);
      g.lineTo(70, 104);
      g.lineTo(70, 78);
      g.lineTo(8, 78);
      g.fill();
      break;
    case 'number':
      g.font = '900 italic 96px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text.slice(0, 2), 64, 70);
      break;
    case 'splat': {
      let s = 7;
      const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      g.beginPath();
      g.arc(64, 64, 30, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = 26 + r() * 30;
        g.beginPath();
        g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + r() * 10, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'bolt':
      g.beginPath();
      g.moveTo(74, 6);
      g.lineTo(28, 72);
      g.lineTo(60, 72);
      g.lineTo(48, 122);
      g.lineTo(100, 50);
      g.lineTo(68, 50);
      g.fill();
      break;
    case 'grime': {
      let s = 3;
      const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 260; i++) {
        g.globalAlpha = 0.05 + r() * 0.12;
        g.beginPath();
        g.arc(r() * n, r() * n, 2 + r() * 10, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
  }
  return c;
}
