import { buildPath, type TrackDef, type TrackPath } from './track';

/*
 * The ten built-in circuits. Each is written as a drive: straights and turns (left positive),
 * with heights, widths, banking and surfaces. The tests check every one closes, fits six cars on
 * the grid, and never runs into itself except over a proper bridge.
 */

const coastal: TrackDef = {
  id: 'coastal',
  name: 'Coastal Sprint',
  description: 'Long waterfront straights and sweeping bends past palm islands. Flat out, then brave.',
  theme: 'coast',
  laps: 3,
  width: 8,
  verge: 'sand',
  shoulder: 4,
  wall: 1.1,
  ground: 0,
  sea: -1.2,
  segs: [
    { len: 273 },
    { turn: 90, r: 70, items: true },
    { len: 90, y: 2 },
    { turn: 45, r: 55 },
    { turn: -45, r: 55, obstacles: true },
    { len: 70, y: 4 },
    { turn: 90, r: 48 },
    { len: 250, y: 3, items: true },
    { turn: 60, r: 62 },
    { turn: 30, r: 90, y: 1 },
    { len: 233, y: 0, obstacles: true },
    { turn: 45, r: 42 },
    { turn: 45, r: 58 },
  ],
};

const neon: TrackDef = {
  id: 'neon',
  name: 'Neon Circuit',
  description: 'A tight street circuit lit up at dusk: hairpins, chicanes and walls close enough to touch.',
  theme: 'neon',
  laps: 4,
  width: 6.5,
  verge: 'metal',
  shoulder: 1.5,
  wall: 1.3,
  ground: 0,
  sea: null,
  segs: [
    { len: 160 },
    { turn: 90, r: 24 },
    { len: 114 },
    { turn: -90, r: 24, items: true },
    { len: 50 },
    { turn: 90, r: 26 },
    { turn: 90, r: 26 },
    { len: 281 },
    { turn: -45, r: 32 },
    { turn: 45, r: 32, obstacles: true },
    { len: 70, items: true },
    { turn: 90, r: 22 },
    { len: 170 },
    { turn: 90, r: 30 },
    { len: 50 },
    { turn: -30, r: 40 },
    { turn: 30, r: 40 },
    { len: 40 },
  ],
};

const canyon: TrackDef = {
  id: 'canyon',
  name: 'Prism Canyon',
  description: 'Climb through red-rock switchbacks, over a dusty crest and down the dirt run back to the valley.',
  theme: 'canyon',
  laps: 3,
  width: 7,
  verge: 'dirt',
  shoulder: 3,
  wall: 1.4,
  ground: 0,
  sea: null,
  segs: [
    { len: 140 },
    { turn: 70, r: 48, y: 6 },
    { turn: -50, r: 44, y: 12, items: true },
    { len: 90, y: 18 },
    { turn: 120, r: 40, y: 22 },
    { len: 80, y: 22 },
    { turn: -60, r: 54, y: 16, surf: 'dirt' },
    { turn: 80, r: 44, y: 10, surf: 'dirt', obstacles: true },
    { len: 150, y: 4, surf: 'dirt', items: true },
    { turn: 100, r: 48, y: 0 },
    { len: 266 },
    { turn: 100, r: 52 },
  ],
};

const skyline: TrackDef = {
  id: 'skyline',
  name: 'Skyline Rush',
  description: 'A figure of eight among the towers: up the banked spiral, over the bridge and dive back down.',
  theme: 'city',
  laps: 3,
  width: 7.5,
  verge: 'metal',
  shoulder: 2,
  wall: 1.3,
  ground: 0,
  sea: -40,
  segs: [
    { len: 160, y: 0, items: true },
    { turn: 90, r: 80, y: 4 },
    { turn: 90, r: 80, y: 8, bank: 10 },
    { turn: 90, r: 80, y: 11, bank: 10 },
    { len: 160, y: 12, items: true },
    { turn: -90, r: 80, y: 9 },
    { turn: -90, r: 80, y: 5, bank: -10, obstacles: true },
    { turn: -90, r: 80, y: 0 },
  ],
  startAt: 60,
};

const docks: TrackDef = {
  id: 'docks',
  name: 'Dye Docks',
  description: 'Square corners between stacked containers on the quayside. Brake late, turn hard, mind the cranes.',
  theme: 'docks',
  laps: 4,
  width: 7,
  verge: 'metal',
  shoulder: 2,
  wall: 1.2,
  ground: 1.5,
  sea: -0.6,
  segs: [
    { len: 391, y: 1.5 },
    { turn: 90, r: 19 },
    { len: 61, items: true },
    { turn: 90, r: 19 },
    { len: 60 },
    { turn: -90, r: 18 },
    { len: 70, obstacles: true },
    { turn: 90, r: 21 },
    { len: 210, items: true },
    { turn: 90, r: 21 },
    { len: 60 },
    { turn: -90, r: 17 },
    { len: 50 },
    { turn: 90, r: 17 },
    { len: 70 },
    { turn: 90, r: 23 },
  ],
};

