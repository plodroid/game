import { applyGrant, useMods } from '../auth/admin';
import { Client, type Room } from '@colyseus/sdk';
import type { Grant, Mods } from '@chromashift/shared';
import { create } from 'zustand';
import {
  DEFAULT_PORT,
  generateRoomCode,
  MSG,
  normalizeRoomCode,
  PROTOCOL_VERSION,
  ROOM_NAME,
  type ChatLine,
  type JoinOptions,
  type LobbySettings,
  type LobbyState,
  type MatchStart,
} from '@chromashift/shared';
import { env } from '../env';
import { publicName, useProfile } from '../state/profile';
import { useChat } from '../state/chat';
import { useUi } from '../state/ui';
import type { PeerHello } from './p2p';
import { voice } from './voice';

export type NetStatus = 'idle' | 'connecting' | 'lobby' | 'match' | 'error';
/** server: a dedicated server · host: this tab hosts the game · peer: a game hosted in someone else's tab. */
export type RoomKind = 'server' | 'host' | 'peer';

/** What the client needs from a room connection: a Colyseus room (wrapped) or a peer-to-peer link. */
export interface NetRoom {
  send(type: string, payload?: unknown): void;
  onMessage<T = unknown>(type: string, cb: (msg: T) => void): () => void;
  ping(cb: (ms: number) => void): void;
  leave(consented?: boolean): unknown;
  onDrop(cb: () => void): unknown;
  onReconnect(cb: () => void): unknown;
  onLeave(cb: (code: number) => void): unknown;
  onError(cb: (code: number, message?: string) => void): unknown;
}

/** A game someone joined recently, shown on the Online screen like a saved server. */
export interface RecentGame {
  code: string;
  host: string;
  at: number;
  /** Set for games on a dedicated server. */
  server?: string;
}

interface NetStore {
  status: NetStatus;
  error: string | null;
  endpoint: string;
  /** A game server is serving this page (LAN / self-hosted). */
  sameOrigin: boolean;
  lobby: LobbyState | null;
  you: number;
  room: NetRoom | null;
  kind: RoomKind | null;
  reconnecting: boolean;
  recent: RecentGame[];
}

const STORAGE_KEY = 'chromashift.server';
const RECENT_KEY = 'chromashift.recent';
/** This browser's game code, kept between hosting sessions so friends can reuse it. */
export const HOST_CODE_KEY = 'chromashift.hostCode';

/** The code friends will use when this browser hosts, created on first need. */
export function ownHostCode(): string | null {
  try {
    const saved = normalizeRoomCode(localStorage.getItem(HOST_CODE_KEY) ?? '');
    if (saved) return saved;
    const code = generateRoomCode();
    localStorage.setItem(HOST_CODE_KEY, code);
    return code;
  } catch {
    return null;
  }
}

function readRecent(): RecentGame[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list)
      ? list.filter((g) => normalizeRoomCode(String(g?.code ?? ''))).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

export const useNet = create<NetStore>()(() => ({
  status: 'idle',
  error: null,
  endpoint: '',
  sameOrigin: false,
  lobby: null,
  you: -1,
  room: null,
  kind: null,
  reconnecting: false,
  recent: readRecent(),
}));

/** Set by the session layer to hand a starting match to the engine. */
export const netHooks: {
  onMatch: ((room: NetRoom, start: MatchStart) => void) | null;
  onLeftMatch: (() => void) | null;
  idToken: (() => Promise<string | undefined>) | null;
  /** Every lobby change of the game this tab hosts (null once it closes); used by public listing. */
  hostLobby: ((state: LobbyState | null) => void) | null;
} = { onMatch: null, onLeftMatch: null, idToken: null, hostLobby: null };

let hostLobbyState: LobbyState | null = null;
/** The latest lobby of the game this tab hosts, or null. */
export const currentHostLobby = () => hostLobbyState;

/** An invite link (?join=CODE, optionally &server=…) waiting for the Online screen. */
let invite: { code: string; server?: string } | null = null;
export const setInvite = (code: string, server?: string) => (invite = { code, server });
export function takeInvite() {
  const i = invite;
  invite = null;
  return i;
}

