import {
  botLook,
  initPhysics,
  levelInfo,
  Simulation,
  SPECIAL_IDS,
  WEAPON_IDS,
  type BotDifficulty,
  type MapId,
  type MatchStart,
  type ModeId,
  type PlayerInfo,
} from '@chromashift/shared';
import { audio } from '../audio/audio';
import { leaveRoom, netHooks, useNet, type NetRoom } from '../multiplayer/net';
import { benchmark, probeHardware, recommend } from '../settings/hardware';
import { useSettings } from '../settings/settings';
import { publicName, useProfile } from '../state/profile';
import { useUi } from '../state/ui';
import { engine, PRESET_LABEL } from './engine';
import { MatchView } from './matchView';
import { MenuView } from './menuView';
import { OfflineSource, type MatchOutcome } from './source';

export const BOT_NAMES = ['Rook', 'Pixel', 'Mango', 'Nova', 'Juno', 'Kiwi', 'Echo', 'Taro', 'Zest', 'Moss', 'Vega', 'Bolt', 'Fizz', 'Lumen', 'Pico', 'Sable'];

export interface OfflineSetup {
  map: MapId;
  mode: ModeId;
  duration: number;
  difficulty: BotDifficulty;
  /** Bots on your team (0–3). */
  allies: number;
  /** Bots on the rival team (0–4). */
  rivals: number;
}

let menuView: MenuView | null = null;
let currentOnline = false;
let lastSetup: OfflineSetup | null = null;

export const menu = () => menuView;

export function showMenu(outcome: 'none' | 'win' | 'lose' = 'none') {
  menuView = new MenuView();
  menuView.setOutcome(outcome);
  engine.setView(menuView);
  audio.startMusic('menu');
  if (!useSettings.getState().benchmarked) setTimeout(firstRunCheck, 1200);
}

/** One-time hardware check. Suggests a preset; the player decides. */
function firstRunCheck() {
  const s = useSettings.getState();
  if (s.benchmarked || !menuView) return;
  useSettings.setState({ benchmarked: true });
  const { scene, camera } = menuView.benchScene;
  const hw = probeHardware(engine.renderer.getContext() as WebGL2RenderingContext);
  const ms = benchmark(engine.renderer, scene, camera);
  const rec = recommend({ ...hw, benchmarkMs: ms });
  if (rec.recommended === s.graphics.preset) return;
  useUi.getState().toast({
    text: `Recommended graphics for this device: ${PRESET_LABEL[rec.recommended]}.`,
    kind: 'info',
    ttl: 15000,
    action: { label: 'Apply', run: () => useSettings.getState().applyPreset(rec.recommended) },
  });
}

function shuffled<T>(a: readonly T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Re-runs the previous offline setup (results screen "Play again"). */
export const replayOffline = () => lastSetup && startOffline(lastSetup);

export async function startOffline(s: OfflineSetup) {
  lastSetup = s;
  const ui = useUi.getState();
  ui.setLoading('Building the arena…');
  try {
    await initPhysics();
    await new Promise((r) => setTimeout(r, 30));
    const p = useProfile.getState();
    const players: PlayerInfo[] = [
      { id: 1, name: publicName(p), team: 0, weapon: p.weapon, special: p.special, bot: false, cosmetics: p.cosmetics },
    ];
    const names = shuffled(BOT_NAMES);
    const weapons = shuffled(WEAPON_IDS);
    const practice = s.mode === 'practice';
    let id = 2;
    const addBot = (team: 0 | 1, i: number) =>
      players.push({
        id: id++,
        name: practice && team === 1 ? `Target ${i + 1}` : names[id % names.length],
        team,
        weapon: weapons[id % weapons.length],
        special: SPECIAL_IDS[Math.floor(Math.random() * SPECIAL_IDS.length)],
        bot: true,
        difficulty: s.difficulty,
        dummy: practice && team === 1,
        cosmetics: botLook(id),
      });
    for (let i = 0; i < Math.min(3, s.allies); i++) addBot(0, i);
    for (let i = 0; i < Math.min(4, practice ? 4 : s.rivals); i++) addBot(1, i);
    const sim = new Simulation({ map: s.map, mode: s.mode, duration: practice ? 0 : s.duration, seed: (Math.random() * 2 ** 31) | 0 }, players);
    currentOnline = false;
    menuView = null;
    engine.setView(new MatchView(new OfflineSource(sim, 1), (o) => finish(o, 1)));
    ui.setPaused(false);
    ui.go('match');
  } catch (e) {
    console.error(e);
    ui.toast({ text: 'Couldn’t start the match. Try a lower graphics preset.', kind: 'error' });
  } finally {
    ui.setLoading(null);
  }
}

export async function startOnline(room: NetRoom, start: MatchStart) {
  const { OnlineSource } = await import('../multiplayer/onlineSource');
  const ui = useUi.getState();
  await initPhysics();
  currentOnline = true;
  menuView = null;
  engine.setView(new MatchView(new OnlineSource(room, start), (o) => finish(o, start.you)));
  ui.setPaused(false);
  ui.go('match');
}

function finish(o: MatchOutcome, you: number) {
  const ui = useUi.getState();
  const profile = useProfile.getState();
  const me = o.result.players.find((p) => p.id === you);
  const before = { xpBefore: profile.xp, levelBefore: levelInfo(profile.xp).level, coins: 0 };
  // Offline progress is local; online progress comes from the server-awarded XP.
  if (o.result.mode !== 'practice') Object.assign(before, profile.recordMatch(o.result, you, o.xp));
  const win = me && o.result.winner === me.team;
  audio.jingle(!!win);
  ui.setResults({ result: o.result, you, xp: o.result.mode === 'practice' ? 0 : o.xp, ...before, online: currentOnline, recorded: o.recorded });
  setTimeout(() => {
    showMenu(win ? 'win' : o.result.winner === -1 ? 'none' : 'lose');
    ui.setPaused(false);
    ui.go('results');
  }, 400);
}

export function leaveMatch() {
  const ui = useUi.getState();
  if (currentOnline) leaveRoom();
  showMenu();
  ui.setPaused(false);
  ui.go('home');
}

netHooks.onMatch = (room, start) => void startOnline(room, start);
netHooks.onLeftMatch = () => {
  if (engine.view?.kind === 'match') leaveMatch();
};

export function inOnlineRoom() {
  return !!useNet.getState().room;
}
