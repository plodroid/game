import { DT, MAX_PLAYERS, TEAM_SIZE, type Team } from '../constants';
import { botLook, DEFAULT_COSMETICS, sanitizeCosmetics, type Cosmetics } from '../config/cosmetics';
import { BOT_DIFFICULTIES, DURATION_OPTIONS, MODES, type ModeId } from '../config/modes';
import { SPECIAL_IDS, type SpecialId } from '../config/specials';
import { publicWeapons, WEAPON_IDS, WEAPONS, type WeaponId } from '../config/weapons';
import { MAPS } from '../maps';
import { customMapData } from '../maps/custom';
import { emptyInput, type Input, type PlayerInfo } from '../sim/player';
import { Simulation, type MatchResult } from '../sim/simulation';
import { xpForMatch } from '../progression';
import { runCommand, type Mods } from '../commands';
import { cleanPlayerName } from '../validation';
import { botCar, DEFAULT_CAR, sanitizeCarLoadout, type CarLoadout } from '../velocity/catalog';
import { DEFAULT_RACE_SETTINGS, MAX_RACERS, sanitizeRaceSettings, type Handling } from '../velocity/config';
import { emptyRaceInput, type RaceInput } from '../velocity/car';
import { RaceSim, type RacerInfo } from '../velocity/race';
import { raceSnapshot, unpackRaceInput, xpForRace, type RaceEnd, type RaceStart } from '../velocity/protocol';
import { isTrack, trackDef } from '../velocity/tracks';
import type { RaceEvent } from '../velocity/race';
import {
  cleanChat,
  MSG,
  packEffect,
  packEvent,
  packPlayer,
  PHASES,
  unpackInput,
  type ChatLine,
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
  /** The host has checked that this is the game's owner (who may join a full game, shown in white). */
  admin?: boolean;
}

export interface RoomHostOptions {
  code: string;
  quick?: boolean;
  /** A skill-matched random server: after a match, only players who chose Play again stay for the next one. */
  random?: boolean;
  /** Disconnects a member (the host's transport closes their link). */
  kick?: (id: string) => void;
  settings?: Partial<LobbySettings>;
  /** Persists verified results (dedicated servers with Firebase Admin). Resolves true when written. */
  record?: (result: MatchResult, xp: Record<number, number>) => Promise<boolean>;
  /** Called whenever the lobby changes: players, settings or phase. */
  onLobby?: (state: LobbyState) => void;
  /**
   * Decides whether someone may run admin commands: `owner` (the game's owner), `admin`, or null.
   * Without it nobody can (dedicated servers have no admins).
   */
  authorize?: (who: { isHost: boolean; uid?: string; token?: string }) => Promise<'owner' | 'admin' | null>;
  /** VELOCITY: the owner's handling tuning, if any. */
  raceHandling?: () => Partial<Handling> | null;
}

