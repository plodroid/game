import { InstallApp } from '../InstallApp';
import { useEffect, useRef } from 'react';
import { GAME_VERSION, levelInfo } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { useAccount } from '../../auth/account';
import { menu, startOffline } from '../../game/session';
import { useNet } from '../../multiplayer/net';
import { publicName, useProfile } from '../../state/profile';
import { useUi, type Screen } from '../../state/ui';
import { Avatar } from '../Avatar';
import { BrandMark } from '../icons';

/** Each section of the game carries one of its paints, here and on its own screen. */
const ITEMS: { label: string; desc: string; pig: string; to?: Screen; run?: () => void }[] = [
  { label: 'Play', desc: 'Host a game for friends, join one, or take on bots', pig: 'magenta', to: 'play' },
  { label: 'Online', desc: 'Join by code, recent games and dedicated servers', pig: 'teal', to: 'online' },
  {
    label: 'Practice',
    desc: 'Free roam with training targets',
    pig: 'gold',
    run: () => void startOffline({ map: 'skyline', mode: 'practice', duration: 0, difficulty: 'easy', allies: 0, rivals: 4 }),
  },
  { label: 'Friends', desc: 'Parties, friends, messages and player search', pig: 'teal', to: 'social' },
  { label: 'Locker', desc: 'Weapons, outfits and 300+ items to collect', pig: 'cobalt', to: 'locker' },
  { label: 'Progress', desc: 'Level, coins, daily and weekly quests', pig: 'forest', to: 'progression' },
  { label: 'Settings', desc: 'Graphics, audio, controls, accessibility', pig: 'graphite', to: 'settings' },
];

export function Home() {
  const go = useUi((s) => s.go);
  const online = useUi((s) => s.online);
  const p = useProfile();
  const account = useAccount();
  const endpoint = useNet((s) => s.endpoint);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);
  const lvl = levelInfo(p.xp);
  const name = publicName(p);

  return (
    <main className="screen home">
      <h1 className="brand">
        <BrandMark />
        <span className="brand__word">Chromashift</span>
      </h1>

      <nav className="menu stagger" aria-label="Main menu">
        {ITEMS.map((it, i) => (
          <button
            key={it.label}
            ref={i === 0 ? first : undefined}
            className="menu__item"
            data-pig={it.pig}
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

      <div>
        <button className="chip-profile" data-pig="gold" onClick={() => (audio.play('click'), go('profile'))} aria-label={`Profile: ${name}, level ${lvl.level}`}>
          <Avatar cosmetics={p.cosmetics} name={name} />
          <span style={{ minWidth: 0 }}>
            <span className="chip-profile__name">{name}</span>
            <span className="chip-profile__meta num">
              Level {lvl.level} · {p.uid ? 'Signed in' : account.status === 'disabled' ? 'Guest' : 'Guest, sign in to sync'}
            </span>
            <span className="xpbar" aria-hidden style={{ display: 'block' }}>
              <span className="xpbar__fill" style={{ display: 'block', transform: `scaleX(${lvl.progress})` }} />
            </span>
          </span>
        </button>
        <InstallApp />
        <footer className="home__foot">
          <span>
            <span className={`dot ${online ? 'dot--ok' : 'dot--warn'}`} />
            {online ? 'Online' : 'Offline, bot matches still work'}
          </span>
          {endpoint && <span>Server {endpoint.replace(/^wss?:\/\//, '')}</span>}
          <span className="num">v{GAME_VERSION}</span>
        </footer>
      </div>
    </main>
  );
}
