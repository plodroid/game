import { Room, type Client } from '@colyseus/core';
import {
  BOT_DIFFICULTIES,
  cleanPlayerName,
  DEFAULT_COSMETICS,
  DT,
  DURATION_OPTIONS,
  emptyInput,
  generateRoomCode,
  initPhysics,
  MAP_IDS,
  MAX_PLAYERS,
  MODES,
  MSG,
  packEffect,
  packEvent,
  packPlayer,
  PHASES,
  PROTOCOL_VERSION,
  sanitizeCosmetics,
  Simulation,
  SPECIAL_IDS,
  TEAM_SIZE,
  TICK_RATE,
  unpackInput,
  WEAPON_IDS,
  xpForMatch,
  type Cosmetics,
  type Input,
  type LobbyPlayer,
  type LobbySettings,
  type LobbyState,
  type MatchEnd,
  type MatchStart,
  type ModeId,
  type PlayerInfo,
  type Snapshot,
  type SpecialId,
  type Team,
  type WeaponId,
} from '@chromashift/shared';
import { recordResults, verifyToken } from '../authentication/firebase';
import { config } from '../config';

interface Member {
  sid: string;
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
  client: Client;
}

const activeCodes = new Set<string>();
let rooms = 0;
let players = 0;
export const roomStats = () => ({ rooms, players });

const BOT_NAMES = ['Rook', 'Pixel', 'Mango', 'Nova', 'Juno', 'Kiwi', 'Echo', 'Taro', 'Zest', 'Moss', 'Vega', 'Bolt', 'Fizz', 'Lumen', 'Pico', 'Sable'];
const PLAYABLE: ModeId[] = ['turf', 'zones', 'knockout'];
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

function sanitizeSettings(s: Partial<LobbySettings> | undefined, base?: LobbySettings): LobbySettings {
  const d: LobbySettings = base ?? { map: 'skyline', mode: 'turf', duration: MODES.turf.duration, botFill: true, botDifficulty: 'normal' };
  return {
    map: MAP_IDS.includes(s?.map as never) ? s!.map! : d.map,
    mode: PLAYABLE.includes(s?.mode as never) ? s!.mode! : d.mode,
    duration: DURATION_OPTIONS.includes(Number(s?.duration)) ? Number(s!.duration) : d.duration,
    botFill: typeof s?.botFill === 'boolean' ? s.botFill : d.botFill,
    botDifficulty: BOT_DIFFICULTIES.includes(s?.botDifficulty as never) ? s!.botDifficulty! : d.botDifficulty,
  };
}

/**
 * One lobby + match. The simulation here is authoritative: clients only send inputs,
 * and everything they see (movement, hits, paint, score, timer, results) comes from it.
 */
export class ArenaRoom extends Room {
  override maxClients = MAX_PLAYERS;
  /** Inputs arrive at ~30 Hz; anything far beyond that is abuse and gets disconnected. */
  override maxMessagesPerSecond = 90;
  private members = new Map<string, Member>();
  private nextPid = 1;
  private hostSid = '';
  private settings!: LobbySettings;
  private quick = false;
  private phase: 'lobby' | 'match' | 'results' = 'lobby';
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

