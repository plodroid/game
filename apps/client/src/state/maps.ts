import { create } from 'zustand';
import { newMapId, registerCustomMap, removeCustomMap, sanitizeCustomMap, type CustomMap } from '@chromashift/shared';
import { accounts, useAccount } from '../auth/account';
import { isOwner } from '../auth/admin';
import { firebaseConfigured } from '../env';
import { syncTrackPresets, takePublishedTracks } from '../velocity/tracksState';

/*
 * Maps come in two kinds. Presets are a player's own: up to three, kept on this device and, when
 * signed in, on their account. Public maps are published by the owner and playable by everyone.
 * Both are registered with the game as they load, so they play like the built-in maps: in custom
 * matches, and in any world friends join (the host sends the map along with the match).
 */

export const MAX_PRESETS = 3;
const KEY = 'chromashift:maps:v1';

function load(): CustomMap[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.slice(0, MAX_PRESETS).map((m) => registerCustomMap(m)).filter((m): m is CustomMap => !!m) : [];
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

export const useMaps = create<{ presets: CustomMap[]; publics: CustomMap[] }>()(() => ({ presets: load(), publics: [] }));

/** Everything playable that a player made or the owner published. */
export const allCustomMaps = () => [...useMaps.getState().publics, ...useMaps.getState().presets];

const cloud = () => (firebaseConfigured && useAccount.getState().status === 'signedIn' ? accounts() : null);

function pushPresets(maps: CustomMap[]) {
  persist(maps);
  void cloud()?.then((m) => m.saveMapPresets(maps.map((x) => JSON.stringify(x)))).catch(() => undefined);
}

/** Saves a preset (replacing one with the same id). Returns the saved map, or why it couldn't be. */
export function savePreset(map: CustomMap): CustomMap | string {
  const { presets, publics } = useMaps.getState();
  // A published map keeps its place; a preset made from it is its own copy.
  const copy = publics.some((p) => p.id === map.id) ? { ...map, id: newMapId() } : map;
  const exists = presets.some((p) => p.id === copy.id);
  if (!exists && presets.length >= MAX_PRESETS) return `You can keep ${MAX_PRESETS} presets. Delete one to make room.`;
  const clean = registerCustomMap(copy);
  if (!clean) return 'That map couldn’t be saved.';
  const next = exists ? presets.map((p) => (p.id === clean.id ? clean : p)) : [...presets, clean];
  useMaps.setState({ presets: next });
  pushPresets(next);
  return clean;
}

export function deletePreset(id: string) {
  const next = useMaps.getState().presets.filter((m) => m.id !== id);
  if (!useMaps.getState().publics.some((m) => m.id === id)) removeCustomMap(id);
  useMaps.setState({ presets: next });
  pushPresets(next);
}

/** Owner only: publishes a map for everyone (the database rules refuse anyone else). */
export async function savePublic(map: CustomMap): Promise<string | null> {
  if (!isOwner()) return 'Only the owner can publish maps.';
  const clean = registerCustomMap(map);
  const c = cloud();
  if (!clean || !c) return 'Sign in to publish a map.';
  try {
    await (await c).savePublicMap(clean.id, clean.name, JSON.stringify(clean));
  } catch (e) {
    return `Couldn’t publish: ${(e as { code?: string }).code ?? (e as Error).message}`;
  }
  useMaps.setState((s) => ({ publics: [...s.publics.filter((m) => m.id !== clean.id), clean] }));
  return null;
}

export async function deletePublic(id: string): Promise<string | null> {
  const c = cloud();
  if (!c || !isOwner()) return 'Only the owner can remove public maps.';
  try {
    await (await c).deletePublicMap(id);
  } catch (e) {
    return `Couldn’t remove it: ${(e as { code?: string }).code ?? (e as Error).message}`;
  }
  if (!useMaps.getState().presets.some((m) => m.id === id)) removeCustomMap(id);
  useMaps.setState((s) => ({ publics: s.publics.filter((m) => m.id !== id) }));
  return null;
}

/** Reads a map shared as text (what “Copy” gives you). */
export function parseSharedMap(text: string): CustomMap | null {
  try {
    return sanitizeCustomMap(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Public maps load for everyone; a signed-in player's presets follow their account. */
async function sync() {
  const m = await accounts();
  if (!m) return;
  try {
    const jsons = await m.loadPublicMaps();
    // Published VELOCITY tracks share the collection, marked as tracks.
    takePublishedTracks(jsons);
    const maps = jsons
      .filter((j) => !/"kind"\s*:\s*"track"/.test(j))
      .map((j) => registerCustomMap(JSON.parse(j)))
      .filter((x): x is CustomMap => !!x);
    useMaps.setState({ publics: maps });
  } catch {
    /* offline: the maps already loaded stay */
  }
  if (useAccount.getState().status !== 'signedIn') return;
  void syncTrackPresets();
  try {
    const stored = await m.loadMapPresets();
    if (stored) {
      const mine = stored.slice(0, MAX_PRESETS).map((j) => registerCustomMap(JSON.parse(j))).filter((x): x is CustomMap => !!x);
      for (const old of useMaps.getState().presets) if (!mine.some((x) => x.id === old.id) && !useMaps.getState().publics.some((x) => x.id === old.id)) removeCustomMap(old.id);
      useMaps.setState({ presets: mine });
      persist(mine);
    } else if (useMaps.getState().presets.length) pushPresets(useMaps.getState().presets);
  } catch {
    /* keep the local presets */
  }
}

if (firebaseConfigured) {
  let last = '';
  useAccount.subscribe((a) => {
    const k = a.status === 'signedIn' ? (a.user?.uid ?? '') : a.status === 'signedOut' ? 'out' : '';
    if (k && k !== last) {
      last = k;
      void sync();
    }
  });
}
