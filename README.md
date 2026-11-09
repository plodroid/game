# CHROMASHIFT

A colourful third-person team paint shooter that runs in the browser. Two teams of four race to cover the arena in their colour: shoot, roll and lob paint, dive into your own colour to swim and refill, climb painted walls, and splat rivals. It plays fully offline against bots, and online with friends: anyone can host a game from their browser and friends join with a code. No downloads, no server, no port forwarding.

**Play:** https://plodroid.github.io/game/ (installable as an app)

![Main menu](docs/screenshots/menu.png)
![Match on Skyline](docs/screenshots/match.png)

## Features

- **Turf Control** (main mode), **Zone Control**, **Knockout** and a **Practice** range. 3-minute matches by default, adjustable from 1 to 5 minutes.
- **21 weapons** across five families: sprayers, rollers, blasters, lobbers and duals. The five originals are free; 16 more (Mist Sprayer, Needle Line, Paint Dozer, Thumper, Comet Launcher, Fizz Pistols and others) have their own tuning and look, and are bought with coins.
- **A locker of about 3,000 items** in one gallery, around 300 per shelf: hats, face pieces, back items and outfits in fifteen colourways, 324 body colours, 321 hair dyes, 300 emotes (30 moves in 10 styles), 296 titles, 300 banners, 300 weapon finishes, plus 38 hairstyles and the weapons. Every piece is built on the same head and body surfaces, so any combination fits. Each tile is a live portrait of your character wearing it; pick anything to try it on.
- **Emote wheel.** Put up to eight emotes on your wheel in the Locker; in a match hold the emote button, point and let go (a quick tap replays the last one). Works with mouse, controller (right stick) and touch.
- **Match length dial** from 1 to 10 minutes, or no time limit, when hosting or in a custom match.
- **Coins and quests**: matches pay coins (1 per 8 XP, plus 300 per level). Three daily and three weekly quests pay more. Everything in the locker has a coin price by rarity.
- **Five specials**: Color Surge, Paint Nova, Shield Burst, Bounce Beacon, Disruption Pulse. You charge them by painting new territory and by KOs.
- **Movement**: walk, sprint, slide, dodge roll, double jump, air control, coyote time and jump buffering. **Paint dive**: swim fast through your own colour, refill pigment, climb walls painted your colour. Rival paint slows and chips at you, but you can always walk out.
- **GPU paint system**: every paint event becomes instanced splat stamps rendered into an atlas render target (one draw call per frame). Map materials read the atlas for colour, gloss and raised paint edges. Territory scoring uses an ownership grid over the real paintable area, excluding occluded and overlapping surfaces.
- **Bots that actually play**: an auto-generated navigation graph (walk, jump, drop and launch-pad links), A* routing that avoids rival paint, painting goals, fighting with leading aim and ledge awareness, refilling, retreating, supporting teammates, team goal claims and specials. Four difficulties change reaction time, aim wobble, turn rate and strategy. Bots only notice what is inside their field of view (or what just hurt them), settle onto a target with a flick and a trembling aim, and fire in bursts; they never get extra rules or perfect aim.
- **Seven original maps**: Skyline (sunset rooftops), Core (indoor arena), Float (islands in the clouds), Dye Docks (a harbour at dusk), Bloom Gardens (hedges and a gazebo), Prism Canyon (red-rock terraces), Neon Arcade (a rooftop arcade at night). Maps are mirrored, so both teams get identical routes.
- **Multiplayer**: host a game from the browser and share a 5-character code (it stays the same each time you host) or an invite link. Browsers connect directly over WebRTC; the host's tab runs the same authoritative match code as the optional Colyseus dedicated server. Host controls, bot fill, late join, reconnection, recent games, client prediction with reconciliation, snapshot interpolation, input validation and rate limiting.
- **Accounts** (free Firebase Spark plan): everyone signs in with a username and a strong password. An email is optional (private, for updates). A Google account can be linked as the way back in if the password is forgotten. Progress, coins, purchases, favourites and settings follow the account live between the site, the desktop app and phones; saves from two devices at once are merged, never overwritten. Graphics settings stay per kind of device (a phone keeps its own).
- **Social**: search players by username, view their cards, add friends, see who's online, and get in-game notifications. Parties of up to four (invites last five minutes) follow the leader into games. Messages between friends support text and voice notes.
- **In the match**: chat (T, Tab for team chat), voice chat with push to talk (V) or an open mic, name tags with a health bar that light up with a mic while someone talks, and a minimap with player names (M to enlarge). Voice is proximity chat by default (voices fade with distance; or teammates anywhere plus rivals nearby, or everyone), with a corner indicator that lights only while your voice is going out, a list of who is talking, and mute mic, deafen and per-player mute in the pause menu and lobby.
- **Owner commands**: in chat, the owner account types `/` for a Minecraft-style list that predicts commands, then players in the match and items: `/give <player> coins|xp|all|<item> [amount]`, `/size`, `/speed`, `/heal`, `/god`, `/tp`, `/kill`, `/reset`, `/help`, and `/admin <player>` / `/deadmin` to make someone an admin for that room. The owner is one specific account (`OWNER_UID` in `apps/client/src/auth/admin.ts`); a room's host checks the signature of the sender's Firebase token, so the claim can't be faked. Commands also work in offline matches.
- **Locker favourites**: star any item; a Favourites shelf gathers them across every category.
- **Split screen** (local, two controllers): connect two controllers (Bluetooth works) and a corner prompt says to press Options (Menu on Xbox). The screen splits down the middle: player 1 keeps the account that is signed in, player 2 plays as "<name>-P2" on the same team with their own weapon, special and look (they can optionally sign in to their own account). It works in the menu too (player 2 gets their own panel) and in a match already running. The scene is updated once per frame and both cameras draw it into the two halves of one canvas, so shadows, paint and effects are never duplicated. Local matches only; the website, Android app and Windows app all support it.
- **Every device**: keyboard and mouse, Xbox and PlayStation controllers (button names follow the controller; D-pad and stick move through menus), and touch with on-screen controls, chat and hold-to-talk buttons. Layouts adapt to phones and tablets in either orientation.
- **Settings**: Very Low to Ultra graphics presets plus every option individually, hardware check, audio buses, key rebinding, gamepad and touch controls, camera and HUD options, and accessibility (colour-blind palettes with shape markers, text size, reduced motion, subtitles, visual audio cues, high contrast).
- **PWA**: installable, works offline against bots, asks before updating.
- **All assets are original and generated in code**: character and weapon models, textures, music and sound effects. Nothing is downloaded or licensed.

