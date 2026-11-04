# Multiplayer

There are two ways to play together. Most people only need the first.

| | Browser-hosted game | Dedicated server |
| --- | --- | --- |
| Setup | None. Press **Host a game**. | Install Node.js, run `npm run start:server` |
| Who can join | Anyone with the code, over the internet or the same Wi-Fi | Anyone who can reach the server |
| Runs while | The host's tab is open (it may be in the background) | The server process runs |
| Verified online stats | No (the host is a player like everyone else) | Yes, with Firebase Admin credentials |

## Browser-hosted games (no setup)

1. One player opens **Play → Host a game** (or **Online → Host a game**). Their browser becomes the game server and shows a 5-character code.
2. Friends open **Online**, type the code and press **Join**, or simply open the invite link (**Copy invite link** in the lobby). The link joins straight away.
3. The host picks the map, mode, length and bots, and starts the match. Empty slots fill with bots.

The host's code stays the same every time they host from the same browser, so friends can keep using it like a server address. Games you've joined appear under **Online → Recent games**.

### How it works

- The host's tab runs the same authoritative `RoomHost` as the dedicated server: the full simulation, bots, input validation and rate limits. Guests only send inputs, exactly as with a dedicated server, and get the same prediction, interpolation and reconnection. Nothing in the match logic differs.
- Browsers connect directly with WebRTC data channels. To find each other they use the free public [PeerJS](https://peerjs.com/) broker, which only passes the connection setup between the two browsers. Game traffic never goes through it. The code is the host's id on that broker.
- Free public STUN servers (Google, Cloudflare) let browsers behind home routers find a direct path, so nobody has to forward ports.
- The host's game clock runs in a Web Worker. Timers on hidden pages are throttled, worker timers aren't, so the game keeps running for everyone when the host switches tabs. The host must keep the tab open: closing it ends the game, and guests are told the host closed it.
- If a guest's connection drops, a bot covers their slot and they take it back automatically within 45 seconds.

### Limits

- **Strict networks.** A direct link fails when both players are behind very strict NATs or firewalls: some school, office and mobile-data networks. Guests then see "Couldn't connect to the host". Fixes, from easiest: try another network (a phone hotspot often works), let someone else host, or configure a TURN relay (below).
- **Host upload.** The host sends every guest about 15 KB/s, so 7 guests need roughly 1 Mbit/s of upload. A host on weak Wi-Fi will make everyone lag; let the player with the best connection host.
- **Trust.** The host's browser runs the match, so a modified browser could cheat, as in any game where a player hosts. Results from browser-hosted games count towards your local progress but are never recorded as verified online stats.
- **Privacy.** Like every peer-to-peer game, the host and each guest can see each other's IP address. Guests connect only to the host, not to each other. The host never receives anyone's account token.

### Optional: a TURN relay for strict networks

A TURN server relays traffic for players who can't connect directly. The game works without one; it just widens who can join. Get credentials from a TURN provider with a free plan (sign-up required; check their current terms) and set them as repository **Variables** (Settings → Secrets and variables → Actions) before the next deploy:

| Variable | Example |
| --- | --- |
| `VITE_TURN_URLS` | `turn:relay.example.com:443?transport=tcp,turn:relay.example.com:3478` |
| `VITE_TURN_USERNAME` | provided by the relay |
| `VITE_TURN_CREDENTIAL` | provided by the relay (a Secret also works) |

These values ship in the public web build, so use credentials meant for browsers, never an account password or API secret. PeerJS's own free relays (`*.turn.peerjs.com`) no longer exist, so there is no relay by default.

### How other games do it

| Game | Hosting | Joining over the internet |
| --- | --- | --- |
| Minecraft (Java) | Run a server program, or "Open to LAN" | Port forwarding, or paid Realms |
| Terraria, Stardew Valley, Valheim | "Host & play" from inside the game | Invite through Steam or a platform relay |
| Among Us, Jackbox | The developer's servers | A room code |
| **CHROMASHIFT** | "Host a game" from inside the browser | A room code; browsers connect directly, no ports or accounts |

## Dedicated server (optional)

The CHROMASHIFT server is a Node.js process (Colyseus). It runs the same authoritative simulation, records verified results when given Firebase Admin credentials, and serves the built web client at `/game/`. GitHub Pages only hosts the static website; it cannot run this server. Use one for an always-on server, verified stats, or LAN play without internet.

In the game, dedicated servers live under **Online → Dedicated servers**: server status, the server address, Quick Play, Create room, and joining a room code on that server.

### Local development

```bash
npm install
npm run dev:server
```

```bash
npm run dev
```

Open http://localhost:5173/game/. The dev client connects to `ws://localhost:2567`.

### LAN party (one computer hosts)

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

### Public internet server

Players outside your network need to reach your server over the internet, and the HTTPS website needs **`wss://`** (TLS).

#### Option A: your own machine or a VPS with a reverse proxy

1. Run the server (`npm run start:server`, or keep it running with a process manager such as `pm2`, systemd or a Windows service).
2. Point a domain at the machine. Free dynamic DNS services work for home connections.
3. Put a TLS reverse proxy in front. With [Caddy](https://caddyserver.com/) (free, automatic Let's Encrypt certificates), the whole `Caddyfile` is:

   ```
   play.example.com {
     reverse_proxy localhost:2567
   }
   ```

   Caddy proxies WebSockets automatically.
4. Players use `wss://play.example.com` (Online → Dedicated servers → Server address, or set `VITE_DEFAULT_SERVER_URL` so Quick Play uses it by default).

#### Option B: a free tunnel (no port forwarding)

Tunnels such as Cloudflare Tunnel (`cloudflared`) give a machine behind NAT a public `https://` and `wss://` address without opening router ports. Point the tunnel at `http://localhost:2567`. Check the provider's current free-tier terms. The game doesn't depend on any particular provider.

#### Port forwarding (home hosting without a tunnel)

1. Give the host computer a fixed LAN IP (DHCP reservation in the router).
2. In the router, forward TCP port **443** (if Caddy runs on the host) or **2567** (direct, no TLS) to that IP.
3. Allow the port in the host's firewall.

#### Limits of hosting from home

- **NAT / CGNAT:** many ISPs, especially mobile and some fibre providers, put customers behind carrier-grade NAT. Port forwarding then can't work, and a tunnel is the only option.
- **Dynamic IP:** your public IP can change. Use a DNS name, ideally updated by dynamic DNS.
- **Upload bandwidth:** each player uses roughly 10–25 KB/s down and 3–5 KB/s up. A full 8-player match needs about 200 KB/s of upload from the host, which is fine on most connections.
- **Availability:** the server only exists while the host computer is on and connected.
- **Security:** you're exposing a port to the internet. Keep Node.js and dependencies updated, and run the server as a normal (non-admin) user. The server validates every input and caps message rates, but it is still a network service.

### Configuration

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

### What the server and browser hosts enforce

- The server runs the full simulation. Clients send only inputs: stick, view and aim angles, buttons, and a sequence number. Movement, fire rate, ink, hits, damage, paint, scores, timers and results all come from the server.
- Inputs are range-checked and clamped. Malformed packets are dropped, and replayed sequence numbers are ignored. Input buffers are capped so a lagging client can't build up extra latency.
- More than 90 messages per second disconnects a client.
- Browser hosts apply all of the above too: they run the same `RoomHost` code, and a guest must present the right protocol version and a seat token before taking a seat back.
- Room codes are 5 characters from an alphabet without look-alikes (no 0/O, 1/I/L), unique among live rooms, and case-insensitive for players.
- A client must match the server's protocol version to join, so outdated cached clients get a clear "update" message.
- Disconnected players' slots are covered by a bot and kept for `RECONNECT_SECONDS`. People who join mid-match take over a bot slot and receive a full paint sync.

`GET /health` returns `{ ok, version, protocol, rooms, players }`. The Online screen uses it to show server status.
