import { create } from 'zustand';
import type { Simulation } from '@chromashift/shared';
import { accounts, useAccount } from '../auth/account';
import { firebaseConfigured } from '../env';
import { peerHello } from '../multiplayer/net';
import type { World } from '../multiplayer/p2p';
import { useUi } from '../state/ui';
import type { OfflineSource } from './source';

/*
 * An offline match becomes a server the moment a friend (or the owner) joins it. While you play,
 * the match listens under a private code that only your friends (and the owner) can see; if
 * someone joins, they simply appear in the match in progress and take over a bot. Nothing
 * restarts. When the match ends the world closes.
 */

export const useWorld = create<{ code: string | null; guests: number }>()(() => ({ code: null, guests: 0 }));

let world: World | null = null;
let source: OfflineSource | null = null;
let beat = 0;
let token = 0;

async function share(code: string | null) {
  const m = await accounts();
  if (!m) return;
  const s = await import('../auth/social');
  await s.setJoinable(code).catch(() => undefined);
}

/** Opens the match you're playing to friends. Quietly does nothing when offline or signed out. */
export async function openWorldFor(src: OfflineSource, pid: number) {
  closeWorld();
  if (!firebaseConfigured || useAccount.getState().status !== 'signedIn' || !navigator.onLine) return;
  const mine = ++token;
  try {
    const p2p = await import('../multiplayer/p2p');
    const w = await p2p.openWorld(src.sim as Simulation, pid, peerHello(), (n) => {
      useWorld.setState({ guests: Math.max(0, n - 1) });
      useUi.getState().toast({ text: n > 1 ? `${n - 1} ${n === 2 ? 'player has' : 'players have'} joined your world.` : 'A player left your world.', kind: 'info' });
    });
    if (mine !== token) return void w.close();
    world = w;
    source = src;
    src.tap = w.tap;
    useWorld.setState({ code: w.code, guests: 0 });
    await share(w.code);
    beat = window.setInterval(() => void share(w.code), 60_000);
  } catch {
    // No broker or no network: the match just stays private.
  }
}

/** Closes the world (guests are let go). Pass a delay to let the results reach them first. */
export function closeWorld(delayMs = 0) {
  const w = world;
  token++;
  clearInterval(beat);
  beat = 0;
  if (source) source.tap = null;
  source = null;
  world = null;
  if (useWorld.getState().code) {
    useWorld.setState({ code: null, guests: 0 });
    void share(null);
  }
  if (w) {
    if (delayMs > 0) setTimeout(w.close, delayMs);
    else w.close();
  }
}
