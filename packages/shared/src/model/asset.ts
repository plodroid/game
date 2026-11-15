import type { WeaponPart } from '../config/weapons';
import { decodeVoxels, encodeVoxels, VOXEL_MAX, type VoxelGrid } from './voxel';
import type { PolyFace, PolyMesh } from './polymesh';

/*
 * The Studio's asset format (version 1). An asset keeps its editable sources: primitive shapes,
 * voxel grids and polygon meshes in a hierarchy, the materials they use, painted texture layers
 * and named attachment points. The game builds its drawn meshes from this, so an asset can always
 * be reopened and edited; nothing is flattened away on save.
 */

export const ASSET_VERSION = 1;
export type AssetKind = 'weapon' | 'vehicle' | 'accessory' | 'prop' | 'material';
export const ASSET_KINDS: AssetKind[] = ['weapon', 'vehicle', 'accessory', 'prop', 'material'];

/** What a material stands for in the game: team paint, the weapon / car finish, and so on. */
export type MaterialRole = 'none' | 'team' | 'finish' | 'accent' | 'glass' | 'glow';
export const MATERIAL_ROLES: MaterialRole[] = ['none', 'team', 'finish', 'accent', 'glass', 'glow'];

/** A surface look: the fine detail (grain, weave, brushing) laid over the colour. */
export type SurfaceId = 'plain' | 'paint' | 'metal' | 'brushed' | 'rubber' | 'plastic' | 'wood' | 'concrete' | 'stone' | 'fabric' | 'carbon' | 'glass';
export const SURFACES_IDS: SurfaceId[] = ['plain', 'paint', 'metal', 'brushed', 'rubber', 'plastic', 'wood', 'concrete', 'stone', 'fabric', 'carbon', 'glass'];

export interface AssetMaterial {
  name: string;
  color: number;
  rough: number;
  metal: number;
  /** Glow strength, 0 … 4, in the material's colour. */
  emissive: number;
  opacity: number;
  role: MaterialRole;
  surface: SurfaceId;
}

type V3 = [number, number, number];

interface NodeBase {
  id: string;
  name: string;
  /** Parent group's id; absent at the top. */
  parent?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Position, rotation in degrees and scale, relative to the parent. */
  p: V3;
  r: V3;
  s: V3;
}

export type PrimShape = 'box' | 'cyl' | 'sphere' | 'cone' | 'torus' | 'wedge' | 'capsule';
export const PRIM_SHAPES: PrimShape[] = ['box', 'cyl', 'sphere', 'cone', 'torus', 'wedge', 'capsule'];

export interface PrimNode extends NodeBase {
  t: 'prim';
  shape: PrimShape;
  mat: number;
  /** Rounded edges on a box, as a fraction of its smallest side (0 … 0.5). */
  bevel?: number;
}

export interface VoxNode extends NodeBase {
  t: 'vox';
  n: V3;
  /** Metres per voxel. */
  size: number;
  /** Run-length encoded grid; a value k uses materials[k - 1]. */
  data: string;
}

/** Painted texture layers of a mesh (PNG data URLs, square). */
export interface PaintData {
  size: number;
  layers: { name: string; hidden?: boolean; opacity: number; png: string }[];
  /** Optional painted channels: white = rough / metallic / glowing. */
  rough?: string;
  metal?: string;
  glow?: string;
}

export interface MeshNode extends NodeBase {
  t: 'mesh';
  verts: number[];
  faces: PolyFace[];
  /** Edges sharper than this (degrees) stay crisp; 0 is fully faceted. */
  smooth: number;
  paint?: PaintData;
}

export interface GroupNode extends NodeBase {
  t: 'group';
}

export type ModelNode = PrimNode | VoxNode | MeshNode | GroupNode;

export interface ModelAsset {
  v: number;
  id: string;
  kind: AssetKind;
  name: string;
  note: string;
  nodes: ModelNode[];
  materials: AssetMaterial[];
  /** Named points: `muzzle` on a weapon, `mount` on an accessory. */
  points: Record<string, V3>;
  /** Kind-specific settings: an accessory's car slot, a prop's size class. */
  meta: Record<string, string | number | boolean>;
  updatedAt: number;
}

