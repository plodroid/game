import { authorize, isOwner } from '../auth/admin';
import { accounts } from '../auth/account';
import { Peer, type DataConnection } from 'peerjs';
import { Packr } from 'msgpackr';
import {
  generateRoomCode,
  initPhysics,
  MAX_PLAYERS,
  normalizeRoomCode,
  PROTOCOL_VERSION,
  RoomHost,
  TICK_RATE,
  type HostClient,
  type JoinOptions,
  type LobbySettings,
  type LobbyState,
} from '@chromashift/shared';
import { env } from '../env';
import { HOST_CODE_KEY, type NetRoom } from './net';

/**
 * Browser-hosted games. The host's tab runs the same authoritative RoomHost as the dedicated
 * server; guests connect to it over WebRTC data channels. The free public PeerJS broker only
 * introduces the two browsers (and relays through TURN when a direct path is impossible), so
 * nobody installs anything or opens router ports.
 */

/** Namespaces our codes on the shared PeerJS broker. Bump with breaking protocol changes. */
const ID_PREFIX = 'chromashift-v1-';
/** Seconds a dropped guest keeps their seat (same as the dedicated server). */
const GRACE_MS = 45_000;
/** A link with no traffic for this long is treated as lost. */
const SILENT_MS = 8_000;
const KEEPALIVE_MS = 2_000;
const CONNECT_MS = 20_000;
const HELLO_MS = 10_000;
/** Inputs arrive at ~30 Hz; far beyond that is abuse. */
const MAX_MSGS_PER_SEC = 90;
const LOCAL_ID = 'local';

/**
 * Free public STUN servers let two browsers find a direct path, which works on most home
 * networks. PeerJS's bundled TURN relays no longer exist, so a relay only comes from our own
 * optional config (VITE_TURN_*), for networks that block direct links.
 */
export const PEER_OPTIONS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
      ...(env.turn ? [env.turn] : []),
    ],
  },
};
export const hasRelay = !!env.turn;

/** What a guest tells the host. Never includes the account token: the host is just another player. */
export type PeerHello = Pick<JoinOptions, 'name' | 'protocol' | 'weapon' | 'special' | 'cosmetics'> & {
  /** The game's owner says so; the host checks it against the owner's note in Firestore (no token is ever sent). */
  admin?: boolean;
};

class P2PError extends Error {
  constructor(readonly type: string) {
    super(type);
  }
}

/** Turns broker, WebRTC and host refusals into something a player can act on. */
export function explain(e: unknown): string {
  switch ((e as { type?: string } | null)?.type) {
    case 'peer-unavailable':
      return 'No game is open with that code right now. Check the code, or ask your friend to host again.';
    case 'browser-incompatible':
      return 'This browser can’t make peer-to-peer connections. Try a recent Chrome, Edge, Firefox or Safari.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected':
      return 'Couldn’t reach the matchmaking service. Check your internet connection and try again.';
    case 'unavailable-id':
      return 'Couldn’t reserve a game code. Try again in a moment.';
    case 'full':
      return 'That game is full (8 players).';
    case 'version':
      return 'That game runs a different version of CHROMASHIFT. Both of you should refresh the page to update.';
    case 'expired':
      return 'Your seat in that game was given up. Join again with the code.';
    case 'negotiation-failed':
    case 'webrtc':
    case 'timeout':
      return 'Couldn’t connect to the host. A strict network (school, office, some mobile data) may be blocking it. Try another network, or let someone else host.';
  }
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}

const codec = new Packr({ useRecords: false });
const encode = (type: string, payload?: unknown) => codec.pack([type, payload ?? null]) as Uint8Array;
function decode(data: unknown): [string, unknown] | null {
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return null;
  try {
    const v: unknown = codec.unpack(
      data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array),
    );
    return Array.isArray(v) && typeof v[0] === 'string' ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

function randomId(bytes = 12) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Connects to the broker, optionally under a chosen id. Resolves once registered. */
function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_OPTIONS) : new Peer(PEER_OPTIONS);
    const done = (err?: unknown) => {
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', done);
      if (err) {
        peer.destroy();
        reject(err);
      } else resolve(peer);
    };
    const onOpen = () => done();
    const timer = setTimeout(() => done(new P2PError('network')), CONNECT_MS);
    peer.on('open', onOpen);
    peer.on('error', done);
  });
}

