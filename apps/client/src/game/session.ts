import { offline, resetLocalMods } from '../auth/admin';
import {
  botLook,
  initPhysics,
  levelInfo,
  Simulation,
  SPECIAL_IDS,
  publicWeapons,
  MAX_PLAYERS,
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
import { useTutorial } from '../state/tutorial';
import { useHud2, useUi } from '../state/ui';
import { p2Name, useP2 } from '../state/p2';
import { engine, PRESET_LABEL } from './engine';
import { MatchView } from './matchView';
import { MenuView } from './menuView';
import { OfflineSource, type MatchOutcome } from './source';
import { input2, setSplitAllowed, splitHooks, useSplit } from './split';
import { closeWorld, openWorldFor, useWorld } from './world';

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
  /** Not joinable by friends (the tutorial). */
  private?: boolean;
  /** The guided tutorial runs over this match. */
  tutorial?: boolean;
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

/** The guided tutorial: a quiet practice arena with steps, never joinable. */
export const startTutorial = () =>
  startOffline({ map: 'skyline', mode: 'practice', duration: 0, difficulty: 'easy', allies: 0, rivals: 4, private: true, tutorial: true });

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
    const weapons = shuffled(publicWeapons());
    const practice = s.mode === 'practice';
    // Split screen: player 2 plays on the same team, so they take one ally seat and the bots start after them.
    const split = useSplit.getState().on;
    if (split) {
      const q = useP2.getState();
      players.push({ id: 2, name: p2Name(), team: 0, weapon: q.weapon, special: q.special, bot: false, cosmetics: q.cosmetics });
    }
    let id = split ? 3 : 2;
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
    for (let i = 0; i < Math.min(3, Math.max(0, s.allies - (split ? 1 : 0))); i++) addBot(0, i);
    for (let i = 0; i < Math.min(4, practice ? 4 : s.rivals); i++) addBot(1, i);
    const sim = new Simulation({ map: s.map, mode: s.mode, duration: practice ? 0 : s.duration, seed: (Math.random() * 2 ** 31) | 0 }, players);
    currentOnline = false;
    menuView = null;
    offline.sim = sim;
    resetLocalMods();
    useTutorial.setState({ active: !!s.tutorial });
    const source = new OfflineSource(sim, 1);
    const view = new MatchView(source, (o) => finish(o, 1));
    engine.setView(view);
    if (split) view.addSeat(2, input2, useHud2);
    ui.setPaused(false);
    ui.go('match');
    // Friends (and the owner) can step into this match while it runs, practice included; only the tutorial stays private.
    if (!s.private) void openWorldFor(source, 1);
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
  offline.sim = null;
  menuView = null;
  engine.setView(new MatchView(new OnlineSource(room, start), (o) => finish(o, start.you)));
  ui.setPaused(false);
  ui.go('match');
}

function finish(o: MatchOutcome, you: number) {
  const ui = useUi.getState();
  const profile = useProfile.getState();
  // Guests in an open world get the results before the door closes.
  closeWorld(15_000);
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
  closeWorld();
  useTutorial.setState({ active: false });
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

/*
 * Split screen. Two controllers connected and Options pressed: player 2 gets the other half of the
 * screen. In a running offline match they take a bot's seat (the bot leaves, as when a friend
 * joins); from the menu, the next match simply starts with both of them.
 */
function joinSplitMatch() {
  const v = engine.view;
  const sim = offline.sim;
  if (!(v instanceof MatchView) || !sim || currentOnline || v.seats.length > 1) return;
  if (useWorld.getState().guests > 0) {
    useUi.getState().toast({ text: 'Split screen can start once your friends have left the world.', kind: 'warn' });
    return void useSplit.setState({ on: false });
  }
  const bot = sim.players.find((p) => p.info.bot && p.team === 0) ?? sim.players.find((p) => p.info.bot);
  if (!bot && sim.players.length >= MAX_PLAYERS) {
    useUi.getState().toast({ text: 'No room for a second player in this match.', kind: 'warn' });
    return void useSplit.setState({ on: false });
  }
  const id = bot ? bot.id : Math.max(...sim.players.map((p) => p.id)) + 1;
  const team = bot ? bot.team : 0;
  if (bot) sim.removePlayer(bot.id);
  const q = useP2.getState();
  sim.addPlayer({ id, name: p2Name(), team, weapon: q.weapon, special: q.special, bot: false, cosmetics: q.cosmetics });
  v.addSeat(id, input2, useHud2);
  useUi.getState().toast({ text: `Split screen on. ${p2Name()} joined your team.`, kind: 'success' });
}

/** Player 2 leaves the match; a bot covers their seat. */
function leaveSplitMatch() {
  const v = engine.view;
  if (!(v instanceof MatchView) || v.seats.length < 2) return;
  const id = v.seats[1].localId;
  v.removeSeat();
  offline.sim?.setBot(id, 'normal');
}

splitHooks.start = joinSplitMatch;
splitHooks.stop = leaveSplitMatch;
setSplitAllowed(() => !useTutorial.getState().active && !(currentOnline && engine.view?.kind === 'match'));
