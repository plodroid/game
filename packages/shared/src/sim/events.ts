import type { Team } from '../constants';
import type { SpecialId } from '../config/specials';
import type { WeaponId } from '../config/weapons';

export const PAINT_KIND = { IMPACT: 0, DRIP: 1, ROLL: 2, DEATH: 3, NOVA: 4, TRAIL: 5 } as const;

/**
 * Everything observable that happened during a tick. The host drains these each tick:
 * offline they drive visuals/audio directly; online the server forwards them to clients.
 */
export type SimEvent =
  | { t: 'paint'; seq: number; x: number; y: number; z: number; r: number; team: Team; kind: number }
  | { t: 'fire'; id: number; w: WeaponId; x: number; y: number; z: number; yaw: number; pitch: number; seed: number; n: number }
  | { t: 'hit'; id: number; by: number; dmg: number }
  | { t: 'kill'; id: number; by: number; w: WeaponId | 'fall' | 'special' }
  | { t: 'spawn'; id: number }
  | { t: 'special'; id: number; s: SpecialId; x: number; y: number; z: number }
  | { t: 'blast'; x: number; y: number; z: number; team: Team; r: number }
  | { t: 'empty'; id: number }
  | { t: 'zone'; zone: number; team: number }
  | { t: 'phase'; phase: string };