interface Member {
  pid: number;
  name: string;
  uid?: string;
  verified: boolean;
  admin: boolean;
  team: Team;
  ready: boolean;
  weapon: WeaponId;
  special: SpecialId;
  cosmetics: Cosmetics;
  connected: boolean;
  /** The host's own seat in a world that adopted an offline match: its input comes from the local view. */
  local?: boolean;
  queue: Input[];
  last: Input;
  lastSeq: number;
  lastInputAt: number;
  /** Chat flood control: a small bucket of messages that refills over time. */
  chatTokens: number;
  chatAt: number;
  client: HostClient;
  /** VELOCITY: their car and race inputs. */
  car: CarLoadout;
  rqueue: RaceInput[];
  rlast: RaceInput;
  rLastSeq: number;
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
const PLAYABLE: ModeId[] = ['turf', 'zones', 'knockout', 'blitz', 'rush', 'suddendeath', 'brawl'];
const RACE_BOT_NAMES = ['Dash', 'Nitro', 'Comet', 'Zippy', 'Torque', 'Vroom', 'Apex', 'Drift', 'Sparky', 'Turbo', 'Rally', 'Skid'];
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
    map: typeof s?.map === 'string' && MAPS[s.map] ? s.map : d.map,
    mode: PLAYABLE.includes(s?.mode as never) ? s!.mode! : d.mode,
    duration: DURATION_OPTIONS.includes(Number(s?.duration)) ? Number(s!.duration) : d.duration,
    botFill: typeof s?.botFill === 'boolean' ? s.botFill : d.botFill,
    botDifficulty: BOT_DIFFICULTIES.includes(s?.botDifficulty as never) ? s!.botDifficulty! : d.botDifficulty,
    game: s?.game === 'velocity' || s?.game === 'shooter' ? s.game : (d.game ?? 'shooter'),
    race: sanitizeRaceSettings(s?.race, isTrack, d.race ?? DEFAULT_RACE_SETTINGS),
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
  private mods = new Map<number, Mods>();
  /** Connections made admin with /admin; kept for this room only. */
  private roomAdmins = new Set<string>();
  /** Random servers: who tapped Play again for the next match. */
  private again = new Set<string>();
  /** An offline match whose simulation is stepped by the host's own view; this room only mirrors it to guests. */
  private external = false;
  /** VELOCITY: the running race, its roster and the events since the last snapshot. */
  private race: RaceSim | null = null;
  private raceRoster: Omit<RacerInfo, 'uid'>[] = [];
  private raceEvents: RaceEvent[] = [];

  constructor(private opts: RoomHostOptions) {
    this.code = opts.code;
    this.quick = !!opts.quick;
    this.settings = sanitizeSettings(opts.settings);
    if (this.quick) this.autoStartAt = Date.now() + 20_000;
  }

  get random() {
    return !!this.opts.random;
  }

  /** Puts this room in or out of the random-server pool (changes what happens after a match). */
  setRandom(on: boolean) {
    this.opts.random = on;
    this.pushLobby();
  }

  /**
   * Turns a match already running on the host's device (an offline game) into a room: the simulation
   * keeps going untouched, and guests who join take over bots as if they had been there all along.
   */
  adopt(sim: Simulation, client: HostClient, hostPid: number, hello: Partial<{ name: string; weapon: string; special: string; cosmetics: Partial<Cosmetics> }>, admin = false) {
    const me = sim.byId(hostPid);
    this.sim = sim;
    this.external = true;
    this.phaseNow = 'match';
    this.nextPid = Math.max(0, ...sim.players.map((p) => p.id)) + 1;
    this.settings = sanitizeSettings({ map: sim.config.map, mode: sim.config.mode as ModeId, duration: sim.config.duration });
    this.roster = sim.players.map((p) => {
      const { uid: _uid, ...info } = p.info;
      return info;
    });
    const m: Member = {
      pid: hostPid,
      name: cleanPlayerName(hello.name ?? me?.info.name, 'Host'),
      verified: false,
      admin,
      team: (me?.team ?? 0) as Team,
      ready: true,
      weapon: me?.info.weapon ?? 'pulse',
      special: me?.info.special ?? 'surge',
      cosmetics: me?.info.cosmetics ?? sanitizeCosmetics(hello.cosmetics ?? DEFAULT_COSMETICS),
      connected: true,
      local: true,
      queue: [],
      last: emptyInput(),
      lastSeq: 0,
      lastInputAt: Date.now(),
      chatTokens: 4,
      chatAt: Date.now(),
      client,
      car: DEFAULT_CAR,
      rqueue: [],
      rlast: emptyRaceInput(),
      rLastSeq: 0,
    };
    this.members.set(client.id, m);
    this.hostId = client.id;
    this.pushLobby();
  }

