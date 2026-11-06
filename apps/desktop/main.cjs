// CHROMASHIFT desktop: the web build served from inside the app, in its own window.
// Electron's main process loads as CommonJS.
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, session, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Packaged: the build is copied next to this file. In development: the client's dist folder.
const ROOT = fs.existsSync(path.join(__dirname, 'web')) ? path.join(__dirname, 'web') : path.join(__dirname, '../client/dist');
const BASE = '/game/';
// A fixed port keeps the page's origin the same every launch, so sign-in, settings and saves persist.
// "localhost" is also an authorised domain for Firebase sign-in by default.
const PORTS = [47821, 47822, 47823, 47824];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function serve(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(BASE)) {
        res.writeHead(302, { Location: BASE });
        return res.end();
      }
      const rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end();
      }
      fs.readFile(file, (err, data) => {
        // Unknown paths get the app itself (it routes in the page).
        if (err) return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => (res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] }), res.end(html)));
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    });
    server.once('error', reject);
    server.listen(port, 'localhost', () => resolve(server));
  });
}

async function start() {
  let port = 0;
  for (const p of PORTS) {
    try {
      await serve(p);
      port = p;
      break;
    } catch {
      // Port in use: try the next one.
    }
  }
  if (!port) throw new Error('No free local port for the game.');

  // Microphone for voice chat, pointer lock and fullscreen for play; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'CHROMASHIFT',
    backgroundColor: '#120f17',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // Sign-in windows (Google, Firebase) open as popups; every other link opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(google\.com|firebaseapp\.com)\//.test(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  await win.loadURL(`http://localhost:${port}${BASE}`);
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
  app.whenReady().then(start).catch((e) => {
    console.error(e);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
