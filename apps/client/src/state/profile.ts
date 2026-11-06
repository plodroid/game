import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  coinsEarned,
  COSMETIC_ITEMS,
  dailyQuests,
  dayIndex,
  DEFAULT_COSMETICS,
  levelInfo,
  questProgress,
  sanitizeCosmetics,
  SPECIAL_IDS,
  STARTING_COINS,
  WEAPON_IDS,
  WEAPONS,
  weekIndex,
  weeklyQuests,
  type Cosmetics,
  type MatchResult,
  type SpecialId,
  type WeaponId,
} from '@chromashift/shared';

export interface Stats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  kills: number;
  deaths: number;
  assists: number;
  paint: number;
  bestPaint: number;
  weaponGames: Record<string, number>;
}

export interface Profile {
  /** Firebase uid when signed in, null for guests. */
  uid: string | null;
  username: string;
  displayName: string;
  createdAt: number;
  xp: number;
  stats: Stats;
  weapon: WeaponId;
  special: SpecialId;
  cosmetics: Cosmetics;
  coins: number;
  /** Item keys bought (`slot:id`, `weapon:id`); starter items are always owned. */
  owned: string[];
  quests: QuestState;
  /** Local changes not yet synced to the cloud. */
  dirty: boolean;
  updatedAt: number;
}

export interface QuestState {
  day: number;
  week: number;
  /** Progress by quest id. */
  progress: Record<string, number>;
  claimed: string[];
}

const freshQuests = (): QuestState => ({ day: dayIndex(), week: weekIndex(), progress: {}, claimed: [] });

/** Clears the quests of a day or week that has ended. */
function rollQuests(q: QuestState): QuestState {
  const day = dayIndex(), week = weekIndex();
  if (q.day === day && q.week === week) return q;
  const keep = (id: string) => (id.startsWith('d-') ? q.day === day : q.week === week);
  return {
    day,
    week,
    progress: Object.fromEntries(Object.entries(q.progress).filter(([id]) => keep(id))),
    claimed: q.claimed.filter(keep),
  };
}

/** Starter items and the original weapons belong to everyone. */
export const FREE = new Set([
  ...COSMETIC_ITEMS.filter((i) => i.price === 0).map((i) => i.key),
  ...WEAPON_IDS.filter((w) => WEAPONS[w].price === 0).map((w) => `weapon:${w}`),
]);

const emptyStats = (): Stats => ({ games: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, assists: 0, paint: 0, bestPaint: 0, weaponGames: {} });

