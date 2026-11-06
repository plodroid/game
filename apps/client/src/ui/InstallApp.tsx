import { useState } from 'react';
import { Icon } from './icons';
import { Button } from './kit';

// The installer is too big for the site itself (Pages caps files at 100 MB), so it lives in GitHub Releases.
const INSTALLER = 'https://github.com/plodroid/game/releases/latest/download/CHROMASHIFT-Setup.exe';

/** Website only: not shown inside the desktop app or an installed PWA. */
export function InstallApp() {
  const [open, setOpen] = useState(false);
  const inApp = /Electron/i.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches;
  const windows = /Windows/i.test(navigator.userAgent);
  if (inApp || !windows) return null;
  return (
    <>
      <button className="install-btn" onClick={() => setOpen(true)} aria-label="Install the desktop app" title="Install the desktop app">
        <Icon.download />
        <span>Install app</span>
      </button>
      {open && (
        <div className="pause" role="dialog" aria-label="Install CHROMASHIFT" onClick={() => setOpen(false)}>
          <div className="pause__card" onClick={(e) => e.stopPropagation()}>
            <h2 className="pause__title">Install the app</h2>
            <ol className="install-steps">
              <li>Click <b>Download installer</b> below.</li>
              <li>Open the downloaded <b>CHROMASHIFT-Setup.exe</b>. If Windows warns that it is unrecognised, choose <b>More info</b>, then <b>Run anyway</b>.</li>
              <li>Click <b>Install</b>. A shortcut appears on your desktop.</li>
            </ol>
            <p className="muted small">The app updates itself, so you only install it once.</p>
            <a className="btn btn--primary btn--lg btn--block" href={INSTALLER} onClick={() => setOpen(false)}>
              <Icon.download /> Download installer
            </a>
            <Button size="lg" block onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </>
  );
}
