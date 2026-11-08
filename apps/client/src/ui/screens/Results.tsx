import { useEffect, useState } from 'react';
import { kindOf, LEVEL_COINS, levelInfo, MAPS, MODES, WEAPONS } from '@chromashift/shared';
import { replayOffline } from '../../game/session';
import { send, useNet } from '../../multiplayer/net';
import { teamNames } from '../../rendering/palette';
import { useUi } from '../../state/ui';
import { MSG } from '@chromashift/shared';
import { Coin, TeamShape } from '../icons';
import { Button } from '../kit';

export default function Results() {
  const r = useUi((s) => s.results);
  const go = useUi((s) => s.go);
  const lobby = useNet((s) => s.lobby);
  const you = useNet((s) => s.you);
  const [shown, setShown] = useState(false);
  const [again, setAgain] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 120);
    return () => clearTimeout(t);
  }, []);
  if (!r) {
    return (
      <main className="screen results">
        <Button onClick={() => go('home')}>Main menu</Button>
      </main>
    );
  }
  const res = r.result;
  const me = res.players.find((p) => p.id === r.you);
  const names = teamNames();
  const practice = res.mode === 'practice';
  const verdict = practice
    ? 'Practice done'
    : res.winner === -1
      ? 'Draw'
      : me && res.winner === me.team
        ? 'Victory'
        : 'Defeat';
  const pct = kindOf(res.mode) === 'turf' || practice;
  const before = levelInfo(r.xpBefore),
    after = levelInfo(r.xpBefore + r.xp);
  const levelled = after.level > before.level;
  const sorted = [...res.players].sort((a, b) => a.team - b.team || b.paint - a.paint);
  const isHost = lobby && lobby.hostId === you;
  const random = !!lobby?.random;

  // The verdict sits on a field of your team's paint when you win, on ink when you lose.
  const field =
    verdict === 'Victory' || practice
      ? { ['--pig' as string]: me?.team === 1 ? 'var(--team-b)' : 'var(--team-a)', ['--pig-ink' as string]: 'var(--on-paint)' }
      : verdict === 'Defeat'
        ? { ['--pig' as string]: 'var(--s3)', ['--pig-ink' as string]: 'var(--tx)' }
        : { ['--pig' as string]: 'var(--graphite)', ['--pig-ink' as string]: 'var(--on-paint)' };

  return (
    <main className="screen results">
      <header className="header verdict-field" style={field}>
        <div>
          <p className="header__sub" style={{ margin: 0 }}>
            {MODES[res.mode].name} · {MAPS[res.map].name} · {Math.floor(res.duration / 60)}:{String(res.duration % 60).padStart(2, '0')}
          </p>
          <h1 className="verdict">{verdict}</h1>
          {!practice && res.winner >= 0 && (
            <p className="header__sub" style={{ margin: 0 }}>
              {names[res.winner as 0 | 1]} team wins
            </p>
          )}
        </div>
      </header>
      <div className="results__body">
        <div className="coverage">
          <div className="coverage__bar" aria-label="Final coverage">
            <div className="coverage__a" style={{ flexBasis: shown ? `${res.coverage[0]}%` : '0%' }} />
            <div className="coverage__b" style={{ flexBasis: shown ? `${res.coverage[1]}%` : '0%' }} />
          </div>
          <div className="coverage__nums num">
            <span className="row" style={{ gap: 8 }}>
              <TeamShape team={0} size={16} /> {pct ? `${res.coverage[0].toFixed(1)}%` : res.score[0]}
            </span>
            <span className="row" style={{ gap: 8 }}>
              {pct ? `${res.coverage[1].toFixed(1)}%` : res.score[1]} <TeamShape team={1} size={16} />
            </span>
          </div>
          {!pct && (
            <p className="muted small">
              {kindOf(res.mode) === 'zones' ? 'Zone countdown remaining' : 'Respawn tickets left'} · coverage{' '}
              {res.coverage[0].toFixed(1)}% / {res.coverage[1].toFixed(1)}%
            </p>
          )}
        </div>

        <div className="table-wrap">
          <table className="table table--results">
            <thead>
              <tr>
                <th>Player</th>
                <th>Weapon</th>
                <th>Paint (m²)</th>
                <th>KO</th>
                <th>Assist</th>
                <th>Splatted</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.id}
                  className={p.id === r.you ? 'is-you' : ''}
                  style={{ ['--row-team' as string]: p.team === 0 ? 'var(--team-a)' : 'var(--team-b)' }}
                >
                  <td>
                    {p.name}
                    {p.bot && <span className="muted small"> · bot</span>}
                    <span className="table__sub">{WEAPONS[p.weapon].name}</span>
                  </td>
                  <td>{WEAPONS[p.weapon].name}</td>
                  <td>{p.paint}</td>
                  <td>{p.kills}</td>
                  <td>{p.assists}</td>
                  <td>{p.deaths}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!practice && (
          <div style={{ margin: '4px 0 18px' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>
                +{r.xp} XP {r.online && r.recorded ? <span className="badge badge--ok">Verified</span> : null}
              </strong>
              <span className="muted small num">
                Level {after.level} · {after.into}/{after.needed}
              </span>
            </div>
            <div className="xpbar">
              <div
                className="xpbar__fill"
                style={{ transform: `scaleX(${shown ? after.progress : before.progress})` }}
              />
            </div>
            <p className="row" style={{ margin: '12px 0 0', gap: 8 }}>
              <span className="coins">
                <Coin size={18} /> <span className="num">+{r.coins.toLocaleString()}</span>
              </span>
              <span className="muted small">
                {levelled ? `Level up! Includes ${LEVEL_COINS * (after.level - before.level)} bonus coins.` : 'Spend coins in the Locker. Quests pay more.'}
              </span>
            </p>
          </div>
        )}

        <div className="row">
          {r.online && lobby && random ? (
            <>
              {isHost ? (
                <Button variant="primary" size="lg" onClick={() => (send(MSG.TO_LOBBY), go('lobby'))}>
                  Next match
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  disabled={again}
                  onClick={() => {
                    setAgain(true);
                    send(MSG.AGAIN);
                    go('lobby');
                  }}
                >
                  {again ? 'Waiting for the next lobby…' : 'Play again?'}
                </Button>
              )}
              <span className="muted small">Everyone who taps Play again moves to a new lobby together.</span>
            </>
          ) : r.online && lobby ? (
            isHost ? (
              <Button variant="primary" size="lg" onClick={() => (send(MSG.TO_LOBBY), go('lobby'))}>
                Back to lobby
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => go('lobby')}>
                Back to lobby
              </Button>
            )
          ) : (
            <Button variant="primary" size="lg" onClick={() => void replayOffline()}>
              Play again
            </Button>
          )}
          <Button size="lg" onClick={() => go('home')}>
            Main menu
          </Button>
        </div>
      </div>
    </main>
  );
}