## Technology

| Area | Choice |
| --- | --- |
| Rendering / engine | three.js r187 (used directly; React never drives the render loop) |
| Physics | Rapier 3D 0.21 (kinematic character controller, capsule collision, fixed 60 Hz step) |
| UI | React 19 + Zustand, hand-written CSS |
| Build | Vite 8, vite-plugin-pwa (Workbox) |
| Multiplayer | Browser-hosted games over WebRTC data channels (PeerJS for connection setup, MessagePack); optional dedicated server on Node.js 22 + Colyseus 0.18 |
| Accounts | Firebase Authentication + Cloud Firestore (Spark plan), Firebase Admin on the server (optional) |
| Local storage | IndexedDB (profile) and localStorage (settings) |
| Quality | TypeScript strict, ESLint, Prettier, Vitest, Playwright |

No C++/WebAssembly of our own: the simulation costs about 0.2 ms per tick for 8 bots, so profiling gave no reason to add it. Rapier itself ships as WebAssembly.

## Quick start

Requires Node.js 20.19+ (22 recommended).

```bash
npm install
```

```bash
npm run dev            # web client at http://localhost:5173/game/
```

```bash
npm run dev:server     # multiplayer server at ws://localhost:2567
```

The dev client connects to `ws://localhost:2567` automatically. Offline play needs no server.

| Command | What it does |
| --- | --- |
| `npm run build` | Production client in `apps/client/dist` (base path `/game/`) |
| `npm run preview` | Serve the production build at http://localhost:4173/game/ |
| `npm run start:server` | Run the multiplayer server (also serves the built client at `/game/`) |
| `npm test` | Unit tests, full headless bot matches on every map, multiplayer integration tests |
| `npm run test:e2e` | Playwright smoke tests against the production build (run `npm run build` first) |
| `npm run typecheck` | TypeScript for all three workspaces |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run icons` | Regenerate PWA icons (needs ImageMagick) |

## Project structure

```
apps/client/        Web client (Vite + React + three.js)
  src/game/         engine loop, match/menu views, input, camera, session flow
  src/rendering/    paint atlas, map meshes, environment, effects, post-processing
  src/characters/   procedural character model + animation controller
  src/weapons/      procedural weapon models
  src/audio/        synthesized sound effects, music, ambience
  src/multiplayer/  browser hosting (WebRTC), server client, prediction / interpolation source
  src/auth/         Firebase accounts and cloud sync (lazy-loaded)
  src/settings/     settings store, presets, hardware detection
  src/ui/           screens, HUD and UI kit
