import { create } from 'zustand';
import { registerTrack, removeTrack, sanitizeTrackDef, type TrackDef } from '@chromashift/shared';
import { accounts, useAccount } from '../auth/account';
import { firebaseConfigured } from '../env';

/*
 * Player-made VELOCITY tracks, kept like player-made maps: up to three presets on this device (and
 * on the account when signed in), plus tracks the owner publishes for everyone. Published tracks
 * live beside published maps, marked as tracks, so maps and tracks never get mixed up.
 */

export const MAX_TRACK_PRESETS = 3;
const KEY = 'chromashift:tracks:v1';

function load(): TrackDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.slice(0, MAX_TRACK_PRESETS).map(sanitizeTrackDef).filter((t): t is TrackDef => !!t).map((t) => (registerTrack(t), t)) : [];
  } catch {
    return [];
  }
}

function persist(list: TrackDef[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full: kept for this visit */
  }
}

export const useTracks = create<{ presets: TrackDef[]; publics: TrackDef[] }>()(() => ({ presets: load(), publics: [] }));

const cloud = () => (firebaseConfigured && useAccount.getState().status === 'signedIn' ? accounts() : null);

export const newTrackId = () => `t-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** Saves a track preset (replacing one with the same id). Returns why not, or null. */
export function saveTrackPreset(t: TrackDef): string | null {
  const clean = sanitizeTrackDef({ ...t, kind: 'track' });
  if (!clean) return 'That track couldn’t be saved.';
  const list = useTracks.getState().presets;
  const exists = list.some((x) => x.id === clean.id);
  if (!exists && list.length >= MAX_TRACK_PRESETS) return `You can keep ${MAX_TRACK_PRESETS} tracks. Delete one to make room.`;
  registerTrack(clean);
  const next = exists ? list.map((x) => (x.id === clean.id ? clean : x)) : [...list, clean];
  useTracks.setState({ presets: next });
  persist(next);
  void cloud()?.then((m) => m.saveTrackPresets(next.map((x) => JSON.stringify({ ...x, kind: 'track' })))).catch(() => undefined);
  return null;
}

export function deleteTrackPreset(id: string) {
  const next = useTracks.getState().presets.filter((x) => x.id !== id);
  removeTrack(id);
  useTracks.setState({ presets: next });
  persist(next);
  void cloud()?.then((m) => m.saveTrackPresets(next.map((x) => JSON.stringify({ ...x, kind: 'track' })))).catch(() => undefined);
}

/** Owner only: publishes a track for everyone. */
export async function publishTrack(t: TrackDef): Promise<string | null> {
  const m = cloud();
  if (!m) return 'Sign in to publish.';
  try {
    await (await m).savePublicMap(t.id, t.name, JSON.stringify({ ...t, kind: 'track' }));
    registerTrack(t);
    useTracks.setState({ publics: [...useTracks.getState().publics.filter((x) => x.id !== t.id), t] });
    return null;
  } catch {
    return 'Couldn’t publish. Only the game’s owner can publish tracks.';
  }
}

export async function unpublishTrack(id: string): Promise<string | null> {
  const m = cloud();
  if (!m) return 'Sign in first.';
  try {
    await (await m).deletePublicMap(id);
    removeTrack(id);
    useTracks.setState({ publics: useTracks.getState().publics.filter((x) => x.id !== id) });
    return null;
  } catch {
    return 'Couldn’t remove it.';
  }
}

/** Published tracks arrive with the published maps (marked as tracks). */
export function takePublishedTracks(jsons: string[]) {
  const list: TrackDef[] = [];
  for (const j of jsons) {
    try {
      const raw = JSON.parse(j);
      if (raw?.kind !== 'track') continue;
      const t = sanitizeTrackDef(raw);
      if (t) {
        registerTrack(t);
        list.push(t);
      }
    } catch {
      /* skip broken entries */
    }
  }
  useTracks.setState({ publics: list });
}

/** Signed in: the account's presets replace this device's (or this device's go up if the account has none). */
export async function syncTrackPresets() {
  const m = cloud();
  if (!m) return;
  try {
    const stored = await (await m).loadTrackPresets();
    if (stored) {
      const list = stored.map((j) => sanitizeTrackDef(JSON.parse(j))).filter((t): t is TrackDef => !!t).slice(0, MAX_TRACK_PRESETS);
      for (const t of list) registerTrack(t);
      useTracks.setState({ presets: list });
      persist(list);
    } else if (useTracks.getState().presets.length) void (await m).saveTrackPresets(useTracks.getState().presets.map((x) => JSON.stringify({ ...x, kind: 'track' })));
  } catch {
    /* keep local */
  }
}
