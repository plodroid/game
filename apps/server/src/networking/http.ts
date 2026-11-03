import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
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

async function serveClient(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/game/chroma-server.json')
    return Response.json({ chromashift: true, version: GAME_VERSION, protocol: PROTOCOL_VERSION }, { headers: { 'cache-control': 'no-store' } });
  if (!hasClient())
    return new Response('<h1>CHROMASHIFT server is running</h1><p>The web client is not built yet. Run <code>npm run build</code>, then restart the server.</p>', {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  const root = config.clientDist;
  let rel = decodeURIComponent(url.pathname.replace(/^\/game\/?/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = resolve(root, normalize(rel));
  // Refuse anything that escapes the client folder.
  if (file !== root && !file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  let path = file;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    if (extname(rel)) return new Response('Not found', { status: 404 });
    path = resolve(root, 'index.html');
  }
  const ext = extname(path);
  const immutable = rel.startsWith('assets/');
  return new Response(await readFile(path), {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}

const redirect = () => new Response(null, { status: 302, headers: { location: '/game/' } });

export const router = createRouter({
  health: createEndpoint('/health', { method: 'GET' }, async () =>
    Response.json(
      { ok: true, name: 'chromashift', version: GAME_VERSION, protocol: PROTOCOL_VERSION, ...roomStats() },
      { headers: { 'cache-control': 'no-store' } },
    ),
  ),
  root: createEndpoint('/', { method: 'GET' }, async () => redirect()),
  gameRoot: createEndpoint('/game', { method: 'GET' }, async () => redirect()),
  game: createEndpoint('/game/**', { method: 'GET' }, async (ctx) => serveClient(ctx.request as Request)),
});