apps/server/        Colyseus server (rooms, authentication, static hosting)
packages/shared/    Simulation shared by both: maps, physics, paint grid,
                    movement, combat, bots, modes, protocol, validation
docs/               Architecture, multiplayer hosting, Firebase setup
e2e/                Playwright tests
```

The key design decision: **one simulation, two hosts.** `packages/shared` runs the whole game (players, weapons, paint, bots, scoring). Offline, the browser runs it locally. Online, the server runs it authoritatively and clients send inputs only. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | W A S D | Left stick |
| Look / aim | Mouse | Right stick |
| Fire (hold to roll with the roller) | Left click | RT |
| Paint dive: swim, refill, climb (hold) | Right click or F | LT |
| Jump / double jump | Space | A |
| Sprint | Left Shift | L3 |
| Slide (while sprinting) | C | B |
| Dodge | Q | X |
| Special | E | RB |
| Emote | G | Y |
| Chat (Tab in the box: all or team) | T or Enter | |
| Push to talk (hold) | V | |
| Bigger minimap | M | |
| Scoreboard (hold) | Tab | View |
| Pause | Esc | Menu |

Every keyboard and mouse binding can be changed in Settings → Controls. Voice chat (push to talk, open mic or off) and its volume are under Settings → Audio. Touch screens get an on-screen stick and buttons. Menus work with the D-pad (A selects, B goes back).

## Multiplayer

**Host a game:** Play → Host a game. Your browser runs the match and shows a code. Keep the tab open (it can be in the background).

**Join:** Online → enter the code, or open the host's invite link. Games you've joined are listed under Recent games.

**Public games:** signed-in hosts can switch on **Public game** in their lobby, and the game appears under Online → Public games for anyone to join, guests included.

That's all: nothing to install, no accounts needed, no router settings. Browsers connect directly over WebRTC after a free public broker introduces them. On very strict networks (some schools, offices and mobile data) a direct link can fail. A phone hotspot or another host usually works, and an optional TURN relay can be configured for those players.

**Dedicated server (optional):** for an always-on server, verified online stats or LAN play without internet, run the Node.js server (`npm run start:server`) and use Online → Dedicated servers.

See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for how it works, its limits, the TURN option, and dedicated server setup (LAN, port forwarding, TLS, tunnels).

## Accounts

With Firebase configured, every player signs in before playing, with a username and a strong password (at least 10 characters, upper and lower case, a number and a symbol). Under the hood the username maps to a sign-in identity on the project's own auth domain; nothing is ever emailed there. In the profile, players can add an optional private email for updates, link a Google account as their way back in, and change their password. Builds without Firebase settings skip the sign-in and play as guests.

Create a free Firebase project (Spark plan, no billing), enable **Email/Password** and **Google** sign-in, set the `VITE_FIREBASE_*` values, and deploy [firestore.rules](firestore.rules) (`npx firebase deploy --only firestore:rules`). The rules must be deployed whenever they change, or sign-up and social features will be refused. Full steps are in [docs/FIREBASE.md](docs/FIREBASE.md).

**Playtesting without accounts:** `npm run dev:ungated` serves the game on http://localhost:5175/game/ with accounts switched off.

**Testing accounts locally:** the repository's `.env` points at the real project, so test sign-ups belong on the local emulators. Run `npm run emulators`, then `npm run dev:emulated`, and open http://localhost:5174/game/. That mode forces a demo project, so nothing reaches the live one. Test accounts are listed in [scripts/emulator-accounts.json](scripts/emulator-accounts.json).

Coins, quests and owned items are saved on the device and synced to the account. Without a paid server-side plan they are client-reported, like offline XP.

What's stored: passwords are handled only by Firebase Authentication. Firestore holds a private profile (owner-only), a public card (username, display name, level, look), the username registry, and verified online stats written only by trusted servers. Offline results are client-reported and labelled as such; online results are verified only when the server has Firebase Admin credentials.

## GitHub Pages deployment

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs on every push to `main`. It installs dependencies, typechecks, lints, runs the unit, simulation and multiplayer tests, builds the client, runs the end-to-end tests, then uploads `apps/client/dist` and deploys it with the Pages Actions flow. The repository's Pages source must be **GitHub Actions** (Settings → Pages).

Optional repository **Variables** (Settings → Secrets and variables → Actions → Variables): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_DEFAULT_SERVER_URL`. All are public values (the API key may be stored as a Secret instead; the workflow accepts either). Never put a service account in the client build.

## Desktop app (Windows)