export const ASSET_LIMITS = { nodes: 160, materials: 32, verts: 12000, faces: 12000, paintChars: 360_000, layers: 6, json: 900_000 } as const;
const ID = /^[a-z0-9][a-z0-9-]{1,31}$/;

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
// eslint-disable-next-line no-control-regex
const text = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : d);
const vec = (v: unknown, lo: number, hi: number, d: number): V3 => {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0], lo, hi, d), num(a[1], lo, hi, d), num(a[2], lo, hi, d)];
};
const png = (v: unknown) => (typeof v === 'string' && v.length <= ASSET_LIMITS.paintChars && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : undefined);

export const newAssetId = (kind: AssetKind) => `${kind.slice(0, 3)}-${Math.random().toString(36).slice(2, 9).padEnd(7, '0')}`;
export const newNodeId = () => `n${Math.random().toString(36).slice(2, 9)}`;

export const defaultMaterial = (over: Partial<AssetMaterial> = {}): AssetMaterial => ({ name: 'Material', color: 0x9a93b4, rough: 0.6, metal: 0.1, emissive: 0, opacity: 1, role: 'none', surface: 'plain', ...over });

/** The four materials every weapon starts with, matching the game's team / finish / dark / light. */
export const weaponMaterials = (): AssetMaterial[] => [
  defaultMaterial({ name: 'Finish', color: 0x9a93b4, rough: 0.45, metal: 0.4, role: 'finish', surface: 'paint' }),
  defaultMaterial({ name: 'Team paint', color: 0xff4d94, rough: 0.3, metal: 0, role: 'team', surface: 'plain' }),
  defaultMaterial({ name: 'Polymer', color: 0x2c2a36, rough: 0.8, metal: 0, surface: 'rubber' }),
  defaultMaterial({ name: 'Steel', color: 0xc9ccd6, rough: 0.35, metal: 0.9, surface: 'brushed' }),
];

export function blankAsset(kind: AssetKind, name = 'New asset'): ModelAsset {
  return {
    v: ASSET_VERSION,
    id: newAssetId(kind),
    kind,
    name,
    note: '',
    nodes: [],
    materials: kind === 'weapon' ? weaponMaterials() : [defaultMaterial({ name: 'Base' }), defaultMaterial({ name: 'Accent', color: 0xff4d94, role: kind === 'vehicle' || kind === 'accessory' ? 'accent' : 'none' }), defaultMaterial({ name: 'Dark', color: 0x2c2a36, rough: 0.8 })],
    points: kind === 'weapon' ? { muzzle: [0, 0.12, -0.45] } : {},
    meta: {},
    updatedAt: Date.now(),
  };
}

function cleanMaterial(raw: unknown): AssetMaterial {
  const m = (raw ?? {}) as Partial<AssetMaterial>;
  return {
    name: text(m.name, 24, 'Material') || 'Material',
    color: Math.round(num(m.color, 0, 0xffffff, 0x9a93b4)),
    rough: num(m.rough, 0, 1, 0.6),
    metal: num(m.metal, 0, 1, 0),
    emissive: num(m.emissive, 0, 4, 0),
    opacity: num(m.opacity, 0.05, 1, 1),
    role: MATERIAL_ROLES.includes(m.role as MaterialRole) ? (m.role as MaterialRole) : 'none',
    surface: SURFACES_IDS.includes(m.surface as SurfaceId) ? (m.surface as SurfaceId) : 'plain',
  };
}

function cleanPaint(raw: unknown): PaintData | undefined {
  const p = raw as Partial<PaintData> | undefined;
  if (!p || typeof p !== 'object' || !Array.isArray(p.layers)) return undefined;
  const layers = p.layers
    .slice(0, ASSET_LIMITS.layers)
    .map((l) => ({ name: text(l?.name, 20, 'Layer') || 'Layer', ...(l?.hidden ? { hidden: true } : {}), opacity: num(l?.opacity, 0, 1, 1), png: png(l?.png) ?? '' }))
    .filter((l) => l.png);
  const out: PaintData = { size: [128, 256, 512, 1024].includes(p.size as number) ? (p.size as number) : 256, layers };
  for (const k of ['rough', 'metal', 'glow'] as const) {
    const v = png(p[k]);
    if (v) out[k] = v;
  }
  return layers.length || out.rough || out.metal || out.glow ? out : undefined;
}

