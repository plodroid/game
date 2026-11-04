import { DT, MAX_PLAYERS, TEAM_SIZE, type Team } from '../constants';
import { DEFAULT_COSMETICS, sanitizeCosmetics, type Cosmetics } from '../config/cosmetics';
import { BOT_DIFFICULTIES, DURATION_OPTIONS, MODES, type ModeId } from '../config/modes';
import { SPECIAL_IDS, type SpecialId } from '../config/specials';
import { WEAPON_IDS, type WeaponId } from '../config/weapons';
import { MAP_IDS } from '../maps';
import { emptyInput, type Input, type PlayerInfo } from '../sim/player';
import { Simulation, type MatchResult } from '../sim/simulation';
import { xpForMatch } from '../progression';
import { cleanPlayerName } from '../validation';
import {
  MSG,
  packEffect,
  packEvent,
  packPlayer,
  PHASES,
  unpackInput,
  type LobbyPlayer,
  type LobbySettings,
  type LobbyState,
  type MatchEnd,
  type MatchStart,
  type Snapshot,
} from './protocol';

/** One connection to a room, whatever carries it: a WebSocket server, WebRTC, or an in-page loopback. */
export interface HostClient {
  readonly id: string;
  send(type: string, payload: unknown): void;
}

export interface JoinAuth {
  uid?: string;
  username?: string | null;
}

export interface RoomHostOptions {
  code: string;
  quick?: boolean;
  settings?: Partial<LobbySettings>;
  /** Persists verified results (dedicated servers with Firebase Admin). Resolves true when written. */
  record?: (result: MatchResult, xp: Record<number, number>) => Promise<boolean>;
  /** Called whenever the lobby changes: players, settings or phase. */
  onLobby?: (state: LobbyState) => void;
}

interface Member {
  pid: number;
  name: string;
  uid?: string;
  verified: boolean;
  team: Team;
  ready: boolean;
  weapon: WeaponId;
  special: SpecialId;
  cosmetics: Cosmetics;
  connected: boolean;
  queue: Input[];
  last: Input;
  lastSeq: number;
  lastInputAt: number;
  client: HostClient;
}

const BOT_NAMES = [
  'Rook',
  'Pixel',
  'Mango',
  'Nova',
  'Juno',
  'Kiwi',
  'Echo',
  'Taro',
  'Zest',
  'Moss',
  'Vega',
  'Bolt',
  'Fizz',
  'Lumen',
  'Pico',
  'Sable',
];
const PLAYABLE: ModeId[] = ['turf', 'zones', 'knockout'];
/** A player whose inputs stop arriving (hidden tab, stalled link) stops moving and firing instead of running on. */
const INPUT_STALE_MS = 400;
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export function sanitizeSettings(s: Partial<LobbySettings> | undefined, base?: LobbySettings): LobbySettings {
  const d: LobbySettings = base ?? {
    map: 'skyline',
    mode: 'turf',
    duration: MODES.turf.duration,
    botFill: true,
    botDifficulty: 'normal',
  };
  return {
    map: MAP_IDS.includes(s?.map as never) ? s!.map! : d.map,
    mode: PLAYABLE.includes(s?.mode as never) ? s!.mode! : d.mode,
    duration: DURATION_OPTIONS.includes(Number(s?.duration)) ? Number(s!.duration) : d.duration,
    botFill: typeof s?.botFill === 'boolean' ? s.botFill : d.botFill,
    botDifficulty: BOT_DIFFICULTIES.includes(s?.botDifficulty as never) ? s!.botDifficulty! : d.botDifficulty,
  };
}

/**
 * One lobby + match, independent of how players connect. The simulation here is authoritative:
 * clients only send inputs, and everything they see (movement, hits, paint, score, timer, results)
 * comes from it. Dedicated servers and browser-hosted games both run this class.
 */
export class RoomHost {
  readonly code: string;
  readonly quick: boolean;
  private members = new Map<string, Member>();
  private nextPid = 1;
  private hostId = '';
  private settings: LobbySettings;
  private phaseNow: 'lobby' | 'match' | 'results' = 'lobby';
  private sim: Simulation | null = null;
  private roster: Omit<PlayerInfo, 'uid'>[] = [];
  private acc = 0;
  private ticks = 0;
  private snaps = 0;
  private pending: number[][] = [];
  private autoStartAt = 0;
  private resultsAt = 0;
  private lastLobbyPush = 0;
  private finishing = false;
  private disposed = false;