The desktop app is a [Tauri](https://tauri.app) shell: a ~few MB launcher around the system's WebView2 instead of a bundled browser, so it installs small, starts fast and uses much less memory than the old Electron app. It is a window onto the published site, so every deploy updates it without reinstalling, and the site's service worker caches the game so it also starts offline after the first launch. It asks WebView2 for GPU rasterisation even on drivers Chromium distrusts, keeps full speed in the background (voice chat and online play keep running), and F11 toggles fullscreen. While you play it also lowers the render resolution automatically when the frame rate falls short (and raises it back when there is room), without touching shadows, effects or textures, so weak PCs can keep the Ultra preset.

The installer is built by [.github/workflows/desktop.yml](.github/workflows/desktop.yml) on a Windows runner and published as `CHROMASHIFT-Setup.exe` on the `desktop` release. Locally (needs Rust and the MSVC build tools): `npm run desktop:pack` builds it under `apps/desktop/src-tauri/target/release/bundle/nsis/`, and `npm run desktop` runs it without packing. The installer isn't code-signed, so Windows SmartScreen may ask before the first run. Google sign-in pages can refuse embedded windows, so use a username and password in the app (or link Google from the browser version).

## Installing the app (PWA)

- **Desktop Chrome / Edge:** the install icon in the address bar, or menu → Install CHROMASHIFT.
- **Android:** menu → Add to Home screen / Install app.
- **iOS / iPadOS Safari:** Share → Add to Home Screen.

The installed app opens straight into the game and keeps working offline for bot matches. When a new version is deployed, it asks before updating. Online play checks the protocol version, so an outdated cached copy can't join an incompatible server.

## Graphics and performance

Characters are built from many small parts, so each one is merged per joint at load: parts that share a material become one mesh, plain parts share one material that carries colour, roughness and glow per vertex, and each joint casts its shadow from one merged shadow-only copy. The picture is pixel-identical; a match draws less than half as many draw calls. Every shader a match can use is compiled during loading (no mid-match compile stalls), and sound effects are rendered once into buffers instead of being synthesised live for every shot.

WebGL2 is required. If it's unavailable, the game shows a message explaining how to fix it.

| Preset | What changes |
| --- | --- |
| Very Low | 60% resolution capped at 720p, no shadows (blob shadows instead), no AO, bloom, reflections or post, low paint atlas, Lambert materials, fewer particles, short draw distance |
| Low | Low-resolution shadows refreshed every 3rd frame, no post |
| Medium | Default: shadows, reflections, FXAA, raised paint edges |
| High | Sharper shadows and textures, bloom |
| Ultra | 4096 soft shadows, MSAA, GTAO ambient occlusion, supersampling |

Measured on an **NVIDIA GeForce GT 740** (the low end this project targets), full frame (simulation plus render) at a forced 1080p: Very Low 8.8 ms, Low 10.6 ms, Medium 13.2 ms, High 12.4 ms, Ultra 41 ms. At 720p: Very Low 4.4 ms, Medium 6.5 ms. These are single-scene measurements, not promises: real frame rates depend on the scene, browser, drivers, CPU and resolution. Settings → Graphics → Hardware check runs a short benchmark and recommends a preset. It never changes anything by itself. During matches, the game may *suggest* a lower preset if frames drop; you decide.

## Troubleshooting

- **Black screen or the "can't run" message:** enable hardware acceleration in the browser, update graphics drivers, try Chrome, Edge or Firefox.
- **Low FPS:** pick Very Low, or lower Resolution scale. Close other GPU-heavy tabs.
- **"No game is open with that code":** check the code with the host, and that their game is still open.
- **"Couldn't connect to the host":** one of the networks blocks direct connections. Try another network (a phone hotspot often works) or let someone else host. See the TURN option in docs/MULTIPLAYER.md.
- **Can't connect to a dedicated server:** check the address and port, that the server is running, and the firewall. From the HTTPS site, the server must use `wss://`. Online → Dedicated servers shows the server's status.
- **"Different version" when joining:** refresh the page or accept the update prompt, or ask the host to update.
- **Sign-in popup blocked:** allow popups, or the game falls back to a redirect. "Unauthorized domain" means the site's domain must be added in Firebase Authentication → Settings → Authorized domains.
- **Progress not syncing:** it stays saved on your device and syncs when the account service is reachable. The Profile screen shows the sync status.

## Credits and licensing

Everything in CHROMASHIFT was made for this project: code, characters, maps, textures, music and sound, generated procedurally. Font: Archivo (SIL Open Font License) via Fontsource. Third-party libraries keep their own licences (three.js MIT, Rapier Apache-2.0, React MIT, Colyseus MIT, Firebase Apache-2.0).