/** Accepts "host", "host:port", "ws://…", "wss://…", "http(s)://…". */
export function normalizeEndpoint(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(s)) {
    const secure = location.protocol === 'https:' && !/^(localhost|127\.|\[::1\])/.test(s);
    s = `${secure ? 'wss' : 'ws'}://${s}`;
  }
  try {
    const u = new URL(s);
    // Plain ws:// is LAN/self-hosted: default to the game port. wss:// usually sits behind a proxy on 443.
    if (!u.port && u.protocol === 'ws:') u.port = String(DEFAULT_PORT);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** HTTPS pages cannot open plain ws:// to anything but localhost (browser mixed-content rule). */
export function mixedContentBlocked(endpoint: string) {
  return (
    location.protocol === 'https:' &&
    endpoint.startsWith('ws://') &&
    !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(endpoint)
  );
}

/** Detects a self-hosted server serving this page, then falls back to configured defaults. */
export async function detectServer() {
  try {
    const r = await fetch(`${env.base}chroma-server.json`, { cache: 'no-store' });
    if (r.ok && (await r.json())?.chromashift) {
      const endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
      useNet.setState({ endpoint, sameOrigin: true });
      return;
    }
  } catch {
    // No same-origin server (e.g. GitHub Pages) — expected.
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  const dev = import.meta.env.DEV ? `ws://${location.hostname || 'localhost'}:${DEFAULT_PORT}` : '';
  useNet.setState({ endpoint: saved || env.defaultServer || dev });
}

export function setEndpoint(e: string) {
  useNet.setState({ endpoint: e });
  try {
    localStorage.setItem(STORAGE_KEY, e);
  } catch {
    // storage unavailable; keep it for this session only
  }
}

async function joinOptions(quick = false): Promise<JoinOptions> {
  return {
    ...peerHello(),
    token: (await netHooks.idToken?.().catch(() => undefined)) ?? undefined,
    quick,
  };
}

/** Peer-to-peer hosts are other players' browsers, so they never get the account token. */
export function peerHello(): PeerHello {
  const p = useProfile.getState();
  return {
    name: publicName(p),
    protocol: PROTOCOL_VERSION,
    weapon: p.weapon,
    special: p.special,
    cosmetics: p.cosmetics,
  };
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? 'Unknown error');
  if (/VERSION/.test(msg))
    return 'This server runs a different version of CHROMASHIFT. Refresh to update, or ask the host to update.';
  if (/not found|4212|invalid room/i.test(msg))
    return 'No room with that code. Check the code and try again.';
  if (/full|locked/i.test(msg)) return 'That room is full or already in a match.';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|offline|timed out|1006/i.test(msg))
    return 'Couldn’t reach the server. Check the address and that the server is running.';
  return msg;
}

const serverLink = (room: Room): NetRoom => ({
  send: (type, payload) => room.send(type, payload),
  onMessage: (type, cb) => room.onMessage(type, cb),
  ping: (cb) => room.ping(cb),
  leave: (consented) => room.leave(consented),
  onDrop: (cb) => room.onDrop(cb),
  onReconnect: (cb) => room.onReconnect(cb),
  onLeave: (cb) => room.onLeave(cb),
  onError: (cb) => room.onError(cb),
});

async function enter(
  kind: RoomKind,
  open: () => Promise<NetRoom>,
  explain: (e: unknown) => string | Promise<string>,
  endpoint?: string,
) {
  useNet.setState({ status: 'connecting', error: null });
  try {
    const room = await open();
    bind(room, kind, endpoint);
    useNet.setState({ room, kind, status: 'lobby', ...(endpoint ? { endpoint } : {}) });
    return room;
  } catch (e) {
    const error = await Promise.resolve()
      .then(() => explain(e))
      .catch(() => friendly(e));
    useNet.setState({ status: 'error', error, room: null, kind: null });
    throw new Error(error, { cause: e });
  }
}

const p2pExplain = async (e: unknown) => (await import('./p2p')).explain(e);

function connect(endpoint: string, fn: (c: Client, opts: JoinOptions) => Promise<Room>, quick = false) {
  return enter(
    'server',
    async () => {
      if (!endpoint) throw new Error('No server configured. Enter a server address under Direct connect.');
      if (mixedContentBlocked(endpoint))
        throw new Error(
          'This page is HTTPS, so it can only reach secure (wss://) servers. Open the game from your server’s own address for LAN play, or use a wss:// address.',
        );
      return serverLink(await fn(new Client(endpoint), await joinOptions(quick)));
    },
    friendly,
    endpoint,
  );
}

export const createRoom = (endpoint: string, settings: Partial<LobbySettings>) =>
  connect(endpoint, (c, o) => c.create(ROOM_NAME, { ...o, settings }));

export async function joinByCode(endpoint: string, raw: string) {
  const code = normalizeRoomCode(raw);
  if (!code) {
    useNet.setState({ status: 'error', error: 'Room codes are 5 letters or numbers.' });
    throw new Error('Room codes are 5 letters or numbers.');
  }
  return connect(endpoint, (c, o) => c.joinById(code, o));
}

export const quickPlay = (endpoint: string) =>
  connect(endpoint, (c, o) => c.joinOrCreate(ROOM_NAME, o), true);

/** Hosts a game in this tab. Friends join with the code; nothing to install or configure. */
export const hostGame = (settings?: Partial<LobbySettings>) =>
  enter(
    'host',
    async () =>
      (await import('./p2p')).host(peerHello(), settings, (state) => {
        hostLobbyState = state;
        netHooks.hostLobby?.(state);
      }),
    p2pExplain,
  );

