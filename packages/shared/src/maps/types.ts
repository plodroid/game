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

export type MapId = 'skyline' | 'core' | 'float' | 'docks' | 'gardens' | 'canyon' | 'arcade';
