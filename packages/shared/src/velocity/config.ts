import { BOT_DIFFICULTIES, type BotDifficulty } from '../config/modes';

/*
 * VELOCITY: the racing side of CHROMASHIFT. Everything competitive about a car lives here, in one
 * place, so handling is tuned in one file and cosmetics can never change it.
 */

/** Six cars at most in a race, people and bots together. */
export const MAX_RACERS = 6;

/** The six racing identities. Pink and cyan are the shooter's team colours; the others are new. */
export const RACE_IDENTITIES = [
  { name: 'Pink', color: 0xff3f8e, shape: 'circle' },
  { name: 'Cyan', color: 0x19d3be, shape: 'triangle' },
  { name: 'Yellow', color: 0xffc21a, shape: 'square' },
  { name: 'Dark blue', color: 0x2f4fd8, shape: 'diamond' },
  { name: 'Green', color: 0x2fbf4f, shape: 'hexagon' },
  { name: 'Deep red', color: 0xb3122e, shape: 'star' },
] as const;
export type IdentityShape = (typeof RACE_IDENTITIES)[number]['shape'];

/** Road surfaces and how much grip they give (1 = asphalt). */
export type RoadSurface = 'asphalt' | 'dirt' | 'grass' | 'sand' | 'ice' | 'snow' | 'metal';
export const SURFACE_GRIP: Record<RoadSurface, number> = {
  asphalt: 1,
  metal: 0.95,
  dirt: 0.78,
  sand: 0.66,
  grass: 0.62,
  snow: 0.58,
  ice: 0.42,
};
/** Rolling drag per surface (soft ground slows you down). */
export const SURFACE_DRAG: Record<RoadSurface, number> = { asphalt: 0, metal: 0, dirt: 0.12, sand: 0.35, grass: 0.3, snow: 0.22, ice: 0 };

/**
 * Handling. Every car shares these: bodies and parts are cosmetic, so nobody buys speed.
 * The owner can tune them for everyone (config/velocity), within the bounds in `HANDLING_LIMITS`.
 */
export interface Handling {
  /** kg */
  mass: number;
  /** Peak drive force at low speed, N. */
  engine: number;
  /** m/s */
  topSpeed: number;
  reverseSpeed: number;
  /** Brake force, N. */
  brake: number;
  /** Steering lock at low speed and at top speed, radians. */
  steerLow: number;
  steerHigh: number;
  /** How fast the wheels turn towards the stick, rad/s. */
  steerRate: number;
  /** Tyre friction coefficient (arcade: above 1). */
  grip: number;
  /** Rear grip while the handbrake is held (drifting). */
  driftGrip: number;
  /** Extra yaw authority while drifting. */
  driftYaw: number;
  /** Spring stiffness N/m and damping N·s/m per wheel; rest length m. */
  spring: number;
  damper: number;
  rest: number;
  /** Air control torque factor. */
  air: number;
  /** Downforce per (m/s)². */
  downforce: number;
  /** Drag per (m/s)². */
  drag: number;
  /** Boost force, N. */
  boost: number;
}

export const DEFAULT_HANDLING: Handling = {
  mass: 1150,
  engine: 11800,
  topSpeed: 47,
  reverseSpeed: 13,
  brake: 17000,
  steerLow: 0.58,
  steerHigh: 0.16,
  steerRate: 3.4,
  grip: 1.55,
  driftGrip: 0.42,
  driftYaw: 1.0,
  spring: 46000,
  damper: 4200,
  rest: 0.36,
  air: 1,
  downforce: 3.2,
  drag: 0.62,
  boost: 9000,
};

export const HANDLING_LIMITS: Record<keyof Handling, [number, number]> = {
  mass: [600, 2500],
  engine: [4000, 30000],
  topSpeed: [20, 80],
  reverseSpeed: [4, 25],
  brake: [5000, 40000],
  steerLow: [0.2, 0.9],
  steerHigh: [0.05, 0.5],
  steerRate: [1, 8],
  grip: [0.6, 3],
  driftGrip: [0.15, 1],
  driftYaw: [0, 3],
  spring: [15000, 120000],
  damper: [800, 15000],
  rest: [0.15, 0.7],
  air: [0, 3],
  downforce: [0, 12],
  drag: [0.1, 2],
  boost: [0, 25000],
};

/** Owner overrides, clamped into safe bounds. */
export function sanitizeHandling(raw: unknown): Handling {
  const out = { ...DEFAULT_HANDLING };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(out) as (keyof Handling)[]) {
    const v = Number((raw as Record<string, unknown>)[k]);
    if (Number.isFinite(v)) out[k] = Math.min(HANDLING_LIMITS[k][1], Math.max(HANDLING_LIMITS[k][0], v));
  }
  return out;
}

/** Car body box (the same for every body, so collisions are fair). Half extents, metres. */
export const CAR_HALF = { x: 0.95, y: 0.42, z: 2.15 };
/** Wheel mounts relative to the body centre: x out, y down, z forward. */
export const WHEEL_X = 0.86;
export const WHEEL_Z = 1.38;
export const WHEEL_Y = -0.18;
export const WHEEL_R = 0.36;

/** Race presets: Classic is pure racing; Arcade adds pickups. */
export type RacePreset = 'classic' | 'arcade';
/** Damage: off, looks only, or looks plus balanced handling penalties. */
export type DamageMode = 'off' | 'visual' | 'full';

export interface RaceSettings {
  track: string;
  laps: number;
  preset: RacePreset;
  damage: DamageMode;
  /** Bots filling empty grid slots (0–5). */
  bots: number;
  difficulty: BotDifficulty;
}

export const DEFAULT_RACE_SETTINGS: RaceSettings = { track: 'coastal', laps: 3, preset: 'classic', damage: 'full', bots: 5, difficulty: 'normal' };

export const LAP_OPTIONS = [1, 2, 3, 4, 5, 7, 10];

export function sanitizeRaceSettings(s: Partial<RaceSettings> | undefined, isTrack: (id: string) => boolean, base = DEFAULT_RACE_SETTINGS): RaceSettings {
  return {
    track: typeof s?.track === 'string' && isTrack(s.track) ? s.track : base.track,
    laps: LAP_OPTIONS.includes(Number(s?.laps)) ? Number(s!.laps) : base.laps,
    preset: s?.preset === 'arcade' || s?.preset === 'classic' ? s.preset : base.preset,
    damage: s?.damage === 'off' || s?.damage === 'visual' || s?.damage === 'full' ? s.damage : base.damage,
    bots: Number.isInteger(s?.bots) ? Math.max(0, Math.min(MAX_RACERS - 1, s!.bots!)) : base.bots,
    difficulty: BOT_DIFFICULTIES.includes(s?.difficulty as BotDifficulty) ? s!.difficulty! : base.difficulty,
  };
}

/** Seconds the race keeps going for the rest of the field once the winner finishes. */
export const FINISH_GRACE = 30;
/** Countdown before the lights go green. */
export const COUNTDOWN = 3;
