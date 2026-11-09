import type { Team } from '../constants';
import type { Cosmetics } from '../config/cosmetics';
import type { BotDifficulty, ModeId } from '../config/modes';
import { SPECIAL_IDS, type SpecialId } from '../config/specials';
import { WEAPON_IDS, type WeaponId } from '../config/weapons';
import type { CustomMap } from '../maps/custom';
import type { MapId } from '../maps';
import type { Effect } from '../sim/combat';
import type { SimEvent } from '../sim/events';
import { BTN_MASK, type Input, type PlayerInfo, type PlayerState } from '../sim/player';
import type { MatchConfig, MatchResult, Phase } from '../sim/simulation';
import { clamp, wrapAngle } from '../vec';

/** Message type ids. Client → server and server → client share one namespace. */
export const MSG = {
  INPUT: 'in',
  READY: 'ready',
  LOADOUT: 'loadout',
  TEAM: 'team',
  SETTINGS: 'settings',
  START: 'start',
  BALANCE: 'balance',
  TO_LOBBY: 'toLobby',
  LOBBY: 'lobby',
  MATCH: 'match',
  SNAP: 'snap',
  SYNC: 'sync',
  END: 'end',
  NOTICE: 'notice',
  /** Text chat: client → host { text, team }, host → clients ChatLine. */
  CHAT: 'chat',
  /** Admin command line: client to host { line, token? }; the host answers with NOTICE. */
  CMD: 'cmd',
  /** Admin modifiers of every player: host to clients { [pid]: { speed, size, god } }. */
  MODS: 'mods',
  /** Items, coins or XP granted by an admin: host to that player's client. */
  GRANT: 'grant',
  /** A random-server player says they want another match: client → host. */
  AGAIN: 'again',
} as const;

export const CHAT_MAX = 120;

export interface ChatLine {
  id: number;
  name: string;
  team: number;
  text: string;
  /** Sent to the sender's team only. */
  toTeam: boolean;
}

/** Cleans a chat line: printable characters only, trimmed, length-capped. */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

export interface LobbySettings {
  map: MapId;
  mode: ModeId;
  duration: number;
  botFill: boolean;
  botDifficulty: BotDifficulty;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  team: Team;
  ready: boolean;
  weapon: WeaponId;
  special: SpecialId;
  cosmetics: Cosmetics;
  bot: boolean;
  connected: boolean;
  /** Signed in with a verified account on this server. */
  verified: boolean;
  /** The game's owner, shown in white. */
  admin?: boolean;
}

export interface LobbyState {
  code: string;
  phase: 'lobby' | 'match' | 'results';
  hostId: number;
  quick: boolean;
  /** A skill-matched random server: players who tap Play again are carried into the next lobby. */
  random?: boolean;
  settings: LobbySettings;
  players: LobbyPlayer[];
  /** Quick Play: seconds until the match auto-starts. */
  startsIn?: number;
}

export interface JoinOptions {
  name: string;
  protocol: number;
  token?: string;
  weapon: WeaponId;
  special: SpecialId;
  cosmetics: Cosmetics;
  quick?: boolean;
}

export interface MatchStart {
  config: MatchConfig;
  players: Omit<PlayerInfo, 'uid'>[];
  you: number;
  /** The map's data when it is a player-made one, so guests can build it too. */
  mapDef?: CustomMap;
}

export interface MatchEnd {
  result: MatchResult;
  /** XP awarded per player id. */
  xp: Record<number, number>;
  /** True when results were written to verified profiles. */
  recorded: boolean;
}

export interface Snapshot {
  /** Server tick. */
  k: number;
  ph: number;
  /** Time left ×10. */
  tl: number;
  /** Phase timer ×10. */
  pt: number;
  /** HUD score ×100. */
  sc: [number, number];
  /** Zone holders. */
  ho: number[];
  p: number[][];
  e: number[][];
  fx: number[][];
  /** Scoreboard rows [id, kills, deaths, assists, paint], sent about once a second. */
  st?: number[][];
}

export const PHASES: Phase[] = ['intro', 'playing', 'ending', 'ended'];
const EFFECT_KINDS: Effect['kind'][] = ['shield', 'beacon', 'nova', 'disrupt'];
const KILL_CAUSES = [...WEAPON_IDS, 'fall', 'special'] as const;
const F = { grounded: 1, diving: 2, swimming: 4, climbing: 8, enemy: 16, alive: 32, firing: 64, rolling: 128 };

