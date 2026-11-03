import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { initPhysics, ROOM_NAME } from '@chromashift/shared';
import { initFirebase } from './authentication/firebase';
import { router } from './networking/http';
import { ArenaRoom } from './rooms/ArenaRoom';

/** Boots the game server (also used by the integration tests). */
export async function startServer(port: number, host: string) {
  await initPhysics();
  initFirebase();
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 6000, pingMaxRetries: 4 }),
    gracefullyShutdown: true,
  });
  server.router = router;
  // Quick Play rooms only match other Quick Play joins; private rooms are joined by code.
  server.define(ROOM_NAME, ArenaRoom).filterBy(['quick']);
  await server.listen(port, host);
  return server;
}
