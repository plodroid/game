import { v3 } from '../vec';
import { MAPS } from './index';
import type { Block, BuiltinMapId, MapDef, MapId, MaterialId } from './types';

/*
 * Player-made maps. A map is plain data (so it can be saved, copied and sent to guests), turned into
 * the same MapDef the built-in maps use. Like the built-ins, a map is authored for team 0's half:
 * blocks marked "mirror" and all spawns and jump pads get a 180° copy for team 1.
 */

export interface CustomBlock {
  n?: string;
  x: number;
  y: number;
  z: number;
  /** Full size (width, height, depth). */
  w: number;
  h: number;
  d: number;
  /** Radians: turn around Y, then tilt around the block's own X (ramps). */
  yaw: number;
  pitch: number;
  mat: MaterialId;
  paint: boolean;
  solid: boolean;
  mirror: boolean;
}

export interface CustomMap {
  id: string;
  name: string;
  description: string;
  /** Which built-in map supplies the sky, light and colours. */
  look: BuiltinMapId;
  blocks: CustomBlock[];
  /** Team 0's spawns; team 1 gets the mirrored set. */
  spawns: { x: number; y: number; z: number; yaw: number }[];
  /** Jump pads (mirrored for team 1). */
  pads: { x: number; y: number; z: number; vx: number; vy: number; vz: number }[];
  /** Objective zones, placed exactly where you put them. */
  zones: { x: number; y: number; z: number; w: number; d: number }[];
}

export const CUSTOM_LIMITS = { blocks: 400, spawns: 4, pads: 12, zones: 4, span: 90 } as const;
export const BUILTIN_LOOKS: BuiltinMapId[] = ['skyline', 'core', 'float', 'docks', 'gardens', 'canyon', 'arcade'];
const MATERIALS: MaterialId[] = ['floor', 'wall', 'metal', 'trim', 'glass', 'base', 'crate', 'island', 'invisible'];
const ID = /^c-[a-z0-9]{4,16}$/;

const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const text = (v: unknown, max: number, fallback = '') =>
  // eslint-disable-next-line no-control-regex
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : fallback;
const S = CUSTOM_LIMITS.span;

