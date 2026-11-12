import { BODIES, coinsEarned, levelInfo, RACE_IDENTITIES, trackDef } from '@chromashift/shared';
import { useUi } from '../../state/ui';
import { raceControl, useRaceResults } from '../../velocity/state';
import { Icon } from '../icons';
import { Button, Header } from '../kit';
import { ordinal } from './RaceHud';

const fmt = (s: number | null) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export default function RaceResults() {
  const data = useRaceResults((s) => s.data);
  const go = useUi((s) => s.go);
  if (!data) {
    return (
      <main className="screen">
        <Header title="Results" />
        <Button onClick={() => go('play')}>Back</Button>
      </main>
    );
  }
  const { result, you, xp, coins, levelBefore, xpBefore, online, records } = data;
  const me = result.players.find((p) => p.id === you);
  const track = trackDef(result.track);
  const lv = levelInfo(xpBefore + xp);
  void coinsEarned;
  return (
    <main className="screen" data-pig="gold">
      <Header title="Race results" sub={`${track?.name ?? 'Track'} · ${result.laps} lap${result.laps > 1 ? 's' : ''} · ${result.preset === 'arcade' ? 'Arcade' : 'Classic'}${online ? ' · online' : ''}`} onBack={() => go('play')} />
      <div className="col--wide race-results stagger">
        <section className="panel" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <span className="podium">{me ? (me.finished ? ordinal(me.position) : 'DNF') : '—'}</span>
          <span>
            <strong style={{ display: 'block', fontSize: '1.1rem' }}>{me?.position === 1 && me.finished ? 'Victory!' : me?.finished ? 'Finished' : 'Did not finish'}</strong>
            <span className="muted small">
              {me?.time ? `Race ${fmt(me.time)}` : ''} {me?.best ? `· Best lap ${fmt(me.best)}` : ''}
            </span>
          </span>
          <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <strong style={{ display: 'block' }}>
              +{xp} XP · +{coins} coins
            </strong>
            <span className="muted small">{lv.level > levelBefore ? `Level up! Now level ${lv.level}.` : `Level ${lv.level}`}</span>
          </span>
        </section>
        {records.length > 0 && (
          <section className="panel" style={{ background: 'var(--gold)', color: 'var(--on-paint)' }}>
            <strong>{records.join(' · ')}!</strong>
          </section>
        )}
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>Pos</th>
                <th>Driver</th>
                <th>Car</th>
                <th>Time</th>
                <th>Best lap</th>
                <th>Overtakes</th>
              </tr>
            </thead>
            <tbody>
              {result.players.map((p) => (
                <tr key={p.id} data-me={p.id === you}>
                  <td className="num">{p.finished ? p.position : 'DNF'}</td>
                  <td>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: hex(RACE_IDENTITIES[p.identity % 6].color), marginRight: 8 }} />
                    {p.name}
                    {p.bot ? <span className="muted small"> · bot</span> : null}
                  </td>
                  <td className="muted small">{BODIES[p.body]?.name ?? p.body}</td>
                  <td className="num">{fmt(p.time)}</td>
                  <td className="num" style={{ color: result.fastest?.id === p.id ? 'var(--cobalt)' : undefined }}>
                    {fmt(p.best)}
                    {result.fastest?.id === p.id ? ' ★' : ''}
                  </td>
                  <td className="num">{p.stats.overtakes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {me && (
          <section className="panel">
            <h3 className="panel__title">Your race</h3>
            <div className="vstats">
              <div>
                <strong className="num">{(me.stats.distance / 1000).toFixed(2)} km</strong>
                <span>Distance</span>
              </div>
              <div>
                <strong className="num">{Math.round(me.stats.topSpeed * 3.6)} km/h</strong>
                <span>Top speed</span>
              </div>
              <div>
                <strong className="num">{me.stats.driftTime.toFixed(1)} s</strong>
                <span>Drifting</span>
              </div>
              <div>
                <strong className="num">{me.stats.collisions}</strong>
                <span>Collisions</span>
              </div>
              <div>
                <strong className="num">{me.stats.boosts}</strong>
                <span>Boosts</span>
              </div>
              <div>
                <strong className="num">{me.laps.map((l) => fmt(l)).join(' · ') || '—'}</strong>
                <span>Laps</span>
              </div>
            </div>
          </section>
        )}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {!online && (
            <Button variant="primary" size="lg" onClick={() => raceControl.replay?.()}>
              <Icon.play size={16} /> Race again
            </Button>
          )}
          <Button size="lg" onClick={() => go('garage')}>
            <Icon.car size={16} /> Garage
          </Button>
          <Button size="lg" onClick={() => go(online ? 'lobby' : 'play')}>
            {online ? 'Back to lobby' : 'Done'}
          </Button>
        </div>
      </div>
    </main>
  );
}
