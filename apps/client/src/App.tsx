import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { accounts, useAccount } from './auth/account';
import { firebaseConfigured } from './env';
import { engine } from './game/engine';
import { showMenu } from './game/session';
import { detectServer, setInvite, useNet } from './multiplayer/net';
import { prefersReducedMotion, useSettings } from './settings/settings';
import { useUi, type Screen } from './state/ui';
import { Hud } from './ui/hud/Hud';
import { Button } from './ui/kit';
import { Home } from './ui/screens/Home';
import { Custom, Play } from './ui/screens/Play';
import { useMenuGamepad } from './ui/useMenuGamepad';
import { SocialBar } from './ui/SocialBar';
import { CallUi } from './ui/CallUi';
import { useSocial } from './state/social';
import { useSplit } from './game/split';
import { Player2Panel, SplitPrompt } from './ui/Split';

const Online = lazy(() => import('./ui/screens/Online'));
const Lobby = lazy(() => import('./ui/screens/Lobby'));
const Locker = lazy(() => import('./ui/screens/Locker'));
const Progression = lazy(() => import('./ui/screens/Progression'));
const Profile = lazy(() => import('./ui/screens/Profile'));
const Settings = lazy(() => import('./ui/screens/Settings'));
const Auth = lazy(() => import('./ui/screens/Auth'));
const Results = lazy(() => import('./ui/screens/Results'));
const Social = lazy(() => import('./ui/screens/Social'));
const PlayerCard = lazy(() => import('./ui/PlayerCard'));

const SCREENS: Record<Exclude<Screen, 'match'>, ComponentType> = {
  home: Home,
  play: Play,
  custom: Custom,
  online: Online,
  lobby: Lobby,
  locker: Locker,
  progression: Progression,
  profile: Profile,
  settings: Settings,
  auth: Auth,
  results: Results,
  social: Social,
};

export function App({ webgl2 }: { webgl2: boolean }) {
  const screen = useUi((s) => s.screen);
  const paused = useUi((s) => s.paused);
  const loading = useUi((s) => s.loading);
  const [failed, setFailed] = useState<string | null>(null);
  const a11y = useSettings((s) => s.accessibility);
  const status = useAccount((s) => s.status);
  const split = useSplit((s) => s.on);
  // Everyone signs in before playing; builds without accounts configured skip the gate.
  const gated = firebaseConfigured && status !== 'signedIn';
  useMenuGamepad(screen !== 'match' || paused);

  useEffect(() => {
    if (!webgl2) return;
    try {
      engine.init(document.getElementById('stage')!);
      showMenu();
    } catch (e) {
      console.error(e);
      setFailed(e instanceof Error ? e.message : String(e));
    }
    void detectServer();
    void accounts();
    const params = new URLSearchParams(location.search);
    const join = params.get('join');
    if (join) {
      useNet.setState({ error: null });
      setInvite(join, params.get('server') ?? undefined);
      useUi.getState().go('online');
      history.replaceState(null, '', location.pathname);
    }
  }, [webgl2]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--text-scale', String(a11y.textScale));
    root.dataset.contrast = a11y.highContrast ? 'high' : 'normal';
    root.dataset.motion = prefersReducedMotion() ? 'reduced' : 'full';
  }, [a11y]);

  if (!webgl2 || failed)
    return (
      <div className="blocker">
        <div className="col" style={{ display: 'grid', gap: 12 }}>
          <h1 className="header__title">This device can’t run CHROMASHIFT</h1>
          <p className="muted">
            {failed
              ? `The 3D renderer failed to start (${failed}).`
              : 'CHROMASHIFT needs WebGL2, which this browser or graphics driver doesn’t provide.'}{' '}
            Try an up-to-date Chrome, Edge, Firefox or Safari, make sure hardware acceleration is enabled in the browser settings, and update your
            graphics drivers.
          </p>
          <div>
            <Button variant="primary" onClick={() => location.reload()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );

  const showSettingsOverMatch = screen === 'settings' && paused;
  // Split screen in the menu: player 1's menu keeps the left half, player 2 gets the right.
  const splitMenu = split && !gated && screen !== 'match' && !showSettingsOverMatch;
  const Current = gated ? (status === 'loading' ? null : Auth) : screen === 'match' ? null : SCREENS[screen];
  return (
    <>
      {!gated && (screen === 'match' || showSettingsOverMatch) && <Hud />}
      {Current && (
        <Suspense fallback={null}>
          <div key={gated ? 'gate' : screen} style={{ position: 'absolute', inset: splitMenu ? '0 50% 0 0' : 0, zIndex: showSettingsOverMatch ? 35 : undefined, ...(splitMenu ? { transform: 'translateZ(0)', overflow: 'hidden' } : {}) }}>
            <Current />
          </div>
        </Suspense>
      )}
      {gated && status === 'loading' && (
        <div className="overlay" style={{ background: 'transparent' }}>
          <div className="loading">
            <div className="spinner" />
            Signing in…
          </div>
        </div>
      )}
      {loading && (
        <div className="overlay">
          <div className="loading">
            <div className="spinner" />
            {loading}
          </div>
        </div>
      )}
      {splitMenu && <Player2Panel />}
      {!gated && screen !== 'match' && !splitMenu && <SocialBar />}
      {!gated && <SplitPrompt />}
      <Viewing />
      <Toasts />
      {!gated && <CallUi />}
      <Reconnecting />
    </>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <span className="toast__bar" />
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.action && (
            <Button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </Button>
          )}
          <Button icon variant="ghost" aria-label="Dismiss" onClick={() => dismiss(t.id)} style={{ width: 34, height: 34 }}>
            ×
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Another player's card, over whatever screen is open. */
function Viewing() {
  const uid = useSocial((s) => s.viewing);
  if (!uid) return null;
  return (
    <Suspense fallback={null}>
      <PlayerCard uid={uid} />
    </Suspense>
  );
}

function Reconnecting() {
  const r = useNet((s) => s.reconnecting);
  if (!r) return null;
  return (
    <div className="overlay" style={{ background: 'rgba(8,9,16,0.45)', zIndex: 50 }}>
      <div className="loading">
        <div className="spinner" />
        Connection lost. Reconnecting…
      </div>
    </div>
  );
}
