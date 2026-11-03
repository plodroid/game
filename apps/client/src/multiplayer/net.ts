import { Client, type Room } from '@colyseus/sdk';
import { create } from 'zustand';
import {
  DEFAULT_PORT,
  MSG,
  normalizeRoomCode,
  PROTOCOL_VERSION,
  ROOM_NAME,
  type JoinOptions,
  type LobbySettings,
  type LobbyState,
  type MatchStart,
} from '@chromashift/shared';
import { env } from '../env';
import { publicName, useProfile } from '../state/profile';
import { useUi } from '../state/ui';

export type NetStatus = 'idle' | 'connecting' | 'lobby' | 'match' | 'error';

interface NetStore {
  status: NetStatus;
  error: string | null;
  endpoint: string;
  /** A game server is serving this page (LAN / self-hosted). */
  sameOrigin: boolean;
  lobby: LobbyState | null;
  you: number;
  room: Room | null;
  reconnecting: boolean;
}

export const useNet = create<NetStore>()(() => ({
  status: 'idle',
  error: null,
  endpoint: '',
  sameOrigin: false,
  lobby: null,
  you: -1,
  room: null,
  reconnecting: false,
}));

/** Set by the session layer to hand a starting match to the engine. */
export const netHooks: {
  onMatch: ((room: Room, start: MatchStart) => void) | null;
  onLeftMatch: (() => void) | null;
  idToken: (() => Promise<string | undefined>) | null;
} = { onMatch: null, onLeftMatch: null, idToken: null };

const STORAGE_KEY = 'chromashift.server';

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
  return location.protocol === 'https:' && endpoint.startsWith('ws://') && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(endpoint);
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
  const p = useProfile.getState();
  return {
    name: publicName(p),
    protocol: PROTOCOL_VERSION,
    token: (await netHooks.idToken?.().catch(() => undefined)) ?? undefined,
    weapon: p.weapon,
    special: p.special,
    cosmetics: p.cosmetics,
    quick,
  };
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? 'Unknown error');
  if (/VERSION/.test(msg)) return 'This server runs a different version of CHROMASHIFT. Refresh to update, or ask the host to update.';
  if (/not found|4212|invalid room/i.test(msg)) return 'No room with that code. Check the code and try again.';
  if (/full|locked/i.test(msg)) return 'That room is full or already in a match.';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|offline|timed out|1006/i.test(msg)) return 'Couldn’t reach the server. Check the address and that the server is running.';
  return msg;
}

async function connect(endpoint: string, fn: (c: Client, opts: JoinOptions) => Promise<Room>, quick = false) {
  if (!endpoint) throw new Error('No server configured. Enter a server address under Direct connect.');
  if (mixedContentBlocked(endpoint))
    throw new Error('This page is HTTPS, so it can only reach secure (wss://) servers. Open the game from your server’s own address for LAN play, or use a wss:// address.');
  useNet.setState({ status: 'connecting', error: null });
  try {
    const c = new Client(endpoint);
    const room = await fn(c, await joinOptions(quick));
    bind(room);
    useNet.setState({ room, endpoint, status: 'lobby' });
    return room;
  } catch (e) {
    const error = friendly(e);
    useNet.setState({ status: 'error', error, room: null });
    throw new Error(error, { cause: e });
  }
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

export const quickPlay = (endpoint: string) => connect(endpoint, (c, o) => c.joinOrCreate(ROOM_NAME, o), true);

function bind(room: Room) {
  room.onMessage(MSG.LOBBY, (l: LobbyState & { you: number }) => {
    useNet.setState({ lobby: l, you: l.you, status: l.phase === 'lobby' ? 'lobby' : 'match' });
  });
  room.onMessage(MSG.MATCH, (start: MatchStart) => {
    useNet.setState({ status: 'match', you: start.you });
    netHooks.onMatch?.(room, start);
  });
  room.onMessage(MSG.NOTICE, (n: { text: string; kind?: 'info' | 'warn' | 'error' }) => useUi.getState().toast({ text: n.text, kind: n.kind ?? 'info' }));
  room.onDrop(() => useNet.setState({ reconnecting: true }));
  room.onReconnect(() => {
    useNet.setState({ reconnecting: false });
    useUi.getState().toast({ text: 'Reconnected.', kind: 'success' });
  });
  room.onLeave((code: number) => {
    const wasMatch = useNet.getState().status === 'match';
    useNet.setState({ room: null, lobby: null, status: 'idle', reconnecting: false });
    if (code > 1000 && code !== 4000) useUi.getState().toast({ text: 'Disconnected from the server.', kind: 'warn' });
    if (wasMatch) netHooks.onLeftMatch?.();
    else if (['lobby'].includes(useUi.getState().screen)) useUi.getState().go('online');
  });
  room.onError((_code: number, message?: string) => useUi.getState().toast({ text: friendly(message), kind: 'error' }));
}

export function leaveRoom() {
  const room = useNet.getState().room;
  useNet.setState({ room: null, lobby: null, status: 'idle' });
  void room?.leave(true);
}

export function send(type: string, payload?: unknown) {
  useNet.getState().room?.send(type, payload);
}
