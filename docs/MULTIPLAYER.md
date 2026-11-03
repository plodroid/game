# Hosting multiplayer

The CHROMASHIFT server is a Node.js process (Colyseus). It runs the authoritative simulation and also serves the built web client at `/game/`. GitHub Pages only hosts the static website; it cannot run this server.

There are three ways to run it.

## 1. Local development

```bash
npm install
npm run dev:server
```

```bash
npm run dev
```

Open http://localhost:5173/game/. The dev client connects to `ws://localhost:2567`.

## 2. LAN party (one computer hosts)

On the host computer:

```bash
npm install
npm run build
npm run start:server
```

The console lists the LAN addresses, for example:

```
LAN:     http://192.168.1.20:2567/game/   (players on your network open this)
```

Everyone on the same network opens that address. The page sees that a game server is serving it and connects there automatically, so there's nothing else to configure. Create a room, share the 5-letter code, and play.

**Firewall:** the first time, Windows asks whether Node.js may accept connections. Allow it on private networks. On macOS, allow incoming connections for `node`. On Linux with ufw: `sudo ufw allow 2567/tcp`.

**Why open the server's address instead of the website?** Browsers refuse plain `ws://` connections from HTTPS pages, except to `localhost`. A LAN server usually has no TLS certificate, so the HTTPS site at github.io can't reach it. The same game served over plain HTTP from the server itself can. (The installable app needs HTTPS, so for LAN play use the browser tab.)

## 3. Public internet server

Players outside your network need to reach your server over the internet, and the HTTPS website needs **`wss://`** (TLS).

### Option A: your own machine or a VPS with a reverse proxy

1. Run the server (`npm run start:server`, or keep it running with a process manager such as `pm2`, systemd or a Windows service).
2. Point a domain at the machine. Free dynamic DNS services work for home connections.
3. Put a TLS reverse proxy in front. With [Caddy](https://caddyserver.com/) (free, automatic Let's Encrypt certificates), the whole `Caddyfile` is:

   ```
   play.example.com {
     reverse_proxy localhost:2567
   }
   ```

   Caddy proxies WebSockets automatically.
4. Players use `wss://play.example.com` (Online → Direct connect, or set `VITE_DEFAULT_SERVER_URL` so Quick Play uses it by default).

### Option B: a free tunnel (no port forwarding)

Tunnels such as Cloudflare Tunnel (`cloudflared`) give a machine behind NAT a public `https://` and `wss://` address without opening router ports. Point the tunnel at `http://localhost:2567`. Check the provider's current free-tier terms. The game doesn't depend on any particular provider.

### Port forwarding (home hosting without a tunnel)

1. Give the host computer a fixed LAN IP (DHCP reservation in the router).
2. In the router, forward TCP port **443** (if Caddy runs on the host) or **2567** (direct, no TLS) to that IP.
3. Allow the port in the host's firewall.

### Limits of hosting from home

- **NAT / CGNAT:** many ISPs, especially mobile and some fibre providers, put customers behind carrier-grade NAT. Port forwarding then can't work, and a tunnel is the only option.
- **Dynamic IP:** your public IP can change. Use a DNS name, ideally updated by dynamic DNS.
- **Upload bandwidth:** each player uses roughly 10–25 KB/s down and 3–5 KB/s up. A full 8-player match needs about 200 KB/s of upload from the host, which is fine on most connections.
- **Availability:** the server only exists while the host computer is on and connected.
- **Security:** you're exposing a port to the internet. Keep Node.js and dependencies updated, and run the server as a normal (non-admin) user. The server validates every input and caps message rates, but it is still a network service.

## Configuration

Environment variables (or a `.env` file in the repository root; see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `2567` | Listening port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` = this machine only) |
| `MAX_ROOMS` | `50` | Room limit |
| `RECONNECT_SECONDS` | `45` | How long a dropped player's seat is kept (a bot covers meanwhile) |
| `CLIENT_DIST` | `apps/client/dist` | Built client served at `/game/` |
| `FIREBASE_PROJECT_ID` | — | Verify signed-in players |
| `FIREBASE_SERVICE_ACCOUNT` | — | Path or JSON. Enables verified usernames and recorded results. **Secret.** |

## What the server enforces

- The server runs the full simulation. Clients send only inputs: stick, view and aim angles, buttons, and a sequence number. Movement, fire rate, ink, hits, damage, paint, scores, timers and results all come from the server.
- Inputs are range-checked and clamped. Malformed packets are dropped, and replayed sequence numbers are ignored. Input buffers are capped so a lagging client can't build up extra latency.
- More than 90 messages per second disconnects a client.
- Room codes are 5 characters from an alphabet without look-alikes (no 0/O, 1/I/L), unique among live rooms, and case-insensitive for players.
- A client must match the server's protocol version to join, so outdated cached clients get a clear "update" message.
- Disconnected players' slots are covered by a bot and kept for `RECONNECT_SECONDS`. People who join mid-match take over a bot slot and receive a full paint sync.

`GET /health` returns `{ ok, version, protocol, rooms, players }`. The Online screen uses it to show server status.
