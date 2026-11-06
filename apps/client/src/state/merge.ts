import type { Cosmetics } from '@chromashift/shared';
import type { Settings } from '../settings/settings';
import type { QuestState, Stats } from './profile';

/** The part of an account that follows the player between devices (users/{uid}). */
export interface Synced {
  displayName: string;
  xp: number;
  stats: Stats;
  weapon: string;
  special: string;
  cosmetics: Cosmetics;
  coins: number;
  owned: string[];
  favs: string[];
  quests: QuestState;
  settings: Partial<Settings>;
}

/** JSON with sorted keys, so equal data compares equal whatever order the keys arrived in. */
export const stable = (x: unknown): string =>
  Array.isArray(x)
    ? `[${x.map(stable).join(',')}]`
    : x && typeof x === 'object'
      ? `{${Object.keys(x)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(x ?? null);

export const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/** Choices: whichever side changed since the last sync wins; this device wins a tie. */
const pick = <T>(base: T, local: T, remote: T) => (same(local, base) ? remote : local);
/** Earnings: both devices' gains (or spending) since the last sync count. */
const add = (base = 0, local = 0, remote = 0) => Math.max(0, remote + local - base);

/**
 * Three-way merge for when another device saved while this one had unsynced changes: coins, XP
 * and stats add up, purchases and claimed quests are kept from both sides, and choices (look,
 * loadout, settings, favourites) go to whichever side changed them.
 * ponytail: a quest claimed on both devices inside one sync window pays twice; needs server-side claims to fix.
 */
export function mergeSynced(base: Synced, local: Synced, remote: Synced): Synced {
  const stats: Stats = { ...remote.stats, weaponGames: { ...remote.stats.weaponGames } };
  for (const k of ['games', 'wins', 'losses', 'draws', 'kills', 'deaths', 'assists', 'paint'] as const)
    stats[k] = add(base.stats[k], local.stats[k], remote.stats[k]);
  stats.bestPaint = Math.max(local.stats.bestPaint ?? 0, remote.stats.bestPaint ?? 0);
  for (const w of new Set([
    ...Object.keys(local.stats.weaponGames),
    ...Object.keys(remote.stats.weaponGames),
  ]))
    stats.weaponGames[w] = add(
      base.stats.weaponGames[w],
      local.stats.weaponGames[w],
      remote.stats.weaponGames[w],
    );
  const progress = { ...remote.quests.progress };
  for (const [id, n] of Object.entries(local.quests.progress)) progress[id] = Math.max(n, progress[id] ?? 0);
  return {
    displayName: pick(base.displayName, local.displayName, remote.displayName),
    weapon: pick(base.weapon, local.weapon, remote.weapon),
    special: pick(base.special, local.special, remote.special),
    cosmetics: pick(base.cosmetics, local.cosmetics, remote.cosmetics),
    favs: pick(base.favs, local.favs, remote.favs),
    settings: pick(base.settings, local.settings, remote.settings),
    xp: add(base.xp, local.xp, remote.xp),
    coins: add(base.coins, local.coins, remote.coins),
    owned: [...new Set([...remote.owned, ...local.owned])],
    quests: {
      day: Math.max(local.quests.day, remote.quests.day),
      week: Math.max(local.quests.week, remote.quests.week),
      progress,
      claimed: [...new Set([...remote.quests.claimed, ...local.quests.claimed])],
    },
    stats,
  };
}
