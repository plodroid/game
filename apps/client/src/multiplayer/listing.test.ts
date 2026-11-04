import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbyState } from '@chromashift/shared';

// Firebase and the network layer are stood in for: this checks when listings are written and removed.
const fb = { publishGame: vi.fn(async (_g: unknown) => {}), unpublishGame: vi.fn(async () => {}) };
const account = { status: 'signedIn' };
let lobby: LobbyState | null = null;
const hooks: { hostLobby: ((s: LobbyState | null) => void) | null } = { hostLobby: null };

vi.mock('../auth/account', () => ({
  accounts: () => Promise.resolve(fb),
  describeAuthError: (e: unknown) => String(e),
  useAccount: { getState: () => account },
}));
vi.mock('./net', () => ({ netHooks: hooks, currentHostLobby: () => lobby }));
vi.stubGlobal('window', globalThis);

const { setPublic, useListing } = await import('./listing');

const state = (players: number, phase: LobbyState['phase'] = 'lobby'): LobbyState => ({
  code: 'K7QPX',
  phase,
  hostId: 1,
  quick: false,
  settings: { map: 'core', mode: 'turf', duration: 180, botFill: true, botDifficulty: 'normal' },
  players: Array.from({ length: players }, (_, i) => ({
    id: i + 1,
    name: i ? `Guest${i}` : 'Mia',
    team: (i % 2) as 0 | 1,
    ready: false,
    weapon: 'pulse',
    special: 'surge',
    cosmetics: { hair: 'fin', headgear: 'none', outfit: 'jacket', accent: 'graphite', skin: 1, emote: 'wave' },
    bot: false,
    connected: true,
    verified: false,
  })),
});
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  fb.publishGame.mockClear();
  fb.unpublishGame.mockClear();
  account.status = 'signedIn';
  lobby = state(1);
});
afterEach(async () => {
  await setPublic(false);
  vi.useRealTimers();
});

describe('public game listing', () => {
  it('lists the hosted game, refreshes it on changes and every minute, and removes it when the game closes', async () => {
    await setPublic(true);
    await flush();
    expect(fb.publishGame).toHaveBeenCalledTimes(1);
    expect(fb.publishGame.mock.calls[0][0]).toMatchObject({ code: 'K7QPX', name: 'Mia', map: 'core', mode: 'turf', players: 1, phase: 'lobby' });
    expect(useListing.getState()).toMatchObject({ wanted: true, live: true, error: null });

    // A friend joins: the listing catches up within a couple of seconds.
    lobby = state(2);
    hooks.hostLobby?.(lobby);
    await flush(2000);
    expect(fb.publishGame).toHaveBeenCalledTimes(2);
    expect(fb.publishGame.mock.calls[1][0]).toMatchObject({ players: 2 });

    // Nothing changes for a minute: it still re-announces itself so it doesn't expire.
    await flush(60_000);
    expect(fb.publishGame).toHaveBeenCalledTimes(3);

    // The host closes the game: the listing goes and nothing is written after.
    hooks.hostLobby?.(null);
    await flush();
    expect(fb.unpublishGame).toHaveBeenCalledTimes(1);
    expect(useListing.getState()).toMatchObject({ wanted: false, live: false });
    await flush(120_000);
    expect(fb.publishGame).toHaveBeenCalledTimes(3);
  });

  it('needs an account, and explains a database that refuses listings', async () => {
    account.status = 'signedOut';
    await setPublic(true);
    await flush();
    expect(fb.publishGame).not.toHaveBeenCalled();
    expect(useListing.getState().error).toMatch(/Sign in/);

    account.status = 'signedIn';
    fb.publishGame.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await setPublic(true);
    await flush();
    expect(useListing.getState()).toMatchObject({ wanted: false, live: false });
    expect(useListing.getState().error).toMatch(/aren’t switched on/);
  });
});