const bloom: TrackDef = {
  id: 'bloom',
  name: 'Bloom Raceway',
  description: 'Rolling garden hills and flowing esses between the flower beds. Keep it smooth, keep it fast.',
  theme: 'garden',
  laps: 3,
  width: 7.5,
  verge: 'grass',
  shoulder: 4,
  wall: 0.9,
  ground: 0,
  sea: null,
  segs: [
    { len: 150 },
    { turn: 40, r: 85, y: 3 },
    { turn: -60, r: 65, y: 6, items: true },
    { turn: 80, r: 72, y: 8 },
    { len: 100, y: 5 },
    { turn: 50, r: 90, y: 2 },
    { turn: -40, r: 72, y: 0, obstacles: true },
    { turn: 90, r: 62, y: 3 },
    { len: 359, y: 6, items: true },
    { turn: 70, r: 82, y: 4 },
    { turn: -30, r: 64, y: 2 },
    { turn: 80, r: 72, y: 0 },
    { len: 295 },
    { turn: 80, r: 76 },
  ],
};

const coreway: TrackDef = {
  id: 'coreway',
  name: 'Core Raceway',
  description: 'Through the glowing tunnels of the Core complex: technical, metallic and very, very close.',
  theme: 'core',
  laps: 4,
  width: 6.5,
  verge: 'metal',
  shoulder: 1.5,
  wall: 1.6,
  ground: 0,
  sea: null,
  segs: [
    { len: 227, tunnel: true },
    { turn: 90, r: 26, tunnel: true },
    { len: 82, items: true },
    { turn: 90, r: 26 },
    { len: 50 },
    { turn: -90, r: 21 },
    { len: 45, obstacles: true },
    { turn: 90, r: 21 },
    { len: 150, tunnel: true, items: true },
    { turn: 90, r: 30, tunnel: true },
    { len: 70 },
    { turn: 45, r: 32 },
    { turn: -45, r: 32 },
    { len: 50 },
    { turn: 90, r: 26 },
  ],
};

const arcade: TrackDef = {
  id: 'arcade',
  name: 'Arcade Velocity',
  description: 'A playground track: round the banked helix, out over your own tail and back through the boost alley.',
  theme: 'arcade',
  laps: 3,
  width: 7.5,
  verge: 'metal',
  shoulder: 2,
  wall: 1.3,
  ground: 0,
  sea: null,
  segs: [
    { len: 160, items: true },
    { turn: 120, r: 46, y: 5, bank: 14 },
    { turn: 120, r: 46, y: 10, bank: 14 },
    { turn: 120, r: 46, y: 14, bank: 14 },
    { len: 160, y: 14 },
    { turn: 90, r: 44, y: 10 },
    { len: 90, y: 4, items: true },
    { turn: 90, r: 40, y: 0 },
    { len: 324, obstacles: true },
    { turn: 90, r: 44 },
    { len: 86 },
    { turn: 90, r: 44 },
  ],
};

const frozen: TrackDef = {
  id: 'frozen',
  name: 'Frozen Apex',
  description: 'A mountain pass in the snow. Ice on the high corners: lift early, slide wide, hold your nerve.',
  theme: 'snow',
  laps: 2,
  width: 7.5,
  verge: 'snow',
  shoulder: 3,
  wall: 1.2,
  ground: 0,
  sea: null,
  segs: [
    { len: 150 },
    { turn: 60, r: 52, y: 6 },
    { turn: -80, r: 48, y: 10, surf: 'ice', items: true },
    { len: 90, y: 14 },
    { turn: 110, r: 44, y: 18 },
    { len: 80, y: 20, surf: 'ice' },
    { turn: -50, r: 62, y: 16 },
    { turn: 90, r: 48, y: 10, obstacles: true },
    { len: 582, y: 4, items: true },
    { turn: 100, r: 56, y: 0 },
    { turn: 40, r: 72 },
    { len: 600 },
    { turn: 90, r: 52 },
  ],
};

const sunset: TrackDef = {
  id: 'sunset',
  name: 'Sunset Drift',
  description: 'Wide, long corners on the coast road at golden hour, made for holding a drift all the way round.',
  theme: 'sunset',
  laps: 3,
  width: 9,
  verge: 'sand',
  shoulder: 5,
  wall: 1,
  ground: 0,
  sea: -1.4,
  segs: [
    { len: 190 },
    { turn: 120, r: 62, items: true },
    { len: 90, surf: 'dirt' },
    { turn: -70, r: 72, surf: 'dirt' },
    { len: 70 },
    { turn: 150, r: 58, obstacles: true },
    { len: 170, items: true },
    { turn: 70, r: 82 },
    { len: 134 },
    { turn: -40, r: 64 },
    { turn: 130, r: 54 },
  ],
};

export const TRACKS: Record<string, TrackDef> = { coastal, neon, canyon, skyline, docks, bloom, coreway, arcade, frozen, sunset };
export const TRACK_IDS = Object.keys(TRACKS);

/** Player-made tracks registered at runtime (editor presets and published tracks). */
const custom = new Map<string, TrackDef>();
export function registerTrack(def: TrackDef) {
  custom.set(def.id, { ...def, custom: true });
  paths.delete(def.id);
}
export function removeTrack(id: string) {
  custom.delete(id);
  paths.delete(id);
}
export const trackDef = (id: string): TrackDef | undefined => TRACKS[id] ?? custom.get(id);
export const isTrack = (id: string) => !!trackDef(id);
export const customTrackIds = () => [...custom.keys()];

const paths = new Map<string, TrackPath>();
/** The sampled path of a track (cached). */
export function trackPath(id: string): TrackPath {
  let p = paths.get(id);
  if (!p) {
    const def = trackDef(id) ?? TRACKS.coastal;
    p = buildPath(def);
    paths.set(id, p);
  }
  return p;
}
