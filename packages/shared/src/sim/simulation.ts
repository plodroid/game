import { BotBrain } from '../bots/brain';
import { NavGraph } from '../bots/nav';
import { DT, FEET_OFFSET, MAX_HP, MAX_INK, type Team } from '../constants';
import { MODES, type ModeId } from '../config/modes';
import { SPECIAL_CHARGE_AREA } from '../config/specials';
import type { WeaponId } from '../config/weapons';
import { MAPS, type MapDef, type MapId } from '../maps';
import { set, v3, type Vec3 } from '../vec';
import { GameWorld, initPhysics } from '../world/world';
import { collectLaunchers, stepProjectiles, updateCombat, updateEffects, type Effect, type Projectile } from './combat';
import { PAINT_KIND, type SimEvent } from './events';
import { initialModeState, RULES, type ModeRules, type ModeState } from './modes';
import { stepMovement, type Launcher } from './movement';
import { createPlayerState, emptyInput, type Input, type PlayerInfo, type SimPlayer } from './player';

export interface MatchConfig {
  map: MapId;
  mode: ModeId;
  /** Seconds; 0 = untimed (practice). */
  duration: number;
  seed: number;
}

export type Phase = 'intro' | 'playing' | 'ending' | 'ended';
export const INTRO_TIME = 3.5;
export const OUTRO_TIME = 2.6;

/** Shared knowledge for a team's bots. */
export interface TeamBoard {
  claims: Map<number, Vec3>;
  distress: Map<number, number>;
}

export interface PlayerResult {
  id: number;
  name: string;
  team: Team;
  bot: boolean;
  weapon: WeaponId;
  kills: number;
  deaths: number;
  assists: number;
  paint: number;
  specials: number;
  uid?: string;
}

export interface MatchResult {
  winner: -1 | 0 | 1;
  coverage: [number, number];
  score: [number, number];
  mode: ModeId;
  map: MapId;
  duration: number;
  players: PlayerResult[];
}

const IDLE = emptyInput();

/** Authoritative match simulation. Runs offline in the browser and online on the server. */
export class Simulation {
  readonly world: GameWorld;
  readonly map: MapDef;
  readonly rules: ModeRules;
  readonly modeState: ModeState;
  readonly players: SimPlayer[] = [];
  readonly projectiles: Projectile[] = [];
  readonly effects: Effect[] = [];
  readonly boards: [TeamBoard, TeamBoard] = [
    { claims: new Map(), distress: new Map() },
    { claims: new Map(), distress: new Map() },
  ];
  readonly inputs = new Map<number, Input>();
  readonly bots = new Map<number, BotBrain>();
  events: SimEvent[] = [];
  phase: Phase = 'intro';
  phaseT = INTRO_TIME;
  timeLeft: number;
  tick = 0;
  time = 0;
  played = 0;
  paintSeq = 0;
  result: MatchResult | null = null;
  private idCounter = 1;
  private launchers: Launcher[] = [];
  private navGraph: NavGraph | null = null;

  static async create(config: MatchConfig, players: PlayerInfo[]) {
    await initPhysics();
    return new Simulation(config, players);
  }

  /** Requires initPhysics() to have resolved. */
  constructor(
    readonly config: MatchConfig,
    players: PlayerInfo[],
  ) {
    this.map = MAPS[config.map];
    this.world = new GameWorld(this.map);
    this.rules = RULES[config.mode];
    this.modeState = initialModeState(config.mode, this.map.zones.length);
    this.timeLeft = config.duration;
    for (const info of players) this.addPlayer(info);
  }

  get nav(): NavGraph {
    return (this.navGraph ??= new NavGraph(this.world));
  }
  nextId() {
    return this.idCounter++;
  }
  emit(e: SimEvent) {
    this.events.push(e);
  }
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
  byId(id: number): SimPlayer | undefined {
    for (const p of this.players) if (p.id === id) return p;
    return undefined;
  }

  addPlayer(info: PlayerInfo): SimPlayer {
    const used = new Set(this.players.filter((p) => p.team === info.team).map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const p: SimPlayer = {
      ...createPlayerState(info),
      info,
      collider: this.world.createPlayerCollider(),
      stats: { kills: 0, deaths: 0, assists: 0, paint: 0, specials: 0 },
      damagedBy: new Map(),
      rollAt: v3(),
      slot,
    };
    this.players.push(p);
    this.placeAtSpawn(p);
    this.setBot(p.id, info.bot ? (info.difficulty ?? 'normal') : null);
    return p;
  }

  removePlayer(id: number) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.world.removeCollider(this.players[i].collider);
    this.players.splice(i, 1);
    this.bots.delete(id);
    this.inputs.delete(id);
    for (const b of this.boards) {
      b.claims.delete(id);
      b.distress.delete(id);
    }
  }

  /** Hands a player to the AI (e.g. on disconnect) or back to a human with `null`. */
  setBot(id: number, difficulty: PlayerInfo['difficulty'] | null) {
    const p = this.byId(id);
    if (!p) return;
    p.info.bot = difficulty != null;
    if (difficulty) {
      p.info.difficulty = difficulty;
      this.bots.set(id, new BotBrain(id, p.info.dummy ? 'dummy' : difficulty, (this.config.seed ^ (id * 7919)) >>> 0));
    } else this.bots.delete(id);
  }

  setInput(id: number, inp: Input) {
    this.inputs.set(id, inp);
  }

