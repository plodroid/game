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

/** Screens the TV edition never opens: they belong to the paint shooter (or need a mouse and keyboard). */
export const TV_BLOCKED = new Set(['custom', 'online', 'locker', 'progression', 'profile', 'social', 'results', 'studio']);
