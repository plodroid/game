import type { Vec3 } from '../vec';

export type MaterialId = 'floor' | 'wall' | 'metal' | 'trim' | 'glass' | 'base' | 'crate' | 'island' | 'invisible';

/** Oriented box. Every collidable, paintable piece of a map is one of these. */
export interface Block {
  c: Vec3;
  /** Half extents. */
  h: Vec3;
  yaw: number;
  /** Tilt around the local X axis (ramps). */
  pitch: number;
  mat: MaterialId;
  paint: boolean;
  solid: boolean;
  visible: boolean;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface JumpPad {
  x: number;
  y: number;
  z: number;
  r: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface ZoneDef {
  c: Vec3;
  h: Vec3;
}

/** Visual-only decoration, rendered by the client and ignored by the simulation. */
export interface PropDef {
  kind: 'building' | 'tank' | 'antenna' | 'billboard' | 'lamp' | 'cloud' | 'crystal' | 'tree' | 'rock' | 'panel' | 'pipe';
  x: number;
  y: number;
  z: number;
  s: number;
  yaw?: number;
  h?: number;
}

export interface MapTheme {
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  fog: number;
  sunColor: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  ambient: number;
  ground: number;
  materials: Record<MaterialId, number>;
  indoor?: boolean;
  /** Summer look (visual only). Cloud cover, 0 … 1. */
  clouds?: number;
  /** Haze in the air: about 1.6 crisp and deep blue … 6 milky. */
  haze?: number;
  /** Sea level; null when no sea is in view (indoor). Default: just under the arena floor. */
  sea?: number | null;
  /** Radius of a beach island under the arena, for maps that stand high above the sea. */
  land?: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  description: string;
  theme: MapTheme;
  blocks: Block[];
  spawns: [SpawnPoint[], SpawnPoint[]];
  killY: number;
  /** Rough playable extent used for camera/shadow framing and bot sampling. */
  extent: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
  zones: ZoneDef[];
  pads: JumpPad[];
  props: PropDef[];
}

export type BuiltinMapId = 'skyline' | 'core' | 'float' | 'docks' | 'gardens' | 'canyon' | 'arcade';
/** A built-in map, or a player-made one ("c-…"). */
export type MapId = string;
