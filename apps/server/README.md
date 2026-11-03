# CHROMASHIFT server

Authoritative Colyseus server. It runs the shared simulation and serves the built client at `/game/`.

```bash
npm install            # in the repository root
npm run build          # build the client so the server can serve it
npm run start:server   # http://localhost:2567/game/ (LAN addresses are printed)
```

`npm run dev:server` restarts on file changes. Configuration comes from environment variables or the root `.env`; see `.env.example`.

| Endpoint | |
| --- | --- |
| `ws://host:2567` | Colyseus matchmaking and rooms (`arena`) |
| `GET /health` | `{ ok, version, protocol, rooms, players }` |
| `GET /game/…` | Static client (SPA fallback, gzip, path-traversal safe) |
| `GET /game/chroma-server.json` | Lets a client served from here auto-connect |

Hosting on a LAN or the internet, TLS, port forwarding and NAT: see [../../docs/MULTIPLAYER.md](../../docs/MULTIPLAYER.md).
