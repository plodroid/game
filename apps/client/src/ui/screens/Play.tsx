import { useState } from 'react';
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
import { isOwner } from '../../auth/admin';
import { firebaseConfigured } from '../../env';
import { hostFromMenu, ownHostCode } from '../../multiplayer/net';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';
import { MyMaps } from '../MyMaps';
import { useMaps } from '../../state/maps';
import { Button, Header, LengthDial, Segmented, Setting } from '../kit';

export const DIFF_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
export const onlineIntent: { mode: 'join' | null } = { mode: null };

export function Play() {
  const go = useUi((s) => s.go);
  const [code] = useState(ownHostCode);
  const [maps, setMaps] = useState(false);
  useAccount((a) => a.user?.uid); // re-check the owner when the account changes
  const owner = isOwner();
  const signedIn = useAccount((a) => a.status === 'signedIn');
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
    // The map editor is an owner tool, like the weapon editor.
    ...(owner ? [{ title: 'Map editor', desc: 'Build maps in 3D, then edit, play or delete them.', run: () => setMaps(true) }] : []),
  ];
  return (
    <main className="screen" data-pig="magenta">
      <Header title="Play" sub="Every mode supports bots, so a full match never needs eight people." />
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
      {maps && owner && <MyMaps onClose={() => setMaps(false)} />}
      {code && (
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
  const mine = useMaps((s) => s.maps);
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
            <Segmented value={chosen} onChange={setMap} label="Map" options={[...MAP_IDS, ...mine.map((m) => m.id)].map((m) => ({ value: m, label: MAPS[m].name }))} />
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