/** Makes sure the peer is registered with the broker again after a dropped socket. */
function brokerReady(peer: Peer): Promise<void> {
  if (peer.open) return Promise.resolve();
  if (peer.destroyed) return Promise.reject(new P2PError('network'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (cleanup(), reject(new P2PError('network'))), 8000);
    const cleanup = () => (clearTimeout(timer), peer.off('open', ok));
    const ok = () => (cleanup(), resolve());
    peer.on('open', ok);
    if (peer.disconnected) peer.reconnect();
  });
}

/** Runs queued callbacks as a fresh task: never re-entrant, and not throttled like timers in hidden tabs. */
class Pump {
  private queue: (() => void)[] = [];
  private channel = new MessageChannel();
  private scheduled = false;
  constructor() {
    this.channel.port1.onmessage = () => {
      this.scheduled = false;
      for (const run of this.queue.splice(0)) run();
    };
  }
  push(run: () => void) {
    this.queue.push(run);
    if (!this.scheduled) {
      this.scheduled = true;
      this.channel.port2.postMessage(0);
    }
  }
}

/**
 * 60 Hz clock from a worker. Timers on a hidden page are throttled to once a second or less;
 * worker timers aren't, so a host who switches tabs keeps everyone's game running.
 */
function ticker(run: () => void): () => void {
  try {
    const url = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${1000 / TICK_RATE});`], { type: 'text/javascript' }),
    );
    const worker = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    worker.onmessage = run;
    return () => worker.terminate();
  } catch {
    const t = setInterval(run, 1000 / TICK_RATE);
    return () => clearInterval(t);
  }
}

/** The client side of a room, in the shape net.ts expects (a subset of a Colyseus room). */
abstract class Link implements NetRoom {
  protected handlers = new Map<string, Set<(msg: unknown) => void>>();
  protected closed = false;
  protected cb = {
    drop: () => {},
    reconnect: () => {},
    leave: (_code: number) => {},
    error: (_code: number, _message?: string) => {},
  };

  abstract send(type: string, payload?: unknown): void;
  abstract ping(cb: (ms: number) => void): void;
  abstract leave(): void;

  onMessage<T = unknown>(type: string, cb: (msg: T) => void) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    const fn = cb as (msg: unknown) => void;
    set.add(fn);
    return () => void set.delete(fn);
  }
  protected emit(type: string, msg: unknown) {
    if (this.closed) return;
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) fn(msg);
  }
  onDrop(cb: () => void) {
    this.cb.drop = cb;
  }
  onReconnect(cb: () => void) {
    this.cb.reconnect = cb;
  }
  onLeave(cb: (code: number) => void) {
    this.cb.leave = cb;
  }
  onError(cb: (code: number, message?: string) => void) {
    this.cb.error = cb;
  }
}

/** A guest's connection to a host. Reconnects with its seat token after a blip. */
class PeerLink extends Link {
  private conn: DataConnection | null = null;
  private resume = '';
  private heard = performance.now();
  private pings: ((ms: number) => void)[] = [];
  private timer = 0;
  private droppedAt = 0;

  constructor(
    private peer: Peer,
    private target: string,
    private hello: PeerHello,
  ) {
    super();
  }

  /** Opens a data channel and resolves once the host has given us a seat. */
  attach(): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(this.target, { reliable: true, serialization: 'raw' });
      let settled = false;
      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.peer.off('error', onPeerError);
        if (err) {
          conn.close();
          reject(err);
        } else resolve();
      };
      const timer = setTimeout(() => finish(new P2PError('timeout')), CONNECT_MS);
      // The broker reports unknown codes (and its own failures) on the peer, not the connection.
      const onPeerError = (e: unknown) => finish(e);
      this.peer.on('error', onPeerError);
      conn.on(
        'open',
        () => void conn.send(encode('~hello', { ...this.hello, resume: this.resume || undefined })),
      );
      conn.on('data', (raw) => {
        const m = decode(raw);
        if (!m) return;
        if (!settled) {
          if (m[0] === '~welcome') {
            this.resume = String((m[1] as { resume?: unknown })?.resume ?? '');
            this.conn = conn;
            this.heard = performance.now();
            finish();
          } else if (m[0] === '~refuse')
            finish(new P2PError(String((m[1] as { reason?: unknown })?.reason ?? 'refused')));
          return;
        }
        if (conn === this.conn) this.receive(m[0], m[1]);
      });
      conn.on('close', () => {
        if (!settled) finish(new P2PError('timeout'));
        else if (conn === this.conn) this.lost();
      });
      conn.on('error', (e) => !settled && finish(e));
    });
  }

  start() {
    this.timer = window.setInterval(() => this.keepalive(), KEEPALIVE_MS);
  }

  private receive(type: string, payload: unknown) {
    this.heard = performance.now();
    if (type === '~pong') {
      const ms = Math.max(0, Math.round(performance.now() - Number(payload)));
      for (const cb of this.pings.splice(0)) cb(ms);
    } else if (type === '~bye') this.end(4100);
    else if (type[0] !== '~') this.emit(type, payload);
  }

  private raw(type: string, payload?: unknown) {
    if (this.conn?.open) void this.conn.send(encode(type, payload));
  }

  private keepalive() {
    if (this.closed || this.droppedAt) return;
    if (performance.now() - this.heard > SILENT_MS) this.conn?.close();
    else this.raw('~ping', performance.now());
  }

  private lost() {
    if (this.closed || this.droppedAt) return;
    this.conn = null;
    this.droppedAt = performance.now();
    this.cb.drop();
    void this.retry();
  }

  private async retry() {
    let missingSince = 0;
    while (!this.closed && performance.now() - this.droppedAt < GRACE_MS) {
      await sleep(1500);
      if (this.closed) return;
      try {
        await brokerReady(this.peer);
        await this.attach();
        this.droppedAt = 0;
        this.cb.reconnect();
        return;
      } catch (e) {
        const type = (e as P2PError).type;
        if (type === 'expired' || type === 'version') break;
        // The host's code vanished from the broker: give them a moment, then accept they're gone.
        if (type === 'peer-unavailable') {
          missingSince ||= performance.now();
          if (performance.now() - missingSince > 15_000) break;
        }
      }
    }
    this.end(4101);
  }

  private end(code: number) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.conn?.close();
    this.peer.destroy();
    this.cb.leave(code);
  }

  send(type: string, payload?: unknown) {
    this.raw(type, payload);
  }

  ping(cb: (ms: number) => void) {
    if (this.pings.length < 4) this.pings.push(cb);
  }

  leave() {
    if (this.closed) return;
    this.raw('~bye');
    this.closed = true;
    clearInterval(this.timer);
    const conn = this.conn;
    // Let the goodbye flush before the channel goes away.
    setTimeout(() => (conn?.close(), this.peer.destroy()), 150);
    setTimeout(() => this.cb.leave(1000), 0);
  }
}

/** The host's own seat: same protocol, no network. */
class LoopbackLink extends Link {
  readonly client: HostClient;
  private toClient = new Pump();
  private toHost = new Pump();

  constructor(private host: BrowserHost) {
    super();
    this.client = {
      id: LOCAL_ID,
      send: (type, payload) => this.toClient.push(() => this.emit(type, payload)),
    };
  }
  send(type: string, payload?: unknown) {
    this.toHost.push(() => !this.closed && this.host.room.message(LOCAL_ID, type, payload));
  }
  ping(cb: (ms: number) => void) {
    cb(0);
  }
  leave() {
    if (this.closed) return;
    this.closed = true;
    this.host.close();
    setTimeout(() => this.cb.leave(1000), 0);
  }
}

interface Session {
  id: string;
  /** Secret a guest presents to take their seat back after a drop. */
  resume: string;
  conn: DataConnection | null;
  heard: number;
  droppedAt: number;
  windowAt: number;
  count: number;
  client: HostClient;
}

/** The server half, living in the host's tab. */
/** Did the owner just say they are joining this game? (Needs this player to be signed in to look.) */
async function adminNoted(code: string) {
  return (await accounts()?.then((m) => m.checkAdminJoin(code)).catch(() => false)) === true;
}

class BrowserHost {
  readonly room: RoomHost;
  readonly link: LoopbackLink;
  private sessions = new Map<string, Session>();
  private stopTicker: () => void;
  private last = performance.now();
  private housekeepAt = 0;
  private closed = false;
  private cache: { type: string; payload: unknown; buf: Uint8Array } | null = null;

  constructor(
    private peer: Peer,
    code: string,
    settings: Partial<LobbySettings> | undefined,
    hello: PeerHello,
    private onLobby?: (state: LobbyState | null) => void,
  ) {
    this.room = new RoomHost({ code, settings, onLobby: (s) => this.onLobby?.(s), authorize });
    this.link = new LoopbackLink(this);
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => this.rejoinBroker());
    this.stopTicker = ticker(() => this.tick());
    addEventListener('pagehide', this.close);
    this.room.join(this.link.client, hello, { admin: isOwner() });
  }

  private accept(conn: DataConnection) {
    if (this.closed) return conn.close();
    let s: Session | null = null;
    let waiting = false;
    const helloTimer = setTimeout(() => !s && conn.close(), HELLO_MS);
    conn.on('data', (raw) => {
      const m = decode(raw);
      if (!m || waiting) return;
      if (!s) {
        if (m[0] !== '~hello') return conn.close();
        clearTimeout(helloTimer);
        const first = m[1] as Partial<PeerHello> | undefined;
        if (first?.admin === true) {
          // The owner left a fresh note for this game's code; check it before letting them past a full game.
          waiting = true;
          void adminNoted(this.code).then((ok) => {
            s = this.hello(conn, first, ok);
            waiting = false;
          });
        } else s = this.hello(conn, m[1]);
        return;
      }
      if (s.conn !== conn) return;
      const now = performance.now();
      s.heard = now;
      if (now - s.windowAt > 1000) {
        s.windowAt = now;
        s.count = 0;
      }
      if (++s.count > MAX_MSGS_PER_SEC) return conn.close();
      const [type, payload] = m;
      if (type === '~ping') this.raw(conn, '~pong', payload);
      else if (type === '~bye') this.remove(s);
      else if (type[0] !== '~') this.room.message(s.id, type, payload);
    });
    conn.on('close', () => {
      clearTimeout(helloTimer);
      if (s && s.conn === conn) this.drop(s);
    });
    conn.on('error', () => conn.close());
  }

  private get code() {
    return this.room.code;
  }

  private hello(conn: DataConnection, raw: unknown, admin = false): Session | null {
    const h = (raw && typeof raw === 'object' ? raw : {}) as Partial<PeerHello> & { resume?: unknown };
    const refuse = (reason: string) => {
      this.raw(conn, '~refuse', { reason });
      setTimeout(() => conn.close(), 300);
      return null;
    };
    if (h.protocol !== PROTOCOL_VERSION) return refuse('version');
    if (typeof h.resume === 'string') {
      const seat = [...this.sessions.values()].find((x) => x.resume === h.resume);
      if (!seat) return refuse('expired');
      const prev = seat.conn;
      seat.conn = conn;
      prev?.close();
      seat.droppedAt = 0;
      seat.heard = performance.now();
      this.raw(conn, '~welcome', { resume: seat.resume });
      this.room.reconnect(seat.client);
      return seat;
    }
    if (this.room.size >= MAX_PLAYERS && !admin) return refuse('full');
    const s: Session = {
      id: randomId(6),
      resume: randomId(),
      conn,
      heard: performance.now(),
      droppedAt: 0,
      windowAt: 0,
      count: 0,
      client: null!,
    };
    s.client = { id: s.id, send: (type, payload) => this.sendTo(s, type, payload) };
    this.sessions.set(s.id, s);
    this.raw(conn, '~welcome', { resume: s.resume });
    this.room.join(s.client, { name: h.name, weapon: h.weapon, special: h.special, cosmetics: h.cosmetics }, { admin });
    return s;
  }

  private raw(conn: DataConnection, type: string, payload?: unknown) {
    if (conn.open) void conn.send(encode(type, payload));
  }

  private sendTo(s: Session, type: string, payload: unknown) {
    const conn = s.conn;
    if (!conn?.open) return;
    // Snapshots go to every guest as the same object: encode once, send many.
    const c = this.cache;
    const buf = c && c.payload === payload && c.type === type ? c.buf : encode(type, payload);
    this.cache = { type, payload, buf };
    void conn.send(buf);
  }

  private drop(s: Session) {
    if (s.droppedAt || this.closed) return;
    s.conn = null;
    s.droppedAt = performance.now();
    this.room.drop(s.id);
  }

  private remove(s: Session) {
    this.sessions.delete(s.id);
    const conn = s.conn;
    s.conn = null;
    conn?.close();
    this.room.leave(s.id);
  }

  private tick() {
    const now = performance.now();
    this.room.tick(now - this.last);
    this.last = now;
    if (now - this.housekeepAt < 1000) return;
    this.housekeepAt = now;
    for (const s of this.sessions.values()) {
      if (s.droppedAt) {
        if (now - s.droppedAt > GRACE_MS) this.remove(s);
      } else if (now - s.heard > SILENT_MS) s.conn?.close();
    }
  }

  /** Guests already in the game don't need the broker; new ones do, so keep re-registering. */
  private rejoinBroker() {
    setTimeout(() => {
      if (!this.closed && this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
    }, 2000);
  }

  readonly close = () => {
    if (this.closed) return;
    this.closed = true;
    removeEventListener('pagehide', this.close);
    for (const s of this.sessions.values()) if (s.conn) this.raw(s.conn, '~bye');
    this.stopTicker();
    this.room.dispose();
    this.onLobby?.(null);
    setTimeout(() => this.peer.destroy(), 300);
  };
}

/**
 * Reserves this browser's game code on the broker. The code is kept between sessions, so friends
 * can save it like a server address; if it's busy (say, another tab is hosting) a one-off code is used.
 */
async function claimCode(): Promise<{ peer: Peer; code: string }> {
  let mine = normalizeRoomCode(stored(HOST_CODE_KEY) ?? '');
  if (!mine) {
    mine = generateRoomCode();
    try {
      localStorage.setItem(HOST_CODE_KEY, mine);
    } catch {
      // private mode: the code just won't persist
    }
  }
  const attempts = [mine, mine, generateRoomCode(), generateRoomCode()];
  for (let i = 0; i < attempts.length; i++) {
    try {
      return { peer: await openPeer(ID_PREFIX + attempts[i]), code: attempts[i] };
    } catch (e) {
      if ((e as P2PError).type !== 'unavailable-id') throw e;
      // Right after a reload our previous session can still hold the code for a moment.
      if (i === 0) await sleep(3000);
    }
  }
  throw new P2PError('unavailable-id');
}

/** Starts hosting in this tab. Returns the host's own seat; guests join with the code. */
export async function host(
  hello: PeerHello,
  settings?: Partial<LobbySettings>,
  onLobby?: (state: LobbyState | null) => void,
): Promise<NetRoom> {
  // The host's tab runs the authoritative simulation, so physics must be ready before any match starts.
  const [{ peer, code }] = await Promise.all([claimCode(), initPhysics()]);
  return new BrowserHost(peer, code, settings, hello, onLobby).link;
}

/** Joins a game hosted in someone else's browser. */
export async function join(code: string, hello: PeerHello): Promise<NetRoom> {
  if (isOwner()) {
    hello = { ...hello, admin: true };
    await accounts()?.then((m) => m.markAdminJoin(code)).catch(() => undefined);
  }
  const peer = await openPeer();
  const link = new PeerLink(peer, ID_PREFIX + code, hello);
  try {
    await link.attach();
  } catch (e) {
    peer.destroy();
    throw e;
  }
  link.start();
  return link;
}
