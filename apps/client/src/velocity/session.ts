import {
  botCar, initPhysics, levelInfo, MAX_RACERS, RaceSim, xpForRace, type BotDifficulty, type DamageMode, type RacePreset,
  type RacerInfo, type RaceStart,
} from '@chromashift/shared';
import { audio } from '../audio/audio';
import { engine } from '../game/engine';
import { input2, useSplit } from '../game/split';
import { leaveRoom, type NetRoom } from '../multiplayer/net';
import { p2Name } from '../state/p2';
import { publicName, useProfile } from '../state/profile';
import { useUi } from '../state/ui';
import { activeCar } from './racing';
import { OfflineRaceSource } from './raceSource';
import { RaceView, type RaceOutcome } from './raceView';
import { raceControl, useRaceHud2, useRaceResults } from './state';
import { tuning } from './tuning';

/** An offline race: you (and player two in split screen) against bots. */
export interface RaceSetup {
  track: string;
  laps: number;
  preset: RacePreset;
  damage: DamageMode;
  bots: number;
  difficulty: BotDifficulty;
}

const RACE_BOTS = ['Dash', 'Nitro', 'Comet', 'Zippy', 'Torque', 'Vroom', 'Apex', 'Drift', 'Sparky', 'Turbo', 'Rally', 'Skid'];


let last: RaceSetup | null = null;
let online = false;
let raceSeq = 0;

export const replayRace = () => last && void startRace(last);

export async function startRace(s: RaceSetup) {
  last = s;
  const ui = useUi.getState();
  ui.setLoading('Building the track…');
  try {
    await initPhysics();
    await new Promise((r) => setTimeout(r, 30));
    const p = useProfile.getState();
    const racers: RacerInfo[] = [{ id: 1, name: publicName(p), bot: false, car: activeCar(p.racing), identity: 0 }];
    const split = useSplit.getState().on;
    if (split) racers.push({ id: 2, name: p2Name(), bot: false, car: p.racing.builds[(p.racing.active + 1) % p.racing.builds.length], identity: 1 });
    const names = [...RACE_BOTS].sort(() => Math.random() - 0.5);
    const seed = (Math.random() * 2 ** 31) | 0;
    for (let i = 0; i < s.bots && racers.length < MAX_RACERS; i++) {
      const id = racers.length + 1;
      racers.push({ id, name: names[i % names.length], bot: true, difficulty: s.difficulty, car: botCar(seed + id * 977), identity: racers.length });
    }
    const sim = new RaceSim({ track: s.track, laps: s.laps, preset: s.preset, damage: s.damage, seed, ...(tuning.handling ? { handling: tuning.handling } : {}) }, racers);
    const source = new OfflineRaceSource(sim, split ? [1, 2] : [1]);
    online = false;
    const id = `off-${Date.now()}-${++raceSeq}`;
    const view = new RaceView(source, (o) => finish(o, id));
    engine.setView(view);
    if (split) view.addSeat(2, input2, useRaceHud2);
    ui.setPaused(false);
    ui.go('match');
  } catch (e) {
    console.error(e);
    ui.toast({ text: 'Couldn’t start the race. Try a lower graphics preset.', kind: 'error' });
  } finally {
    ui.setLoading(null);
  }
}

/** A race hosted by someone else (or by this tab, through its own room). */
export async function startRaceOnline(room: NetRoom, start: RaceStart) {
  const { OnlineRaceSource } = await import('./raceOnline');
  await initPhysics();
  online = true;
  const ui = useUi.getState();
  const id = `on-${start.config.seed}-${start.you}`;
  engine.setView(new RaceView(new OnlineRaceSource(room, start), (o) => finish(o, id)));
  ui.setPaused(false);
  ui.go('match');
}

function finish(o: RaceOutcome, raceId: string) {
  const ui = useUi.getState();
  const prof = useProfile.getState();
  const xp = online ? o.xp : xpForRace(o.result, o.you);
  const before = { xpBefore: prof.xp, levelBefore: levelInfo(prof.xp).level };
  const rec = prof.recordRace(o.result, o.you, xp, online, raceId);
  useRaceResults.setState({ data: { result: o.result, you: o.you, xp, coins: rec.coins, ...before, online, recorded: o.recorded, records: rec.records } });
  const me = o.result.players.find((p) => p.id === o.you);
  audio.jingle(!!me && me.position <= 3);
  setTimeout(() => {
    void import('../game/session').then((m) => {
      m.showMenu(me && me.position === 1 ? 'win' : 'none');
      ui.setPaused(false);
      ui.go('raceResults');
    });
  }, 300);
}

export function leaveRace() {
  if (online) leaveRoom();
  online = false;
}

raceControl.replay = () => void replayRace();
raceControl.leave = leaveRace;
