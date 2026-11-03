import { v3 } from '../vec';
import type { Block, JumpPad, MaterialId, PropDef, SpawnPoint, ZoneDef } from './types';

interface Opts {
  mat?: MaterialId;
  yaw?: number;
  paint?: boolean;
  solid?: boolean;
  visible?: boolean;
  /** Mirror through the map centre (180° about Y) for the other team. Default true. */
  mirror?: boolean;
}

/**
 * Maps are authored for team 0's half and rotated 180° about the origin for team 1,
 * which guarantees identical routes and sightlines for both teams.
 */
export class MapBuilder {
  private blocks: (Block & { mirror: boolean })[] = [];
  private pads: JumpPad[] = [];
  private props: (PropDef & { mirror: boolean })[] = [];
  private zones: ZoneDef[] = [];

  /** Axis-aligned box from y0 to y1, footprint w × d centred at (x, z). */
  box(x: number, z: number, w: number, d: number, y0: number, y1: number, o: Opts = {}) {
    this.blocks.push({
      c: v3(x, (y0 + y1) / 2, z),
      h: v3(w / 2, (y1 - y0) / 2, d / 2),
      yaw: o.yaw ?? 0,
      pitch: 0,
      mat: o.mat ?? 'wall',
      paint: o.paint ?? (o.mat !== 'glass' && o.mat !== 'invisible'),
      solid: o.solid ?? true,
      visible: o.visible ?? o.mat !== 'invisible',
      mirror: o.mirror ?? true,
    });
    return this;
  }

  /** Sloped slab whose top surface runs exactly from point a to point b. */
  ramp(a: [number, number, number], b: [number, number, number], width: number, o: Opts = {}) {
    const t = 0.4;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const horiz = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const alpha = Math.atan2(dy, horiz);
    const pitch = -alpha;
    const length = Math.hypot(horiz, dy);
    // Local up after rotation, used to sink the slab below its top surface.
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const up = v3(sp * sy, cp, sp * cy);
    this.blocks.push({
      c: v3((a[0] + b[0]) / 2 - (up.x * t) / 2, (a[1] + b[1]) / 2 - (up.y * t) / 2, (a[2] + b[2]) / 2 - (up.z * t) / 2),
      h: v3(width / 2, t / 2, length / 2),
      yaw,
      pitch,
      mat: o.mat ?? 'metal',
      paint: o.paint ?? true,
      solid: true,
      visible: true,
      mirror: o.mirror ?? true,
    });
    return this;
  }

  pad(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    this.pads.push({ x, y, z, r: 1.2, vx, vy, vz });
    this.pads.push({ x: -x, y, z: -z, r: 1.2, vx: -vx, vy, vz: -vz });
    return this;
  }

  prop(p: PropDef, mirror = true) {
    this.props.push({ ...p, mirror });
    return this;
  }

  zone(x: number, y: number, z: number, w: number, d: number) {
    this.zones.push({ c: v3(x, y, z), h: v3(w / 2, 1.2, d / 2) });
    return this;
  }

  build() {
    const blocks: Block[] = [];
    for (const { mirror, ...b } of this.blocks) {
      blocks.push(b);
      if (mirror) blocks.push({ ...b, c: v3(-b.c.x, b.c.y, -b.c.z), yaw: b.yaw + Math.PI });
    }
    const props: PropDef[] = [];
    for (const { mirror, ...p } of this.props) {
      props.push(p);
      if (mirror) props.push({ ...p, x: -p.x, z: -p.z, yaw: (p.yaw ?? 0) + Math.PI });
    }
    return { blocks, pads: this.pads, props, zones: this.zones };
  }
}

/** Four spawn points for team 0 in a row; team 1 gets the mirrored set. */
export function spawnRow(y: number, z: number, xs: number[]): [SpawnPoint[], SpawnPoint[]] {
  const a = xs.map((x) => ({ x, y, z, yaw: Math.PI }));
  const b = a.map((s) => ({ x: -s.x, y: s.y, z: -s.z, yaw: 0 }));
  return [a, b];
}
