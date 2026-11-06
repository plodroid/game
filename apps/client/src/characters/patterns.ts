import * as THREE from 'three';

export type Pattern = 'stripes' | 'check' | 'dots' | 'camo' | 'drip' | 'marble' | 'carbon' | 'galaxy';

const cache = new Map<string, THREE.CanvasTexture>();
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A repeating two-colour pattern, drawn once per combination and shared. */
export function patternTexture(p: Pattern, a: number, b: number): THREE.CanvasTexture {
  const key = `${p}:${a}:${b}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = hex(a);
  x.fillRect(0, 0, S, S);
  x.fillStyle = hex(b);
  const blob = (cx: number, cy: number, r: number) => {
    x.beginPath();
    for (let i = 0; i <= 14; i++) {
      const t = (i / 14) * Math.PI * 2, rr = r * (0.75 + 0.25 * Math.abs(Math.sin(i * 2.3 + cx)));
      x.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
    }
    x.fill();
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  switch (p) {
    case 'stripes':
      for (let y = 0; y < S; y += 32) x.fillRect(0, y, S, 14);
      break;
    case 'check':
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) x.fillRect(i * 32, j * 32, 32, 32);
      break;
    case 'dots':
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          x.beginPath();
          x.arc(i * 32 + 16 + (j % 2) * 16, j * 32 + 16, 8, 0, Math.PI * 2);
          x.fill();
        }
      break;
    case 'camo':
      for (let i = 0; i < 9; i++) blob(rnd() * S, rnd() * S, 12 + rnd() * 16);
      x.fillStyle = hex(darken(a, 0.55));
      for (let i = 0; i < 6; i++) blob(rnd() * S, rnd() * S, 8 + rnd() * 10);
      break;
    case 'drip':
      x.fillRect(0, 0, S, 26);
      for (let i = 0; i < 8; i++) {
        const cx = i * 16 + 8, len = 20 + rnd() * 70;
        x.fillRect(cx - 4, 20, 8, len);
        x.beginPath();
        x.arc(cx, 20 + len, 6, 0, Math.PI * 2);
        x.fill();
      }
      break;
    case 'marble':
      x.strokeStyle = hex(b);
      x.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        x.beginPath();
        let px = rnd() * S, py = 0;
        x.moveTo(px, py);
        while (py < S) {
          px += (rnd() - 0.5) * 30;
          py += 10 + rnd() * 14;
          x.lineTo(px, py);
        }
        x.stroke();
      }
      break;
    case 'carbon':
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) if ((i + j) % 2) x.fillRect(i * 8, j * 8, 8, 4);
      break;
    case 'galaxy':
      for (let i = 0; i < 60; i++) {
        x.globalAlpha = 0.3 + rnd() * 0.7;
        x.beginPath();
        x.arc(rnd() * S, rnd() * S, rnd() * 1.8 + 0.4, 0, Math.PI * 2);
        x.fill();
      }
      x.globalAlpha = 0.25;
      for (let i = 0; i < 4; i++) blob(rnd() * S, rnd() * S, 20 + rnd() * 20);
      x.globalAlpha = 1;
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1.5);
  cache.set(key, t);
  return t;
}

export function darken(c: number, k: number) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}
