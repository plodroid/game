import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createEndpoint, createRouter } from '@colyseus/core';
import { GAME_VERSION, PROTOCOL_VERSION } from '@chromashift/shared';
import { config, hasClient } from '../config';
import { roomStats } from '../rooms/ArenaRoom';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.wasm', '.txt']);
// ponytail: whole-file in-memory gzip cache — fine for one built client (~7 MB); add eviction if it ever serves more.
const gzCache = new Map<string, { mtime: number; body: Buffer }>();

/** Serves the built client under /game/ so LAN players can open the game from this server. */
async function serveClient(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const send = (status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': type, 'content-length': String(Buffer.byteLength(body)), 'access-control-allow-origin': '*', ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (url.pathname === '/game') return send(302, 'text/plain', '', { location: '/game/' });
  if (url.pathname === '/game/chroma-server.json')
    return send(200, 'application/json', JSON.stringify({ chromashift: true, version: GAME_VERSION, protocol: PROTOCOL_VERSION }), { 'cache-control': 'no-store' });
  if (!hasClient())
    return send(503, 'text/html; charset=utf-8', '<h1>CHROMASHIFT server is running</h1><p>The web client is not built yet. Run <code>npm run build</code>, then reload.</p>');

  const root = config.clientDist;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname.replace(/^\/game\/?/, ''));
  } catch {
    return send(400, 'text/plain', 'Bad request');
  }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  let file = resolve(root, normalize(rel));
  // Refuse anything that escapes the client folder.
  if (file !== root && !file.startsWith(root + sep)) return send(404, 'text/plain', 'Not found');
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    // Unknown asset → 404; unknown page → the app shell.
    if (extname(rel)) return send(404, 'text/plain', 'Not found');
    file = resolve(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) return send(404, 'text/plain', 'Not found');
  }
  const ext = extname(file);
  const headers: Record<string, string> = {
    'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    vary: 'accept-encoding',
  };
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    let hit = gzCache.get(file);
    if (!hit || hit.mtime !== info.mtimeMs) gzCache.set(file, (hit = { mtime: info.mtimeMs, body: gzipSync(await readFile(file), { level: 6 }) }));
    return send(200, MIME[ext] ?? 'application/octet-stream', hit.body, { ...headers, 'content-encoding': 'gzip' });
  }
  return send(200, MIME[ext] ?? 'application/octet-stream', await readFile(file), headers);
}

/**
 * Puts the static handler in front of Colyseus' own HTTP listener (matchmaking, /health).
 * Static files are answered here with plain buffered responses.
 */
export function mountClient(server: HttpServer) {
  const colyseus = server.listeners('request') as ((req: IncomingMessage, res: ServerResponse) => void)[];
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/game' || path.startsWith('/game/'))) {
      serveClient(req, res).catch((e) => {
        console.error('[http]', e);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    for (const l of colyseus) l.call(server, req, res);
  });
}

export const router = createRouter({
  health: createEndpoint('/health', { method: 'GET' }, async () =>
    Response.json(
      { ok: true, name: 'chromashift', version: GAME_VERSION, protocol: PROTOCOL_VERSION, ...roomStats() },
      { headers: { 'cache-control': 'no-store' } },
    ),
  ),
  root: createEndpoint('/', { method: 'GET' }, async () => new Response(null, { status: 302, headers: { location: '/game/' } })),
});
