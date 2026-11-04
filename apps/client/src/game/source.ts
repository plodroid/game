import {
  DT,
  type Effect,
  type GameWorld,
  type MatchConfig,
  type MatchResult,
  type Phase,
  type PlayerInfo,
  type PlayerState,
  type PlayerStats,
  type SimEvent,
  type Simulation,
  type Team,
  type Vec3,
  type WeaponId,
  v3,
  xpForMatch,
} from '@chromashift/shared';

export interface ViewPlayer {
  id: number;
  info: Omit<PlayerInfo, 'uid'>;
  /** Latest simulation state (authoritative offline, interpolated online). */
  state: PlayerState;
  /** Render position, interpolated between ticks. */
  pos: Vec3;
  stats: PlayerStats;
}

export interface ProjectileView {
  pos: Vec3;
  vel: Vec3;
  team: Team;
  weapon: WeaponId;
}

export interface FrameInput {
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  aimYaw: number;
  aimPitch: number;
  buttons: number;
  /** Clears latched presses once a tick has seen them. */
  consume(): void;
}

export interface MatchOutcome {
  result: MatchResult;
  xp: number;
  recorded: boolean;
}

/** What the match view renders. Implemented by the offline simulation and the network client. */
export interface MatchSource {
  readonly online: boolean;
  readonly world: GameWorld;
  readonly config: MatchConfig;
  readonly localId: number;
  players(): readonly ViewPlayer[];
  projectiles(): Iterable<ProjectileView>;
  effects(): readonly Effect[];
  phase(): Phase;
  phaseT(): number;
  timeLeft(): number;
  score(): [number, number];
  holders(): number[];
  update(dt: number, input: FrameInput): SimEvent[];
  outcome(): MatchOutcome | null;
  ping(): number | null;
  /** True once after the paint grid was replaced wholesale (late join / reconnect). */
  consumeRepaint?(): boolean;
  dispose(): void;
}

/** Runs the full simulation locally (bots, practice, offline play). */
export class OfflineSource implements MatchSource {
  readonly online = false;
  private acc = 0;
  private seq = 0;
  private prev = new Map<number, Vec3>();
  private view: ViewPlayer[] = [];

  constructor(
    readonly sim: Simulation,
    readonly localId: number,
  ) {
    for (const p of sim.players) {
      this.prev.set(p.id, { ...p.pos });
      this.view.push({ id: p.id, info: p.info, state: p, pos: { ...p.pos }, stats: p.stats });
    }
  }

  get world() {
    return this.sim.world;
  }
  get config(): MatchConfig {
    return this.sim.config;
  }

  update(dt: number, inp: FrameInput): SimEvent[] {
    const sim = this.sim;
    this.acc = Math.min(this.acc + dt, 0.2);
    const out: SimEvent[] = [];
    while (this.acc >= DT) {
      for (const p of sim.players) {
        const q = this.prev.get(p.id) ?? v3();
        q.x = p.pos.x;
        q.y = p.pos.y;
        q.z = p.pos.z;
        this.prev.set(p.id, q);
      }
      sim.setInput(this.localId, {
        seq: ++this.seq,
        mx: inp.mx,
        mz: inp.mz,
        yaw: inp.yaw,
        pitch: inp.pitch,
        aimYaw: inp.aimYaw,
        aimPitch: inp.aimPitch,
        buttons: inp.buttons,
      });
      inp.consume();
      sim.step();
      for (const e of sim.drainEvents()) out.push(e);
      this.acc -= DT;
    }
    const a = this.acc / DT;
    for (const v of this.view) {
      const p = v.state, q = this.prev.get(v.id)!;
      // Teleports (respawn) must not smear across the map.
      const jump = Math.abs(p.pos.x - q.x) + Math.abs(p.pos.z - q.z) > 3;
      v.pos.x = jump ? p.pos.x : q.x + (p.pos.x - q.x) * a;
      v.pos.y = jump ? p.pos.y : q.y + (p.pos.y - q.y) * a;
      v.pos.z = jump ? p.pos.z : q.z + (p.pos.z - q.z) * a;
    }
    return out;
  }

  players() {
    return this.view;
  }
  projectiles() {
    return this.sim.projectiles;
  }
  effects() {
    return this.sim.effects;
  }
  phase() {
    return this.sim.phase;
  }
  phaseT() {
    return this.sim.phaseT;
  }
  timeLeft() {
    return this.sim.timeLeft;
  }
  score() {
    return this.sim.rules.score(this.sim);
  }
  holders() {
    return this.sim.modeState.holders;
  }
  outcome(): MatchOutcome | null {
    const r = this.sim.result;
    return r && this.sim.phase === 'ended' ? { result: r, xp: xpForMatch(r, this.localId), recorded: false } : null;
  }
  ping() {
    return null;
  }
  dispose() {
    this.sim.dispose();
  }
}
