import { create } from 'zustand';
import { accounts, useAccount } from './auth/account';
import { isOwner } from './auth/admin';
import { env } from './env';
import { useUi } from './state/ui';
import { Button } from './ui/kit';
import { Icon } from './ui/icons';

/**
 * Test versions. Every push builds the new game into /game/beta/ (the test version) and keeps the
 * released commit at /game/. Only the owner can open the test version; its "Update for everyone"
 * records that commit in config/release, which sends every player to it from then on (the next
 * deploy then builds it at /game/ too).
 */
const SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? '';
const NOTE = (import.meta.env.VITE_BUILD_NOTE as string | undefined) ?? '';
export const IS_TEST = import.meta.env.VITE_CHANNEL === 'test';
const ROOT = IS_TEST ? env.base.replace(/beta\/$/, '') : env.base;
const go = (path: string) => location.replace(path + location.search + location.hash);

export const useRelease = create<{ live: string | null; test: { sha: string; note?: string } | null }>()(() => ({ live: null, test: null }));

/** Sends this player to the released version. Builds without a commit id (local, tests) skip it. */
export async function checkRelease() {
  const fb = accounts();
  if (!SHA || !fb) return;
  const [live, test] = await Promise.all([
    fb.then((m) => m.loadLiveSha()).catch(() => null),
    IS_TEST
      ? { sha: SHA, note: NOTE }
      : fetch(`${ROOT}beta/version.json`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
  ]);
  useRelease.setState({ live, test });
  if (!IS_TEST) {
    // The owner released the test version and the site hasn't been rebuilt since.
    if (live && live !== SHA && test?.sha === live) go(`${ROOT}beta/`);
    return;
  }
  if (live === SHA) return;
  const settled = () => useAccount.getState().status !== 'loading';
  if (!settled()) await new Promise<void>((done) => { const off = useAccount.subscribe(() => settled() && (off(), done())); });
  if (!isOwner()) go(ROOT);
}

async function release() {
  if (!confirm('Update the game for everyone to this test version?')) return;
  try {
    await (await accounts())!.saveLiveSha(SHA);
    useRelease.setState({ live: SHA });
    useUi.getState().toast({ text: 'Released! Everyone gets this version the next time they open the game.', kind: 'success', ttl: 8000 });
  } catch {
    useUi.getState().toast({ text: 'Couldn’t release it. Check your connection and try again.', kind: 'error' });
  }
}

/** On the test version, for the owner: what this is, release it, or go back. */
export function TestVersionBar() {
  const live = useRelease((s) => s.live);
  const me = useAccount((s) => s.user);
  if (!IS_TEST || live === SHA || !me || !isOwner()) return null;
  return (
    <div className="test-bar" role="status">
      <b>TEST VERSION</b>
      <span className="test-bar__note">{NOTE || SHA.slice(0, 7)}</span>
      <Button variant="primary" onClick={() => void release()}>
        Update for everyone
      </Button>
      <Button variant="ghost" onClick={() => go(ROOT)}>
        Back to live
      </Button>
    </div>
  );
}

/** On the live game, for the owner, when there's a test version to try. */
export function TestUpdateButton() {
  const { live, test } = useRelease();
  if (IS_TEST || !test || test.sha === SHA || test.sha === live || !isOwner()) return null;
  return (
    <button className="round-btn" onClick={() => go(`${ROOT}beta/`)} aria-label="Test the new update" title={`Test the new update: ${test.note ?? test.sha.slice(0, 7)}`}>
      <Icon.bolt />
    </button>
  );
}
