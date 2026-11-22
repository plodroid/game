import { useSettings, PRESETS } from './settings/settings';
import { useUi } from './state/ui';
import { isTv } from './tvFlag';

/*
 * The Android TV edition's behaviour, started once from main.tsx. It is the same game and the same
 * simulation; this only adds what a TV needs:
 *  - D-pad focus movement through the menus (OK activates, the focused item gets a big ring);
 *  - the remote's Back key: pause in a race, step back in menus, press twice at home to exit;
 *  - a lighter graphics setup the first time it runs (720p, 30 fps, simple shadows, no post effects);
 *  - a one-time hint for the remote controls.
 * Driving with the remote ("simple remote mode") lives in game/input.ts, the VELOCITY-only menus in
 * Home.tsx and Play.tsx, and the blocked screens in state/ui.ts.
 */

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const DIRS: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

const visible = (e: HTMLElement) => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
};

/** The focusable element nearest in a direction: close along it, and little sideways drift. */
export function nearest(from: DOMRect, els: HTMLElement[], dx: number, dy: number, skip?: Element | null): HTMLElement | null {
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const e of els) {
    if (e === skip) continue;
    const r = e.getBoundingClientRect();
    const ex = r.left + r.width / 2 - cx, ey = r.top + r.height / 2 - cy;
    const along = ex * dx + ey * dy, across = Math.abs(ex * dy) + Math.abs(ey * dx);
    if (along <= 1) continue;
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function moveFocus(dx: number, dy: number) {
  const els = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!els.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !els.includes(cur)) {
    els[0].focus({ preventScroll: false });
    return;
  }
  const next = nearest(cur.getBoundingClientRect(), els, dx, dy, cur);
  next?.focus();
  next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function installNavigation() {
  addEventListener(
    'keydown',
    (e) => {
      const d = DIRS[e.key];
      if (!d) return;
      const ui = useUi.getState();
      if (ui.screen === 'match' && !ui.paused) return; // arrows drive the car
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes((t as HTMLInputElement).type)))) return;
      // A slider uses left and right to change its value; up and down still leave it.
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range' && d[0] !== 0) return;
      e.preventDefault();
      moveFocus(d[0], d[1]);
    },
    true,
  );
}

/**
 * A TV remote's D-pad and OK keys arrive with an empty `code` (only `key` and `keyCode` are set), but the
 * game's bindings are written in codes. Fill the code in before any other listener sees the event.
 */
const KEY_CODE: Record<string, string> = { ' ': 'Space', Escape: 'Escape', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab' };
export const codeOf = (e: { code: string; key: string }): string => {
  if (e.code) return e.code;
  if (KEY_CODE[e.key]) return KEY_CODE[e.key];
  if (/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return e.key;
  if (/^[a-z]$/i.test(e.key)) return 'Key' + e.key.toUpperCase();
  if (/^[0-9]$/.test(e.key)) return 'Digit' + e.key;
  return e.key;
};
function installKeyCodes() {
  const fix = (e: KeyboardEvent) => {
    if (!e.code) Object.defineProperty(e, 'code', { value: codeOf(e) });
  };
  for (const t of ['keydown', 'keyup', 'keypress'] as const) addEventListener(t, fix, true);
}

interface BackPlugin {
  addListener(name: 'backButton', cb: () => void): unknown;
  exitApp(): void;
}

/**
 * The remote's Back key. In the TV app Capacitor reports it through its App plugin (without a listener
 * it would simply close the app); in a browser it is the history going back, which is the fallback.
 */
function installBack() {
  let armed = 0;
  const plugin = (window as unknown as { Capacitor?: { Plugins?: { App?: BackPlugin } } }).Capacitor?.Plugins?.App;
  const onBack = (): boolean => {
    const ui = useUi.getState();
    if (ui.screen === 'match') {
      // In a race Back pauses; the pause menu is the confirmation before leaving.
      ui.setPaused(!ui.paused);
      return true;
    }
    if (ui.screen !== 'home') {
      ui.back();
      return true;
    }
    if (Date.now() - armed < 2500) return false; // second press at home: exit
    armed = Date.now();
    ui.toast({ text: 'Press Back again to exit', kind: 'info', ttl: 2400 });
    return true;
  };
  if (plugin?.addListener) {
    plugin.addListener('backButton', () => {
      if (!onBack()) plugin.exitApp();
    });
    return;
  }
  // Fallback: the browser's back button, which only counts entries made after a user gesture.
  const hold = () => history.pushState({ tv: 1 }, '');
  addEventListener('keydown', () => history.state?.tv || hold(), { capture: true, once: true });
  addEventListener('popstate', () => {
    if (onBack()) hold();
    else history.back();
  });
}

function firstRun() {
  const s = useSettings.getState();
  try {
    if (localStorage.getItem('cs.tvInit2')) return;
    localStorage.setItem('cs.tvInit2', '1');
  } catch {
    /* no storage: apply every time */
  }
  // A TCL G07-class TV: 2 GB, an older GPU, 1080p output. Render at 720p, 30 fps, simple shadows.
  useSettings.setState({
    benchmarked: true,
    graphics: { ...s.graphics, ...PRESETS.low, preset: 'custom', renderScale: 1, maxHeight: 720, shadowQuality: 1, shadowResolution: 1024, particles: 0.4, drawDistance: 120, fpsCap: 30, showFps: false },
    controls: { ...s.controls, raceBindings: { ...s.controls.raceBindings, item: [...new Set([...(s.controls.raceBindings.item ?? []), 'Enter', 'NumpadEnter'])] } },
    accessibility: { ...s.accessibility, textScale: 1 },
  });
}

/** One hint, the first time a race starts. */
function installTutorial() {
  let shown = false;
  try {
    shown = localStorage.getItem('cs.tvHint') === '1';
  } catch {
    /* ignore */
  }
  if (shown) return;
  const off = useUi.subscribe((st, prev) => {
    if (st.screen === 'match' && prev.screen !== 'match') {
      try {
        localStorage.setItem('cs.tvHint', '1');
      } catch {
        /* ignore */
      }
      st.toast({ text: 'Remote: Left and Right steer, Down brakes, OK uses an item, Back pauses. The car accelerates by itself.', kind: 'info', ttl: 9000 });
      off();
    }
  });
}

export function startTv() {
  if (!isTv) return;
  document.documentElement.dataset.tv = '1';
  firstRun();
  installKeyCodes();
  installNavigation();
  installBack();
  installTutorial();
}
