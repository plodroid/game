import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { accounts } from './auth/account';
import { engine } from './game/engine';
import { showMenu } from './game/session';
import { detectServer, useNet } from './multiplayer/net';
import { prefersReducedMotion, useSettings } from './settings/settings';
import { useUi, type Screen } from './state/ui';
import { Hud } from './ui/hud/Hud';
import { Button } from './ui/kit';
import { Home } from './ui/screens/Home';
import { Custom, Play } from './ui/screens/Play';
import { useMenuGamepad } from './ui/useMenuGamepad';

const Online = lazy(() => import('./ui/screens/Online'));
const Lobby = lazy(() => import('./ui/screens/Lobby'));
const Locker = lazy(() => import('./ui/screens/Locker'));
const Progression = lazy(() => import('./ui/screens/Progression'));
const Profile = lazy(() => import('./ui/screens/Profile'));
const Settings = lazy(() => import('./ui/screens/Settings'));
const Auth = lazy(() => import('./ui/screens/Auth'));
const Results = lazy(() => import('./ui/screens/Results'));

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
};

export function App({ webgl2 }: { webgl2: boolean }) {
  const screen = useUi((s) => s.screen);
  const paused = useUi((s) => s.paused);
  const loading = useUi((s) => s.loading);
  const [failed, setFailed] = useState<string | null>(null);
  const a11y = useSettings((s) => s.accessibility);
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
      sessionStorage.setItem('chromashift.join', join);
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
  const Current = screen === 'match' ? null : SCREENS[screen];
  return (
    <>
      {(screen === 'match' || showSettingsOverMatch) && <Hud />}
      {Current && (
        <Suspense fallback={null}>
          <div key={screen} style={{ position: 'absolute', inset: 0, zIndex: showSettingsOverMatch ? 35 : undefined }}>
            <Current />
          </div>
        </Suspense>
      )}
      {loading && (
        <div className="overlay">
          <div className="loading">
            <div className="spinner" />
            {loading}
          </div>
        </div>
      )}
      <Toasts />
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

function Reconnecting() {
  const r = useNet((s) => s.reconnecting);
  if (!r) return null;
  return (
    <div className="overlay" style={{ background: 'rgba(8,9,16,0.45)', zIndex: 50 }}>
      <div className="loading">
        <div className="spinner" />
        Connection lost — reconnecting…
      </div>
    </div>
  );
}
