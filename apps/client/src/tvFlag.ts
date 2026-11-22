/*
 * Is this the Android TV edition? The TV app (a build flavour of the Android shell) adds
 * "ChromashiftTV" to the browser's user agent. For testing on a computer, open the site with ?tv=1
 * (remembered), and ?tv=0 turns it off again. Kept free of imports so any module can read it.
 */
function detect(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/ChromashiftTV/.test(ua)) return true;
  try {
    const q = new URLSearchParams(location.search).get('tv');
    if (q === '1') localStorage.setItem('cs.tv', '1');
    else if (q === '0') localStorage.removeItem('cs.tv');
    return localStorage.getItem('cs.tv') === '1';
  } catch {
    return false;
  }
}

export const isTv = detect();

/**
 * Is this a game controller we should use? On the TV edition the Bluetooth remote itself is listed as a
 * gamepad (non-standard mapping, no triggers or sticks to drive with), so only "standard" controllers
 * (Xbox, PlayStation and the like) count there; anywhere else every connected pad does.
 */
export const isUsablePad = (p: Gamepad | null | undefined): p is Gamepad => !!p && p.connected && (!isTv || p.mapping === 'standard');

/** Screens the TV edition never opens: they belong to the paint shooter (or need a mouse and keyboard). */
export const TV_BLOCKED = new Set(['custom', 'online', 'locker', 'progression', 'profile', 'social', 'results', 'studio']);