export const newMapId = () => `c-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;

/** A fresh map: a floor and two spawn spots, ready to build on. */
export function blankMap(): CustomMap {
  return {
    id: newMapId(),
    name: 'My map',
    description: 'A map I made.',
    look: 'skyline',
    blocks: [{ n: 'Floor', x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 60, yaw: 0, pitch: 0, mat: 'floor', paint: true, solid: true, mirror: false }],
    spawns: [-3, -1, 1, 3].map((x) => ({ x, y: 1.5, z: -24, yaw: Math.PI })),
    pads: [],
    zones: [
      { x: 0, y: 0.6, z: 0, w: 8, d: 8 },
    ],
  };
}

/** Checks anything that claims to be a map (from storage or from a host) and returns a clean copy, or null. */
export function sanitizeCustomMap(raw: unknown): CustomMap | null {
  const r = raw as Partial<CustomMap> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID.test(r.id) || !Array.isArray(r.blocks)) return null;
  const blocks: CustomBlock[] = r.blocks.slice(0, CUSTOM_LIMITS.blocks).map((b) => {
    const mat = MATERIALS.includes(b?.mat as MaterialId) ? (b.mat as MaterialId) : 'wall';
    return {
      n: b?.n ? text(b.n, 24) : undefined,
      x: num(b?.x, -S, S, 0),
      y: num(b?.y, -40, 80, 0),
      z: num(b?.z, -S, S, 0),
      w: num(b?.w, 0.1, 120, 1),
      h: num(b?.h, 0.1, 120, 1),
      d: num(b?.d, 0.1, 120, 1),
      yaw: num(b?.yaw, -7, 7, 0),
      pitch: num(b?.pitch, -1.5, 1.5, 0),
      mat,
      paint: typeof b?.paint === 'boolean' ? b.paint : mat !== 'glass' && mat !== 'invisible',
      solid: typeof b?.solid === 'boolean' ? b.solid : true,
      mirror: typeof b?.mirror === 'boolean' ? b.mirror : false,
    };
  });
  const spawns = (Array.isArray(r.spawns) ? r.spawns : []).slice(0, CUSTOM_LIMITS.spawns).map((s) => ({ x: num(s?.x, -S, S, 0), y: num(s?.y, -40, 80, 1.5), z: num(s?.z, -S, S, 0), yaw: num(s?.yaw, -7, 7, 0) }));
  if (!spawns.length) spawns.push({ x: 0, y: 1.5, z: -10, yaw: Math.PI });
  const pads = (Array.isArray(r.pads) ? r.pads : []).slice(0, CUSTOM_LIMITS.pads).map((p) => ({
    x: num(p?.x, -S, S, 0), y: num(p?.y, -40, 80, 0), z: num(p?.z, -S, S, 0),
    vx: num(p?.vx, -30, 30, 0), vy: num(p?.vy, 0, 40, 16), vz: num(p?.vz, -30, 30, 0),
  }));
  const zones = (Array.isArray(r.zones) ? r.zones : []).slice(0, CUSTOM_LIMITS.zones).map((z) => ({ x: num(z?.x, -S, S, 0), y: num(z?.y, -40, 80, 0.6), z: num(z?.z, -S, S, 0), w: num(z?.w, 1, 40, 8), d: num(z?.d, 1, 40, 8) }));
  return {
    id: r.id,
    name: text(r.name, 28, 'My map') || 'My map',
    description: text(r.description, 90),
    look: BUILTIN_LOOKS.includes(r.look as BuiltinMapId) ? (r.look as BuiltinMapId) : 'skyline',
    blocks,
    spawns,
    pads,
    zones,
  };
}

/** Turns map data into the playable map. */
export function buildCustomMap(c: CustomMap): MapDef {
  const blocks: Block[] = [];
  for (const b of c.blocks) {
    const base: Block = {
      c: v3(b.x, b.y, b.z),
      h: v3(b.w / 2, b.h / 2, b.d / 2),
      yaw: b.yaw,
      pitch: b.pitch,
      mat: b.mat,
      paint: b.paint,
      solid: b.solid,
      visible: b.mat !== 'invisible',
    };
    blocks.push(base);
    if (b.mirror) blocks.push({ ...base, c: v3(-b.x, b.y, -b.z), yaw: b.yaw + Math.PI });
  }
  let minX = -20, maxX = 20, minZ = -30, maxZ = 30, maxY = 12, minY = -1;
  if (blocks.length) {
    minX = minZ = Infinity;
    maxX = maxZ = -Infinity;
    maxY = -Infinity;
    minY = Infinity;
    for (const b of blocks) {
      const r = Math.hypot(b.h.x, b.h.z);
      minX = Math.min(minX, b.c.x - r);
      maxX = Math.max(maxX, b.c.x + r);
      minZ = Math.min(minZ, b.c.z - r);
      maxZ = Math.max(maxZ, b.c.z + r);
      maxY = Math.max(maxY, b.c.y + b.h.y);
      minY = Math.min(minY, b.c.y - b.h.y);
    }
  }
  const spawns = c.spawns.map((s) => ({ ...s }));
  const zones = c.zones.length ? c.zones : [{ x: 0, y: 0.6, z: 0, w: 8, d: 8 }];
  const base = MAPS[c.look];
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    theme: base.theme,
    blocks,
    spawns: [spawns, spawns.map((s) => ({ x: -s.x, y: s.y, z: -s.z, yaw: s.yaw + Math.PI }))],
    killY: Math.min(-8, minY - 8),
    extent: { minX, maxX, minZ, maxZ, maxY: Math.max(maxY, 4) },
    zones: zones.map((z) => ({ c: v3(z.x, z.y, z.z), h: v3(z.w / 2, 1.2, z.d / 2) })),
    pads: c.pads.flatMap((p) => [
      { x: p.x, y: p.y, z: p.z, r: 1.2, vx: p.vx, vy: p.vy, vz: p.vz },
      { x: -p.x, y: p.y, z: -p.z, r: 1.2, vx: -p.vx, vy: p.vy, vz: -p.vz },
    ]),
    props: [],
  };
}

const data = new Map<string, CustomMap>();

/** Makes a custom map playable by id (replacing an older copy). Returns the clean data, or null if it was refused. */
export function registerCustomMap(raw: unknown): CustomMap | null {
  const c = sanitizeCustomMap(raw);
  if (!c) return null;
  data.set(c.id, c);
  MAPS[c.id] = buildCustomMap(c);
  return c;
}

export function removeCustomMap(id: MapId) {
  if (!data.delete(id)) return;
  delete MAPS[id];
}

/** The data of a custom map, or undefined for a built-in one. Hosts send this to guests. */
export const customMapData = (id: MapId): CustomMap | undefined => data.get(id);
