import { useEffect, useRef, useState } from 'react';
import type { MapDef } from '@chromashift/shared';
import { useSplit } from '../../game/split';
import { engine } from '../../game/engine';
import type { MatchView } from '../../game/matchView';
import { useHud, useHud2 } from '../../state/ui';

const PAD = 8;

/** The map from above, drawn once: higher ground is lighter, spawns carry their team's paint. */
function drawLayout(map: MapDef, size: number, colors: string[]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  const e = map.extent;
  const scale = (size - PAD * 2) / Math.max(e.maxX - e.minX, e.maxZ - e.minZ);
  const ox = PAD + ((size - PAD * 2) - (e.maxX - e.minX) * scale) / 2 - e.minX * scale;
  const oz = PAD + ((size - PAD * 2) - (e.maxZ - e.minZ) * scale) / 2 - e.minZ * scale;
  // Ceilings and anything else above the play space would cover the whole map.
  const blocks = map.blocks.filter((b) => b.solid && b.visible && b.c.y - b.h.y < e.maxY - 0.5).sort((a, b) => a.c.y + a.h.y - (b.c.y + b.h.y));
  const top = Math.max(1, Math.min(e.maxY, ...blocks.map((b) => b.c.y + b.h.y)));
  for (const b of blocks) {
    const h = Math.max(0, Math.min(1, (b.c.y + b.h.y) / top));
    x.fillStyle = `hsl(268 18% ${16 + h * 30}%)`;
    const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    // A ramp's footprint shrinks with its tilt.
    const hz = b.h.z * Math.abs(Math.cos(b.pitch)) + b.h.y * Math.abs(Math.sin(b.pitch));
    x.beginPath();
    for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = b.c.x + u * b.h.x * cs + w * hz * sn, pz = b.c.z - u * b.h.x * sn + w * hz * cs;
      x.lineTo(ox + px * scale, oz + pz * scale);
    }
    x.closePath();
    x.fill();
  }
  map.spawns.forEach((list, t) => {
    x.fillStyle = colors[t];
    x.globalAlpha = 0.55;
    for (const s of list) {
      x.beginPath();
      x.arc(ox + s.x * scale, oz + s.z * scale, 6, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  });
  x.strokeStyle = 'rgba(255,197,50,0.8)';
  x.setLineDash([4, 3]);
  for (const z of map.zones) x.strokeRect(ox + (z.c.x - z.h.x) * scale, oz + (z.c.z - z.h.z) * scale, z.h.x * 2 * scale, z.h.z * 2 * scale);
  return { canvas: c, to: (wx: number, wz: number) => [ox + wx * scale, oz + wz * scale] as const };
}

/** The minimap: the arena and everyone you can see, with their names. M makes it bigger. */
export function Minimap({ seat = 0 }: { seat?: number }) {
  // Split screen: each player has their own, a little smaller.
  const big = (seat ? useHud2 : useHud)((h) => h.bigMap);
  const ref = useRef<HTMLCanvasElement>(null);
  // Sized to the screen, so a phone held sideways keeps room for its touch buttons.
  const [vh, setVh] = useState(() => Math.min(innerWidth, innerHeight));
  useEffect(() => {
    const on = () => setVh(Math.min(innerWidth, innerHeight));
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  const seated = useSplit((x) => x.seated);
  const half = seated ? 0.62 : 1;
  const size = Math.round(half * (big ? Math.min(340, Math.round(vh * 0.8)) : Math.min(190, Math.round(vh * 0.3))));
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    cv.width = cv.height = px;
    const ctx = cv.getContext('2d')!;
    let layout: ReturnType<typeof drawLayout> | null = null;
    let mapId = '';
    let raf = 0, last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 66) return;
      last = t;
      const view = engine.view?.kind === 'match' ? (engine.view as MatchView) : null;
      if (!view) return;
      const r = view.radar(seat);
      const colors = r.colors.map((c) => `#${c.getHexString()}`);
      if (!layout || mapId !== r.map.id) {
        layout = drawLayout(r.map, px, colors);
        mapId = r.map.id;
      }
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(layout.canvas, 0, 0);
      ctx.font = `700 ${Math.round(11 * dpr)}px "Archivo Variable", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const p of r.players) {
        if (!p.alive || !p.seen) continue;
        const [x, y] = layout.to(p.x, p.z);
        ctx.fillStyle = colors[p.team];
        if (p.me) {
          // You: an arrow pointing where the camera looks.
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-r.yaw + Math.PI);
          ctx.beginPath();
          ctx.moveTo(0, -9 * dpr);
          ctx.lineTo(6 * dpr, 6 * dpr);
          ctx.lineTo(0, 3 * dpr);
          ctx.lineTo(-6 * dpr, 6 * dpr);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.restore();
          continue;
        }
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = 'rgba(12,10,18,0.9)';
        ctx.stroke();
        const label = p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name;
        ctx.lineWidth = 3 * dpr;
        ctx.strokeText(label, x, y - 8 * dpr);
        ctx.fillStyle = '#f4efe9';
        ctx.fillText(label, x, y - 8 * dpr);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, seat]);
  return <canvas ref={ref} className="minimap" data-big={big} style={{ width: size, height: size }} aria-hidden />;
}
