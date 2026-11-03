import type RAPIER from '@dimforge/rapier3d-compat';
import { MAX_HP, MAX_INK, type Team } from '../constants';
import type { Cosmetics } from '../config/cosmetics';
import type { BotDifficulty } from '../config/modes';
import type { SpecialId } from '../config/specials';
import type { WeaponId } from '../config/weapons';
import { v3, type Vec3 } from '../vec';

export const BTN = {
  FIRE: 1,
  JUMP: 2,
  DIVE: 4,
  SPRINT: 8,
  SLIDE: 16,
  DODGE: 32,
  SPECIAL: 64,
  EMOTE: 128,
} as const;
export const BTN_MASK = 255;

/** One fixed-tick worth of player intent. Identical for humans and bots. */
export interface Input {
  seq: number;
  /** Camera-relative stick: x = strafe right, z = forward. Range -1..1. */
  mx: number;
  mz: number;
  /** View angles: movement is relative to yaw. */
  yaw: number;
  pitch: number;
  /** Firing direction from the muzzle (crosshair-corrected). */
  aimYaw: number;
  aimPitch: number;
  buttons: number;
}

export const emptyInput = (): Input => ({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, aimYaw: 0, aimPitch: 0, buttons: 0 });

export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  weapon: WeaponId;
  special: SpecialId;
  bot: boolean;
  difficulty?: BotDifficulty;
  /** Practice target: walks to a spot and never fires. */
  dummy?: boolean;
  cosmetics: Cosmetics;
  /** Verified account id (server-side only). */
  uid?: string;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  paint: number;
  specials: number;
}

/** Everything the movement/combat step reads or writes. Must round-trip over the network for prediction. */
export interface PlayerState {
  id: number;
  team: Team;
  weapon: WeaponId;
  special: SpecialId;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  aimYaw: number;
  aimPitch: number;
  grounded: boolean;
  diving: boolean;
  swimming: boolean;
  climbing: boolean;
  onEnemyPaint: boolean;
  airJumps: number;
  /** Seconds since last grounded. */
  airTime: number;
  jumpBuffer: number;
  slideT: number;
  slideCd: number;
  dodgeT: number;
  dodgeCd: number;
  dodgeDir: Vec3;
  /** Seconds since landing (animation + landing lag). */
  landT: number;
  hp: number;
  ink: number;
  /** Special meter 0..1. */
  charge: number;
  surgeT: number;
  disruptedT: number;
  fireCd: number;
  firing: boolean;
  rolling: boolean;
  /** Seconds since last shot; drives ink regen delay and animation. */
  sinceFire: number;
  regenDelay: number;
  alive: boolean;
  respawnT: number;
  spawnProtect: number;
  emoteT: number;
  shots: number;
  prevButtons: number;
  lastSeq: number;
}

export function createPlayerState(info: PlayerInfo): PlayerState {
  return {
    id: info.id,
    team: info.team,
    weapon: info.weapon,
    special: info.special,
    pos: v3(),
    vel: v3(),
    yaw: 0,
    pitch: 0,
    aimYaw: 0,
    aimPitch: 0,
    grounded: false,
    diving: false,
    swimming: false,
    climbing: false,
    onEnemyPaint: false,
    airJumps: 1,
    airTime: 0,
    jumpBuffer: 0,
    slideT: 0,
    slideCd: 0,
    dodgeT: 0,
    dodgeCd: 0,
    dodgeDir: v3(),
    landT: 1,
    hp: MAX_HP,
    ink: MAX_INK,
    charge: 0,
    surgeT: 0,
    disruptedT: 0,
    fireCd: 0,
    firing: false,
    rolling: false,
    sinceFire: 10,
    regenDelay: 0,
    alive: true,
    respawnT: 0,
    spawnProtect: 0,
    emoteT: 0,
    shots: 0,
    prevButtons: 0,
    lastSeq: 0,
  };
}

/** Runtime-only data the simulation attaches to each player. */
export interface SimPlayer extends PlayerState {
  info: PlayerInfo;
  collider: RAPIER.Collider;
  stats: PlayerStats;
  /** attackerId → time of last damage, for assists. */
  damagedBy: Map<number, number>;
  /** Last roller paint position (distance-throttles roll paint). */
  rollAt: Vec3;
  /** Spawn slot within the team. */
  slot: number;
}