  constructor(private opts: RoomHostOptions) {
    this.code = opts.code;
    this.quick = !!opts.quick;
    this.settings = sanitizeSettings(opts.settings);
    if (this.quick) this.autoStartAt = Date.now() + 20_000;
  }

  get size() {
    return this.members.size;
  }
  get phase() {
    return this.phaseNow;
  }
  has(id: string) {
    return this.members.has(id);
  }

  join(
    client: HostClient,
    options:
      Partial<{ name: string; weapon: string; special: string; cosmetics: Partial<Cosmetics> }> | undefined,
    auth?: JoinAuth,
  ) {
    const m: Member = {
      pid: this.nextPid++,
      // A verified username can't be spoofed; otherwise use the (sanitised) name the client sent.
      name: cleanPlayerName(auth?.username ?? options?.name, `Player${this.nextPid}`),
      uid: auth?.uid,
      verified: !!auth?.username,
      team: this.emptierTeam(),
      ready: false,
      weapon: WEAPON_IDS.includes(options?.weapon as WeaponId) ? (options!.weapon as WeaponId) : 'pulse',
      special: SPECIAL_IDS.includes(options?.special as SpecialId)
        ? (options!.special as SpecialId)
        : 'surge',
      cosmetics: sanitizeCosmetics(options?.cosmetics ?? DEFAULT_COSMETICS),
      connected: true,
      queue: [],
      last: emptyInput(),
      lastSeq: 0,
      lastInputAt: Date.now(),
      client,
    };
    this.members.set(client.id, m);
    if (!this.hostId) this.hostId = client.id;
    if (this.phaseNow === 'match' && this.sim) this.joinRunning(m);
    this.pushLobby();
    if (this.quick && this.phaseNow === 'lobby' && this.members.size >= MAX_PLAYERS) this.startMatch();
  }

  /** The connection was lost; the seat is kept and a bot covers it until they're back. */
  drop(id: string) {
    const m = this.members.get(id);
    if (!m) return;
    m.connected = false;
    m.queue.length = 0;
    if (this.phaseNow === 'match') this.sim?.setBot(m.pid, this.settings.botDifficulty);
    this.pushLobby();
  }

  /** A dropped player is back on a new connection object with the same id. Their match view kept running. */
  reconnect(client: HostClient) {
    const m = this.members.get(client.id);
    if (!m) return;
    m.connected = true;
    m.client = client;
    m.lastInputAt = Date.now();
    if (this.phaseNow === 'match' && this.sim?.byId(m.pid)) {
      this.sim.setBot(m.pid, null);
      client.send(MSG.SYNC, { rle: this.sim.world.grid.encode() });
    }
    this.pushLobby();
  }

