import { useEffect, useRef } from 'react';
import { GAME_VERSION, levelInfo } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { useAccount } from '../../auth/account';
import { menu, startOffline } from '../../game/session';
import { useNet } from '../../multiplayer/net';
import { publicName, useProfile } from '../../state/profile';
import { useUi, type Screen } from '../../state/ui';
import { BrandMark } from '../icons';

const ITEMS: { label: string; desc: string; to?: Screen; run?: () => void }[] = [
  { label: 'Play', desc: 'Matches against bots, custom games and quick play', to: 'play' },
  { label: 'Online', desc: 'Private rooms, room codes and LAN servers', to: 'online' },
  {
    label: 'Practice',
    desc: 'Free roam with training targets',
    run: () => void startOffline({ map: 'skyline', mode: 'practice', duration: 0, difficulty: 'easy', allies: 0, rivals: 4 }),
  },
  { label: 'Locker', desc: 'Look, weapon and special', to: 'locker' },
  { label: 'Progression', desc: 'Level, XP and unlocks', to: 'progression' },
  { label: 'Settings', desc: 'Graphics, audio, controls, accessibility', to: 'settings' },
];

export function Home() {
  const go = useUi((s) => s.go);
  const online = useUi((s) => s.online);
  const p = useProfile();
  const account = useAccount();
  const endpoint = useNet((s) => s.endpoint);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  const lvl = levelInfo(p.xp).level;
  const name = publicName(p);

  return (
    <main className="screen home">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="brand">
          <BrandMark />
          <span className="brand__word">CHROMASHIFT</span>
        </div>
        <button className="chip-profile" onClick={() => (audio.play('click'), go('profile'))} aria-label="Profile">
          <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
          <span>
            <span style={{ display: 'block', fontWeight: 650, fontSize: '0.9rem' }}>{name}</span>
            <span className="muted small num">
              Level {lvl} · {p.uid ? 'Account' : account.status === 'disabled' ? 'Guest' : 'Guest — sign in to sync'}
            </span>
          </span>
        </button>
      </div>

      <nav className="menu stagger" aria-label="Main menu">
        {ITEMS.map((it, i) => (
          <button
            key={it.label}
            ref={i === 0 ? first : undefined}
            className="menu__item"
            onMouseEnter={() => audio.play('hover')}
            onFocus={() => it.label === 'Locker' && menu()?.react('hop')}
            onClick={() => {
              audio.unlock();
              audio.play('click');
              if (it.run) it.run();
              else if (it.to) go(it.to);
            }}
          >
            <span className="menu__label">{it.label}</span>
            <span className="menu__desc">{it.desc}</span>
          </button>
        ))}
      </nav>

      <footer className="home__foot">
        <span>
          <span className={`dot ${online ? 'dot--ok' : 'dot--warn'}`} />
          {online ? 'Online' : 'Offline — bot matches still work'}
        </span>
        <span>{endpoint ? `Server: ${endpoint.replace(/^wss?:\/\//, '')}` : 'No multiplayer server set'}</span>
        <span className="num">v{GAME_VERSION}</span>
      </footer>
    </main>
  );
}
