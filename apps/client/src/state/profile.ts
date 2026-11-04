import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_COSMETICS,
  levelInfo,
  sanitizeCosmetics,
  SPECIAL_IDS,
  WEAPON_IDS,
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
  /** Local changes not yet synced to the cloud. */
  dirty: boolean;
  updatedAt: number;
}

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
  dirty: false,
  updatedAt: Date.now(),
});

interface ProfileStore extends Profile {
  hydrated: boolean;
  patch(p: Partial<Profile>): void;
  /** Records an offline/casual match. Returns XP before for the results screen. */
  recordMatch(r: MatchResult, you: number, xp: number): { xpBefore: number; levelBefore: number };
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
        const before = { xpBefore: s.xp, levelBefore: levelInfo(s.xp).level };
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
        setState({ stats: st, xp: s.xp + xp, dirty: true, updatedAt: Date.now() });
        return before;
      },
      replace: (p) => setState({ ...p }),
      reset: () => setState({ ...newProfile(), hydrated: true }),
    }),
    {
      name: 'chromashift.profile.v1',
      storage: idb,
      partialize: (s) => {
        const { hydrated: _h, patch: _p, recordMatch: _r, replace: _x, reset: _z, ...rest } = s;
        return rest as unknown as ProfileStore;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Profile>;
        return {
          ...current,
          ...p,
          stats: { ...emptyStats(), ...p.stats },
          cosmetics: sanitizeCosmetics(p.cosmetics),
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
