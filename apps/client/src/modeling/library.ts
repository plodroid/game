import { create } from 'zustand';
import { sanitizeAsset, type AssetKind, type ModelAsset } from '@chromashift/shared';

/*
 * The official asset library: what the owner has published from the Studio. Loaded once at start
 * (and again whenever the owner publishes), then read by the game wherever an asset is named:
 * a weapon's model, a prop on a map, a car accessory.
 */

const published = new Map<string, ModelAsset>();

/** Bumps when the library changes, so screens that show assets redraw. */
export const useLibrary = create<{ v: number; loaded: boolean }>()(() => ({ v: 0, loaded: false }));

export const publishedAsset = (id: string): ModelAsset | undefined => published.get(id);
export const publishedAssets = (kind?: AssetKind): ModelAsset[] => [...published.values()].filter((a) => !kind || a.kind === kind);

/** Replaces the library with what the server has (anything malformed is dropped). */
export function setPublishedAssets(list: unknown[]) {
  published.clear();
  for (const raw of list) {
    const a = sanitizeAsset(raw);
    if (a) published.set(a.id, a);
  }
  useLibrary.setState((s) => ({ v: s.v + 1, loaded: true }));
}

export function putPublishedAsset(raw: unknown) {
  const a = sanitizeAsset(raw);
  if (!a) return null;
  published.set(a.id, a);
  useLibrary.setState((s) => ({ v: s.v + 1, loaded: true }));
  return a;
}

export function dropPublishedAsset(id: string) {
  if (published.delete(id)) useLibrary.setState((s) => ({ v: s.v + 1 }));
}
