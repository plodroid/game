import { create } from 'zustand';
import { registerCustomMap, removeCustomMap, sanitizeCustomMap, type CustomMap } from '@chromashift/shared';

/*
 * The maps you made, kept on this device. They are registered with the game as they load, so they
 * play like the built-in maps: in custom matches, and in any world friends join (the host sends the
 * map along with the match).
 */

const KEY = 'chromashift:maps:v1';

function load(): CustomMap[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map((m) => registerCustomMap(m)).filter((m): m is CustomMap => !!m) : [];
  } catch {
    return [];
  }
}

function persist(maps: CustomMap[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(maps));
  } catch {
    /* storage full or blocked: the maps stay for this session */
  }
}

export const useMaps = create<{ maps: CustomMap[] }>()(() => ({ maps: load() }));

/** Saves (or replaces) a map. Returns false when it was refused. */
export function saveMap(map: CustomMap): boolean {
  const clean = registerCustomMap(map);
  if (!clean) return false;
  const maps = [...useMaps.getState().maps.filter((m) => m.id !== clean.id), clean];
  useMaps.setState({ maps });
  persist(maps);
  return true;
}

export function deleteMap(id: string) {
  removeCustomMap(id);
  const maps = useMaps.getState().maps.filter((m) => m.id !== id);
  useMaps.setState({ maps });
  persist(maps);
}

/** Reads a map shared as text (what “Copy” gives you). */
export function parseSharedMap(text: string): CustomMap | null {
  try {
    return sanitizeCustomMap(JSON.parse(text));
  } catch {
    return null;
  }
}
