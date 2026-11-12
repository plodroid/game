import * as THREE from 'three';
import { CAR_COLORS, CAR_FINISHES, LIVERIES, type CarLoadout, type Finish } from '@chromashift/shared';

/*
 * Car paint. One canvas per car holds the finish pattern, the livery, the race number and any
 * scratches; the material on top gives the finish its gloss, metal, pearl or glow. The canvas is
 * laid out like the body's surface: x runs from the tail to the nose, y runs round the body from
 * underneath (0), up the left side (¼), over the top (½), down the right side (¾) and back under.
 * The left flank sees the canvas turned half round, so writing there is drawn rotated.
 */

export const hex = (id: string) => CAR_COLORS[id]?.hex ?? 0xff3f8e;
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Draws the finish pattern (accent over paint). */
function pattern(g: CanvasRenderingContext2D, W: number, H: number, f: Finish, paint: number, accent: number, seed: number) {
  const r = rnd(seed);
  const A = css(accent), P = css(paint);
  g.fillStyle = P;
  g.fillRect(0, 0, W, H);
  // Bare materials: carbon weave, or brushed metal grain.
  if (f.model === 'carbon')
    for (let x = 0, i = 0; x < W; x += 8, i++)
      for (let y = 0, j = 0; y < H; y += 8, j++) {
        g.fillStyle = (i + j) % 2 ? '#24272e' : '#3a3f48';
        g.fillRect(x, y, 8, 8);
      }
  if (f.model === 'brushed') {
    g.fillStyle = '#c9ced6';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(90,95,105,0.25)';
      g.fillRect(r() * W, r() * H, 40 + r() * 160, 1);
    }
  }
  const top = H * 0.5, left = H * 0.25, right = H * 0.75;
  const band = (y: number, h: number) => {
    g.fillRect(0, y - h / 2, W, h);
    if (y - h / 2 < 0) g.fillRect(0, H + y - h / 2, W, h);
  };
  g.fillStyle = A;
  switch (f.pattern) {
    case 'none':
      break;
    case 'stripes':
      band(top - H * 0.035, H * 0.035);
      band(top + H * 0.035, H * 0.035);
      break;
    case 'twin':
      for (const y of [top - H * 0.11, top + H * 0.11]) band(y, H * 0.008);
      break;
    case 'side':
      band(left + H * 0.02, H * 0.06);
      band(right - H * 0.02, H * 0.06);
      break;
    case 'gradient': {
      const gr = g.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, A);
      gr.addColorStop(1, P);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      break;
    }
    case 'fade': {
      for (const y0 of [left, right]) {
        const gr = g.createLinearGradient(0, y0 + H * 0.12, 0, y0 - H * 0.06);
        gr.addColorStop(0, A);
        gr.addColorStop(1, P);
        g.fillStyle = gr;
        g.fillRect(0, y0 - H * 0.06, W, H * 0.18);
      }
      g.fillStyle = A;
      g.fillRect(0, 0, W, H * 0.12);
      g.fillRect(0, H * 0.88, W, H * 0.12);
      break;
    }
    case 'sunset':
    case 'rainbow': {
      const cols = f.pattern === 'rainbow' ? ['#ff3d3d', '#ff9a1f', '#ffe14a', '#3ddc5a', '#2f8bff', '#8b5cff'] : ['#ffb347', '#ff7a59', '#e0457b', '#8b3fbf', '#3d2a8f'];
      const gr = g.createLinearGradient(0, 0, W, 0);
      cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      break;
    }
    case 'camo':
      for (let i = 0; i < 160; i++) {
        g.fillStyle = i % 3 ? A : css(darken(paint, 0.55));
        g.beginPath();
        g.ellipse(r() * W, r() * H, 18 + r() * 40, 10 + r() * 26, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'digicamo':
      for (let i = 0; i < 900; i++) {
        g.fillStyle = i % 3 ? A : css(darken(paint, 0.5));
        const s = 8 * (1 + Math.floor(r() * 3));
        g.fillRect(Math.floor((r() * W) / 8) * 8, Math.floor((r() * H) / 8) * 8, s, s);
      }
      break;
    case 'splat':
    case 'drip':
      for (let i = 0; i < (f.pattern === 'splat' ? 28 : 18); i++) {
        const x = r() * W, y = f.pattern === 'drip' ? top + (r() - 0.5) * H * 0.1 : r() * H, rad = 14 + r() * 34;
        g.beginPath();
        for (let k = 0; k <= 18; k++) {
          const a = (k / 18) * Math.PI * 2, rr = rad * (0.7 + r() * 0.5);
          g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.fill();
        if (f.pattern === 'drip')
          for (const dir of [1, -1]) {
            const len = 30 + r() * 110;
            g.fillRect(x - 4 + r() * 8, dir > 0 ? y : y - len, 7 + r() * 5, len);
          }
      }
      break;
    case 'pixel':
      for (let x = 0; x < W; x += 32)
        for (let y = 0; y < H; y += 32) if (r() < 0.35) g.fillRect(x, y, 32, 32);
      break;
    case 'hex': {
      g.strokeStyle = A;
      g.lineWidth = 3;
      const s = 22;
      for (let y = 0, row = 0; y < H + s; y += s * 1.5, row++)
        for (let x = row % 2 ? s * 0.87 : 0; x < W + s; x += s * 1.74) {
          g.beginPath();
          for (let k = 0; k <= 6; k++) {
            const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
            g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * s, y + Math.sin(a) * s);
          }
          g.stroke();
        }
      break;
    }
    case 'check':
      for (let x = 0, i = 0; x < W; x += 32, i++) for (let y = 0, j = 0; y < H; y += 32, j++) if ((i + j) % 2) g.fillRect(x, y, 32, 32);
      break;
    case 'plaid':
      g.globalAlpha = 0.55;
      for (let x = 0; x < W; x += 48) g.fillRect(x, 0, 14, H);
      for (let y = 0; y < H; y += 48) g.fillRect(0, y, W, 14);
      g.globalAlpha = 1;
      break;
    case 'diamonds':
      for (let x = 0, i = 0; x < W + 40; x += 40, i++)
        for (let y = 0, j = 0; y < H + 40; y += 40, j++) {
          if ((i + j) % 2) continue;
          g.beginPath();
          g.moveTo(x, y - 20);
          g.lineTo(x + 20, y);
          g.lineTo(x, y + 20);
          g.lineTo(x - 20, y);
          g.fill();
        }
      break;
    case 'chevrons':
      g.lineWidth = 12;
      g.strokeStyle = A;
      for (let x = -H; x < W; x += 60) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 40, H * 0.25);
        g.lineTo(x, H * 0.5);
        g.lineTo(x + 40, H * 0.75);
        g.lineTo(x, H);
        g.stroke();
      }
      break;
    case 'zebra':
    case 'tiger':
      for (let i = 0; i < (f.pattern === 'tiger' ? 40 : 30); i++) {
        const x = r() * W;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= H; y += 16) g.lineTo(x + Math.sin(y * 0.05 + i) * 14 + (f.pattern === 'tiger' ? (r() - 0.5) * 8 : 0), y);
        g.lineTo(x + (f.pattern === 'tiger' ? 7 : 22), H);
        for (let y = H; y >= 0; y -= 16) g.lineTo(x + (f.pattern === 'tiger' ? 7 : 22) + Math.sin(y * 0.05 + i) * 14, y);
        g.fill();
      }
      break;
    case 'waves':
      g.lineWidth = 8;
      g.strokeStyle = A;
      for (let y = 0; y < H; y += 28) {
        g.beginPath();
        for (let x = 0; x <= W; x += 8) g[x ? 'lineTo' : 'moveTo'](x, y + Math.sin(x * 0.04 + y) * 9);
        g.stroke();
      }
      break;
    case 'bolts':
      for (const y0 of [left + H * 0.03, right - H * 0.03]) {
        g.beginPath();
        let x = W * 0.12, y = y0 - 18;
        g.moveTo(x, y);
        while (x < W * 0.92) {
          x += 50 + r() * 40;
          y = y0 + (y === y0 - 18 ? 18 : -18);
          g.lineTo(x, y);
        }
        g.lineTo(x, y0 + 26);
        g.lineTo(W * 0.12, y0 + 6);
        g.fill();
      }
      break;
    case 'stars':
    case 'galaxy':
      if (f.pattern === 'galaxy') {
        for (let i = 0; i < 26; i++) {
          g.fillStyle = `${A}22`;
          g.beginPath();
          g.ellipse(r() * W, r() * H, 60 + r() * 120, 30 + r() * 60, r() * 3, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#fff';
      }
      for (let i = 0; i < 260; i++) {
        const s = r() < 0.92 ? 1 + r() * 2 : 4 + r() * 4;
        g.fillRect(r() * W, r() * H, s, s);
      }
      break;
    case 'dots':
      for (let x = 20, i = 0; x < W; x += 56, i++)
        for (let y = 20 + (i % 2) * 28; y < H; y += 56) {
          g.beginPath();
          g.arc(x, y, 14, 0, Math.PI * 2);
          g.fill();
        }
      break;
    case 'triangles':
      for (let x = 0, i = 0; x < W; x += 40, i++)
        for (let y = 0, j = 0; y < H; y += 40, j++) {
          if (r() < 0.5) continue;
          g.globalAlpha = 0.4 + r() * 0.6;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 40, y + ((i + j) % 2 ? 40 : 0));
          g.lineTo(x, y + 40);
          g.fill();
        }
      g.globalAlpha = 1;
      break;
    case 'circuit':
      g.strokeStyle = A;
      g.lineWidth = 3;
      for (let i = 0; i < 90; i++) {
        let x = r() * W, y = r() * H;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          if (r() < 0.5) x += (r() - 0.5) * 120;
          else y += (r() - 0.5) * 80;
          g.lineTo(x, y);
        }
        g.stroke();
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'cells':
      for (let i = 0; i < 70; i++) {
        g.globalAlpha = 0.5 + r() * 0.5;
        g.beginPath();
        g.ellipse(r() * W, r() * H, 10 + r() * 30, 10 + r() * 30, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      break;
    case 'marble':
      g.strokeStyle = A;
      for (let i = 0; i < 40; i++) {
        g.lineWidth = 1 + r() * 4;
        g.globalAlpha = 0.3 + r() * 0.5;
        g.beginPath();
        let x = r() * W, y = r() * H;
        g.moveTo(x, y);
        for (let k = 0; k < 12; k++) {
          x += 20 + r() * 30;
          y += (r() - 0.5) * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    case 'scales':
      g.strokeStyle = A;
      g.lineWidth = 3;
      for (let y = 0, row = 0; y < H + 20; y += 16, row++)
        for (let x = (row % 2) * 16; x < W + 20; x += 32) {
          g.beginPath();
          g.arc(x, y, 16, 0, Math.PI);
          g.stroke();
        }
      break;
    case 'topo':
      g.strokeStyle = A;
      g.lineWidth = 2;
      for (let c = 0; c < 9; c++) {
        const cx = r() * W, cy = r() * H;
        for (let k = 1; k < 9; k++) {
          g.beginPath();
          g.ellipse(cx, cy, k * 16 + r() * 6, k * 10 + r() * 6, r(), 0, Math.PI * 2);
          g.stroke();
        }
      }
      break;
    case 'speckle':
      for (let i = 0; i < 2500; i++) g.fillRect(r() * W, r() * H, 2, 2);
      break;
    case 'flames':
      for (const y0 of [left, right]) {
        g.beginPath();
        g.moveTo(W, y0 - 40);
        for (let x = W; x > W * 0.35; x -= 26) {
          g.quadraticCurveTo(x - 13, y0 - 40 - r() * 30, x - 26, y0 - 10 - r() * 20);
        }
        g.lineTo(W * 0.3, y0);
        for (let x = W * 0.35; x < W; x += 26) g.quadraticCurveTo(x + 13, y0 + 40 + r() * 30, x + 26, y0 + 10 + r() * 20);
        g.lineTo(W, y0 + 40);
        g.fill();
      }
      break;
  }
}

export function darken(c: number, k: number) {
  const r = ((c >> 16) & 255) * k, g = ((c >> 8) & 255) * k, b = (c & 255) * k;
  return (r << 16) | (g << 8) | b;
}

/** Livery and race number on top of the pattern. */
function livery(g: CanvasRenderingContext2D, W: number, H: number, l: CarLoadout, identity: number, ident: number) {
  const id = LIVERIES[l.livery] ? l.livery : 'none';
  const A = css(hex(l.accent));
  const sides = [H * 0.29, H * 0.71];
  const roundel = (y: number, flip: boolean) => {
    g.save();
    g.translate(W * 0.47, y);
    if (flip) g.rotate(Math.PI);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 62, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = css(ident);
    g.stroke();
    g.fillStyle = '#15161b';
    g.font = 'bold 78px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(l.number), 0, 3);
    g.restore();
  };
  const text = (s: string, y: number, flip: boolean, size = 34) => {
    g.save();
    g.translate(W * 0.5, y);
    if (flip) g.rotate(Math.PI);
    g.font = `900 italic ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, 0, 0);
    g.restore();
  };
  g.fillStyle = A;
  switch (id) {
    case 'stripe':
      g.fillRect(0, H * 0.5 - H * 0.05, W, H * 0.1);
      break;
    case 'band':
      for (const y of sides) for (let x = W * 0.15, i = 0; x < W * 0.85; x += 14, i++) for (let k = 0; k < 2; k++) {
        g.fillStyle = (i + k) % 2 ? '#15161b' : '#ffffff';
        g.fillRect(x, y - 14 + k * 14, 14, 14);
      }
      break;
    case 'splat':
      for (const y of sides) {
        g.fillStyle = css(ident);
        g.beginPath();
        for (let k = 0; k <= 22; k++) {
          const a = (k / 22) * Math.PI * 2, rr = 60 * (0.75 + 0.35 * Math.sin(k * 2.7));
          g[k ? 'lineTo' : 'moveTo'](W * 0.5 + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr * 0.5);
        }
        g.fill();
      }
      break;
    case 'bolt':
      for (const y of sides) {
        g.beginPath();
        g.moveTo(W * 0.85, y - 20);
        g.lineTo(W * 0.55, y);
        g.lineTo(W * 0.6, y - 6);
        g.lineTo(W * 0.15, y + 18);
        g.lineTo(W * 0.5, y + 4);
        g.lineTo(W * 0.45, y + 10);
        g.closePath();
        g.fill();
      }
      break;
    case 'wave':
      for (const y of sides) {
        g.beginPath();
        g.moveTo(W, y + 30);
        for (let x = W; x >= W * 0.35; x -= 10) g.lineTo(x, y + 30 - Math.sin(((W - x) / (W * 0.65)) * Math.PI) * 50);
        g.lineTo(W * 0.35, y + 30);
        g.fill();
      }
      break;
    case 'logo':
      g.fillStyle = A;
      text('CHROMASHIFT', sides[0] + 4, true, 40);
      text('CHROMASHIFT', sides[1] - 4, false, 40);
      break;
    case 'sponsor': {
      const names = ['SPLAT OIL', 'DYE CO', 'PRISM', 'SURGE', 'TEAL TYRES'];
      g.font = '800 22px system-ui, sans-serif';
      names.forEach((n, i) => {
        const x = W * (0.2 + i * 0.15);
        for (const y of sides) {
          g.fillStyle = i % 2 ? '#ffffff' : A;
          g.fillRect(x - 46, y - 14, 92, 26);
          g.fillStyle = '#15161b';
          g.textAlign = 'center';
          g.fillText(n, x, y + 6);
        }
      });
      break;
    }
    case 'sun': {
      const gr = g.createRadialGradient(W * 0.85, H * 0.5, 4, W * 0.85, H * 0.5, 120);
      gr.addColorStop(0, '#fff2a0');
      gr.addColorStop(0.5, A);
      gr.addColorStop(1, 'transparent');
      g.fillStyle = gr;
      g.fillRect(W * 0.6, H * 0.3, W * 0.4, H * 0.4);
      break;
    }
    case 'pixels':
      for (let i = 0; i < 60; i++) {
        g.fillStyle = i % 2 ? A : css(ident);
        g.fillRect(W * (0.3 + Math.random() * 0.6), H * (Math.random() < 0.5 ? 0.29 : 0.71) + (Math.random() - 0.5) * 50, 10 + Math.random() * 30, 8);
      }
      break;
    case 'crown':
      g.fillStyle = '#ffd23f';
      for (const y of sides) {
        g.beginPath();
        g.moveTo(W * 0.42, y + 16);
        g.lineTo(W * 0.42, y - 14);
        g.lineTo(W * 0.46, y + 2);
        g.lineTo(W * 0.5, y - 20);
        g.lineTo(W * 0.54, y + 2);
        g.lineTo(W * 0.58, y - 14);
        g.lineTo(W * 0.58, y + 16);
        g.fill();
      }
      break;
  }
  if (id === 'number' || id === 'stripe' || id === 'band' || id === 'crown') {
    roundel(sides[0], true);
    roundel(sides[1], false);
  }
  void identity;
}

export interface Paint {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  base: ImageData | null;
}

/** Builds the body texture for a loadout. */
export function paintTexture(l: CarLoadout, identity: number, identColor: number, size: number): Paint {
  // Square: the body is about as far round as it is long, so shapes stay round.
  const W = size, H = size;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const f = CAR_FINISHES[l.finish] ?? CAR_FINISHES.gloss;
  const seed = [...`${l.finish}${l.paint}${l.accent}`].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  g.save();
  g.scale(W / 1024, H / 1024);
  pattern(g, 1024, 1024, f, hex(l.paint), hex(l.accent), seed);
  livery(g, 1024, 1024, l, identity, identColor);
  g.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.flipY = false;
  return { canvas, texture, base: g.getImageData(0, 0, W, H) };
}

/** Scratches drawn over the paint where the body is damaged (left, right, front, rear). */
export function scratch(p: Paint, zones: { left: number; right: number; front: number; rear: number; top: number }) {
  const g = p.canvas.getContext('2d')!;
  const W = p.canvas.width, H = p.canvas.height;
  if (p.base) g.putImageData(p.base, 0, 0);
  const r = rnd(99);
  const lines = (x0: number, x1: number, y0: number, y1: number, k: number) => {
    const n = Math.round(k * 70);
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
      g.strokeStyle = r() < 0.5 ? 'rgba(220,220,225,0.7)' : 'rgba(30,30,35,0.55)';
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.3) * 60, y + (r() - 0.5) * 14);
      g.stroke();
    }
    // Grime and bare primer patches on heavy damage.
    if (k > 0.45)
      for (let i = 0; i < Math.round(k * 12); i++) {
        g.fillStyle = `rgba(${90 + r() * 40},${85 + r() * 30},${80 + r() * 30},${0.25 + k * 0.4})`;
        g.beginPath();
        g.ellipse(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 8 + r() * 26 * k, 5 + r() * 14 * k, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
  };
  lines(0, W, H * 0.15, H * 0.36, zones.left);
  lines(0, W, H * 0.64, H * 0.85, zones.right);
  lines(W * 0.8, W, 0, H, zones.front);
  lines(0, W * 0.2, 0, H, zones.rear);
  lines(W * 0.25, W * 0.85, H * 0.4, H * 0.6, zones.top);
  p.texture.needsUpdate = true;
}

/** The body material for a finish. Very Low uses a plain Lambert. */
export function bodyMaterial(f: Finish, map: THREE.Texture, lambert: boolean): THREE.Material {
  if (lambert) return new THREE.MeshLambertMaterial({ map });
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 0.3, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.08 });
  switch (f.model) {
    case 'gloss':
      m.roughness = 0.28;
      m.metalness = 0.05;
      m.clearcoat = 1;
      break;
    case 'matte':
      m.roughness = 0.82;
      m.metalness = 0;
      m.clearcoat = 0;
      break;
    case 'satin':
      m.roughness = 0.5;
      m.clearcoat = 0.3;
      m.clearcoatRoughness = 0.4;
      break;
    case 'metallic':
      m.roughness = 0.35;
      m.metalness = 0.65;
      m.clearcoat = 1;
      break;
    case 'pearl':
      m.roughness = 0.3;
      m.metalness = 0.3;
      m.clearcoat = 1;
      m.iridescence = 0.6;
      m.iridescenceIOR = 1.6;
      break;
    case 'candy':
      m.roughness = 0.12;
      m.metalness = 0.75;
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.02;
      break;
    case 'chrome':
      m.roughness = 0.06;
      m.metalness = 1;
      m.clearcoat = 0.5;
      break;
    case 'brushed':
      m.roughness = 0.42;
      m.metalness = 1;
      m.clearcoat = 0;
      m.anisotropy = 0.8;
      break;
    case 'carbon':
      m.roughness = 0.35;
      m.metalness = 0.2;
      m.clearcoat = 1;
      break;
    case 'holo':
      m.roughness = 0.18;
      m.metalness = 0.9;
      m.iridescence = 1;
      m.iridescenceIOR = 2.1;
      m.iridescenceThicknessRange = [120, 900];
      break;
    case 'glow':
      m.roughness = 0.35;
      m.emissiveMap = map;
      m.emissive = new THREE.Color(0xffffff);
      m.emissiveIntensity = 0.55;
      break;
  }
  return m;
}
