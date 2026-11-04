import { Room, type Client } from '@colyseus/core';
import {
  generateRoomCode,
  initPhysics,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  RoomHost,
  TICK_RATE,
  type HostClient,
  type LobbySettings,
} from '@chromashift/shared';
import { recordResults, verifyToken } from '../authentication/firebase';
import { config } from '../config';

const activeCodes = new Set<string>();
let rooms = 0;
let players = 0;
export const roomStats = () => ({ rooms, players });

const link = (c: Client): HostClient => ({ id: c.sessionId, send: (type, payload) => c.send(type, payload) });

/**
 * Colyseus adapter around the shared RoomHost, which holds the lobby and the authoritative match.
 * This file only deals with sockets, auth, reconnection and server-wide limits.
 */
export class ArenaRoom extends Room {
  override maxClients = MAX_PLAYERS;
  /** Inputs arrive at ~30 Hz; anything far beyond that is abuse and gets disconnected. */
  override maxMessagesPerSecond = 90;
  private host!: RoomHost;

  override async onCreate(options: { quick?: boolean; settings?: Partial<LobbySettings> }) {
    if (rooms >= config.maxRooms) throw new Error('Server is full. Try again later.');
    await initPhysics();
    let code: string;
    do code = generateRoomCode();
    while (activeCodes.has(code));
    activeCodes.add(code);
    this.roomId = code;
    rooms++;
    const quick = !!options?.quick;
    this.host = new RoomHost({ code, quick, settings: options?.settings, record: recordResults });
    if (!quick) await this.setPrivate(true);
    this.onMessage('*', (client, type, data) => this.host.message(client.sessionId, String(type), data));
    this.setSimulationInterval((dt) => this.host.tick(dt), 1000 / TICK_RATE);
  }

  override async onAuth(_client: Client, options: { protocol?: number; token?: unknown }) {
    if (options?.protocol !== PROTOCOL_VERSION)
      throw new Error(`VERSION mismatch (server ${PROTOCOL_VERSION})`);
    const v = await verifyToken(options.token);
    return { uid: v?.uid, username: v?.username ?? null };
  }

  override onJoin(
    client: Client,
    options: Parameters<RoomHost['join']>[1],
    auth?: { uid?: string; username?: string | null },
  ) {
    players++;
    this.host.join(link(client), options, auth);
  }

  override onDrop(client: Client) {
    this.host.drop(client.sessionId);
    this.allowReconnection(client, config.reconnectSeconds);
  }

  override onReconnect(client: Client) {
    this.host.reconnect(link(client));
  }

  override onLeave(client: Client) {
    if (this.host.has(client.sessionId)) players--;
    this.host.leave(client.sessionId);
  }

  override onDispose() {
    activeCodes.delete(this.roomId);
    rooms--;
    this.host.dispose();
  }
}
