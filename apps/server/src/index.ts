import { networkInterfaces } from 'node:os';
import { GAME_VERSION, PROTOCOL_VERSION } from '@chromashift/shared';
import { config, hasClient } from './config';
import { startServer } from './server';

await startServer(config.port, config.host);

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);
console.log(`\nCHROMASHIFT server v${GAME_VERSION} (protocol ${PROTOCOL_VERSION}) listening on ${config.host}:${config.port}`);
console.log(`  Local:   http://localhost:${config.port}/game/`);
for (const ip of lan) console.log(`  LAN:     http://${ip}:${config.port}/game/   (players on your network open this)`);
if (!hasClient()) console.log('  Note: client not built — run `npm run build` to serve the game from this server.');
console.log('');
