import { lazy, Suspense, useState } from 'react';
import {
  BOT_DIFFICULTIES,
  DURATION_OPTIONS,
  MAP_IDS,
  MAPS,
  MODES,
  type BotDifficulty,
  type MapId,
  type ModeId,
} from '@chromashift/shared';
import { startOffline, startTutorial } from '../../game/session';
import { joinRandom } from '../../multiplayer/matchmaking';
import { useAccount } from '../../auth/account';
import { firebaseConfigured } from '../../env';
import { hostFromMenu, ownHostCode } from '../../multiplayer/net';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';
import { MyMaps } from '../MyMaps';
import { useMaps } from '../../state/maps';
import { Button, Header, LengthDial, Segmented, Setting } from '../kit';
/** VELOCITY's setup screen loads with the racing code, only when the car icon is picked. */
const VelocityPlay = lazy(() => import('../velocity/VelocityPlay').then((m) => ({ default: m.VelocityPlay })));

/** Which game Play shows: the paint shooter (default) or VELOCITY. Remembered on this device. */
const MODE_KEY = 'chromashift.playMode';
function readMode(): 'shooter' | 'velocity' {
  try {
    return localStorage.getItem(MODE_KEY) === 'velocity' ? 'velocity' : 'shooter';
  } catch {
    return 'shooter';
  }
}

export function ModeSwitch({ mode, onChange }: { mode: 'shooter' | 'velocity'; onChange: (m: 'shooter' | 'velocity') => void }) {
  const pick = (m: 'shooter' | 'velocity') => {
    onChange(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* not remembered */
    }
  };
  return (
    <div className="mode-switch" role="group" aria-label="Game">
      <button className="mode-switch__b" aria-pressed={mode === 'shooter'} onClick={() => pick('shooter')}>
        <Icon.gun size={30} />
        <span>
          <span className="mode-switch__title">CHROMASHIFT</span>
          <span className="mode-switch__sub">Paint the arena, 4 v 4</span>
        </span>
      </button>
      <button className="mode-switch__b" aria-pressed={mode === 'velocity'} onClick={() => pick('velocity')} style={{ ['--pig' as string]: 'var(--gold)' }}>
        <Icon.car size={30} />
        <span>
          <span className="mode-switch__title">VELOCITY</span>
          <span className="mode-switch__sub">Race up to six cars</span>
        </span>
      </button>
    </div>
  );
}

export const DIFF_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
export const onlineIntent: { mode: 'join' | null } = { mode: null };

export function Play() {
  const go = useUi((s) => s.go);
  const [code] = useState(ownHostCode);
  const [maps, setMaps] = useState(false);
  const signedIn = useAccount((a) => a.status === 'signedIn');
  const [mode, setMode] = useState(readMode);
  const items = [
    {
      title: 'Tutorial',
      desc: 'New here? A guided practice with the controls for your device: move, paint, dive, climb walls and dodge.',
      run: () => void startTutorial(),
    },
    ...(firebaseConfigured && signedIn
      ? [
          {
            title: 'Random server',
            desc: 'Jump into an open game near you with players of a similar skill. When it ends, tap Play again to keep going together.',
            run: () => void joinRandom(),
          },
        ]
      : []),
    { title: 'Host a game', desc: 'Friends join with your code. Runs in your browser, nothing to install.', run: () => void hostFromMenu() },
    {
      title: 'Join a game',
      desc: 'Enter a friend’s code, or pick an open public game.',
      run: () => {
        onlineIntent.mode = 'join';
        go('online');
      },
    },
    {
      title: 'Practice Against Bots',
      desc: 'You and three bots against four. Works offline.',
      run: () => void startOffline({ map: MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)], mode: 'turf', duration: 180, difficulty: 'normal', allies: 3, rivals: 4 }),
    },
    { title: 'Custom Match', desc: 'Pick the map, mode, length and every bot slot.', run: () => go('custom') },
    { title: 'Maps', desc: 'Build your own maps in 3D (keep three presets), or play maps others made public.', run: () => setMaps(true) },
  ];
  return (
    <main className="screen" data-pig="magenta">
      <Header title="Play" sub={mode === 'velocity' ? 'VELOCITY: race against bots or friends, up to six cars.' : 'Every mode supports bots, so a full match never needs eight people.'} />
      <div className="col--wide">
        <ModeSwitch mode={mode} onChange={setMode} />
      </div>
      {mode === 'velocity' && (
        <Suspense fallback={<div className="loading"><div className="spinner" />Loading VELOCITY…</div>}>
          <VelocityPlay />
        </Suspense>
      )}
      {mode === 'shooter' && (
      <div className="col options stagger">
        {items.map((it) => (
          <button key={it.title} className="option" onClick={it.run}>
            <span>
              <span className="option__title" style={{ display: 'block' }}>
                {it.title}
              </span>
              <span className="option__desc" style={{ display: 'block' }}>
                {it.desc}
              </span>
            </span>
            <Icon.play size={14} />
          </button>
        ))}
      </div>
      )}
      {maps && <MyMaps onClose={() => setMaps(false)} />}
      {code && mode === 'shooter' && (
        <section className="col code-note" aria-label="Your game code">
          <span className="code-note__label">Your game code</span>
          <span className="code num">{code}</span>
          <span className="code-note__text">It stays the same every time you host from this browser, so friends can keep it like a server address. They type it under Online, then Join.</span>
        </section>
      )}
    </main>
  );
}

