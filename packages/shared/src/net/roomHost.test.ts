import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initPhysics } from '../world/world';
import { INTRO_TIME } from '../sim/simulation';
import { MSG, packInput, type MatchStart, type Snapshot } from './protocol';
import { RoomHost, type HostClient } from './roomHost';

const seat = (id: string) => {
  const inbox: [string, unknown][] = [];
  const client: HostClient = { id, send: (type, payload) => inbox.push([type, payload]) };
  return { client, inbox, last: <T>(type: string) => inbox.filter(([t]) => t === type).at(-1)?.[1] as T };
};

beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RoomHost', () => {
  it('runs a match without any network, stops stalled players, and resumes seats without restarting the match', () => {
    vi.useFakeTimers();
    // No bots: they move unpredictably and could bump the player this test watches.
    const room = new RoomHost({ code: 'ABCDE', settings: { botFill: false } });
    const a = seat('a'),
      b = seat('b');
    room.join(a.client, { name: 'Ann' });
    room.join(b.client, { name: 'Ben', cosmetics: 42 as never });
    expect(room.size).toBe(2);

    // Only the host (first to join) can start.
    room.message('b', MSG.START, null);
    expect(room.phase).toBe('lobby');
    room.message('a', MSG.START, null);
    expect(room.phase).toBe('match');
    const you = a.last<MatchStart>(MSG.MATCH).you;

    const step = (seconds: number) => {
      for (let t = 0; t < seconds * 60; t++) {
        vi.advanceTimersByTime(1000 / 60);
        room.tick(1000 / 60);
      }
    };
    const me = () => a.last<Snapshot>(MSG.SNAP).p.find((x) => x[0] === you)!;
    const pos = () => ({ x: me()[1] / 1000, z: me()[3] / 1000 });
    step(INTRO_TIME + 0.2);

    // One burst of "run towards the middle of the map" (open ground), then silence,
    // as from a hidden tab or a stalled link. Forward at yaw θ is (-sin θ, -cos θ).
    const start = pos();
    const yaw = Math.atan2(start.x, start.z);
    room.message(
      'a',
      MSG.INPUT,
      Array.from({ length: 6 }, (_, i) =>
        packInput({ seq: i + 1, mx: 0, mz: 1, yaw, pitch: 0, aimYaw: yaw, aimPitch: 0, buttons: 0 }),
      ),
    );
    step(1);
    const stopped = pos();
    step(1);
    const later = pos();
    expect(Math.hypot(stopped.x - start.x, stopped.z - start.z)).toBeGreaterThan(0.5);
    expect(Math.hypot(later.x - stopped.x, later.z - stopped.z)).toBeLessThan(0.05);

    // A dropped player comes back: paint is resynced, but the match isn't announced again.
    room.drop('b');
    const matches = b.inbox.filter(([t]) => t === MSG.MATCH).length;
    room.reconnect(b.client);
    expect(b.inbox.filter(([t]) => t === MSG.MATCH).length).toBe(matches);
    expect(b.inbox.at(-2)?.[0]).toBe(MSG.SYNC);
    room.dispose();
  });

  it('runs admin commands only for authorised players and applies size, speed and god', async () => {
    const room = new RoomHost({ code: 'ADMIN', settings: { botFill: false }, authorize: async ({ isHost }) => (isHost ? 'owner' : null) });
    const a = seat('a'),
      b = seat('b');
    room.join(a.client, { name: 'Ann' });
    room.join(b.client, { name: 'Ben' });
    room.message('a', MSG.START, null);
    const notice = (s: ReturnType<typeof seat>) => (s.last<{ text: string }>(MSG.NOTICE) ?? { text: '' }).text;
    const flush = () => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());

    room.message('b', MSG.CMD, { line: '/size Ann 4' });
    await flush();
    expect(notice(b)).toContain('not an admin');

    room.message('a', MSG.CMD, { line: '/size Ben 4.6' });
    await flush();
    expect(notice(a)).toContain('4.6');
    expect(b.last<Record<number, { size: number }>>(MSG.MODS)[b.last<MatchStart>(MSG.MATCH).you].size).toBe(4.6);

    room.message('a', MSG.CMD, { line: '/give Ben coins 500' });
    await flush();
    expect(b.last<{ coins: number }>(MSG.GRANT)).toEqual({ coins: 500 });

    room.message('a', MSG.CMD, { line: '/admin Ben' });
    await flush();
    room.message('b', MSG.CMD, { line: '/god me on' });
    await flush();
    expect(notice(b)).toContain('God mode');
    room.dispose();
  });
});

describe('joining a running match', () => {
  it('a friend replaces a bot with their own weapon; the owner is added on top and nobody is replaced', () => {
    vi.useFakeTimers();
    const room = new RoomHost({ code: 'ABCDE', settings: { botFill: true } });
    const a = seat('a');
    room.join(a.client, { name: 'Ann' });
    room.message('a', MSG.START, null);
    const sim = (room as unknown as { sim: { players: { id: number; info: { bot: boolean; weapon: string; name: string; admin?: boolean } }[] } }).sim;
    const bots = sim.players.filter((p) => p.info.bot).length;
    const total = sim.players.length;

    const f = seat('f');
    room.join(f.client, { name: 'Fay', weapon: 'roller' });
    expect(sim.players.length).toBe(total);
    expect(sim.players.filter((p) => p.info.bot).length).toBe(bots - 1);
    const fay = sim.players.find((p) => p.info.name === 'Fay')!;
    expect(fay.info.weapon).toBe('roller');
    expect(fay.info.admin).toBeUndefined();
    // Players already in the match are told about the new roster.
    expect(a.inbox.some(([t]) => t === MSG.ROSTER)).toBe(true);

    const o = seat('o');
    room.join(o.client, { name: 'Owner' }, { uid: 'u1', username: 'Owner', admin: true });
    expect(sim.players.length).toBe(total + 1);
    expect(sim.players.filter((p) => p.info.bot).length).toBe(bots - 1);
    expect(sim.players.find((p) => p.info.name === 'Owner')!.info.admin).toBe(true);
  });
});
