// Archivo with its width axis: condensed for names and titles, regular for reading.
import '@fontsource-variable/archivo/standard.css';
import './styles/global.css';
import './styles/hud.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { webgl2Available } from './settings/hardware';
import { useUi } from './state/ui';

createRoot(document.getElementById('root')!).render(<App webgl2={webgl2Available()} />);

// Dev-only handle for debugging in the console; stripped from production builds.
if (import.meta.env.DEV)
  void Promise.all([import('./game/engine'), import('./settings/settings'), import('./multiplayer/net')]).then(([{ engine }, { useSettings }, net]) =>
    Object.assign(window, { __cs: { engine, useUi, useSettings, net } }),
  );

// Service worker: offline caching plus an explicit, user-confirmed update.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        useUi.getState().toast({
          text: 'A new version of CHROMASHIFT is ready.',
          kind: 'info',
          ttl: 0,
          action: { label: 'Update', run: () => void update(true) },
        });
      },
      onOfflineReady() {
        useUi.getState().toast({ text: 'Ready to play offline.', kind: 'success' });
      },
    });
  });
}
