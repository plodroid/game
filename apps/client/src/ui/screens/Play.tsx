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
import { startOffline } from '../../game/session';
import { hostFromMenu } from '../../multiplayer/net';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';
import { Button, Header, Segmented, Setting } from '../kit';

export const DIFF_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
export const onlineIntent: { mode: 'join' | null } = { mode: null };

export function Play() {
  const go = useUi((s) => s.go);
  const items = [
    { icon: <Icon.users />, title: 'Host a game', desc: 'Friends join with your code. Runs in your browser, nothing to install.', run: () => void hostFromMenu() },
    {
      icon: <Icon.key />,
      title: 'Join a game',
      desc: 'Enter a friend’s code, or rejoin a recent game.',
      run: () => {
        onlineIntent.mode = 'join';
        go('online');
      },
    },
    {
      icon: <Icon.target />,
      title: 'Practice Against Bots',
      desc: 'You and three bots against four. Works offline.',
      run: () => void startOffline({ map: MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)], mode: 'turf', duration: 180, difficulty: 'normal', allies: 3, rivals: 4 }),
    },
    { icon: <Icon.sliders />, title: 'Custom Match', desc: 'Pick the map, mode, length and every bot slot.', run: () => go('custom') },
  ];
  return (
    <main className="screen">
      <Header title="Play" sub="Every mode supports bots, so a full match never needs eight people." />
      <div className="col options stagger">
        {items.map((it) => (
          <button key={it.title} className="option" onClick={it.run}>
            <span className="option__icon">{it.icon}</span>
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
    </main>
  );
}

export function Custom() {
  const [map, setMap] = useState<MapId>('skyline');
  const [mode, setMode] = useState<ModeId>('turf');
  const [duration, setDuration] = useState(180);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal');
  const [allies, setAllies] = useState(3);
  const [rivals, setRivals] = useState(4);
  const practice = mode === 'practice';
  return (
    <main className="screen">
      <Header title="Custom Match" sub="Offline against bots. Nothing here needs an internet connection." />
      <div className="col--wide stagger">
        <section className="panel">
          <Setting name="Map" hint={MAPS[map].description}>
            <Segmented value={map} onChange={setMap} label="Map" options={MAP_IDS.map((m) => ({ value: m, label: MAPS[m].name }))} />
          </Setting>
          <Setting name="Mode" hint={MODES[mode].description}>
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                if (MODES[m].duration) setDuration(MODES[m].duration);
              }}
              label="Mode"
              options={(['turf', 'zones', 'knockout', 'practice'] as ModeId[]).map((m) => ({ value: m, label: MODES[m].name }))}
            />
          </Setting>
          {!practice && (
            <Setting name="Length">
              <Segmented value={duration} onChange={setDuration} label="Length" options={DURATION_OPTIONS.map((d) => ({ value: d, label: `${d / 60} min` }))} />
            </Setting>
          )}
          <Setting name="Bot difficulty" hint="Changes reaction time, aim, awareness and teamwork — never the rules.">
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
          <Button variant="primary" size="lg" onClick={() => void startOffline({ map, mode, duration, difficulty, allies, rivals })}>
            <Icon.play size={16} /> Start match
          </Button>
          <span className="muted small">
            {practice ? 'Practice: four training targets, no timer.' : `${1 + allies} vs ${rivals} · ${MODES[mode].name} · ${MAPS[map].name}`}
          </span>
        </div>
      </div>
    </main>
  );
}
