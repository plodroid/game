import { create } from 'zustand';

/** The service worker's update state: set by main.tsx, read by the Settings screen. */
export const useUpdates = create<{ ready: boolean; apply: (() => void) | null }>()(() => ({ ready: false, apply: null }));

export type UpdateResult = 'ready' | 'latest' | 'unavailable';

/** Asks the site for a newer version; resolves once it has downloaded (or there isn't one). */
export async function checkForUpdates(): Promise<UpdateResult> {
  if (useUpdates.getState().ready) return 'ready';
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (!reg) return 'unavailable';
  await reg.update();
  const worker = reg.installing;
  if (worker && worker.state !== 'installed')
    await new Promise<void>((done) => {
      const t = setTimeout(done, 20_000);
      worker.addEventListener('statechange', () => worker.state !== 'installing' && (clearTimeout(t), done()));
    });
  // Give the page's own "new version" callback a moment to fire.
  await new Promise((r) => setTimeout(r, 400));
  return useUpdates.getState().ready || reg.waiting ? 'ready' : 'latest';
}