const finite = (a: unknown[]) => a.every((x) => typeof x === 'number' && Number.isFinite(x));
const q = (v: number, s: number) => Math.round(v * s);

export function packInput(i: Input): number[] {
  return [i.seq, q(i.mx, 100), q(i.mz, 100), q(i.yaw, 1e4), q(i.pitch, 1e4), q(i.aimYaw, 1e4), q(i.aimPitch, 1e4), i.buttons, i.emote ?? 0];
}

/** Validates and clamps an untrusted input. Returns false for malformed data. */
export function unpackInput(a: unknown, out: Input): boolean {
  if (!Array.isArray(a) || a.length < 8 || a.length > 9 || !finite(a)) return false;
  out.seq = a[0] | 0;
  out.mx = clamp(a[1] / 100, -1, 1);
  out.mz = clamp(a[2] / 100, -1, 1);
  out.yaw = wrapAngle(a[3] / 1e4);
  out.pitch = clamp(a[4] / 1e4, -1.5, 1.5);
  out.aimYaw = wrapAngle(a[5] / 1e4);
  out.aimPitch = clamp(a[6] / 1e4, -1.55, 1.55);
  out.buttons = a[7] & BTN_MASK;
  out.emote = clamp((a[8] ?? 0) | 0, 0, 7);
  return true;
}

export function packPlayer(p: PlayerState): number[] {
  const flags =
    (p.grounded ? F.grounded : 0) |
    (p.diving ? F.diving : 0) |
    (p.swimming ? F.swimming : 0) |
    (p.climbing ? F.climbing : 0) |
    (p.onEnemyPaint ? F.enemy : 0) |
    (p.alive ? F.alive : 0) |
    (p.firing ? F.firing : 0) |
    (p.rolling ? F.rolling : 0);
  return [
    p.id, q(p.pos.x, 1000), q(p.pos.y, 1000), q(p.pos.z, 1000), q(p.vel.x, 1000), q(p.vel.y, 1000), q(p.vel.z, 1000),
    q(p.yaw, 1e4), q(p.pitch, 1e4), flags, q(p.hp, 10), q(p.ink, 10), q(p.charge, 1000), p.lastSeq,
    p.airJumps, q(p.airTime, 1000), q(p.jumpBuffer, 1000), q(p.slideT, 1000), q(p.slideCd, 1000), q(p.dodgeT, 1000),
    q(p.dodgeCd, 1000), q(p.dodgeDir.x, 1000), q(p.dodgeDir.z, 1000), q(p.surgeT, 1000), q(p.disruptedT, 1000),
    q(p.fireCd, 1000), q(p.emoteT, 1000), q(p.respawnT, 1000), q(p.spawnProtect, 1000), p.prevButtons, p.shots,
    q(p.landT, 1000), q(p.sinceFire, 1000), q(p.aimYaw, 1e4), q(p.aimPitch, 1e4), p.emoteSlot,
  ];
}

/** Writes a packed player into `p`. Returns the player id, or -1 if malformed. */
export function unpackPlayer(a: number[], p: PlayerState): number {
  if (!Array.isArray(a) || a.length < 35) return -1;
  p.pos.x = a[1] / 1000;
  p.pos.y = a[2] / 1000;
  p.pos.z = a[3] / 1000;
  p.vel.x = a[4] / 1000;
  p.vel.y = a[5] / 1000;
  p.vel.z = a[6] / 1000;
  p.yaw = a[7] / 1e4;
  p.pitch = a[8] / 1e4;
  const f = a[9];
  p.grounded = !!(f & F.grounded);
  p.diving = !!(f & F.diving);
  p.swimming = !!(f & F.swimming);
  p.climbing = !!(f & F.climbing);
  p.onEnemyPaint = !!(f & F.enemy);
  p.alive = !!(f & F.alive);
  p.firing = !!(f & F.firing);
  p.rolling = !!(f & F.rolling);
  p.hp = a[10] / 10;
  p.ink = a[11] / 10;
  p.charge = a[12] / 1000;
  p.lastSeq = a[13];
  p.airJumps = a[14];
  p.airTime = a[15] / 1000;
  p.jumpBuffer = a[16] / 1000;
  p.slideT = a[17] / 1000;
  p.slideCd = a[18] / 1000;
  p.dodgeT = a[19] / 1000;
  p.dodgeCd = a[20] / 1000;
  p.dodgeDir.x = a[21] / 1000;
  p.dodgeDir.z = a[22] / 1000;
  p.surgeT = a[23] / 1000;
  p.disruptedT = a[24] / 1000;
  p.fireCd = a[25] / 1000;
  p.emoteT = a[26] / 1000;
  p.respawnT = a[27] / 1000;
  p.spawnProtect = a[28] / 1000;
  p.prevButtons = a[29];
  p.shots = a[30];
  p.landT = a[31] / 1000;
  p.sinceFire = a[32] / 1000;
  p.aimYaw = a[33] / 1e4;
  p.aimPitch = a[34] / 1e4;
  p.emoteSlot = (a[35] ?? 0) & 7;
  return a[0];
}

