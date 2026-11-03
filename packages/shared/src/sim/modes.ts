import { KNOCKOUT_TICKETS, ZONE_CAPTURE_SHARE, ZONE_TARGET, type ModeId } from '../config/modes';
import type { SimPlayer } from './player';
import type { Simulation } from './simulation';

/** Per-mode rules. State lives in `sim.modeState` so it can be snapshotted. */
export interface ModeRules {
  /** Called when a dead player's timer expires. Return false to keep them out. */
  allowRespawn(sim: Simulation, p: SimPlayer): boolean;
  tick(sim: Simulation, dt: number): void;
  /** True ends the match before the timer. */
  finished(sim: Simulation): boolean;
  /** Headline numbers per team for the HUD. */
  score(sim: Simulation): [number, number];
  winner(sim: Simulation): -1 | 0 | 1;
}

export interface ModeState {
  /** Zones: remaining count per team. Knockout: tickets per team. */
  counters: [number, number];
  /** Zones: holder per zone (-1 neutral). */
  holders: number[];
}

const byCoverage = (sim: Simulation): -1 | 0 | 1 => {
  const [a, b] = sim.world.grid.coverage();
  return Math.abs(a - b) < 0.01 ? -1 : a > b ? 0 : 1;
};

const turf: ModeRules = {
  allowRespawn: () => true,
  tick: () => {},
  finished: () => false,
  score: (sim) => sim.world.grid.coverage(),
  winner: byCoverage,
};

const zones: ModeRules = {
  allowRespawn: () => true,
  tick(sim, dt) {
    const st = sim.modeState;
    sim.world.grid.zoneCells.forEach((_, z) => {
      const share = sim.world.grid.zoneShare(z);
      const held = st.holders[z];
      for (const t of [0, 1] as const) {
        if (share[t] >= ZONE_CAPTURE_SHARE && held !== t) {
          st.holders[z] = t;
          sim.emit({ t: 'zone', zone: z, team: t });
        }
      }
      if (held >= 0 && share[held] < 0.25) {
        st.holders[z] = -1;
        sim.emit({ t: 'zone', zone: z, team: -1 });
      }
      const h = st.holders[z];
      if (h >= 0) st.counters[h] = Math.max(0, st.counters[h] - dt);
    });
  },
  finished: (sim) => sim.modeState.counters[0] <= 0 || sim.modeState.counters[1] <= 0,
  score: (sim) => [Math.ceil(sim.modeState.counters[0]), Math.ceil(sim.modeState.counters[1])],
  winner(sim) {
    const [a, b] = sim.modeState.counters;
    if (Math.abs(a - b) < 0.5) return byCoverage(sim);
    return a < b ? 0 : 1;
  },
};

const teamAlive = (sim: Simulation, t: number) => sim.players.some((p) => p.team === t && p.alive);

const knockout: ModeRules = {
  allowRespawn(sim, p) {
    const c = sim.modeState.counters;
    if (c[p.team] <= 0) return false;
    c[p.team]--;
    return true;
  },
  tick: () => {},
  finished(sim) {
    const c = sim.modeState.counters;
    return (c[0] <= 0 && !teamAlive(sim, 0)) || (c[1] <= 0 && !teamAlive(sim, 1));
  },
  score: (sim) => [sim.modeState.counters[0], sim.modeState.counters[1]],
  winner(sim) {
    const c = sim.modeState.counters;
    const alive = [0, 1].map((t) => sim.players.filter((p) => p.team === t && p.alive).length);
    const a = c[0] + alive[0], b = c[1] + alive[1];
    if (a !== b) return a > b ? 0 : 1;
    return byCoverage(sim);
  },
};

const practice: ModeRules = { ...turf, winner: () => -1 };

export const RULES: Record<ModeId, ModeRules> = { turf, zones, knockout, practice };

export function initialModeState(mode: ModeId, zoneCount: number): ModeState {
  return {
    counters: mode === 'knockout' ? [KNOCKOUT_TICKETS, KNOCKOUT_TICKETS] : [ZONE_TARGET, ZONE_TARGET],
    holders: Array.from({ length: zoneCount }, () => -1),
  };
}
