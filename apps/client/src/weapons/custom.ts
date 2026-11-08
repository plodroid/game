import { create } from 'zustand';
import { registerWeapons } from '@chromashift/shared';
import { dropWeaponPortraits } from '../characters/portrait';

/** The owner's weapon config (new weapons, tuned weapons, limited sales), as the JSON that is stored. */
export const useWeapons = create<{ v: number; json: string }>()(() => ({ v: 0, json: '[]' }));

/** Applies a stored config to the game's weapon table and tells the screens that show weapons. */
export function setWeaponConfig(json: string) {
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return;
    registerWeapons(list);
    dropWeaponPortraits();
    useWeapons.setState((s) => ({ v: s.v + 1, json }));
  } catch {
    /* a bad config is ignored; the built-in weapons still work */
  }
}

export const configList = (): Record<string, unknown>[] => {
  try {
    return JSON.parse(useWeapons.getState().json);
  } catch {
    return [];
  }
};
