import { BODIES, trackDef } from '@chromashift/shared';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { favouriteCar, favouriteTrack } from '../../velocity/racing';
import { Button } from '../kit';

const fmt = (s: number | null) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** VELOCITY's half of the profile: lifetime racing, records per track and per car. */
export function RaceStats() {
  const r = useProfile((p) => p.racing);
  const go = useUi((s) => s.go);
  const s = r.stats;
  const podiums = s.wins + s.seconds + s.thirds;
  const pct = (n: number) => (s.races ? `${Math.round((n / s.races) * 100)}%` : '—');
  const ft = favouriteTrack(r), fc = favouriteCar(r);
  const bestLap = Object.values(r.tracks).reduce<number | null>((b, t) => (t.bestLap && (!b || t.bestLap < b) ? t.bestLap : b), null);
  const cells: [string, string | number][] = [
    ['Races', s.races],
    ['Wins', s.wins],
    ['Win rate', pct(s.wins)],
    ['Podiums', podiums],
    ['Podium rate', pct(podiums)],
    ['Finished', s.finished],
    ['Distance', `${(s.distance / 1000).toFixed(1)} km`],
    ['Driving time', `${Math.round(s.driveTime / 60)} min`],
    ['Laps', s.laps],
    ['Overtakes', s.overtakes],
    ['Drift time', `${Math.round(s.driftTime)} s`],
    ['Boosts', s.boosts],
    ['Collisions', s.collisions],
    ['Clean finishes', s.clean],
    ['Best lap (any track)', fmt(bestLap)],
  ];
  return (
    <section className="panel">
      <h2 className="panel__title">VELOCITY</h2>
      <div className="vstats">
        {cells.map(([k, v]) => (
          <div key={k}>
            <strong className="num">{v}</strong>
            <span>{k}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ margin: '10px 0' }}>
        Favourite track: {ft ? (trackDef(ft)?.name ?? ft) : '—'} · Favourite car: {fc ? (BODIES[fc]?.name ?? fc) : '—'}. {s.verified ? `${s.verified} of these races were online, scored by the host.` : 'Races against bots are recorded on your device and synced to your account.'}
      </p>
      {Object.keys(r.tracks).length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr className="muted small">
              <th style={{ textAlign: 'left', padding: 4 }}>Track</th>
              <th style={{ textAlign: 'left', padding: 4 }}>Races</th>
              <th style={{ textAlign: 'left', padding: 4 }}>Wins</th>
              <th style={{ textAlign: 'left', padding: 4 }}>Best lap</th>
              <th style={{ textAlign: 'left', padding: 4 }}>Best race (3 laps)</th>
              <th style={{ textAlign: 'left', padding: 4 }}>Best place</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(r.tracks).map(([id, t]) => (
              <tr key={id}>
                <td style={{ padding: 4 }}>{trackDef(id)?.name ?? id}</td>
                <td className="num" style={{ padding: 4 }}>
                  {t.races}
                </td>
                <td className="num" style={{ padding: 4 }}>
                  {t.wins}
                </td>
                <td className="num" style={{ padding: 4 }}>
                  {fmt(t.bestLap)}
                </td>
                <td className="num" style={{ padding: 4 }}>
                  {fmt(t.bestRace)} {t.car ? <span className="muted small">({BODIES[t.car]?.name ?? t.car})</span> : null}
                </td>
                <td className="num" style={{ padding: 4 }}>
                  {t.bestPos ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.keys(r.cars).length > 0 && (
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          {Object.entries(r.cars)
            .map(([id, c]) => `${BODIES[id]?.name ?? id}: ${c.races} races, ${c.wins} wins, ${(c.distance / 1000).toFixed(1)} km`)
            .join(' · ')}
        </p>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <Button onClick={() => go('garage')}>Open garage</Button>
      </div>
    </section>
  );
}