export function packEvent(e: SimEvent): number[] | null {
  switch (e.t) {
    case 'paint':
      return [0, e.seq, q(e.x, 100), q(e.y, 100), q(e.z, 100), q(e.r, 100), e.team, e.kind];
    case 'fire':
      return [1, e.id, WEAPON_IDS.indexOf(e.w), q(e.x, 100), q(e.y, 100), q(e.z, 100), q(e.yaw, 1e4), q(e.pitch, 1e4), e.seed, e.n];
    case 'hit':
      return [2, e.id, e.by, e.dmg];
    case 'kill':
      return [3, e.id, e.by, KILL_CAUSES.indexOf(e.w)];
    case 'spawn':
      return [4, e.id];
    case 'special':
      return [5, e.id, SPECIAL_IDS.indexOf(e.s), q(e.x, 100), q(e.y, 100), q(e.z, 100)];
    case 'blast':
      return [6, q(e.x, 100), q(e.y, 100), q(e.z, 100), e.team, q(e.r, 100)];
    case 'empty':
      return [7, e.id];
    case 'zone':
      return [8, e.zone, e.team];
    case 'phase':
      return [9, PHASES.indexOf(e.phase as Phase)];
  }
}

export function unpackEvent(a: number[]): SimEvent | null {
  if (!Array.isArray(a) || !finite(a)) return null;
  switch (a[0]) {
    case 0:
      return { t: 'paint', seq: a[1], x: a[2] / 100, y: a[3] / 100, z: a[4] / 100, r: a[5] / 100, team: (a[6] ? 1 : 0) as Team, kind: a[7] };
    case 1:
      return { t: 'fire', id: a[1], w: WEAPON_IDS[a[2]] ?? 'pulse', x: a[3] / 100, y: a[4] / 100, z: a[5] / 100, yaw: a[6] / 1e4, pitch: a[7] / 1e4, seed: a[8] >>> 0, n: a[9] };
    case 2:
      return { t: 'hit', id: a[1], by: a[2], dmg: a[3] };
    case 3:
      return { t: 'kill', id: a[1], by: a[2], w: KILL_CAUSES[a[3]] ?? 'fall' };
    case 4:
      return { t: 'spawn', id: a[1] };
    case 5:
      return { t: 'special', id: a[1], s: SPECIAL_IDS[a[2]] ?? 'surge', x: a[3] / 100, y: a[4] / 100, z: a[5] / 100 };
    case 6:
      return { t: 'blast', x: a[1] / 100, y: a[2] / 100, z: a[3] / 100, team: (a[4] ? 1 : 0) as Team, r: a[5] / 100 };
    case 7:
      return { t: 'empty', id: a[1] };
    case 8:
      return { t: 'zone', zone: a[1], team: a[2] };
    case 9:
      return { t: 'phase', phase: PHASES[a[1]] ?? 'playing' };
  }
  return null;
}

export function packEffect(e: Effect): number[] {
  return [e.id, EFFECT_KINDS.indexOf(e.kind), e.team, q(e.pos.x, 100), q(e.pos.y, 100), q(e.pos.z, 100), q(e.t, 100), Math.round(e.hp)];
}

export function unpackEffect(a: number[]): Effect {
  return {
    id: a[0],
    kind: EFFECT_KINDS[a[1]] ?? 'shield',
    team: (a[2] ? 1 : 0) as Team,
    owner: -1,
    pos: { x: a[3] / 100, y: a[4] / 100, z: a[5] / 100 },
    t: a[6] / 100,
    hp: a[7],
  };
}
