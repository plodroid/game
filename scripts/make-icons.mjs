// Regenerates the PWA icons from scripts/icon*.svg. Needs ImageMagick 7 (`magick`) on PATH.
// The PNGs are committed, so this only runs when the artwork changes.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const pub = resolve('apps/client/public');
const run = (src, size, out) =>
  execFileSync('magick', ['-background', 'none', '-density', '384', src, '-resize', `${size}x${size}`, resolve(pub, out)], { stdio: 'inherit' });

run('scripts/icon.svg', 64, 'pwa-64x64.png');
run('scripts/icon.svg', 192, 'pwa-192x192.png');
run('scripts/icon.svg', 512, 'pwa-512x512.png');
run('scripts/icon-maskable.svg', 512, 'maskable-icon-512x512.png');
run('scripts/icon-maskable.svg', 180, 'apple-touch-icon-180x180.png');
console.log('Icons written to apps/client/public');