function guestName() {
  return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

export const newProfile = (): Profile => ({
  uid: null,
  username: '',
  displayName: guestName(),
  createdAt: Date.now(),
  xp: 0,
  stats: emptyStats(),
  weapon: 'pulse',
  special: 'surge',
  cosmetics: DEFAULT_COSMETICS,
  coins: STARTING_COINS,
  owned: [],
  quests: freshQuests(),
  dirty: false,
  updatedAt: Date.now(),
});

interface ProfileStore extends Profile {
  hydrated: boolean;
  patch(p: Partial<Profile>): void;
  /** Records a match: stats, XP, coins and quest progress. Returns what the results screen shows. */
  recordMatch(r: MatchResult, you: number, xp: number): { xpBefore: number; levelBefore: number; coins: number };
  owns(key: string): boolean;
  /** Spends coins on an item. False if it's owned already or there aren't enough coins. */
  buy(key: string, price: number): boolean;
  /** Pays out a finished quest once. */
  claimQuest(id: string): number;
  /** Starts the new day's or week's quests if the old ones ran out. */
  refreshQuests(): void;
  replace(p: Profile): void;
  reset(): void;
}

// IndexedDB keeps the profile out of localStorage size limits and survives offline.
const idb = createJSONStorage<ProfileStore>(() => ({
  getItem: async (k) => (await get<string>(k)) ?? null,
  setItem: (k, v) => set(k, v),
  removeItem: (k) => del(k),
}));

export const useProfile = create<ProfileStore>()(
  persist(
    (setState, getState) => ({
      ...newProfile(),
      hydrated: false,
      patch: (p) => setState({ ...p, dirty: true, updatedAt: Date.now() }),
      recordMatch: (r, you, xp) => {
        const s = getState();
        const me = r.players.find((p) => p.id === you);
        const before = { xpBefore: s.xp, levelBefore: levelInfo(s.xp).level, coins: 0 };
        if (!me || r.mode === 'practice') return before;
        const st = { ...s.stats, weaponGames: { ...s.stats.weaponGames } };
        st.games++;
        if (r.winner === -1) st.draws++;
        else if (r.winner === me.team) st.wins++;
        else st.losses++;
        st.kills += me.kills;
        st.deaths += me.deaths;
        st.assists += me.assists;
        st.paint += me.paint;
        st.bestPaint = Math.max(st.bestPaint, me.paint);
        st.weaponGames[me.weapon] = (st.weaponGames[me.weapon] ?? 0) + 1;
        // Quests move by what this match did; finished ones wait to be claimed.
        const quests = rollQuests(s.quests);
        const delta = questProgress(r, you);
        const progress = { ...quests.progress };
        for (const q of [...dailyQuests(quests.day), ...weeklyQuests(quests.week)])
          progress[q.id] = Math.min(q.goal, (progress[q.id] ?? 0) + (delta[q.stat] ?? 0));
        const coins = coinsEarned(s.xp, s.xp + xp);
        setState({ stats: st, xp: s.xp + xp, coins: s.coins + coins, quests: { ...quests, progress }, dirty: true, updatedAt: Date.now() });
        return { ...before, coins };
      },
      owns: (key) => FREE.has(key) || getState().owned.includes(key),
      buy: (key, price) => {
        const s = getState();
        if (s.owns(key) || s.coins < price) return false;
        setState({ coins: s.coins - price, owned: [...s.owned, key], dirty: true, updatedAt: Date.now() });
        return true;
      },
      claimQuest: (id) => {
        const s = getState();
        const quests = rollQuests(s.quests);
        const q = [...dailyQuests(quests.day), ...weeklyQuests(quests.week)].find((x) => x.id === id);
        if (!q || quests.claimed.includes(id) || (quests.progress[id] ?? 0) < q.goal) return 0;
        setState({ coins: s.coins + q.reward, quests: { ...quests, claimed: [...quests.claimed, id] }, dirty: true, updatedAt: Date.now() });
        return q.reward;
      },
      refreshQuests: () => {
        const q = getState().quests;
        const next = rollQuests(q);
        if (next !== q) setState({ quests: next });
      },
      replace: (p) => setState({ ...p }),
      reset: () => setState({ ...newProfile(), hydrated: true }),
    }),
    {
      name: 'chromashift.profile.v1',
      storage: idb,
      partialize: (s) => {
        const { hydrated: _h, patch: _p, recordMatch: _r, replace: _x, reset: _z, owns: _o, buy: _b, claimQuest: _c, refreshQuests: _q, ...rest } = s;
        return rest as unknown as ProfileStore;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Profile>;
        return {
          ...current,
          ...p,
          stats: { ...emptyStats(), ...p.stats },
          cosmetics: sanitizeCosmetics(p.cosmetics),
          coins: typeof p.coins === 'number' && p.coins >= 0 ? Math.floor(p.coins) : STARTING_COINS,
          // Profiles from before the shop keep whatever they were wearing.
          owned: Array.isArray(p.owned)
            ? p.owned.filter((k): k is string => typeof k === 'string')
            : Object.entries(sanitizeCosmetics(p.cosmetics))
                .filter(([slot]) => slot !== 'skin')
                .map(([slot, id]) => `${slot}:${id}`)
                .filter((k) => !FREE.has(k)),
          quests: rollQuests({ ...freshQuests(), ...p.quests }),
          weapon: WEAPON_IDS.includes(p.weapon as WeaponId) ? (p.weapon as WeaponId) : current.weapon,
          special: SPECIAL_IDS.includes(p.special as SpecialId) ? (p.special as SpecialId) : current.special,
        };
      },
      onRehydrateStorage: () => () => useProfile.setState({ hydrated: true }),
    },
  ),
);

export function favouriteWeapon(s: Stats): WeaponId | null {
  let best: WeaponId | null = null, n = 0;
  for (const [w, c] of Object.entries(s.weaponGames))
    if (c > n) {
      n = c;
      best = w as WeaponId;
    }
  return best;
}

export const publicName = (p: Pick<Profile, 'displayName' | 'username'>) => p.displayName || p.username || 'Player';
