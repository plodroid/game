import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { MAX_PLAYERS, PROTOCOL_VERSION } from '@chromashift/shared';
import { accounts, describeAuthError, useAccount } from '../auth/account';
import type { PublicGame } from '../auth/firebase';
import { currentHostLobby, netHooks } from './net';

/**
 * Public games: a host can list the game their tab is hosting so anyone can find and join it.
 * Listings live in Firestore (one per signed-in account) and re-announce themselves every minute;
 * one that stops (closed tab, lost connection) drops out of everyone's list on its own.
 */
const HEARTBEAT_MS = 60_000;
export const LISTING_FRESH_MS = 150_000;

interface ListingStore {
  /** The host wants this game listed. */
  wanted: boolean;
  /** The listing is up. */
  live: boolean;
  error: string | null;
}

export const useListing = create<ListingStore>()(() => ({ wanted: false, live: false, error: null }));

let heartbeat = 0;
let pending = 0;

function explain(e: unknown) {
  const code = String((e as { code?: string })?.code ?? '');
  if (code.includes('permission-denied')) return 'Public games aren’t switched on for this game’s database yet.';
  if (code === 'signed-out') return 'Sign in to list your game publicly.';
  return describeAuthError(e);
}

async function push() {
  pending = 0;
  const s = currentHostLobby();
  if (!s || !useListing.getState().wanted) return;
  const m = await accounts();
  if (!m) return;
  try {
    await m.publishGame({
      code: s.code,
      name: s.players.find((p) => p.id === s.hostId)?.name ?? 'Host',
      map: s.settings.map,
      mode: s.settings.mode,
      players: Math.max(1, s.players.length),
      phase: s.phase,
      protocol: PROTOCOL_VERSION,
    });
    if (useListing.getState().wanted) useListing.setState({ live: true, error: null });
  } catch (e) {
    stopTimers();
    useListing.setState({ wanted: false, live: false, error: explain(e) });
  }
}

function schedule(delay: number) {
  if (!pending) pending = window.setTimeout(() => void push(), delay);
}

function stopTimers() {
  clearTimeout(pending);
  clearInterval(heartbeat);
  pending = heartbeat = 0;
}

/** Lists or unlists the game this tab hosts. */
export async function setPublic(on: boolean) {
  if (on) {
    if (useAccount.getState().status !== 'signedIn') return void useListing.setState({ wanted: false, error: 'Sign in to list your game publicly.' });
    useListing.setState({ wanted: true, error: null });
    schedule(0);
    heartbeat ||= window.setInterval(() => schedule(0), HEARTBEAT_MS);
    return;
  }
  const wasLive = useListing.getState().live;
  stopTimers();
  useListing.setState({ wanted: false, live: false });
  if (wasLive) await (await accounts())?.unpublishGame().catch(() => {});
}

// Lobby changes refresh the listing within a moment; closing the game removes it.
netHooks.hostLobby = (state) => {
  if (!state) void setPublic(false);
  else if (useListing.getState().wanted) schedule(1500);
};

export type { PublicGame };

/** Live list of open public games, for the Online screen. `null` while loading. */
export function usePublicGames(enabled: boolean) {
  const [games, setGames] = useState<PublicGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const ready = accounts();
    if (!ready) return;
    let off = () => {};
    let gone = false;
    const subscribe = () =>
      ready.then((m) => {
        if (gone) return;
        off();
        off = m.watchGames(LISTING_FRESH_MS, setGames, (e) => setError(explain(e)));
      }, () => setError('The game list is unavailable right now.'));
    void subscribe();
    // The query's time window is fixed when it starts, so move it on now and then; the tick
    // drops listings that stopped refreshing in between.
    const resub = setInterval(() => void subscribe(), 5 * 60_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      gone = true;
      off();
      clearInterval(resub);
      clearInterval(tick);
    };
  }, [enabled]);
  const open = games
    ?.filter((g) => g.protocol === PROTOCOL_VERSION && now - g.updatedAt < LISTING_FRESH_MS && g.players < MAX_PLAYERS)
    .sort((a, b) => Number(a.phase !== 'lobby') - Number(b.phase !== 'lobby') || b.players - a.players);
  return { games: open ?? null, error };
}
