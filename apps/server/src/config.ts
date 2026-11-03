import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@chromashift/shared';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

/** All server configuration comes from environment variables (see .env.example). */
export const config = {
  port: Number(env.PORT ?? env.CHROMA_PORT ?? DEFAULT_PORT),
  /** 0.0.0.0 accepts LAN connections; 127.0.0.1 keeps the server local-only. */
  host: env.HOST ?? '0.0.0.0',
  /** Built client served under /game/ for LAN and self-hosted play. */
  clientDist: resolve(env.CLIENT_DIST ?? resolve(here, '../../client/dist')),
  maxRooms: Number(env.MAX_ROOMS ?? 50),
  /** Seconds a dropped player keeps their seat. */
  reconnectSeconds: Number(env.RECONNECT_SECONDS ?? 45),
  firebaseProjectId: env.FIREBASE_PROJECT_ID ?? env.VITE_FIREBASE_PROJECT_ID ?? '',
  /** Path to (or inline JSON of) a service account. Enables verified results and usernames. */
  serviceAccount: env.FIREBASE_SERVICE_ACCOUNT ?? env.GOOGLE_APPLICATION_CREDENTIALS ?? '',
};

export const hasClient = () => existsSync(resolve(config.clientDist, 'index.html'));