  private placeAtSpawn(p: SimPlayer) {
    const sp = this.map.spawns[p.team][p.slot % this.map.spawns[p.team].length];
    set(p.pos, sp.x, sp.y + FEET_OFFSET + 0.05, sp.z);
    set(p.vel, 0, 0, 0);
    p.yaw = p.aimYaw = sp.yaw;
    p.pitch = p.aimPitch = 0;
    p.collider.setTranslation(p.pos);
    p.grounded = false;
  }

  private respawn(p: SimPlayer) {
    this.placeAtSpawn(p);
    p.alive = true;
    p.hp = MAX_HP;
    p.ink = MAX_INK;
    p.spawnProtect = 2.5;
    p.diving = p.swimming = p.climbing = false;
    p.surgeT = p.disruptedT = p.slideT = p.dodgeT = 0;
    p.fireCd = 0.3;
    this.emit({ t: 'spawn', id: p.id });
  }

  kill(v: SimPlayer, by: number, w: WeaponId | 'fall' | 'special') {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.respawnT = MODES[this.config.mode].respawnTime;
    v.diving = v.swimming = v.climbing = false;
    v.stats.deaths++;
    v.charge *= 0.5;
    const killer = by >= 0 && by !== v.id ? this.byId(by) : undefined;
    if (killer) {
      killer.stats.kills++;
      killer.charge = Math.min(1, killer.charge + 0.12);
    }
    for (const [aid, t] of v.damagedBy) {
      if (aid === by || this.time - t > 5) continue;
      const a = this.byId(aid);
      if (a) {
        a.stats.assists++;
        a.charge = Math.min(1, a.charge + 0.06);
      }
    }
    v.damagedBy.clear();
    if (killer) this.paint(v.pos.x, v.pos.y - FEET_OFFSET + 0.3, v.pos.z, 2.2, killer.team, PAINT_KIND.DEATH, killer.id);
    this.emit({ t: 'kill', id: v.id, by: killer ? killer.id : -1, w });
  }

  /** Applies paint with centimetre-quantised parameters so every peer reproduces identical cells. */
  paint(x: number, y: number, z: number, r: number, team: Team, kind: number, by: number): number {
    if (this.phase !== 'playing') return 0;
    const q = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 };
    const qr = Math.round(r * 100) / 100;
    const claimed = this.world.grid.paintSphere(q, qr, team);
    this.emit({ t: 'paint', seq: ++this.paintSeq, x: q.x, y: q.y, z: q.z, r: qr, team, kind });
    const p = by >= 0 ? this.byId(by) : undefined;
    if (p && p.team === team) {
      p.stats.paint += claimed;
      if (p.surgeT <= 0) p.charge = Math.min(1, p.charge + claimed / SPECIAL_CHARGE_AREA);
    }
    return claimed;
  }

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.emit({ t: 'phase', phase });
  }

  /** Advances one fixed tick (DT). */
  step() {
    const dt = DT;
    this.tick++;
    this.time += dt;
    if (this.phase === 'intro') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.setPhase('playing');
    } else if (this.phase === 'playing') {
      this.played += dt;
      if (this.config.duration > 0) this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.rules.tick(this, dt);
      if ((this.config.duration > 0 && this.timeLeft <= 0) || this.rules.finished(this)) {
        this.result = this.computeResult();
        this.projectiles.length = 0;
        this.setPhase('ending');
        this.phaseT = OUTRO_TIME;
      }
    } else if (this.phase === 'ending') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.setPhase('ended');
    }
    if (this.phase === 'ended') return;

    const frozen = this.phase !== 'playing';
    for (const [id, brain] of this.bots) {
      const p = this.byId(id);
      if (p) this.inputs.set(id, brain.update(this, p, dt));
    }
    collectLaunchers(this, this.launchers);
    for (const p of this.players) {
      const inp = this.inputs.get(p.id) ?? IDLE;
      p.lastSeq = inp.seq;
      if (!p.alive) {
        p.prevButtons = inp.buttons;
        if (!frozen) {
          p.respawnT -= dt;
          if (p.respawnT <= 0) {
            if (this.rules.allowRespawn(this, p)) this.respawn(p);
            else p.respawnT = 0.5;
          }
        }
        continue;
      }
      if (!frozen) updateCombat(this, p, inp, dt);
      stepMovement(this.world, p, p.collider, inp, dt, frozen, this.launchers);
      if (p.pos.y < this.map.killY) {
        let last = -1, lastT = this.time - 6;
        for (const [aid, t] of p.damagedBy) if (t > lastT) (last = aid), (lastT = t);
        this.kill(p, last, 'fall');
      }
    }
    if (!frozen) {
      stepProjectiles(this, dt);
      updateEffects(this, dt);
    }
  }

  private computeResult(): MatchResult {
    return {
      winner: this.rules.winner(this),
      coverage: this.world.grid.coverage(),
      score: this.rules.score(this),
      mode: this.config.mode,
      map: this.config.map,
      duration: Math.round(this.played),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.info.name,
        team: p.team,
        bot: p.info.bot,
        weapon: p.weapon,
        kills: p.stats.kills,
        deaths: p.stats.deaths,
        assists: p.stats.assists,
        paint: Math.round(p.stats.paint),
        specials: p.stats.specials,
        uid: p.info.uid,
      })),
    };
  }

  dispose() {
    this.world.dispose();
  }
}
