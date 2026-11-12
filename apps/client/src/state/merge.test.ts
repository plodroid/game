import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '@chromashift/shared';
import { mergeSynced, same, type Synced } from './merge';
import { emptyRacing } from '../velocity/racing';

const base: Synced = {
  displayName: 'Ink',
  xp: 1000,
  stats: {
    games: 10,
    wins: 5,
    losses: 5,
    draws: 0,
    kills: 40,
    deaths: 30,
    assists: 9,
    paint: 9000,
    bestPaint: 1200,
    weaponGames: { pulse: 10 },
  },
  weapon: 'pulse',
  special: 'surge',
  cosmetics: DEFAULT_COSMETICS,
  coins: 2000,
  owned: ['hair:mohawk'],
  favs: [],
  quests: { day: 1, week: 1, progress: { 'd-play': 1 }, claimed: [] },
  settings: { audio: { master: 0.8 } as never },
  racing: emptyRacing(),
};

describe('mergeSynced', () => {
  it('keeps purchases, coins and progress from both devices', () => {
    // This device bought a hat (−600) and favourited it; the other played a match (+150 coins).
    const local = {
      ...base,
      coins: 1400,
      owned: [...base.owned, 'headgear:crown'],
      favs: ['headgear:crown'],
    };
    const remote = {
      ...base,
      coins: 2150,
      xp: 1600,
      stats: { ...base.stats, games: 11, wins: 6, bestPaint: 1500, weaponGames: { pulse: 10, dozer: 1 } },
      quests: { ...base.quests, progress: { 'd-play': 2 } },
      settings: { audio: { master: 0.4 } as never },
    };
    const m = mergeSynced(base, local, remote);
    expect(m.coins).toBe(1550);
    expect(m.xp).toBe(1600);
    expect(m.owned.sort()).toEqual(['hair:mohawk', 'headgear:crown']);
    expect(m.favs).toEqual(['headgear:crown']);
    expect(m.stats.games).toBe(11);
    expect(m.stats.bestPaint).toBe(1500);
    expect(m.stats.weaponGames).toEqual({ pulse: 10, dozer: 1 });
    expect(m.quests.progress['d-play']).toBe(2);
    // Settings only changed on the other device, so they come over.
    expect(m.settings).toEqual(remote.settings);
  });

  it("keeps this device's choice when both changed it", () => {
    const m = mergeSynced(base, { ...base, weapon: 'dozer' }, { ...base, weapon: 'brush' });
    expect(m.weapon).toBe('dozer');
  });

  it('compares regardless of key order', () => {
    expect(same({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
  });
});
