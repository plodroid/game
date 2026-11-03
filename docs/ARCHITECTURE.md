# Architecture

## One simulation, two hosts

`packages/shared` contains the complete game: maps, physics world, paint ownership, movement, weapons, projectiles, specials, modes, bots and the network protocol. It has no DOM or Node dependencies, apart from Rapier (WebAssembly), which runs in both.

- **Offline**, the browser runs `Simulation` at a fixed 60 Hz and renders interpolated states (`OfflineSource`).
- **Online**, the server runs the same `Simulation` authoritatively (`ArenaRoom`). Clients send inputs and render server snapshots (`OnlineSource`).

The renderer (`MatchView`) reads from a `MatchSource` interface and doesn't know which of the two it's drawing.

## Fixed-step simulation

`Simulation.step()` advances exactly `1/60 s`: bot brains produce inputs, then for each player combat (fire, roll, specials, regen) runs, then movement through Rapier's kinematic character controller (capsule, slopes up to 52°, 0.4 m autostep, snap to ground), then projectiles and effects. Rendering never changes the step size; the client accumulates frame time and interpolates between the last two ticks.

## Paint

- **Ownership (gameplay and scoring).** Every visible face of every map block is a rectangle with a grid of roughly 0.4 m cells (`PaintGrid`). Cells covered by other geometry, or under a low overhang, are marked blocked and excluded, so overlapping or occluded geometry never counts. Floors and ramps (normal.y > 0.6) count towards territory; walls are paintable for climbing but not scored. `paintSphere(center, r, team)` paints the front side of every face within reach, never through walls, and updates the per-team scored area incrementally.
- **Atlas layout.** Each face gets a rectangle in one shared atlas (256 cells wide, shelf-packed, 1-cell padding). The same layout serves gameplay and rendering.
- **Rendering.** `PaintAtlas` owns a render target of `256·k × rows·k` texels, where k is 3–10 depending on paint quality. Each paint event becomes one instanced splat stamp per affected face: a rim with a noise wobble plus satellite droplets, clipped to the face. All stamps for a frame go out in one draw call. Map materials (Standard, or Lambert on Very Low) get the atlas injected through `onBeforeCompile`, which mixes team colour, lowers roughness and, on higher presets, bumps the normal from the coverage gradient so paint edges look raised. Team colours are uniforms, so colour-blind palettes switch instantly.
- **Network.** Paint travels as compact events `[seq, x, y, z, r, team, kind]` (centimetre-quantised). The server applies the quantised values itself, so every peer computes identical cells. Late joiners get a run-length-encoded grid (`SYNC`) and the atlas is rebuilt from it in one full-screen pass. Replaying events on top is idempotent, because the last writer wins per cell.

## Networking

- Client → server: packed inputs `[seq, mx, mz, yaw, pitch, aimYaw, aimPitch, buttons]`, batched at about 30 Hz.
- Server → client at 20 Hz: a snapshot with every player's full movement state, the events since the last snapshot (paint, fire, hits, KOs, specials…), live effects, phase, timer and score. Scoreboard stats are added about once a second.
- **Prediction.** The local player runs the same `stepMovement` on every input. When a snapshot arrives, the client resets to the server state and replays the inputs the server hasn't processed yet. Small differences are smoothed visually; large ones (respawn) snap.
- **Interpolation.** Remote players are drawn about 100 ms (6 ticks) in the past, between buffered snapshots, with a drift-corrected clock.
- **Shots.** Your own shots appear instantly from predicted fire timing. Everyone else's come from `fire` events, re-simulated cosmetically from the same deterministic seed (`forEachPellet`). Hits and paint are always decided by the server.

## Bots

- `NavGraph` samples walkable faces about every 2.2 m (skipping beams under 1.5 m wide and spots without headroom). It links neighbours with **walk** edges (ground continuity and line of sight), **jump/drop** edges between levels, and **pad** edges by simulating launch arcs.
- `BotBrain` re-plans every 0.3–0.9 s depending on difficulty, choosing between paint, fight, refill, retreat, support and zone. Painting goals are sampled nodes scored by unpainted and rival coverage, distance, and teammates' claims (team blackboard). Routes are A* with an extra cost for rival paint.
- Every frame, bots follow the path segment (carrot steering, string-pulling only over solid ground), aim with reaction delay, lead, wobble and a capped turn rate, sweep paint, swim through their own colour, and use specials when the situation fits. A ledge guard stops them walking or strafing off edges, and stuck detection hops, re-plans or picks a new goal.
- Bots produce the same `Input` a human does, so they follow every rule.

## Client rendering

- One `WebGLRenderer`. `Engine` owns the rAF loop, the FPS cap and context-loss recovery. React only renders the DOM interface; the HUD reads a throttled Zustand store (about 15 Hz).
- Map blocks are merged into one mesh per material, with baked ray-traced vertex AO (Rapier raycasts at load).
- Characters are procedural rigs (Object3D hierarchy). The `Animator` blends poses (locomotion cycle, air, slide, dodge roll, aim with pitch, recoil, roller, flinch, emotes, victory/defeat) by easing joints towards per-frame targets. The paint-dive form is a separate glossy blob.
- Effects use pools: instanced projectiles per team, instanced particles with per-instance colour, and a capped pool of rings.
- Post-processing (bloom, FXAA, GTAO) is only built when the preset enables it; Very Low and Low render directly.

## Accounts

Firebase is loaded lazily, only when configured, so offline play never waits on it. Signing in loads `users/{uid}`; a new account first claims a username in one transaction (`usernames` + `users` + `profiles`), carrying over guest progress. Changes sync with debounce and exponential backoff. The game server can verify ID tokens and write `stats/{uid}` through the Admin SDK.
