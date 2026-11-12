import { create } from 'zustand';
import type { ItemId, RaceResult } from '@chromashift/shared';

/** What the racing HUD shows, refreshed about 15 times a second (never every frame). */
export interface RaceHudState {
  active: boolean;
  phase: 'grid' | 'countdown' | 'racing' | 'ended';
  count: number;
  speed: number;
  rpm: number;
  gear: number;
  lap: number;
  laps: number;
  position: number;
  field: number;
  time: number;
  lapTime: number;
  best: number;
  lastLap: number | null;
  cp: number;
  cps: number;
  wrong: boolean;
  drift: number;
  driftTier: number;
  boostMeter: number;
  boosting: boolean;
  item: ItemId | null;
  finished: boolean;
  finishPos: number;
  damage: number[];
  /** Part index flashed by the latest hit, and when. */
  hit: { part: number; at: number } | null;
  identity: number;
  name: string;
  /** Minimap: track outline (normalised) and cars. */
  dots: { id: number; x: number; z: number; identity: number; me: boolean }[];
  notice: { id: number; text: string; tone: 'good' | 'bad' | 'neutral' } | null;
  board: { id: number; name: string; position: number; identity: number; me: boolean; bot: boolean; gap: string; finished: boolean }[];
  arcade: boolean;
  ping: number | null;
  online: boolean;
  spectating: boolean;
  lookBack: boolean;
}

export const initialRaceHud: RaceHudState = {
  active: false, phase: 'grid', count: 0, speed: 0, rpm: 0, gear: 1, lap: 0, laps: 3, position: 1, field: 1, time: 0, lapTime: 0, best: 0,
  lastLap: null, cp: 0, cps: 1, wrong: false, drift: 0, driftTier: 0, boostMeter: 0, boosting: false, item: null, finished: false, finishPos: 0,
  damage: [], hit: null, identity: 0, name: '', dots: [], notice: null, board: [], arcade: false, ping: null, online: false, spectating: false, lookBack: false,
};

export const useRaceHud = create<RaceHudState>()(() => ({ ...initialRaceHud }));
export const useRaceHud2 = create<RaceHudState>()(() => ({ ...initialRaceHud }));

/** The track outline for the minimap (set once per race). */
export const useRaceMap = create<{ path: string; viewBox: string }>()(() => ({ path: '', viewBox: '0 0 100 100' }));

/** What the HUD can ask of the running race, set by the race code (so the HUD stays light). */
export const raceControl: { finishNow: (() => void) | null; replay: (() => void) | null; leave: (() => void) | null } = { finishNow: null, replay: null, leave: null };

/** The last race's results for the results screen. */
export interface RaceResultsData {
  result: RaceResult;
  you: number;
  xp: number;
  coins: number;
  levelBefore: number;
  xpBefore: number;
  online: boolean;
  recorded: boolean;
  records: string[];
}
export const useRaceResults = create<{ data: RaceResultsData | null }>()(() => ({ data: null }));