/** Hosting from a menu: shows progress, then the lobby, or the Online screen with the reason it failed. */
export async function hostFromMenu() {
  const ui = useUi.getState();
  ui.setLoading('Opening your game…');
  try {
    await hostGame();
    ui.go('lobby');
  } catch {
    ui.go('online');
  } finally {
    ui.setLoading(null);
  }
}

/**
 * Joins by code. Codes normally belong to games hosted in a browser; on a page served by a
 * dedicated server (LAN), or with a server from an invite link, that server is tried first.
 */
export async function joinGame(raw: string, server?: string) {
  const code = normalizeRoomCode(raw);
  if (!code) {
    useNet.setState({ status: 'error', error: 'Codes are 5 letters or numbers.' });
    throw new Error('Codes are 5 letters or numbers.');
  }
  const net = useNet.getState();
  const dedicated = server ?? (net.sameOrigin ? net.endpoint : undefined);
  if (dedicated) {
    try {
      return await joinByCode(dedicated, code);
    } catch (e) {
      if (server) throw e;
      // Not on this server: it may be a browser-hosted game.
    }
  }
  return enter('peer', async () => (await import('./p2p')).join(code, peerHello()), p2pExplain);
}

function remember(l: LobbyState, endpoint?: string) {
  const host = l.players.find((p) => p.id === l.hostId)?.name ?? 'Unknown host';
  const entry: RecentGame = { code: l.code, host, at: Date.now(), ...(endpoint ? { server: endpoint } : {}) };
  const recent = [
    entry,
    ...useNet.getState().recent.filter((g) => g.code !== l.code || g.server !== entry.server),
  ].slice(0, 6);
  useNet.setState({ recent });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable
  }
}

export function forgetRecent(g: RecentGame) {
  const recent = useNet.getState().recent.filter((x) => x !== g);
  useNet.setState({ recent });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable
  }
}

function bind(room: NetRoom, kind: RoomKind, endpoint?: string) {
  let first = true;
  room.onMessage(MSG.LOBBY, (l: LobbyState & { you: number }) => {
    if (useNet.getState().room !== room) return;
    if (first && kind !== 'host' && !l.quick) remember(l, kind === 'server' ? endpoint : undefined);
    first = false;
    useNet.setState({ lobby: l, you: l.you, status: l.phase === 'lobby' ? 'lobby' : 'match' });
    // Everyone in the room can talk, in the lobby and in matches.
    voice.join(l.code, l.you, l.players.filter((p) => !p.bot && p.connected && p.id !== l.you).map((p) => p.id));
  });
  room.onMessage(MSG.CHAT, (line: ChatLine) => {
    if (useNet.getState().room === room) useChat.getState().push(line);
  });
  room.onMessage(MSG.MODS, (m: Record<number, Mods>) => {
    if (useNet.getState().room === room) useMods.setState({ mods: m });
  });
  room.onMessage(MSG.GRANT, (g: Grant) => {
    if (useNet.getState().room === room) applyGrant(g);
  });
  room.onMessage(MSG.MATCH, (start: MatchStart) => {
    useNet.setState({ status: 'match', you: start.you });
    netHooks.onMatch?.(room, start);
  });
  room.onMessage(MSG.NOTICE, (n: { text: string; kind?: 'info' | 'warn' | 'error' }) =>
    useUi.getState().toast({ text: n.text, kind: n.kind ?? 'info' }),
  );
  room.onDrop(() => useNet.setState({ reconnecting: true }));
  room.onReconnect(() => {
    useNet.setState({ reconnecting: false });
    useUi.getState().toast({ text: 'Reconnected.', kind: 'success' });
  });
  room.onLeave((code: number) => {
    if (useNet.getState().room !== room) return;
    voice.leave();
    useChat.getState().clear();
    const wasMatch = useNet.getState().status === 'match';
    useNet.setState({ room: null, kind: null, lobby: null, status: 'idle', reconnecting: false });
    const toast = useUi.getState().toast;
    if (code === 4100) toast({ text: 'The host closed the game.', kind: 'info' });
    else if (code === 4101) toast({ text: 'Lost the connection to the host.', kind: 'warn' });
    else if (code > 1000 && code !== 4000) toast({ text: 'Disconnected from the server.', kind: 'warn' });
    if (wasMatch) netHooks.onLeftMatch?.();
    else if (['lobby'].includes(useUi.getState().screen)) useUi.getState().go('online');
  });
  room.onError((_code: number, message?: string) =>
    useUi.getState().toast({ text: friendly(message), kind: 'error' }),
  );
}

export function leaveRoom() {
  const room = useNet.getState().room;
  voice.leave();
  useChat.getState().clear();
  useNet.setState({ room: null, kind: null, lobby: null, status: 'idle', reconnecting: false });
  void room?.leave(true);
}

export function send(type: string, payload?: unknown) {
  useNet.getState().room?.send(type, payload);
}
