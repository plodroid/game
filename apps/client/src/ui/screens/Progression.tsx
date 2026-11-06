import { useEffect, useState } from 'react';
import { coinsForXp, dailyQuests, dayEndsAt, LEVEL_COINS, levelInfo, weekEndsAt, weeklyQuests, type Quest } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { Coin, Icon } from '../icons';
import { Button, Header } from '../kit';

const left = (until: number, now: number) => {
  const s = Math.max(0, Math.floor((until - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

export default function Progression() {
  const p = useProfile();
  const toast = useUi((s) => s.toast);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    p.refreshQuests();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
    // Only on open; the store keeps quests fresh as matches finish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const l = levelInfo(p.xp);

  const card = (q: Quest) => {
    const done = p.quests.progress[q.id] ?? 0;
    const claimed = p.quests.claimed.includes(q.id);
    const ready = done >= q.goal && !claimed;
    return (
      <div key={q.id} className="quest" data-state={claimed ? 'claimed' : ready ? 'ready' : 'open'}>
        <div className="quest__text">
          <span className="quest__name">{q.text}</span>
          <span className="quest__bar" aria-hidden>
            <span style={{ transform: `scaleX(${Math.min(1, done / q.goal)})` }} />
          </span>
          <span className="muted small num">
            {Math.min(done, q.goal).toLocaleString()} / {q.goal.toLocaleString()}
          </span>
        </div>
        {claimed ? (
          <span className="quest__done">
            <Icon.check /> Claimed
          </span>
        ) : (
          <Button
            variant={ready ? 'primary' : 'default'}
            disabled={!ready}
            onClick={() => {
              const got = p.claimQuest(q.id);
              if (got) {
                audio.play('confirm');
                toast({ text: `Quest complete: +${got} coins`, kind: 'success' });
              }
            }}
          >
            <Coin /> {q.reward}
          </Button>
        )}
      </div>
    );
  };

  return (
    <main className="screen" data-pig="forest">
      <Header
        title="Progress"
        sub="Every match pays coins. Quests pay more. Spend them on anything in the Locker."
        end={
          <span className="coins" aria-label={`${p.coins} coins`}>
            <Coin size={20} />
            <span className="num">{p.coins.toLocaleString()}</span>
          </span>
        }
      />
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
            1 coin for every 8 XP (a good match is worth about {coinsForXp(700)}), plus {LEVEL_COINS} for each level.
          </p>
        </section>

        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="panel__title" style={{ margin: 0 }}>
              Daily
            </h2>
            <span className="muted small num">New quests in {left(dayEndsAt(now), now)}</span>
          </div>
          <div className="list">{dailyQuests(p.quests.day).map(card)}</div>
        </section>

        <section className="panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="panel__title" style={{ margin: 0 }}>
              Weekly
            </h2>
            <span className="muted small num">Resets in {left(weekEndsAt(now), now)}</span>
          </div>
          <div className="list">{weeklyQuests(p.quests.week).map(card)}</div>
        </section>
      </div>
    </main>
  );
}
