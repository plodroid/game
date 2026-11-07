import { useState } from 'react';
import { Icon } from './icons';
import { Button, Segmented } from './kit';

// The installers are too big for the site itself (Pages caps files at 100 MB), so they live in GitHub Releases.
const WINDOWS = 'https://github.com/plodroid/game/releases/latest/download/CHROMASHIFT-Setup.exe';
const ANDROID = 'https://github.com/plodroid/game/releases/download/android/CHROMASHIFT.apk';

type Platform = 'windows' | 'android';

/** Website only: not shown inside the desktop app, the Android app or an installed PWA. */
export function InstallApp() {
  const [open, setOpen] = useState(false);
  const ua = navigator.userAgent;
  const [platform, setPlatform] = useState<Platform>(/Android/i.test(ua) ? 'android' : 'windows');
  const inApp = /Electron/i.test(ua) || /; wv\)/.test(ua) || matchMedia('(display-mode: standalone)').matches;
  if (inApp) return null;
  return (
    <>
      <button className="install-btn" onClick={() => setOpen(true)} aria-label="Install the app" title="Install the app">
        <Icon.download />
        <span>Install app</span>
      </button>
      {open && (
        <div className="pause" role="dialog" aria-label="Install CHROMASHIFT" onClick={() => setOpen(false)}>
          <div className="pause__card" onClick={(e) => e.stopPropagation()}>
            <h2 className="pause__title">Install the app</h2>
            <Segmented
              value={platform}
              onChange={setPlatform}
              label="Device"
              options={[
                { value: 'windows', label: 'Windows' },
                { value: 'android', label: 'Android' },
              ]}
            />
            {platform === 'windows' ? (
              <ol className="install-steps">
                <li>Click <b>Download installer</b> below.</li>
                <li>Open the downloaded <b>CHROMASHIFT-Setup.exe</b>. If Windows warns that it is unrecognised, choose <b>More info</b>, then <b>Run anyway</b>.</li>
                <li>Click <b>Install</b>. A shortcut appears on your desktop.</li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>On your phone, tap <b>Download APK</b> below.</li>
                <li>Open the downloaded <b>CHROMASHIFT.apk</b>. If asked, allow your browser to <b>install unknown apps</b>.</li>
                <li>Tap <b>Install</b>, then open CHROMASHIFT. Turn your phone sideways to play.</li>
              </ol>
            )}
            <p className="muted small">{platform === 'windows' ? 'The app updates itself, so you only install it once.' : 'The app loads the live game, so it is always up to date.'}</p>
            <a className="btn btn--primary btn--lg btn--block" href={platform === 'windows' ? WINDOWS : ANDROID} onClick={() => setOpen(false)}>
              <Icon.download /> {platform === 'windows' ? 'Download installer' : 'Download APK'}
            </a>
            <Button size="lg" block onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </>
  );
}