  override async onCreate(options: { quick?: boolean; settings?: Partial<LobbySettings> }) {
    if (rooms >= config.maxRooms) throw new Error('Server is full. Try again later.');
    await initPhysics();
    let code: string;
    do code = generateRoomCode();
    while (activeCodes.has(code));
    activeCodes.add(code);
    this.roomId = code;
    rooms++;
    this.quick = !!options?.quick;
    this.settings = sanitizeSettings(options?.settings);
    if (this.quick) this.autoStartAt = Date.now() + 20_000;
    else await this.setPrivate(true);
    this.registerMessages();
    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_RATE);
  }

  override async onAuth(_client: Client, options: { protocol?: number; token?: unknown }) {
    if (options?.protocol !== PROTOCOL_VERSION) throw new Error(`VERSION mismatch (server ${PROTOCOL_VERSION})`);
    const v = await verifyToken(options.token);
    return { uid: v?.uid, username: v?.username ?? null };
  }

  override onJoin(client: Client, options: Partial<{ name: string; weapon: string; special: string; cosmetics: Partial<Cosmetics> }>, auth?: { uid?: string; username?: string | null }) {
    players++;
    const m: Member = {
      sid: client.sessionId,
      pid: this.nextPid++,
      // A verified username can't be spoofed; otherwise use the (sanitised) name the client sent.
      name: cleanPlayerName(auth?.username ?? options?.name, `Player${this.nextPid}`),
      uid: auth?.uid,
      verified: !!auth?.username,
      team: this.emptierTeam(),
      ready: false,
      weapon: WEAPON_IDS.includes(options?.weapon as WeaponId) ? (options!.weapon as WeaponId) : 'pulse',
      special: SPECIAL_IDS.includes(options?.special as SpecialId) ? (options!.special as SpecialId) : 'surge',
      cosmetics: sanitizeCosmetics(options?.cosmetics ?? DEFAULT_COSMETICS),
      connected: true,
      queue: [],
      last: emptyInput(),
      lastSeq: 0,
      client,
    };
    this.members.set(m.sid, m);
    if (!this.hostSid) this.hostSid = m.sid;
    if (this.phase === 'match' && this.sim) this.joinRunning(m);
    this.pushLobby();
    if (this.quick && this.phase === 'lobby' && this.members.size >= MAX_PLAYERS) this.startMatch();
  }

  override onDrop(client: Client) {
    const m = this.members.get(client.sessionId);
    if (!m) return;
    m.connected = false;
    m.queue.length = 0;
    // A bot covers the slot until they come back, so the team isn't a player down.
    if (this.phase === 'match') this.sim?.setBot(m.pid, this.settings.botDifficulty);
    this.pushLobby();
    this.allowReconnection(client, config.reconnectSeconds);
  }

  override onReconnect(client: Client) {
    const m = this.members.get(client.sessionId);
    if (!m) return;
    m.connected = true;
    m.client = client;
    if (this.phase === 'match' && this.sim?.byId(m.pid)) {
      this.sim.setBot(m.pid, null);
      client.send(MSG.SYNC, { rle: this.sim.world.grid.encode() });
    }
    this.pushLobby();
  }

  override onLeave(client: Client) {
    const m = this.members.get(client.sessionId);
    if (!m) return;
    players--;
    this.members.delete(client.sessionId);
    if (this.phase === 'match') this.sim?.setBot(m.pid, this.settings.botDifficulty);
    if (this.hostSid === m.sid) this.hostSid = this.members.keys().next().value ?? '';
    this.pushLobby();
  }

  override onDispose() {
    activeCodes.delete(this.roomId);
    rooms--;
    this.sim?.dispose();
  }

  private member(c: Client) {
    return this.members.get(c.sessionId);
  }
  private isHost(c: Client) {
    return !this.quick && c.sessionId === this.hostSid;
  }

  private emptierTeam(): Team {
    let a = 0, b = 0;
    for (const m of this.members.values()) m.team === 0 ? a++ : b++;
    return a <= b ? 0 : 1;
  }

  private registerMessages() {
    this.onMessage(MSG.INPUT, (client, data: unknown) => {
      const m = this.member(client);
      if (!m || this.phase !== 'match' || !Array.isArray(data)) return;
      for (const raw of data.slice(0, 10)) {
        const inp = emptyInput();
        // Malformed or replayed inputs are dropped; values are clamped inside unpackInput.
        if (!unpackInput(raw, inp) || inp.seq <= m.lastSeq) continue;
        m.lastSeq = inp.seq;
        m.queue.push(inp);
      }
      // Keep the buffer short so a lagging client can't build up extra latency.
      while (m.queue.length > 8) m.queue.shift();
    });
    this.onMessage(MSG.READY, (client, data: { ready?: unknown }) => {
      const m = this.member(client);
      if (!m || this.phase !== 'lobby') return;
      m.ready = data?.ready === true;
      this.pushLobby();
    });
    this.onMessage(MSG.LOADOUT, (client, data: { weapon?: string; special?: string; cosmetics?: Partial<Cosmetics> }) => {
      const m = this.member(client);
      if (!m || this.phase === 'match') return;
      if (WEAPON_IDS.includes(data?.weapon as WeaponId)) m.weapon = data.weapon as WeaponId;
      if (SPECIAL_IDS.includes(data?.special as SpecialId)) m.special = data.special as SpecialId;
      if (data?.cosmetics) m.cosmetics = sanitizeCosmetics(data.cosmetics);
      this.pushLobby();
    });
    this.onMessage(MSG.TEAM, (client, data: { id?: unknown; team?: unknown }) => {
      const m = this.member(client);
      if (!m || this.phase !== 'lobby' || (data?.team !== 0 && data?.team !== 1)) return;
      const target = [...this.members.values()].find((x) => x.pid === data.id);
      if (!target || (target !== m && !this.isHost(client))) return;
      if ([...this.members.values()].filter((x) => x.team === data.team).length >= TEAM_SIZE) return;
      target.team = data.team;
      this.pushLobby();
    });
    this.onMessage(MSG.SETTINGS, (client, data: Partial<LobbySettings>) => {
      if (!this.isHost(client) || this.phase !== 'lobby') return;
      this.settings = sanitizeSettings(data, this.settings);
      this.pushLobby();
    });
    this.onMessage(MSG.BALANCE, (client) => {
      if (!this.isHost(client) || this.phase !== 'lobby') return;
      [...this.members.values()].forEach((m, i) => (m.team = (i % 2) as Team));
      this.pushLobby();
    });
    this.onMessage(MSG.START, (client) => {
      if (this.isHost(client)) this.startMatch();
    });
    this.onMessage(MSG.TO_LOBBY, (client) => {
      if (this.isHost(client) && this.phase === 'results') this.toLobby();
    });
  }

  private startMatch() {
    if (this.phase !== 'lobby' || !this.members.size) return;
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
            cosmetics: { ...DEFAULT_COSMETICS, hair: pick(['fin', 'spikes', 'bob']), headgear: pick(['none', 'cap', 'phones']), skin: Math.floor(Math.random() * 6) },
          });
    }
    this.sim = new Simulation({ map: s.map, mode: s.mode, duration: s.duration, seed: (Math.random() * 2 ** 31) | 0 }, infos);
    this.roster = infos.map(({ uid: _uid, ...p }) => p);
    this.phase = 'match';
    this.acc = this.ticks = this.snaps = 0;
    this.pending = [];
    this.finishing = false;
    for (const m of this.members.values()) {
      m.queue.length = 0;
      m.lastSeq = 0;
      m.last = emptyInput();
      if (m.connected) m.client.send(MSG.MATCH, { config: this.sim.config, players: this.roster, you: m.pid } satisfies MatchStart);
    }
    this.pushLobby();
  }

  /** Late joiners take over a bot on the emptier team (or a fresh slot), then get a full paint sync. */
  private joinRunning(m: Member) {
    const sim = this.sim!;
    const bot = sim.players.find((p) => p.info.bot && p.team === m.team && !this.ownerOf(p.id)) ?? sim.players.find((p) => p.info.bot && !this.ownerOf(p.id));
    if (bot) {
      m.pid = bot.id;
      m.team = bot.team;
      m.weapon = bot.weapon;
      m.special = bot.special;
      bot.info.name = m.name;
      bot.info.uid = m.uid;
      sim.setBot(bot.id, null);
    } else if (sim.players.length < MAX_PLAYERS) {
      sim.addPlayer({ id: m.pid, name: m.name, team: m.team, weapon: m.weapon, special: m.special, bot: false, cosmetics: m.cosmetics, uid: m.uid });
    } else return;
    this.roster = sim.players.map((p) => {
      const { uid: _uid, ...info } = p.info;
      return info;
    });
    m.client.send(MSG.MATCH, { config: sim.config, players: this.roster, you: m.pid } satisfies MatchStart);
    m.client.send(MSG.SYNC, { rle: sim.world.grid.encode() });
  }

  private ownerOf(pid: number) {
    for (const m of this.members.values()) if (m.pid === pid) return m;
    return undefined;
  }

  private tick(dtMs: number) {
    const now = Date.now();
    if (this.phase === 'lobby' && this.quick && this.autoStartAt) {
      if (now >= this.autoStartAt && this.members.size) this.startMatch();
      else if (now - this.lastLobbyPush > 1000) this.pushLobby();
    }
    if (this.phase === 'results' && this.resultsAt && now >= this.resultsAt) this.toLobby();
    const sim = this.sim;
    if (this.phase !== 'match' || !sim || this.finishing) return;
    this.acc += Math.min(dtMs, 250) / 1000;
    while (this.acc >= DT) {
      for (const m of this.members.values()) {
        if (!m.connected) continue;
        const next = m.queue.shift();
        if (next) m.last = next;
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
    if (++this.snaps % 20 === 1) snap.st = sim.players.map((p) => [p.id, p.stats.kills, p.stats.deaths, p.stats.assists, Math.round(p.stats.paint)]);
    this.broadcast(MSG.SNAP, snap);
    this.pending = [];
  }

  private async finish() {
    if (this.finishing || !this.sim?.result) return;
    this.finishing = true;
    const sim = this.sim;
    const r = sim.result!;
    const xp: Record<number, number> = {};
    for (const p of r.players) if (!p.bot) xp[p.id] = xpForMatch(r, p.id);
    const recorded = await recordResults(r, xp);
    // Account ids never leave the server.
    const end: MatchEnd = { result: { ...r, players: r.players.map(({ uid: _uid, ...p }) => p) }, xp, recorded };
    this.broadcast(MSG.END, end);
    this.phase = 'results';
    this.resultsAt = this.quick ? Date.now() + 15_000 : 0;
    sim.dispose();
    this.sim = null;
    this.pushLobby();
  }

  private toLobby() {
    this.phase = 'lobby';
    this.resultsAt = 0;
    for (const m of this.members.values()) m.ready = false;
    if (this.quick) this.autoStartAt = Date.now() + 20_000;
    this.pushLobby();
  }

  private pushLobby() {
    this.lastLobbyPush = Date.now();
    const host = this.members.get(this.hostSid);
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
    const state: LobbyState = {
      code: this.roomId,
      phase: this.phase,
      hostId: this.quick ? -1 : (host?.pid ?? -1),
      quick: this.quick,
      settings: this.settings,
      players: list,
      startsIn: this.quick && this.phase === 'lobby' && this.autoStartAt ? Math.max(0, Math.ceil((this.autoStartAt - Date.now()) / 1000)) : undefined,
    };
    for (const m of this.members.values()) if (m.connected) m.client.send(MSG.LOBBY, { ...state, you: m.pid });
  }
}