  leave(id: string) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (this.phaseNow === 'match') this.sim?.setBot(m.pid, this.settings.botDifficulty);
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? '';
    this.pushLobby();
  }

  dispose() {
    this.disposed = true;
    this.sim?.dispose();
    this.sim = null;
  }

  private isHost(id: string) {
    return !this.quick && id === this.hostId;
  }

  private emptierTeam(): Team {
    let a = 0,
      b = 0;
    for (const m of this.members.values()) {
      if (m.team === 0) a++;
      else b++;
    }
    return a <= b ? 0 : 1;
  }

  /** Every client message goes through here. Payloads are untrusted and validated field by field. */
  message(id: string, type: string, data: unknown) {
    const m = this.members.get(id);
    if (!m) return;
    const d = (data ?? {}) as Record<string, unknown>;
    switch (type) {
      case MSG.INPUT: {
        if (this.phaseNow !== 'match' || !Array.isArray(data)) return;
        for (const raw of data.slice(0, 10)) {
          const inp = emptyInput();
          // Malformed or replayed inputs are dropped; values are clamped inside unpackInput.
          if (!unpackInput(raw, inp) || inp.seq <= m.lastSeq) continue;
          m.lastSeq = inp.seq;
          m.queue.push(inp);
          m.lastInputAt = Date.now();
        }
        // Keep the buffer short so a lagging client can't build up extra latency.
        while (m.queue.length > 8) m.queue.shift();
        return;
      }
      case MSG.READY:
        if (this.phaseNow !== 'lobby') return;
        m.ready = d.ready === true;
        return this.pushLobby();
      case MSG.LOADOUT:
        if (this.phaseNow === 'match') return;
        if (WEAPON_IDS.includes(d.weapon as WeaponId)) m.weapon = d.weapon as WeaponId;
        if (SPECIAL_IDS.includes(d.special as SpecialId)) m.special = d.special as SpecialId;
        if (d.cosmetics && typeof d.cosmetics === 'object')
          m.cosmetics = sanitizeCosmetics(d.cosmetics as Partial<Cosmetics>);
        return this.pushLobby();
      case MSG.TEAM: {
        if (this.phaseNow !== 'lobby' || (d.team !== 0 && d.team !== 1)) return;
        const target = [...this.members.values()].find((x) => x.pid === d.id);
        if (!target || (target !== m && !this.isHost(id))) return;
        if ([...this.members.values()].filter((x) => x.team === d.team).length >= TEAM_SIZE) return;
        target.team = d.team;
        return this.pushLobby();
      }
      case MSG.SETTINGS:
        if (!this.isHost(id) || this.phaseNow !== 'lobby') return;
        this.settings = sanitizeSettings(d as Partial<LobbySettings>, this.settings);
        return this.pushLobby();
      case MSG.BALANCE:
        if (!this.isHost(id) || this.phaseNow !== 'lobby') return;
        [...this.members.values()].forEach((x, i) => (x.team = (i % 2) as Team));
        return this.pushLobby();
      case MSG.START:
        if (this.isHost(id)) this.startMatch();
        return;
      case MSG.TO_LOBBY:
        if (this.isHost(id) && this.phaseNow === 'results') this.toLobby();
        return;
    }
  }

  private startMatch() {
    if (this.phaseNow !== 'lobby' || !this.members.size) return;
    const s = this.settings;
    const infos: PlayerInfo[] = [...this.members.values()].map((m) => ({
      id: m.pid,
      name: m.name,
      team: m.team,
      weapon: m.weapon,
      special: m.special,
      bot: !m.connected,
      difficulty: s.botDifficulty,
      cosmetics: m.cosmetics,
      uid: m.uid,
    }));
    if (s.botFill) {
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      for (const t of [0, 1] as Team[])
        for (let n = infos.filter((p) => p.team === t).length; n < TEAM_SIZE; n++)
          infos.push({
            id: this.nextPid++,
            name: names.pop() ?? 'Bot',
            team: t,
            weapon: pick(WEAPON_IDS),
            special: pick(SPECIAL_IDS),
            bot: true,
            difficulty: s.botDifficulty,
            cosmetics: {
              ...DEFAULT_COSMETICS,
              hair: pick(['fin', 'spikes', 'bob']),
              headgear: pick(['none', 'cap', 'phones']),
              skin: Math.floor(Math.random() * 6),
            },
          });
    }
    this.sim = new Simulation(
      { map: s.map, mode: s.mode, duration: s.duration, seed: (Math.random() * 2 ** 31) | 0 },
      infos,
    );
    this.roster = infos.map(({ uid: _uid, ...p }) => p);
    this.phaseNow = 'match';
    this.acc = this.ticks = this.snaps = 0;
    this.pending = [];
    this.finishing = false;
    const now = Date.now();
    for (const m of this.members.values()) {
      m.queue.length = 0;
      m.lastSeq = 0;
      m.last = emptyInput();
      m.lastInputAt = now;
      if (m.connected)
        m.client.send(MSG.MATCH, {
          config: this.sim.config,
          players: this.roster,
          you: m.pid,
        } satisfies MatchStart);
    }
    this.pushLobby();
  }

  /** Late joiners take over a bot on the emptier team (or a fresh slot), then get a full paint sync. */
  private joinRunning(m: Member) {
    const sim = this.sim!;
    const bot =
      sim.players.find((p) => p.info.bot && p.team === m.team && !this.ownerOf(p.id)) ??
      sim.players.find((p) => p.info.bot && !this.ownerOf(p.id));
    if (bot) {
      m.pid = bot.id;
      m.team = bot.team;
      m.weapon = bot.weapon;
      m.special = bot.special;
      bot.info.name = m.name;
      bot.info.uid = m.uid;
      sim.setBot(bot.id, null);
    } else if (sim.players.length < MAX_PLAYERS) {
      sim.addPlayer({
        id: m.pid,
        name: m.name,
        team: m.team,
        weapon: m.weapon,
        special: m.special,
        bot: false,
        cosmetics: m.cosmetics,
        uid: m.uid,
      });
    } else return;
    this.roster = sim.players.map((p) => {
      const { uid: _uid, ...info } = p.info;
      return info;
    });
    m.lastInputAt = Date.now();
    m.client.send(MSG.MATCH, { config: sim.config, players: this.roster, you: m.pid } satisfies MatchStart);
    m.client.send(MSG.SYNC, { rle: sim.world.grid.encode() });
  }

  private ownerOf(pid: number) {
    for (const m of this.members.values()) if (m.pid === pid) return m;
    return undefined;
  }

  tick(dtMs: number) {
    const now = Date.now();
    if (this.phaseNow === 'lobby' && this.quick && this.autoStartAt) {
      if (now >= this.autoStartAt && this.members.size) this.startMatch();
      else if (now - this.lastLobbyPush > 1000) this.pushLobby();
    }
    if (this.phaseNow === 'results' && this.resultsAt && now >= this.resultsAt) this.toLobby();
    const sim = this.sim;
    if (this.phaseNow !== 'match' || !sim || this.finishing) return;
    this.acc += Math.min(dtMs, 250) / 1000;
    while (this.acc >= DT) {
      for (const m of this.members.values()) {
        if (!m.connected) continue;
        const next = m.queue.shift();
        if (next) m.last = next;
        else if (now - m.lastInputAt > INPUT_STALE_MS && (m.last.mx || m.last.mz || m.last.buttons))
          m.last = { ...m.last, mx: 0, mz: 0, buttons: 0 };
        sim.setInput(m.pid, m.last);
      }
      sim.step();
      for (const e of sim.drainEvents()) {
        const p = packEvent(e);
        if (p) this.pending.push(p);
      }
      this.acc -= DT;
      if (++this.ticks % 3 === 0 || sim.phase === 'ended') this.snapshot();
      if (sim.phase === 'ended') {
        void this.finish();
        break;
      }
    }
  }

  private snapshot() {
    const sim = this.sim!;
    const snap: Snapshot = {
      k: sim.tick,
      ph: PHASES.indexOf(sim.phase),
      tl: Math.round(sim.timeLeft * 10),
      pt: Math.round(sim.phaseT * 10),
      sc: sim.rules.score(sim).map((v) => Math.round(v * 100)) as [number, number],
      ho: [...sim.modeState.holders],
      p: sim.players.map(packPlayer),
      e: this.pending,
      fx: sim.effects.map(packEffect),
    };
    if (++this.snaps % 20 === 1)
      snap.st = sim.players.map((p) => [
        p.id,
        p.stats.kills,
        p.stats.deaths,
        p.stats.assists,
        Math.round(p.stats.paint),
      ]);
    // The same object goes to everyone, so transports can encode it once.
    for (const m of this.members.values()) if (m.connected) m.client.send(MSG.SNAP, snap);
    this.pending = [];
  }

  private async finish() {
    if (this.finishing || !this.sim?.result) return;
    this.finishing = true;
    const sim = this.sim;
    const r = sim.result!;
    const xp: Record<number, number> = {};
    for (const p of r.players) if (!p.bot) xp[p.id] = xpForMatch(r, p.id);
    const recorded = this.opts.record ? await this.opts.record(r, xp).catch(() => false) : false;
    if (this.disposed) return;
    // Account ids never leave the host.
    const end: MatchEnd = {
      result: { ...r, players: r.players.map(({ uid: _uid, ...p }) => p) },
      xp,
      recorded,
    };
    for (const m of this.members.values()) if (m.connected) m.client.send(MSG.END, end);
    this.phaseNow = 'results';
    this.resultsAt = this.quick ? Date.now() + 15_000 : 0;
    sim.dispose();
    this.sim = null;
    this.pushLobby();
  }

  private toLobby() {
    this.phaseNow = 'lobby';
    this.resultsAt = 0;
    for (const m of this.members.values()) m.ready = false;
    if (this.quick) this.autoStartAt = Date.now() + 20_000;
    this.pushLobby();
  }

  lobbyState(): LobbyState {
    const host = this.members.get(this.hostId);
    const list: LobbyPlayer[] = [...this.members.values()].map((m) => ({
      id: m.pid,
      name: m.name,
      team: m.team,
      ready: m.ready,
      weapon: m.weapon,
      special: m.special,
      cosmetics: m.cosmetics,
      bot: false,
      connected: m.connected,
      verified: m.verified,
    }));
    return {
      code: this.code,
      phase: this.phaseNow,
      hostId: this.quick ? -1 : (host?.pid ?? -1),
      quick: this.quick,
      settings: this.settings,
      players: list,
      startsIn:
        this.quick && this.phaseNow === 'lobby' && this.autoStartAt
          ? Math.max(0, Math.ceil((this.autoStartAt - Date.now()) / 1000))
          : undefined,
    };
  }

  private pushLobby() {
    this.lastLobbyPush = Date.now();
    const state = this.lobbyState();
    for (const m of this.members.values())
      if (m.connected) m.client.send(MSG.LOBBY, { ...state, you: m.pid });
    this.opts.onLobby?.(state);
  }
}
