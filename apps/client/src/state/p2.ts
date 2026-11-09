import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { botLook, DEFAULT_COSMETICS, publicWeapons, SPECIAL_IDS, WEAPONS, type Cosmetics, type SpecialId, type WeaponId } from '@chromashift/shared';
import { publicName, useProfile } from './profile';

/*
 * Player 2 in split screen. They don't need an account: they are named after player 1 ("caca-P2")
 * and pick a loadout of their own. If they do want to sign in, their account's name and loadout are
 * used instead (see auth/p2auth.ts).
 */

interface P2Store {
  weapon: WeaponId;
  special: SpecialId;
  cosmetics: Cosmetics;
  /** Set while player 2 is signed in to their own account. */
  account: { uid: string; name: string } | null;
}

export const useP2 = create<P2Store>()(
  persist(
    () => ({ weapon: publicWeapons()[1] ?? publicWeapons()[0] ?? ('pulse' as WeaponId), special: SPECIAL_IDS[0], cosmetics: DEFAULT_COSMETICS, account: null as P2Store['account'] }),
    {
      name: 'chromashift:p2',
      partialize: (s) => ({ weapon: s.weapon, special: s.special, cosmetics: s.cosmetics }),
      // A saved weapon that no longer exists (removed by the owner) falls back to a valid one.
      merge: (saved, cur) => {
        const m = { ...cur, ...(saved as Partial<P2Store>) };
        if (!WEAPONS[m.weapon]) m.weapon = cur.weapon;
        return m;
      },
    },
  ),
);

/** "caca-P2" for a guest player 2, or their own account name once signed in. */
export const p2Name = () => useP2.getState().account?.name ?? `${publicName(useProfile.getState()).slice(0, 13)}-P2`;

export const shufflePlayer2Look = () => useP2.setState({ cosmetics: botLook((Math.random() * 1e9) | 0) });