export function Custom() {
  const presets = useMaps((s) => s.presets);
  const publics = useMaps((s) => s.publics);
  const mine = [...publics, ...presets];
  const [map, setMap] = useState<MapId>('skyline');
  // A map deleted while chosen falls back to the first one.
  const chosen = MAPS[map] ? map : 'skyline';
  const [mode, setMode] = useState<ModeId>('turf');
  const [duration, setDuration] = useState(180);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal');
  const [allies, setAllies] = useState(3);
  const [rivals, setRivals] = useState(4);
  const practice = mode === 'practice';
  return (
    <main className="screen" data-pig="magenta">
      <Header title="Custom Match" sub="Offline against bots. Nothing here needs an internet connection." />
      <div className="col--wide stagger">
        <section className="panel">
          <Setting name="Map" hint={MAPS[chosen].description}>
            <Segmented value={chosen} onChange={setMap} label="Map" options={MAP_IDS.map((m) => ({ value: m as MapId, label: MAPS[m].name }))} />
            {mine.length > 0 && (
              <select className="input" style={{ marginTop: 8 }} aria-label="Player-made maps" value={mine.some((m) => m.id === chosen) ? chosen : ''} onChange={(e) => e.target.value && setMap(e.target.value)}>
                <option value="">Player-made maps…</option>
                {publics.length > 0 && (
                  <optgroup label="Public maps">
                    {publics.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {presets.length > 0 && (
                  <optgroup label="My presets">
                    {presets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </Setting>
          <Setting name="Mode" hint={MODES[mode].description}>
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                if (MODES[m].duration) setDuration(MODES[m].duration);
              }}
              label="Mode"
              options={(['turf', 'blitz', 'zones', 'rush', 'knockout', 'suddendeath', 'brawl', 'practice'] as ModeId[]).map((m) => ({ value: m, label: MODES[m].name }))}
            />
          </Setting>
          {!practice && (
            <Setting name="Length">
              <LengthDial value={duration} options={DURATION_OPTIONS} onChange={setDuration} />
            </Setting>
          )}
          <Setting name="Bot difficulty" hint="Changes reaction time, aim, awareness and teamwork, never the rules.">
            <Segmented value={difficulty} onChange={setDifficulty} label="Bot difficulty" options={BOT_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d] }))} />
          </Setting>
          {!practice && (
            <>
              <Setting name="Bots on your team" hint={`You + ${allies}`}>
                <Segmented value={allies} onChange={setAllies} label="Allies" options={[0, 1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
              </Setting>
              <Setting name="Rival bots">
                <Segmented value={rivals} onChange={setRivals} label="Rivals" options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
              </Setting>
            </>
          )}
        </section>
        <div className="row" style={{ marginTop: 16 }}>
          <Button variant="primary" size="lg" onClick={() => void startOffline({ map: chosen, mode, duration, difficulty, allies, rivals })}>
            <Icon.play size={16} /> Start match
          </Button>
          <span className="muted small">
            {practice ? 'Practice: four training targets, no timer.' : `${1 + allies} vs ${rivals} · ${MODES[mode].name} · ${MAPS[chosen].name}${duration ? '' : ' · no time limit'}`}
          </span>
        </div>
      </div>
    </main>
  );
}