function cleanNode(raw: unknown, materials: number, ids: Set<string>): ModelNode | null {
  const n = raw as Partial<ModelNode> & Record<string, unknown>;
  if (!n || typeof n !== 'object') return null;
  let id = text(n.id, 16);
  if (!/^[a-zA-Z0-9]{2,16}$/.test(id) || ids.has(id)) id = newNodeId();
  ids.add(id);
  const base: NodeBase = {
    id,
    name: text(n.name, 28, 'Part') || 'Part',
    ...(typeof n.parent === 'string' ? { parent: text(n.parent, 16) } : {}),
    ...(n.hidden ? { hidden: true } : {}),
    ...(n.locked ? { locked: true } : {}),
    p: vec(n.p, -200, 200, 0),
    r: vec(n.r, -3600, 3600, 0),
    s: vec(n.s, -200, 200, 1),
  };
  const mat = (v: unknown) => Math.round(num(v, 0, Math.max(0, materials - 1), 0));
  switch (n.t) {
    case 'prim':
      return { ...base, t: 'prim', shape: PRIM_SHAPES.includes(n.shape as PrimShape) ? (n.shape as PrimShape) : 'box', mat: mat(n.mat), ...(n.bevel ? { bevel: num(n.bevel, 0, 0.5, 0) } : {}) };
    case 'vox': {
      const dims = vec(n.n, 1, VOXEL_MAX, 16).map(Math.round) as V3;
      const grid = decodeVoxels(dims[0], dims[1], dims[2], n.data);
      // Values past the palette fall back to the first material.
      for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] > materials) grid.cells[i] = 1;
      return { ...base, t: 'vox', n: dims, size: num(n.size, 0.001, 10, 0.05), data: encodeVoxels(grid) };
    }
    case 'mesh': {
      const src = Array.isArray(n.verts) ? n.verts.slice(0, ASSET_LIMITS.verts * 3) : [];
      const verts = src.map((v) => num(v, -500, 500, 0));
      while (verts.length % 3) verts.pop();
      const count = verts.length / 3;
      const faces: PolyFace[] = [];
      for (const f of Array.isArray(n.faces) ? n.faces.slice(0, ASSET_LIMITS.faces) : []) {
        const v = Array.isArray(f?.v) ? f.v.slice(0, 64).filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < count) : [];
        if (v.length >= 3) faces.push({ v, m: mat(f.m) });
      }
      const paint = cleanPaint(n.paint);
      return { ...base, t: 'mesh', verts, faces, smooth: num(n.smooth, 0, 180, 30), ...(paint ? { paint } : {}) };
    }
    case 'group':
      return { ...base, t: 'group' };
    default:
      return null;
  }
}

/** Checks anything that claims to be an asset (storage, the network) and returns a clean copy, or null. */
export function sanitizeAsset(raw: unknown): ModelAsset | null {
  const a = raw as Partial<ModelAsset> | null;
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !ID.test(a.id) || !ASSET_KINDS.includes(a.kind as AssetKind)) return null;
  const materials = (Array.isArray(a.materials) ? a.materials : []).slice(0, ASSET_LIMITS.materials).map(cleanMaterial);
  if (!materials.length) materials.push(defaultMaterial({ name: 'Base' }));
  const ids = new Set<string>();
  const nodes: ModelNode[] = [];
  for (const n of (Array.isArray(a.nodes) ? a.nodes : []).slice(0, ASSET_LIMITS.nodes)) {
    const c = cleanNode(n, materials.length, ids);
    if (c) nodes.push(c);
  }
  // A parent must be a group that exists, and no node may be its own ancestor.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (!n.parent) continue;
    let p = byId.get(n.parent), hops = 0, ok = !!p && p.t === 'group';
    while (ok && p?.parent && hops++ < 32) {
      if (p.parent === n.id) ok = false;
      p = byId.get(p.parent);
    }
    if (!ok || hops >= 32) delete n.parent;
  }
  const points: Record<string, V3> = {};
  if (a.points && typeof a.points === 'object')
    for (const [k, v] of Object.entries(a.points).slice(0, 12)) if (/^[a-z][a-zA-Z0-9]{0,15}$/.test(k)) points[k] = vec(v, -200, 200, 0);
  const meta: ModelAsset['meta'] = {};
  if (a.meta && typeof a.meta === 'object')
    for (const [k, v] of Object.entries(a.meta).slice(0, 16)) {
      if (!/^[a-z][a-zA-Z0-9]{0,15}$/.test(k)) continue;
      if (typeof v === 'string') meta[k] = text(v, 40);
      else if (typeof v === 'number' && Number.isFinite(v)) meta[k] = v;
      else if (typeof v === 'boolean') meta[k] = v;
    }
  return {
    v: ASSET_VERSION,
    id: a.id,
    kind: a.kind as AssetKind,
    name: text(a.name, 28, 'Asset') || 'Asset',
    note: text(a.note, 120),
    nodes,
    materials,
    points,
    meta,
    updatedAt: num(a.updatedAt, 0, 4e12, 0),
  };
}

