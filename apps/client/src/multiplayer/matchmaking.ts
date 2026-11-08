import { levelInfo, MAX_PLAYERS, PROTOCOL_VERSION } from '@chromashift/shared';
import { accounts } from '../auth/account';
import { useProfile } from '../state/profile';
import { useUi } from '../state/ui';
import { joinGame } from './net';
import { LISTING_FRESH_MS } from './listing';

/*
 * Random servers: hosts can put their public game in the random pool. The Random server button
 * finds one in your region and prefers the closest skill rating. Skill matching applies only here;
 * every other public game lets anyone in.
 */

/** A coarse region from the device's time zone ("Europe", "America", "Asia"…), so random servers are close by. */
export function region(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    return (tz.split('/')[0] || 'World').slice(0, 12);
  } catch {
    return 'World';
  }
}

/** A rating around 1000 from level, win rate and kill/death record; new accounts start in the middle. */
export function mySkill(): number {
  const { xp, stats } = useProfile.getState();
  const games = stats.games ?? 0;
  const trust = Math.min(1, games / 20);
  const winRate = games ? (stats.wins ?? 0) / games : 0.5;
  const kd = (stats.kills ?? 0) / Math.max(1, stats.deaths ?? 0);
  const level = levelInfo(xp).level;
  return Math.round(700 + level * 6 + trust * (winRate - 0.5) * 500 + trust * Math.min(2, kd) * 60);
}

/** Finds an open random server in your region with a similar skill and joins it. */
export async function joinRandom(): Promise<boolean> {
  const ui = useUi.getState();
  const none = () => {
    ui.toast({ text: 'No servers available.', kind: 'warn' });
    return false;
  };
  const m = await accounts();
  if (!m) return none();
  ui.setLoading('Finding a server…');
  try {
    const games = (await m.listRandomGames(LISTING_FRESH_MS, region()).catch(() => [])).filter(
      (g) => g.protocol === PROTOCOL_VERSION && g.players < MAX_PLAYERS && Date.now() - g.updatedAt < LISTING_FRESH_MS,
    );
    if (!games.length) return none();
    const me = mySkill();
    const ranked = [...games].sort((a, b) => Math.abs((a.skill ?? 1000) - me) - Math.abs((b.skill ?? 1000) - me));
    // Among the three closest, pick one at random so everyone doesn't pile into the same room.
    const pick = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))];
    ui.setLoading('Joining…');
    await joinGame(pick.code);
    ui.go('lobby');
    return true;
  } catch {
    ui.toast({ text: 'Couldn’t join that server. Try again.', kind: 'error' });
    return false;
  } finally {
    ui.setLoading(null);
  }
}
