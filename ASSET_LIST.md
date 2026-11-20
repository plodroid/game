# CHROMASHIFT: every model in the game

This is the list of everything drawn as a 3D model, so you can make replacements. Counts come from the
game's data as of this version. "Where it lives" is the file that builds it today.

## What can be replaced today, and what can't

| Kind | Can your model replace it right now? |
| --- | --- |
| Weapons | Yes, but only models made and published in the Studio (`look.asset`). There is no GLB importer yet. |
| Map scenery props | Yes, the same way (a map prop of kind `asset`). Built-in arenas still use the built-in props. |
| Everything else | No. It is built in code and would need a loader added. |

**Proposal:** I add a GLB (glTF 2.0) loader and a small table that maps a file name to each item below
(for example `weapons/pulse.glb`, `cars/sedan.glb`). Anything you supply is used, anything you don't
supply keeps its built-in model. Then you can replace things one at a time. Say the word and I will build it.

## Rules every model should follow

- **Format:** GLB (glTF 2.0), Y up, metres, one file per item, origin as stated per section.
- **Materials:** name them. The game recolours by name: `team` (the player's paint), `finish` (weapon
  finish or car paint), `accent`, `glass`, `glow`. Everything else keeps its own look.
- **Budget:** weapons under 6,000 triangles, cars under 25,000 (wheels and parts included), props under 3,000.
  Mobile runs the same models.
- **Separate parts** where the game moves or swaps them (wheels, steering, wings, lights).

---

## 1. Weapons (132 in the game, 5 base models)

Every weapon is one of five base models plus an attachment and some proportion changes. Replace the five and
the other 127 follow; replace more if you want each to be unique.

| Base model | Weapons using it | What it is |
| --- | --- | --- |
| `pulse` Pulse Sprayer | 27 | Automatic gun with a tank over the back |
| `roller` Stripe Roller | 26 | Long pole with a paint drum |
| `arc` Arc Blaster | 27 | Chunky tube with a flared bell |
| `lobber` Lobber | 26 | Wide-mouthed launcher with a hopper |
| `dual` Twin pistols | 26 | A pair of small guns (two copies, one per hand) |

Attachments the variants add: `scope`, `drum`, `fins`, `tank`, `spikes`, `rings`, `grip`.

- **Origin:** the grip, at (0,0,0). **Barrel points to -Z**, up is +Y. Add an empty named `muzzle` where shots leave.
- **Size:** a pistol is about 0.3 m long, the roller about 1 m.
- **Where it lives:** `apps/client/src/weapons/models.ts`.
- Replacing a model never changes a weapon's stats.

## 2. Vehicles (VELOCITY)

### 2a. Bodies (19)

`sport` Vela Sport (coupé) · `compact` Pip Compact (hatchback) · `sedan` Corsa Sedan · `kei` Bubble Kei ·
`roadster` Breeze Roadster · `muscle` Brava Muscle · `pickup` Haul Pickup · `wagon` Tourer Estate · `suv` Ridge SUV ·
`van` Box Van · `rally` Gravel Rally · `buggy` Dune Buggy · `classic` Starliner Classic · `hotrod` Rust Rod ·
`gt` Strada GT · `super` Apex Super · `openwheel` Formula Vortex · `hyper` Nova Hyper · `future` Prism Concept

- **Origin:** the centre of the car, at the middle of the body. **Nose points to +Z**, up is +Y.
- **Size:** about 4.3 m long, 1.9 m wide for every body (the physics box is the same for all cars).
- **Separate nodes:** body shell, glass, `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` (at the wheel centres, so they can steer and spin), headlights, tail-lights.
- **Where it lives:** `apps/client/src/velocity/carModel.ts` (shapes) and `carParts.ts` (parts).

### 2b. Wheels, tyres and parts

| Slot | Count | Notes |
| --- | --- | --- |
| Wheel designs | 24 | 12 spoke styles (spokes, split, twist, mesh, dish, turbine, star, Y, block, wire, disc, fan) in several spoke counts. Axle along X. |
| Rim finishes | 9 | Colours only, no model |
| Tyres | 7 | 4 tread patterns (street, slick, off-road, block) and 5 sidewall prints |
| Front bumpers | 10 | stock, splitter, rally, canard, retro, wide, lip, grille, push bar, plough |
| Rear bumpers | 8 | stock, sport, tow, race, retro, step, hitch, spare wheel |
| Diffusers | 7 | none, small, race, light, double, blade, venturi |
| Bonnets | 10 | stock, scoop, vents, bulge, carbon, blower, louvres, twin scoops, pins, snorkel |
| Spoilers | 12 | none, lip, gurney, ducktail, whale, wing, GT, swan neck, biplane, split, drag, light blade |
| Roof parts | 11 | none, scoop, rack, light bar, fin, spoiler, box, sunroof, vents, basket, surfboard |
| Mirrors | 6 | stock, aero, round, none, carbon, camera |
| Exhausts | 8 | single, dual, quad, centre, shotgun, triple, side pipes, stacks |
| Headlights | 7 | round, slim, square, bar, twin (shape; colour varies) |
| Tail-lights | 5 | square, bar, round, split, ring |
| Accessories | 14 | antenna ball, flag, duck, crown, dice, cone, propeller, halo, palm, cactus, cowboy hat, longhorns, satellite dish, none |
| Number plate | 1 | the same plate, 10 colour styles |
| Badges | 10 | flat pictures (splat, bolt, star, wings, crest, flag, skull, diamond, trophy) |

