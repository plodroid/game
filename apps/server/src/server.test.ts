import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { Server } from '@colyseus/core';
import {
  DEFAULT_COSMETICS,
  MSG,
  packInput,
  PHASES,
  PROTOCOL_VERSION,
  ROOM_NAME,
  unpackEvent,
  type LobbyState,
  type MatchEnd,
  type MatchStart,
  type Snapshot,
} from '@chromashift/shared';
import { startServer } from './server';

const PORT = 25670;
const URL = `ws://127.0.0.1:${PORT}`;
let server: Server;

const opts = (name: string, protocol = PROTOCOL_VERSION) => ({ name, protocol, weapon: 'pulse', special: 'surge', cosmetics: DEFAULT_COSMETICS });
const next = <T>(room: Room, type: string, pred: (m: T) => boolean = () => true, ms = 8000) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), ms);
    const off = room.onMessage(type, (m: T) => {
      if (!pred(m)) return;
      clearTimeout(t);
      off();
      res(m);
    });
  });

beforeAll(async () => {
  server = await startServer(PORT, '127.0.0.1');
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

describe('multiplayer server', () => {
  it('runs a private room end to end: code join, settings, authoritative match, disconnect', async () => {
    const a = await new Client(URL).create(ROOM_NAME, opts('Alice'));
    const lobbyA = await next<LobbyState & { you: number }>(a, MSG.LOBBY);
    expect(lobbyA.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(lobbyA.hostId).toBe(lobbyA.you);

    // Codes are case-insensitive for players; the room id is the canonical upper-case code.
    const b = await new Client(URL).joinById(lobbyA.code, opts('Bob'));
    const lobbyB = await next<LobbyState & { you: number }>(b, MSG.LOBBY, (l) => l.players.length === 2);
    expect(lobbyB.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    expect(new Set(lobbyB.players.map((p) => p.team)).size).toBe(2);

    // Only the host may change settings.
    b.send(MSG.SETTINGS, { duration: 300 });
    a.send(MSG.SETTINGS, { duration: 60, map: 'core', mode: 'turf', botDifficulty: 'hard' });
    const tuned = await next<LobbyState>(a, MSG.LOBBY, (l) => l.settings.duration === 60);
    expect(tuned.settings.map).toBe('core');

    const startA = next<MatchStart>(a, MSG.MATCH);
    const startB = next<MatchStart>(b, MSG.MATCH);
    a.send(MSG.START);
    const [ma, mb] = await Promise.all([startA, startB]);
    expect(ma.players.length).toBe(8);
    expect(ma.players.filter((p) => p.bot).length).toBe(6);
    expect(ma.you).not.toBe(mb.you);

    // Feed Alice a forward-walking, firing input stream (with one garbage packet mixed in).
    let seq = 0;
    const timer = setInterval(() => {
      const batch = [packInput({ seq: ++seq, mx: 0, mz: 1, yaw: Math.PI, pitch: -0.3, aimYaw: Math.PI, aimPitch: -0.3, buttons: 1 })];
      a.send(MSG.INPUT, seq === 5 ? [[1, 'x'], ...batch] : batch);
    }, 33);

    let paints = 0, alicePos: number[] = [];
    const firstPos: number[] = [];
    const playing = new Promise<Snapshot>((res) => {
      a.onMessage(MSG.SNAP, (s: Snapshot) => {
        paints += s.e.map(unpackEvent).filter((e) => e?.t === 'paint').length;
        const me = s.p.find((p) => p[0] === ma.you)!;
        if (!firstPos.length) firstPos.push(me[1], me[3]);
        alicePos = [me[1], me[3]];
        if (PHASES[s.ph] === 'playing' && s.k > 600) res(s);
      });
    });
    const snap = await playing;
    clearInterval(timer);
    expect(paints).toBeGreaterThan(20);
    expect(snap.sc[0] + snap.sc[1]).toBeGreaterThan(0);
    // Server moved Alice according to her inputs.
    expect(Math.hypot(alicePos[0] - firstPos[0], alicePos[1] - firstPos[1]) / 1000).toBeGreaterThan(3);

    // Bob drops out: the match keeps running for Alice, with a bot covering Bob's slot.
    await b.leave(true);
    const after = await next<Snapshot>(a, MSG.SNAP);
    expect(after.p.length).toBe(8);
    await a.leave(true);
  });

  it('plays a match to the end and reports validated results', async () => {
    const a = await new Client(URL).create(ROOM_NAME, opts('Solo'));
    await next(a, MSG.LOBBY);
    a.send(MSG.SETTINGS, { duration: 60 });
    await next<LobbyState>(a, MSG.LOBBY, (l) => l.settings.duration === 60);
    const end = next<MatchEnd>(a, MSG.END, () => true, 90_000);
    a.send(MSG.START);
    const r = await end;
    expect(r.result.players.length).toBe(8);
    expect(r.result.players.every((p) => !('uid' in p) || p.uid === undefined)).toBe(true);
    expect(r.result.coverage[0] + r.result.coverage[1]).toBeGreaterThan(10);
    expect(Object.keys(r.xp)).toHaveLength(1);
    await a.leave(true);
  }, 100_000);

  it('rejects bad codes and mismatched versions', async () => {
    await expect(new Client(URL).joinById('ZZZZZ', opts('Eve'))).rejects.toThrow();
    await expect(new Client(URL).create(ROOM_NAME, opts('Old', PROTOCOL_VERSION + 99))).rejects.toThrow(/VERSION/);
  });
});