/** The grid of a voxel node, ready to edit. */
export const nodeGrid = (n: VoxNode): VoxelGrid => decodeVoxels(n.n[0], n.n[1], n.n[2], n.data);
/** The polygon mesh of a mesh node. */
export const nodeMesh = (n: MeshNode): PolyMesh => ({ verts: n.verts, faces: n.faces });

/** Rough size of an asset, for the inspector and for budgets. */
export function assetStats(a: ModelAsset) {
  let voxels = 0, faces = 0, verts = 0, prims = 0;
  for (const n of a.nodes) {
    if (n.t === 'vox') voxels += nodeGrid(n).count();
    else if (n.t === 'mesh') {
      faces += n.faces.length;
      verts += n.verts.length / 3;
    } else if (n.t === 'prim') prims++;
  }
  return { nodes: a.nodes.length, voxels, faces, verts, prims };
}

type Quat = [number, number, number, number];
const D2R = Math.PI / 180;
/** Rotation in degrees (applied X, then Y, then Z in the object's own frame, as three.js does) to a quaternion. */
function eulerQuat([x, y, z]: V3): Quat {
  const c1 = Math.cos((x * D2R) / 2), c2 = Math.cos((y * D2R) / 2), c3 = Math.cos((z * D2R) / 2);
  const s1 = Math.sin((x * D2R) / 2), s2 = Math.sin((y * D2R) / 2), s3 = Math.sin((z * D2R) / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
const quatMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function quatEuler([x, y, z, w]: Quat): V3 {
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  const flat = Math.abs(m13) < 0.9999999;
  const r = (v: number) => Math.round((v / D2R) * 1000) / 1000;
  return [r(flat ? Math.atan2(-m23, m33) : Math.atan2(m32, m22)), r(ey), r(flat ? Math.atan2(-m12, m11) : 0)];
}
/** The rotation that does `b` first, then `a` (both in degrees). */
export const composeEuler = (a: V3, b: V3): V3 => quatEuler(quatMul(eulerQuat(a), eulerQuat(b)));

/**
 * Opens a gun made in the old editor (a list of primitive parts) as an asset, without changing the
 * original: each part becomes a primitive node using the matching weapon material. The old editor's
 * cylinders and cones lay along the barrel; here they stand upright, so those are turned to match.
 */
export function assetFromWeaponParts(id: string, name: string, parts: WeaponPart[], muzzle?: [number, number]): ModelAsset {
  const a = blankAsset('weapon', name);
  a.id = ID.test(id) ? id : a.id;
  const slot = { shell: 0, team: 1, dark: 2, light: 3 } as const;
  a.nodes = parts.map((p, i): PrimNode => {
    const rot: V3 = [p.rx ?? 0, p.ry ?? 0, p.rz ?? 0];
    const lying = p.s === 'cyl' || p.s === 'cone';
    return {
      id: `p${i}`,
      name: p.n ?? `Part ${i + 1}`,
      t: 'prim',
      shape: p.s,
      mat: slot[p.c] ?? 0,
      p: [p.x, p.y, p.z],
      r: lying ? composeEuler(rot, [p.s === 'cyl' ? 90 : -90, 0, 0]) : rot,
      s: lying ? [p.w, p.d, p.h] : [p.w, p.h, p.d],
    };
  });
  if (muzzle) a.points.muzzle = [0, muzzle[0], muzzle[1]];
  return a;
}