  /** Before each simulation tick of an adopted match: feed in the guests' inputs. */
  externalBefore() {
    const sim = this.sim;
    if (!sim || !this.external || this.phaseNow !== 'match') return;
    const now = Date.now();
    for (const m of this.members.values()) {
      if (!m.connected || m.local) continue;
      const next = m.queue.shift();
      if (next) m.last = next;
      else if (now - m.lastInputAt > INPUT_STALE_MS && (m.last.mx || m.last.mz || m.last.buttons)) m.last = { ...m.last, mx: 0, mz: 0, buttons: 0 };
      sim.setInput(m.pid, m.last);
    }
  }

  /** After each tick: send guests what happened, and finish when the match does. */
  externalAfter(events: Parameters<typeof packEvent>[0][]) {
    const sim = this.sim;
    if (!sim || !this.external || this.phaseNow !== 'match' || this.finishing) return;
    for (const e of events) {
      const p = packEvent(e);
      if (p) this.pending.push(p);
    }
    if (++this.ticks % 3 === 0 || sim.phase === 'ended') this.snapshot();
    if (sim.phase === 'ended') void this.finish();
  }

  /** A real weapon; the owner's own is only for the owner. */
  private weaponOk(w: unknown, admin: boolean) {
    return WEAPON_IDS.includes(w as WeaponId) && (admin || !WEAPONS[w as WeaponId].admin);
  }

  get size() {
    return this.members.size;
  }
  /** How many can be in this room: eight for the shooter, six for VELOCITY. */
  get capacity() {
    return this.settings.game === 'velocity' ? MAX_RACERS : MAX_PLAYERS;
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
      Partial<{ name: string; weapon: string; special: string; cosmetics: Partial<Cosmetics>; car: unknown }> | undefined,
    auth?: JoinAuth,
  ) {
    const m: Member = {
      pid: this.nextPid++,
      // A verified username can't be spoofed; otherwise use the (sanitised) name the client sent.
      name: cleanPlayerName(auth?.username ?? options?.name, `Player${this.nextPid}`),
      uid: auth?.uid,
      verified: !!auth?.username,
      admin: !!auth?.admin,
      team: this.emptierTeam(),
      ready: false,
      weapon: this.weaponOk(options?.weapon, !!auth?.admin) ? (options!.weapon as WeaponId) : 'pulse',
      special: SPECIAL_IDS.includes(options?.special as SpecialId)
        ? (options!.special as SpecialId)
        : 'surge',
      cosmetics: sanitizeCosmetics(options?.cosmetics ?? DEFAULT_COSMETICS),
      connected: true,
      queue: [],
      last: emptyInput(),
      lastSeq: 0,
      lastInputAt: Date.now(),
      chatTokens: 4,
      chatAt: Date.now(),
      client,
      car: sanitizeCarLoadout(options?.car),
      rqueue: [],
      rlast: emptyRaceInput(),
      rLastSeq: 0,
    };
    this.members.set(client.id, m);
    if (!this.hostId) this.hostId = client.id;
    if (this.mods.size) client.send(MSG.MODS, Object.fromEntries(this.mods));
    if (this.phaseNow === 'match' && this.sim) this.joinRunning(m);
    if (this.phaseNow === 'match' && this.race) this.joinRace(m);
    this.pushLobby();
    if (this.quick && this.phaseNow === 'lobby' && this.members.size >= MAX_PLAYERS) this.startMatch();
  }

  /** The connection was lost; the seat is kept and a bot covers it until they're back. */
  drop(id: string) {
    const m = this.members.get(id);
    if (!m) return;
    m.connected = false;
    m.queue.length = 0;
    m.rqueue.length = 0;
    if (this.phaseNow === 'match') this.sim?.setBot(m.pid, this.settings.botDifficulty);
    if (this.phaseNow === 'match') this.race?.setBot(m.pid, this.settings.race?.difficulty ?? 'normal');
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
    if (this.phaseNow === 'match' && this.race?.byId(m.pid)) {
      this.race.setBot(m.pid, null);
      m.rLastSeq = 0;
    }
    this.pushLobby();
  }

