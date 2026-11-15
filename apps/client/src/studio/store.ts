import { create } from 'zustand';
import { sanitizeAsset, type AssetKind, type ModelAsset } from '@chromashift/shared';
import { isOwner } from '../auth/admin';
import { deleteAssetDraft, deletePublishedAsset, loadAssetDrafts, saveAssetDraft, savePublishedAsset } from '../auth/firebase';
import { firebaseConfigured } from '../env';
import { dropPublishedAsset, publishedAsset, putPublishedAsset } from '../modeling/library';

/*
 * The owner's unfinished work. A draft is kept on this device as it is edited (so a closed tab
 * loses nothing) and in the owner's private collection on the server (so it follows them to
 * another device). Publishing copies a draft into the official library; the version it replaces
 * is kept as a draft of its own, so a bad publish can be rolled back.
 */

const KEY = 'chromashift.studio.drafts.v1';

interface DraftStore {
  drafts: ModelAsset[];
  /** Small pictures by asset id, for the lists. */
  thumbs: Record<string, string>;
  loaded: boolean;
}

function readLocal(): { drafts: ModelAsset[]; thumbs: Record<string, string> } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { drafts?: unknown[]; thumbs?: Record<string, string> };
    return { drafts: (raw.drafts ?? []).map(sanitizeAsset).filter((a): a is ModelAsset => !!a), thumbs: raw.thumbs ?? {} };
  } catch {
    return { drafts: [], thumbs: {} };
  }
}

export const useDrafts = create<DraftStore>()(() => ({ ...readLocal(), loaded: false }));

function writeLocal() {
  const { drafts, thumbs } = useDrafts.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ drafts, thumbs }));
  } catch {
    // Storage is full: the newest drafts matter most, so drop pictures first.
    try {
      localStorage.setItem(KEY, JSON.stringify({ drafts, thumbs: {} }));
    } catch {
      /* nothing more to do; the server copy is still saved */
    }
  }
}

/** Brings in the drafts saved on the server; the newer copy of each wins. */
export async function syncDrafts() {
  if (!isOwner() || !firebaseConfigured) return useDrafts.setState({ loaded: true });
  try {
    const remote = (await loadAssetDrafts()).map((j) => {
      try {
        return sanitizeAsset(JSON.parse(j));
      } catch {
        return null;
      }
    });
    const byId = new Map(useDrafts.getState().drafts.map((d) => [d.id, d]));
    for (const r of remote) if (r && (byId.get(r.id)?.updatedAt ?? 0) < r.updatedAt) byId.set(r.id, r);
    useDrafts.setState({ drafts: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt), loaded: true });
    writeLocal();
  } catch {
    useDrafts.setState({ loaded: true });
  }
}

/** Keeps a draft on this device only (autosave). */
export function keepDraft(a: ModelAsset, thumb?: string) {
  const s = useDrafts.getState();
  useDrafts.setState({ drafts: [a, ...s.drafts.filter((d) => d.id !== a.id)], thumbs: thumb ? { ...s.thumbs, [a.id]: thumb } : s.thumbs });
  writeLocal();
}

const tooBig = (json: string) => (json.length > 940_000 ? 'This asset is too big to save. Use fewer or smaller paint layers.' : null);

/** Saves a draft here and on the server. Returns a message on failure. */
export async function saveDraft(a: ModelAsset, thumb?: string): Promise<string | null> {
  keepDraft(a, thumb);
  if (!isOwner()) return 'Only the owner can save Studio work.';
  if (!firebaseConfigured) return null;
  const json = JSON.stringify(a);
  const big = tooBig(json);
  if (big) return big;
  try {
    await saveAssetDraft(a.id, a.name, a.kind, json);
    return null;
  } catch (e) {
    return `Saved on this device only: ${(e as { code?: string }).code ?? (e as Error).message}`;
  }
}

export async function removeDraft(id: string) {
  const s = useDrafts.getState();
  const thumbs = { ...s.thumbs };
  delete thumbs[id];
  useDrafts.setState({ drafts: s.drafts.filter((d) => d.id !== id), thumbs });
  writeLocal();
  if (isOwner() && firebaseConfigured) await deleteAssetDraft(id).catch(() => undefined);
}

/**
 * Makes an asset official. The server's rules allow this for the owner's account only; anyone
 * else is refused there, whatever their copy of the game claims.
 */
export async function publishAsset(a: ModelAsset): Promise<string | null> {
  if (!isOwner()) return 'Only the owner can publish.';
  if (!firebaseConfigured) return 'Accounts are off in this build, so there is nowhere to publish to.';
  const json = JSON.stringify(a);
  const big = tooBig(json);
  if (big) return big;
  try {
    // Keep what is live now, in case this needs undoing.
    const live = publishedAsset(a.id);
    if (live) {
      const prev: ModelAsset = { ...live, id: `${a.id.slice(0, 26)}-prev`, name: `${live.name} (before)`.slice(0, 28) };
      await saveAssetDraft(prev.id, prev.name, prev.kind, JSON.stringify(prev)).catch(() => undefined);
      keepDraft(prev);
    }
    await savePublishedAsset(a.id, a.name, a.kind, json);
    putPublishedAsset(a);
    return null;
  } catch (e) {
    return `Couldn’t publish: ${(e as { code?: string }).code ?? (e as Error).message}`;
  }
}

export async function unpublishAsset(id: string): Promise<string | null> {
  if (!isOwner()) return 'Only the owner can remove official assets.';
  try {
    await deletePublishedAsset(id);
    dropPublishedAsset(id);
    return null;
  } catch (e) {
    return `Couldn’t remove: ${(e as { code?: string }).code ?? (e as Error).message}`;
  }
}

export const draftsOf = (kind: AssetKind, drafts: ModelAsset[]) => drafts.filter((d) => d.kind === kind);
