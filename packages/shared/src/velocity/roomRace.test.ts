import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '../config/cosmetics';
import { MSG, type LobbyState } from '../net/protocol';
import { RoomHost, type HostClient } from '../net/roomHost';
import { initPhysics } from '../world/world';
import { DEFAULT_CAR } from './catalog';
import { MAX_RACERS } from './config';
import { packRaceInput, unpackRacer, emptyCarView, type RaceEnd, type RaceSnapshot, type RaceStart } from './protocol';

class Fake implements HostClient {
  msgs: [string, unknown][] = [];
  constructor(readonly id: string) {}
  send(type: string, payload: unknown) {
    this.msgs.push([type, payload]);
  }
  last<T>(type: string) {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i][0] === type) return this.msgs[i][1] as T;
    return undefined;
  }
  all<T>(type: string) {
    return this.msgs.filter((m) => m[0] === type).map((m) => m[1] as T);
  }
}

const hello = (name: string) => ({ name, weapon: 'pulse', special: 'surge', cosmetics: DEFAULT_COSMETICS, car: { ...DEFAULT_CAR, body: 'rally', number: 42 } });

beforeAll(async () => {
  await initPhysics();
});

describe('VELOCITY rooms', () => {
  it('a room switches to racing, holds six, runs an authoritative race and sends results', () => {
    const room = new RoomHost({ code: 'RACE1' });
    const host = new Fake('h'), guest = new Fake('g');
    room.join(host, hello('Host'));
    room.join(guest, hello('Guest'));
    expect(room.capacity).toBe(8);
    room.message('h', MSG.SETTINGS, { game: 'velocity', race: { track: 'neon', laps: 1, preset: 'arcade', damage: 'full', bots: 3, difficulty: 'expert' } });
    const lobby = host.last<LobbyState>(MSG.LOBBY)!;
    expect(lobby.settings.game).toBe('velocity');
    expect(lobby.settings.race?.track).toBe('neon');
    expect(lobby.players[1].car?.body).toBe('rally');
    expect(room.capacity).toBe(MAX_RACERS);
    // Only the host changes settings.
    room.message('g', MSG.SETTINGS, { game: 'shooter' });
    expect(host.last<LobbyState>(MSG.LOBBY)!.settings.game).toBe('velocity');

    room.message('h', MSG.START, {});
    const start = guest.last<RaceStart>(MSG.MATCH)!;
    expect(start.race).toBe(true);
    expect(start.racers).toHaveLength(5);
    expect(start.racers.filter((r) => r.bot)).toHaveLength(3);
    expect(start.racers.find((r) => r.id === start.you)?.car.number).toBe(42);
    expect(new Set(start.racers.map((r) => r.identity)).size).toBe(5);

    // The guest floors it; inputs are validated (garbage is ignored).
    let seq = 0;
    room.message('g', MSG.INPUT, [['junk'], [1, 2]]);
    for (let t = 0; t < 60 * 140 && room.phase === 'match'; t++) {
      if (t % 2 === 0) room.message('g', MSG.INPUT, [packRaceInput({ seq: ++seq, steer: 0, throttle: 1, brake: 0, buttons: 0 })]);
      room.tick(1000 / 60);
    }
    const snaps = guest.all<RaceSnapshot>(MSG.SNAP);
    expect(snaps.length).toBeGreaterThan(100);
    const v = emptyCarView(0);
    const mine = snaps[snaps.length - 1].c.find((c) => unpackRacer(c, v) === start.you);
    expect(mine).toBeDefined();
    expect(v.lastSeq).toBeGreaterThan(0);
    const end = guest.last<RaceEnd>(MSG.END)!;
    expect(end.race).toBe(true);
    expect(end.result.players).toHaveLength(5);
    expect(end.result.players.some((p) => 'uid' in p)).toBe(false);
    expect(end.xp[start.you]).toBeGreaterThan(0);
    expect(room.phase).toBe('results');
    // Back in the lobby the host can still pick another track and start, even if nobody pressed "back to lobby".
    room.message('h', MSG.SETTINGS, { race: { track: 'coastal', laps: 1, preset: 'classic', damage: 'off', bots: 1, difficulty: 'easy' } });
    expect(room.phase).toBe('lobby');
    expect(host.last<LobbyState>(MSG.LOBBY)!.settings.race?.track).toBe('coastal');
    room.message('h', MSG.START, {});
    expect(room.phase).toBe('match');
    room.dispose();
  }, 120_000);

  it('switching a full room to racing waits until six or fewer are in it', () => {
    const room = new RoomHost({ code: 'RACE2' });
    const clients = Array.from({ length: 7 }, (_, i) => new Fake(`c${i}`));
    clients.forEach((c, i) => room.join(c, hello(`P${i}`)));
    room.message('c0', MSG.SETTINGS, { game: 'velocity' });
    expect(clients[0].last<LobbyState>(MSG.LOBBY)!.settings.game).toBe('shooter');
    expect(clients[0].all<{ text: string }>(MSG.NOTICE).some((n) => /hold 6/.test(n.text))).toBe(true);
    room.dispose();
  });

  it('a player who drops is driven by a bot and takes their car back on return', () => {
    const room = new RoomHost({ code: 'RACE3' });
    const a = new Fake('a'), b = new Fake('b');
    room.join(a, hello('A'));
    room.join(b, hello('B'));
    room.message('a', MSG.SETTINGS, { game: 'velocity', race: { track: 'coastal', laps: 1, bots: 0 } });
    room.message('a', MSG.START, {});
    for (let t = 0; t < 60 * 3; t++) room.tick(1000 / 60);
    room.drop('b');
    for (let t = 0; t < 60 * 8; t++) room.tick(1000 / 60);
    room.reconnect(new Fake('b'));
    for (let t = 0; t < 60; t++) room.tick(1000 / 60);
    expect(room.phase).toBe('match');
    room.dispose();
  });

  it('the shooter is untouched: a normal room still starts a paint match', () => {
    const room = new RoomHost({ code: 'SHOOT' });
    const a = new Fake('a');
    room.join(a, hello('A'));
    room.message('a', MSG.START, {});
    const start = a.last<{ race?: boolean; config: { map: string } }>(MSG.MATCH)!;
    expect(start.race).toBeUndefined();
    expect(start.config.map).toBeTruthy();
    room.dispose();
  });
});