- Each part is **positioned in car space** (origin at the car's centre, nose +Z). I need a **mount point** per body for parts that sit on the car (roof, bonnet, boot), or I can place them by the body's measurements as now.
- **Not models:** paint colours (32), finishes (56), liveries (12), underglow, horns, engine sounds, trails, boost and drift effects, victory effects. These are colours, patterns and particles.

## 3. Racing tracks and scenery (10 themes)

Tracks are drawn from a road line, so the road, kerbs and walls are generated. These are the models around it.

| Track | Theme | Scenery models |
| --- | --- | --- |
| coastal, sunset | coast | palm tree, beach hut, beach umbrella, sand rocks |
| neon, coreway | neon / core | skyscraper, pylon with glow strip, neon ring |
| skyline | city | skyscraper |
| docks | docks | shipping container, gantry crane |
| bloom | garden | broadleaf tree, flower bed |
| canyon | canyon | mesa, saguaro cactus |
| frozen | snow | pine tree, mountain peak |
| arcade | arcade | toy block, arch |

For every track: **barrier** (7 styles by theme: concrete blocks, neon blocks, hedge, snow bank, rock wall,
guardrail with posts, tyre stacks), **start line gantry**, **grandstand with crowd**, **street lamp**,
**billboards (4 designs)**, **traffic cone, crate, tyre stack**, **kerbs**, **start/finish line**,
**bridge deck and pillars**, **tunnel arch with lights**, **pickup box** and the **item hazards** (oil slick, decoy).

- **Where it lives:** `apps/client/src/velocity/trackScene.ts`.

## 4. Shooter arenas (7 maps)

Arena geometry (floors, walls, ramps) is boxes, because it is also the collision. It stays boxes unless you
want me to separate the look from the collision. The decoration around them:

| Map | Scenery models |
| --- | --- |
| skyline | tank, antenna, billboard, building, lamp, pipe |
| core | panel, lamp, pipe |
| float | tree, crystal, rock, cloud |
| docks | antenna, tank, lamp, building, pipe |
| gardens | tree, rock, lamp, cloud |
| canyon | crystal, rock, building |
| arcade | billboard, panel, lamp, building |

All scenery kinds (11): `building`, `tank`, `antenna`, `billboard`, `lamp`, `cloud`, `crystal`, `tree`, `rock`,
`panel`, `pipe`. Also: jump pad, objective zone marker, beach island with palms/umbrellas/huts, stilts under
platforms, the rock underside of floating islands, sea and sky (these two are shaders, not models).

- **Surfaces (9 materials):** floor, wall, metal, trim, glass, base, crate, island (grass), invisible wall. Textures, not models.
- **Where it lives:** `apps/client/src/rendering/props.ts`, `environment.ts`, `beach.ts`, `mapMesh.ts`.

## 5. Player character

Not remodelled by me. Listed so you can include it. One body (female and male builds) with a fixed rig and
animations; every item below attaches to it.

| Item | Count | Notes |
| --- | --- | --- |
| Hair styles | 38 | about 38 base shapes, many colours (321 items) |
| Headgear | 281 items | about 56 base shapes (caps, beanies, helmets, hats, ears, crowns, headsets…) in many colours |
| Faces | 298 items | face decals/features, not separate meshes |
| Outfits | 288 items | colours and patterns on one outfit shape |
| Back items | 301 items | about 20 base shapes (wings, packs, capes, tails…) |
| Held weapon | see section 1 | attaches to the right hand |
| Emotes | 56 | animations, not models |

- **Where it lives:** `apps/client/src/characters/` (`model.ts`, `hair.ts`, `gear.ts`, `back.ts`, `head.ts`, `face.ts`).
- A replacement body needs the **same rig and bone names** as the current one, or the 56 emotes and the walk,
  run and dive animations won't work on it.

## 6. Effects (procedural, not models)

Paint splats, projectiles and drips, particles (smoke, sparks, flames, stars), the dive blob, shield bubble,
muzzle flash, ocean, sky and clouds, skid marks. Tell me if you want any of these replaced by a model or a texture.

## Suggested order

1. The five weapon bases (all 132 weapons change at once).
2. The 19 car bodies and 24 wheels.
3. Racing scenery per theme.
4. Arena scenery kinds.
5. Character parts, last, because they depend on the rig.
