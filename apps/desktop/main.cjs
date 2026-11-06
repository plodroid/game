// CHROMASHIFT desktop: the live game in its own window, tuned for play.
// It loads the published site, so every update reaches the app without reinstalling; the site's
// service worker caches the game, so after the first launch it also starts and plays offline.
// Electron's main process loads as CommonJS.
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

const GAME = process.env.CHROMASHIFT_URL || 'https://plodroid.github.io/game/';

// Use the dedicated graphics card on machines that have two, and let the GPU do the rasterising.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// Older but capable drivers are sometimes blocklisted, which would drop WebGL to the slow CPU path.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Keep full speed when the window is covered or loses focus (voice chat and online play keep running).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function start() {
  // Microphone for voice chat, pointer lock and fullscreen for play; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 360,
    title: 'CHROMASHIFT',
    icon: path.join(__dirname, 'pwa-512x512.png'),
    backgroundColor: '#120f17',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // Sign-in windows (Google, Firebase) open as popups; every other link opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(google\.com|firebaseapp\.com)\//.test(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) win.webContents.reload();
  });
  // First launch without internet (nothing cached yet): say so, and retry by itself.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 || url.startsWith('file:')) return;
    void win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: GAME } });
  });
  void win.loadURL(GAME);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}
