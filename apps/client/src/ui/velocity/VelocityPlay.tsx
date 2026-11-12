import { useMemo, useState } from 'react';
import {
  BODIES, BOT_DIFFICULTIES, CAR_COLORS, DEFAULT_RACE_SETTINGS, LAP_OPTIONS, MAX_RACERS, RACE_IDENTITIES, trackDef, trackPath, TRACK_IDS,
  sanitizeRaceSettings, isTrack, type RaceSettings,
} from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { hostGame } from '../../multiplayer/net';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { activeCar } from '../../velocity/racing';
import { startRace } from '../../velocity/session';
import { useTracks } from '../../velocity/tracksState';
import { Icon } from '../icons';
import { Button, Segmented, Setting } from '../kit';
import { DIFF_LABEL, onlineIntent } from '../screens/Play';
import { TrackEditor } from './TrackEditor';
import { AdminVelocity } from './AdminVelocity';
import { isOwner } from '../../auth/admin';
import { useAccount } from '../../auth/account';

const KEY = 'chromashift.raceSetup';

export function loadRaceSetup(): RaceSettings {
  try {
    return sanitizeRaceSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'), isTrack);
  } catch {
    return DEFAULT_RACE_SETTINGS;
  }
}
const saveRaceSetup = (s: RaceSettings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: kept for this visit */
  }
};

/** A track's shape as a small outline. */
export function TrackOutline({ id }: { id: string }) {
  const d = useMemo(() => {
    try {
      const p = trackPath(id);
      const b = p.bounds, span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) || 1;
      const pts: string[] = [];
      for (let i = 0; i < p.n; i += 4) pts.push(`${(((p.px[i] - b.minX) / span) * 100).toFixed(1)},${(((p.pz[i] - b.minZ) / span) * 100).toFixed(1)}`);
      return `M${pts.join('L')}Z`;
    } catch {
      return '';
    }
  }, [id]);
  return (
    <svg viewBox="-6 -6 112 112" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function VelocityPlay() {
  const go = useUi((s) => s.go);
  const racing = useProfile((p) => p.racing);
  const setRacing = useProfile((p) => p.setRacing);
  const publics = useTracks((t) => t.publics);
  const presets = useTracks((t) => t.presets);
  const custom = useMemo(() => [...publics, ...presets], [publics, presets]);
  const [s, setS] = useState<RaceSettings>(loadRaceSetup);
  const [editing, setEditing] = useState(false);
  const [tuning, setTuning] = useState(false);
  useAccount((a) => a.user?.uid);
  const owner = isOwner();
  const set = (patch: Partial<RaceSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveRaceSetup(next);
  };
  const track = trackDef(s.track) ?? trackDef('coastal')!;
  const car = activeCar(racing);
  const len = (() => {
    try {
      return (trackPath(track.id).length / 1000).toFixed(2);
    } catch {
      return '?';
    }
  })();
  const host = async () => {
    const ui = useUi.getState();
    ui.setLoading('Opening your race…');
    try {
      await hostGame({ game: 'velocity', race: s });
      ui.go('lobby');
    } catch {
      ui.go('online');
    } finally {
      ui.setLoading(null);
    }
  };
  return (
    <div className="col--wide stagger">
      <section className="panel">
        <Setting name="Your car" hint={`${BODIES[car.body]?.name ?? 'Car'} · ${CAR_COLORS[car.paint]?.name ?? ''}. Three saved builds; change them in the Garage.`}>
          <div className="car-pick">
            {racing.builds.map((b, i) => (
              <button
                key={i}
                aria-pressed={racing.active === i}
                onClick={() => {
                  audio.play('click');
                  setRacing({ active: i });
                }}
              >
                <i style={{ background: `#${(CAR_COLORS[b.paint]?.hex ?? 0xffffff).toString(16).padStart(6, '0')}` }} />
                Build {i + 1} · {BODIES[b.body]?.name ?? b.body}
              </button>
            ))}
            <Button onClick={() => go('garage')}>
              <Icon.car size={16} /> Garage
            </Button>
          </div>
        </Setting>
      </section>
      <section className="panel">
        <h3 className="panel__title">Track</h3>
        <div className="track-grid" role="listbox" aria-label="Track">
          {[...TRACK_IDS, ...custom.map((t) => t.id)].map((id) => {
            const t = trackDef(id);
            if (!t) return null;
            return (
              <button key={id} className="track-card" aria-pressed={s.track === id} onClick={() => set({ track: id, laps: t.laps })} title={t.description}>
                <TrackOutline id={id} />
                <span className="track-card__name">{t.name}</span>
                <span className="track-card__meta">{t.custom ? 'Player-made' : `${t.laps} laps suggested`}</span>
              </button>
            );
          })}
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          {track.description} {len} km a lap.
        </p>
      </section>
      <section className="panel">
        <Setting name="Race" hint={s.preset === 'arcade' ? 'Arcade: pickup boxes with boosts, shields, slicks and more.' : 'Classic: pure racing, no pickups.'}>
          <Segmented value={s.preset} onChange={(preset) => set({ preset })} label="Race type" options={[{ value: 'classic', label: 'Classic' }, { value: 'arcade', label: 'Arcade' }]} />
        </Setting>
        <Setting name="Laps">
          <Segmented value={s.laps} onChange={(laps) => set({ laps })} label="Laps" options={LAP_OPTIONS.map((n) => ({ value: n, label: String(n) }))} />
        </Setting>
        <Setting name="Damage" hint="Full: crashes slow you down a little too. Visual: dents and scratches only. Your car is always fixed after the race.">
          <Segmented value={s.damage} onChange={(damage) => set({ damage })} label="Damage" options={[{ value: 'full', label: 'Full' }, { value: 'visual', label: 'Visual' }, { value: 'off', label: 'Off' }]} />
        </Setting>
        <Setting name="Bots" hint={`Up to ${MAX_RACERS} cars on the grid.`}>
          <Segmented value={s.bots} onChange={(bots) => set({ bots })} label="Bots" options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
        </Setting>
        <Setting name="Bot difficulty" hint="Better bots carry more speed through corners and drive cleaner lines. Same car, same physics, no shortcuts.">
          <Segmented value={s.difficulty} onChange={(difficulty) => set({ difficulty })} label="Bot difficulty" options={BOT_DIFFICULTIES.map((d) => ({ value: d, label: DIFF_LABEL[d] }))} />
        </Setting>
      </section>
      <div className="row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
        <Button variant="primary" size="lg" onClick={() => void startRace(s)}>
          <Icon.play size={16} /> Race
        </Button>
        <Button size="lg" onClick={() => void host()}>
          Host a race
        </Button>
        <Button
          size="lg"
          onClick={() => {
            onlineIntent.mode = 'join';
            go('online');
          }}
        >
          Join a race
        </Button>
        <Button size="lg" onClick={() => setEditing(true)}>
          Track editor
        </Button>
        {owner && (
          <Button size="lg" onClick={() => setTuning(true)}>
            <Icon.crown size={14} /> Vehicle tuning
          </Button>
        )}
      </div>
      {tuning && <AdminVelocity onClose={() => setTuning(false)} />}
      <p className="muted small" style={{ marginTop: 8 }}>
        You race as {RACE_IDENTITIES[0].name.toLowerCase()} number {car.number}. Friends join a hosted race with your game code, the same as a CHROMASHIFT match.
      </p>
      {editing && <TrackEditor onClose={() => setEditing(false)} onPlay={(id) => void startRace({ ...s, track: id, bots: 0, laps: 1 })} />}
    </div>
  );
}
