import { levelInfo, unlocksAt } from '@chromashift/shared';
import { useProfile } from '../../state/profile';
import { Header } from '../kit';

export default function Progression() {
  const xp = useProfile((s) => s.xp);
  const l = levelInfo(xp);
  const levels = Array.from({ length: 10 }, (_, i) => i + 1).filter((n) => n === 1 || unlocksAt(n).length);
  return (
    <main className="screen">
      <Header title="Progression" sub="Earn XP for paint, KOs, assists and wins. Practice doesn’t award XP." />
      <div className="col stagger">
        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="stat__v">Level {l.level}</span>
            <span className="muted num">
              {l.into} / {l.needed} XP
            </span>
          </div>
          <div className="xpbar" style={{ marginTop: 12 }}>
            <div className="xpbar__fill" style={{ transform: `scaleX(${l.progress})` }} />
          </div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>
            Total XP {xp.toLocaleString()} · each match awards up to 1,200 XP.
          </p>
        </section>
        <section className="panel">
          <h2 className="panel__title">Unlock track</h2>
          <div className="track">
            {levels.map((n) => {
              const items = unlocksAt(n);
              return (
                <div key={n} className={`track__row ${n > l.level ? 'track__row--locked' : ''}`}>
                  <span className="track__lvl">Lv {n}</span>
                  <span>
                    {items.length ? items.map((u) => `${u.name} (${u.category.toLowerCase()})`).join(' · ') : 'Starter set'}
                    {n <= l.level && <span className="muted small"> — unlocked</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