  leave(id: string) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (this.phaseNow === 'match') this.sim?.setBot(m.pid, this.settings.botDifficulty);
    if (this.phaseNow === 'match') this.race?.setBot(m.pid, this.settings.race?.difficulty ?? 'normal');
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? '';
    this.pushLobby();
  }

  dispose() {
    this.disposed = true;
    this.sim?.dispose();
    this.sim = null;
    this.race?.dispose();
    this.race = null;
  }

  private pushMods() {
    const out: Record<number, Mods> = {};
    for (const [pid, v] of this.mods) out[pid] = v;
    for (const x of this.members.values()) if (x.connected) x.client.send(MSG.MODS, out);
  }

  /** Re-applies admin modifiers to a fresh simulation and tells everyone. */
  private applyMods() {
    for (const [pid, v] of this.mods) {
      const p = this.sim?.byId(pid);
      if (p) {
        p.speedMult = v.speed === 1 ? undefined : v.speed;
        p.size = v.size === 1 ? undefined : v.size;
        p.god = v.god || undefined;
      }
    }
    this.pushMods();
  }

  private async command(id: string, m: Member, d: { line?: unknown; token?: unknown }) {
    const reply = (text: string, kind: 'info' | 'error' = 'info') => m.client.send(MSG.NOTICE, { text, kind });
    const line = cleanChat(d?.line);
    if (!line.startsWith('/')) return;
    const level = this.roomAdmins.has(id)
      ? 'admin'
      : await this.opts.authorize?.({ isHost: this.isHost(id), uid: m.uid, token: typeof d?.token === 'string' ? d.token : undefined });
    if (!level) return reply('You are not an admin.', 'error');
    const owner = level === 'owner';
    const live = this.sim?.players ?? [];
    const players = this.sim
      ? live.map((p) => ({ pid: p.id, name: p.info.name }))
      : [...this.members.values()].map((x) => ({ pid: x.pid, name: x.name }));
    const res = runCommand(line, {
      sim: this.sim,
      sender: { pid: m.pid, name: m.name, owner },
      players,
      grant: (pid, g) => {
        for (const x of this.members.values()) if (x.pid === pid && x.connected) x.client.send(MSG.GRANT, g);
      },
      setAdmin: (pid, on) => {
        const t = [...this.members.entries()].find(([, x]) => x.pid === pid);
        if (!t) return 'Only players (not bots) can be admins.';
        if (on) this.roomAdmins.add(t[0]);
        else this.roomAdmins.delete(t[0]);
        return null;
      },
      mods: this.mods,
      modsChanged: () => this.pushMods(),
    });
    reply(res.text, res.ok ? 'info' : 'error');
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
        if (this.race) {
          for (const raw of data.slice(0, 10)) {
            const inp = emptyRaceInput();
            if (!unpackRaceInput(raw, inp) || inp.seq <= m.rLastSeq) continue;
            m.rLastSeq = inp.seq;
            m.rqueue.push(inp);
            m.lastInputAt = Date.now();
          }
          while (m.rqueue.length > 8) m.rqueue.shift();
          return;
        }
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
        if (this.weaponOk(d.weapon, m.admin)) m.weapon = d.weapon as WeaponId;
        if (SPECIAL_IDS.includes(d.special as SpecialId)) m.special = d.special as SpecialId;
        if (d.cosmetics && typeof d.cosmetics === 'object')
          m.cosmetics = sanitizeCosmetics(d.cosmetics as Partial<Cosmetics>);
        if (d.car && typeof d.car === 'object') m.car = sanitizeCarLoadout(d.car);
        return this.pushLobby();
      case MSG.TEAM: {
        if (this.phaseNow !== 'lobby' || (d.team !== 0 && d.team !== 1)) return;
        const target = [...this.members.values()].find((x) => x.pid === d.id);
        if (!target || (target !== m && !this.isHost(id))) return;
        if ([...this.members.values()].filter((x) => x.team === d.team).length >= TEAM_SIZE) return;
        target.team = d.team;
        return this.pushLobby();
      }
      case MSG.SETTINGS: {
        if (this.isHost(id) && this.phaseNow === 'results') this.toLobby();
        if (!this.isHost(id) || this.phaseNow !== 'lobby') return;
        const next = sanitizeSettings(d as Partial<LobbySettings>, this.settings);
        // A race holds six: switching a fuller room to VELOCITY waits until it's six or fewer.
        if (next.game === 'velocity' && this.settings.game !== 'velocity' && this.members.size > MAX_RACERS) {
          m.client.send(MSG.NOTICE, { text: `VELOCITY races hold ${MAX_RACERS}. Ask ${this.members.size - MAX_RACERS} to leave first.`, kind: 'warn' });
          next.game = 'shooter';
        }
        this.settings = next;
        return this.pushLobby();
      }
      case MSG.BALANCE:
        if (!this.isHost(id) || this.phaseNow !== 'lobby') return;
        [...this.members.values()].forEach((x, i) => (x.team = (i % 2) as Team));
        return this.pushLobby();
      case MSG.START:
        if (this.isHost(id) && this.phaseNow === 'results') this.toLobby();
        if (this.isHost(id)) this.startMatch();
        return;
      case MSG.TO_LOBBY:
        if (this.isHost(id) && this.phaseNow === 'results') this.toLobby();
        return;
      case MSG.AGAIN:
        if (this.random && this.phaseNow === 'results') this.again.add(id);
        return;
      case MSG.CMD:
        void this.command(id, m, d);
        return;
      case MSG.CHAT: {
        const text = cleanChat(d.text);
        const now = Date.now();
        m.chatTokens = Math.min(4, m.chatTokens + (now - m.chatAt) / 1500);
        m.chatAt = now;
        if (!text || m.chatTokens < 1) return;
        m.chatTokens -= 1;
        const line: ChatLine = { id: m.pid, name: m.name, team: m.team, text, toTeam: d.team === true };
        for (const x of this.members.values()) if (x.connected && (!line.toTeam || x.team === m.team)) x.client.send(MSG.CHAT, line);
        return;
      }
    }
  }

  private startMatch() {
    if (this.phaseNow !== 'lobby' || !this.members.size) return;
    if (this.settings.game === 'velocity') return this.startRace();
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
      ...(m.admin ? { admin: true } : {}),
    }));
    if (s.botFill) {
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      for (const t of [0, 1] as Team[])
        for (let n = infos.filter((p) => p.team === t).length; n < TEAM_SIZE; n++)
          infos.push({
            id: this.nextPid++,
            name: names.pop() ?? 'Bot',
            team: t,
            weapon: pick(publicWeapons()),
            special: pick(SPECIAL_IDS),
            bot: true,
            difficulty: s.botDifficulty,
            cosmetics: botLook(this.nextPid * 7919 + Math.floor(Math.random() * 1e6)),
          });
    }
    this.sim = new Simulation(
      { map: s.map, mode: s.mode, duration: s.duration, seed: (Math.random() * 2 ** 31) | 0 },
      infos,
    );
    this.roster = infos.map(({ uid: _uid, ...p }) => p);
    this.mods.clear();
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
          mapDef: customMapData(this.sim.config.map),
        } satisfies MatchStart);
    }
    this.pushLobby();
    this.pushMods();
  }

  /** Late joiners take over a bot on the emptier team (or a fresh slot), then get a full paint sync. */
  private joinRunning(m: Member) {
    const sim = this.sim!;
    // A player takes a bot's seat: the bot leaves and the player arrives with their own look and weapon.
    // The owner is added on top instead, so the match stays exactly as it is.
    if (!m.admin) {
      const bot =
        sim.players.find((p) => p.info.bot && p.team === m.team && !this.ownerOf(p.id)) ??
        sim.players.find((p) => p.info.bot && !this.ownerOf(p.id));
      if (bot) {
        m.team = bot.team;
        sim.removePlayer(bot.id);
      } else if (sim.players.length >= MAX_PLAYERS) return;
    }
    sim.addPlayer({
      id: m.pid,
      name: m.name,
      team: m.team,
      weapon: m.weapon,
      special: m.special,
      bot: false,
      cosmetics: m.cosmetics,
      uid: m.uid,
      ...(m.admin ? { admin: true } : {}),
    });
    this.roster = sim.players.map((p) => {
      const { uid: _uid, ...info } = p.info;
      return info;
    });
    for (const o of this.members.values()) if (o !== m && o.connected) o.client.send(MSG.ROSTER, { players: this.roster });
    m.lastInputAt = Date.now();
    m.client.send(MSG.MATCH, { config: sim.config, players: this.roster, you: m.pid, mapDef: customMapData(sim.config.map) } satisfies MatchStart);
    m.client.send(MSG.SYNC, { rle: sim.world.grid.encode() });
  }

  private ownerOf(pid: number) {
    for (const m of this.members.values()) if (m.pid === pid) return m;
    return undefined;
  }

  /* ---------- VELOCITY ---------- */

  private startRace() {
    const s = this.settings.race ?? DEFAULT_RACE_SETTINGS;
    const ms = [...this.members.values()].slice(0, MAX_RACERS);
    const infos: RacerInfo[] = ms.map((m, i) => ({
      id: m.pid,
      name: m.name,
      bot: !m.connected,
      difficulty: s.difficulty,
      car: m.car,
      identity: i,
      ...(m.uid ? { uid: m.uid } : {}),
      ...(m.admin ? { admin: true } : {}),
    }));
    const seed = (Math.random() * 2 ** 31) | 0;
    const names = [...RACE_BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let k = 0; k < s.bots && infos.length < MAX_RACERS; k++)
      infos.push({ id: this.nextPid++, name: names[k % names.length], bot: true, difficulty: s.difficulty, car: botCar(seed + k * 977), identity: infos.length });
    const handling = this.opts.raceHandling?.() ?? null;
    this.race = new RaceSim({ track: s.track, laps: s.laps, preset: s.preset, damage: s.damage, seed, ...(handling ? { handling } : {}) }, infos);
    this.raceRoster = infos.map(({ uid: _uid, ...p }) => p);
    this.raceEvents = [];
    this.phaseNow = 'match';
    this.acc = this.ticks = this.snaps = 0;
    this.finishing = false;
    const now = Date.now();
    const def = trackDef(s.track);
    for (const m of this.members.values()) {
      m.rqueue.length = 0;
      m.rLastSeq = 0;
      m.rlast = emptyRaceInput();
      m.lastInputAt = now;
      if (m.connected && this.race.byId(m.pid))
        m.client.send(MSG.MATCH, { race: true, config: this.race.config, racers: this.raceRoster, you: m.pid, ...(def?.custom ? { track: def } : {}) } satisfies RaceStart);
    }
    this.pushLobby();
  }

  /** Someone arriving mid-race takes over a bot's car; with no bot to replace they race next time. */
  private joinRace(m: Member) {
    const race = this.race!;
    const taken = new Set([...this.members.values()].filter((x) => x !== m).map((x) => x.pid));
    const bot = race.racers.find((r) => r.info.bot && !taken.has(r.id));
    if (!bot) {
      m.client.send(MSG.NOTICE, { text: 'A race is on. You’ll race in the next one.', kind: 'info' });
      return;
    }
    m.pid = bot.id;
    race.setBot(bot.id, null);
    bot.info = { ...bot.info, name: m.name };
    this.raceRoster = race.racers.map(({ info: { uid: _uid, ...p } }) => p);
    m.lastInputAt = Date.now();
    const def = trackDef(race.config.track);
    m.client.send(MSG.MATCH, { race: true, config: race.config, racers: this.raceRoster, you: m.pid, ...(def?.custom ? { track: def } : {}) } satisfies RaceStart);
  }

  private tickRace(now: number) {
    const race = this.race!;
    while (this.acc >= DT) {
      for (const m of this.members.values()) {
        if (!m.connected || !race.byId(m.pid)) continue;
        const next = m.rqueue.shift();
        if (next) m.rlast = next;
        else if (now - m.lastInputAt > INPUT_STALE_MS && (m.rlast.throttle || m.rlast.brake || m.rlast.steer || m.rlast.buttons)) m.rlast = { ...emptyRaceInput(), seq: m.rlast.seq };
        race.setInput(m.pid, m.rlast);
      }
      race.step();
      this.raceEvents.push(...race.drainEvents());
      this.acc -= DT;
      if (++this.ticks % 3 === 0 || race.phase === 'ended') {
        const snap = raceSnapshot(race, this.raceEvents);
        this.raceEvents = [];
        for (const m of this.members.values()) if (m.connected) m.client.send(MSG.SNAP, snap);
      }
      if (race.phase === 'ended') {
        this.finishRace();
        break;
      }
    }
  }

  private finishRace() {
    const race = this.race;
    if (!race?.result || this.finishing) return;
    this.finishing = true;
    const r = race.result;
    const xp: Record<number, number> = {};
    for (const p of r.players) if (!p.bot) xp[p.id] = xpForRace(r, p.id);
    const end: RaceEnd = { race: true, result: { ...r, players: r.players.map(({ uid: _uid, ...p }) => p) }, xp, recorded: false };
    for (const m of this.members.values()) if (m.connected) m.client.send(MSG.END, end);
    this.phaseNow = 'results';
    this.again.clear();
    this.resultsAt = this.quick ? Date.now() + 15_000 : this.random ? Date.now() + 14_000 : 0;
    race.dispose();
    this.race = null;
    this.pushLobby();
  }

  tick(dtMs: number) {
    const now = Date.now();
    if (this.phaseNow === 'lobby' && (this.quick || this.random) && this.autoStartAt) {
      if (now >= this.autoStartAt && this.members.size) this.startMatch();
      else if (now - this.lastLobbyPush > 1000) this.pushLobby();
    }
    if (this.phaseNow === 'results' && this.resultsAt && now >= this.resultsAt) this.toLobby();
    if (this.race && this.phaseNow === 'match' && !this.finishing) {
      this.acc += Math.min(dtMs, 250) / 1000;
      return this.tickRace(now);
    }
    const sim = this.sim;
    if (this.external || this.phaseNow !== 'match' || !sim || this.finishing) return;
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
    this.again.clear();
    this.resultsAt = this.quick ? Date.now() + 15_000 : this.random ? Date.now() + 14_000 : 0;
    // An adopted match is still being shown to the host by their own view; it disposes it.
    if (!this.external) sim.dispose();
    this.sim = null;
    this.pushLobby();
  }

  private toLobby() {
    this.phaseNow = 'lobby';
    this.resultsAt = 0;
    for (const m of this.members.values()) m.ready = false;
    if (this.quick) this.autoStartAt = Date.now() + 20_000;
    if (this.random) {
      // Everyone who tapped Play again moves on together; the rest are let go.
      for (const [id, m] of [...this.members]) {
        if (this.again.has(id) || id === this.hostId) m.ready = true;
        else this.opts.kick?.(id);
      }
      this.autoStartAt = this.members.size >= 2 ? Date.now() + 8_000 : 0;
      this.again.clear();
    }
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
      ...(m.admin ? { admin: true } : {}),
      car: m.car,
    }));
    return {
      code: this.code,
      phase: this.phaseNow,
      hostId: this.quick ? -1 : (host?.pid ?? -1),
      quick: this.quick,
      ...(this.random ? { random: true } : {}),
      settings: this.settings,
      players: list,
      startsIn:
        (this.quick || this.random) && this.phaseNow === 'lobby' && this.autoStartAt
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
