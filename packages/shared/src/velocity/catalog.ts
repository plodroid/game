import { PRICE, type Rarity } from '../config/cosmetics';

/*
 * Car customisation. Everything here is cosmetic: the race treats every car the same (one body box,
 * one handling table), so nothing you buy is faster. Items are bought with the same coins as the
 * locker and kept in the same `owned` list, as `car:<slot>:<id>`; a few are earned by racing instead.
 * The renderer reads the parameters below to build each car, wheel and effect procedurally.
 */

export const CAR_SLOTS = [
  'body', 'paint', 'accent', 'finish', 'wheel', 'rim', 'tire', 'frontBumper', 'rearBumper', 'diffuser', 'hood', 'spoiler', 'roof',
  'mirrors', 'tint', 'headlights', 'taillights', 'livery', 'plate', 'underglow', 'exhaust', 'horn', 'engine', 'wheelfx',
  'trail', 'boostfx', 'driftfx', 'accessory', 'victory', 'badge',
] as const;
export type CarSlot = (typeof CAR_SLOTS)[number];

export type CarLoadout = Record<CarSlot, string> & {
  /** Race number on the doors, 0–99. */
  number: number;
  /** Number-plate text (A–Z, 0–9, up to 7). */
  plateText: string;
};

/** How an item is earned when it isn't simply bought. */
export interface Unlock {
  kind: 'races' | 'wins' | 'podiums' | 'level';
  n: number;
}

export interface CarItem {
  key: string;
  slot: CarSlot;
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  price: number;
  unlock?: Unlock;
}

/* ---------- Colours ---------- */

export const CAR_COLORS: Record<string, { name: string; hex: number; rarity: Rarity }> = {
  white: { name: 'Pearl White', hex: 0xf2f2ee, rarity: 'starter' },
  black: { name: 'Night Black', hex: 0x15161b, rarity: 'starter' },
  silver: { name: 'Silver', hex: 0xb9bec7, rarity: 'starter' },
  magenta: { name: 'Chroma Pink', hex: 0xff3f8e, rarity: 'starter' },
  teal: { name: 'Chroma Teal', hex: 0x19d3be, rarity: 'starter' },
  red: { name: 'Race Red', hex: 0xd7192f, rarity: 'starter' },
  blue: { name: 'Coast Blue', hex: 0x1f5fe0, rarity: 'starter' },
  yellow: { name: 'Sun Yellow', hex: 0xffc21a, rarity: 'starter' },
  orange: { name: 'Tangerine', hex: 0xff7a1a, rarity: 'common' },
  lime: { name: 'Lime', hex: 0x8fe82c, rarity: 'common' },
  green: { name: 'Garden Green', hex: 0x1f8f4a, rarity: 'common' },
  navy: { name: 'Navy', hex: 0x1b2a5a, rarity: 'common' },
  sky: { name: 'Sky', hex: 0x6ec6ff, rarity: 'common' },
  purple: { name: 'Grape', hex: 0x6a2fd0, rarity: 'common' },
  lilac: { name: 'Lilac', hex: 0xb9a2f0, rarity: 'common' },
  coral: { name: 'Coral', hex: 0xff7f6e, rarity: 'common' },
  sand: { name: 'Sand', hex: 0xd9c08f, rarity: 'common' },
  olive: { name: 'Olive', hex: 0x6b7334, rarity: 'common' },
  brown: { name: 'Espresso', hex: 0x4a2c1d, rarity: 'common' },
  grey: { name: 'Gunmetal', hex: 0x4a4f5a, rarity: 'common' },
  mint: { name: 'Mint', hex: 0x9ff2d0, rarity: 'rare' },
  peach: { name: 'Peach', hex: 0xffc2a0, rarity: 'rare' },
  wine: { name: 'Wine', hex: 0x6e1030, rarity: 'rare' },
  cyan: { name: 'Electric Cyan', hex: 0x00e5ff, rarity: 'rare' },
  hotpink: { name: 'Hot Pink', hex: 0xff1fa6, rarity: 'rare' },
  gold: { name: 'Gold', hex: 0xd8a83a, rarity: 'epic' },
  copper: { name: 'Copper', hex: 0xb5653a, rarity: 'epic' },
  ice: { name: 'Glacier', hex: 0xc9f0ff, rarity: 'epic' },
  volt: { name: 'Volt', hex: 0xd4ff1a, rarity: 'epic' },
  ultraviolet: { name: 'Ultraviolet', hex: 0x4b1fff, rarity: 'legendary' },
  ember: { name: 'Ember', hex: 0xff3d00, rarity: 'legendary' },
  aurora: { name: 'Aurora', hex: 0x3dffb0, rarity: 'legendary' },
};

/* ---------- Finishes (material + pattern) ---------- */

export type FinishModel = 'gloss' | 'matte' | 'metallic' | 'pearl' | 'chrome' | 'satin' | 'carbon' | 'brushed' | 'holo' | 'candy' | 'glow';
export type FinishPattern =
  | 'none' | 'stripes' | 'twin' | 'side' | 'gradient' | 'fade' | 'camo' | 'digicamo' | 'splat' | 'drip' | 'pixel' | 'hex' | 'check'
  | 'zebra' | 'tiger' | 'waves' | 'bolts' | 'stars' | 'dots' | 'triangles' | 'circuit' | 'marble' | 'galaxy' | 'scales' | 'plaid'
  | 'diamonds' | 'chevrons' | 'topo' | 'speckle' | 'rainbow' | 'sunset' | 'flames' | 'cells';

export interface Finish {
  name: string;
  rarity: Rarity;
  model: FinishModel;
  pattern: FinishPattern;
  /** Animated shimmer or glow. */
  animated?: boolean;
  desc: string;
}

const F = (name: string, rarity: Rarity, model: FinishModel, pattern: FinishPattern, desc: string, animated = false): Finish => ({ name, rarity, model, pattern, desc, animated });

export const CAR_FINISHES: Record<string, Finish> = {
  gloss: F('Gloss', 'starter', 'gloss', 'none', 'Deep, wet-look clear coat.'),
  matte: F('Matte', 'starter', 'matte', 'none', 'Flat paint with no shine.'),
  metallic: F('Metallic', 'starter', 'metallic', 'none', 'Fine metal flake that sparkles in the sun.'),
  satin: F('Satin', 'common', 'satin', 'none', 'Soft sheen between gloss and matte.'),
  pearl: F('Pearl', 'common', 'pearl', 'none', 'Shifts a little in colour with the light.'),
  candy: F('Candy', 'rare', 'candy', 'none', 'Translucent tinted coat over silver.'),
  chrome: F('Chrome', 'epic', 'chrome', 'none', 'A mirror. Every cloud reflects in it.'),
  brushed: F('Brushed Metal', 'rare', 'brushed', 'none', 'Bare metal with a brushed grain.'),
  carbon: F('Carbon Fibre', 'rare', 'carbon', 'none', 'Woven carbon under a clear coat.'),
  holo: F('Holographic', 'legendary', 'holo', 'none', 'Rainbow foil that moves as you turn.', true),
  stripes: F('Racing Stripes', 'starter', 'gloss', 'stripes', 'Two stripes nose to tail in the accent colour.'),
  twin: F('Twin Pinstripes', 'common', 'gloss', 'twin', 'Thin pinstripes along the shoulders.'),
  side: F('Side Sweep', 'common', 'gloss', 'side', 'A bold accent band along each side.'),
  gradient: F('Gradient', 'common', 'gloss', 'gradient', 'Paint to accent, nose to tail.'),
  fade: F('Underfade', 'common', 'metallic', 'fade', 'Accent rising from the sills into the main colour.'),
  camo: F('Camo', 'common', 'matte', 'camo', 'Blotchy woodland camouflage.'),
  digicamo: F('Digital Camo', 'rare', 'matte', 'digicamo', 'Pixel camouflage in two tones.'),
  splat: F('Paint Splat', 'common', 'gloss', 'splat', 'CHROMASHIFT paint splattered over the body.'),
  drip: F('Paint Drip', 'rare', 'gloss', 'drip', 'Accent paint dripping down from the roof.'),
  pixel: F('Pixel', 'rare', 'satin', 'pixel', 'Chunky retro pixels.'),
  hex: F('Hex Grid', 'rare', 'metallic', 'hex', 'A honeycomb of hexagons.'),
  check: F('Chequered', 'rare', 'gloss', 'check', 'The finish-line flag, all over.'),
  zebra: F('Zebra', 'rare', 'matte', 'zebra', 'Wavy two-tone stripes.'),
  tiger: F('Tiger', 'rare', 'gloss', 'tiger', 'Sharp stripes on a bright base.'),
  waves: F('Waves', 'common', 'pearl', 'waves', 'Rolling ocean waves.'),
  bolts: F('Lightning', 'rare', 'gloss', 'bolts', 'Jagged bolts in the accent colour.'),
  stars: F('Starfield', 'epic', 'metallic', 'stars', 'Scattered stars on deep paint.'),
  dots: F('Polka', 'common', 'gloss', 'dots', 'Big friendly dots.'),
  triangles: F('Shards', 'rare', 'satin', 'triangles', 'Faceted triangles in two tones.'),
  circuit: F('Circuit', 'epic', 'glow', 'circuit', 'Glowing circuit traces.', true),
  marble: F('Marble', 'epic', 'gloss', 'marble', 'Polished veined stone.'),
  galaxy: F('Galaxy', 'legendary', 'metallic', 'galaxy', 'A nebula with stars.', true),
  scales: F('Scales', 'epic', 'pearl', 'scales', 'Overlapping scales that catch the light.'),
  plaid: F('Plaid', 'rare', 'satin', 'plaid', 'A woven tartan check.'),
  diamonds: F('Diamonds', 'rare', 'gloss', 'diamonds', 'A harlequin diamond grid.'),
  chevrons: F('Chevrons', 'rare', 'gloss', 'chevrons', 'Arrows pointing forward.'),
  topo: F('Topographic', 'epic', 'matte', 'topo', 'Contour lines like a map.'),
  speckle: F('Speckle', 'common', 'gloss', 'speckle', 'Fine flecks of accent colour.'),
  rainbow: F('Rainbow', 'epic', 'gloss', 'rainbow', 'Every colour in bands.'),
  sunset: F('Sunset Fade', 'epic', 'pearl', 'sunset', 'Orange to purple like the evening sky.'),
  flames: F('Heat Wave', 'epic', 'gloss', 'flames', 'Rippling heat rising from the nose.'),
  cells: F('Cells', 'rare', 'satin', 'cells', 'Organic cell shapes.'),
  neonedge: F('Neon Edge', 'epic', 'glow', 'twin', 'Glowing accent lines.', true),
  neonsplat: F('Glow Splat', 'legendary', 'glow', 'splat', 'Splats that glow in the dark.', true),
  chromestripe: F('Chrome Stripes', 'epic', 'chrome', 'stripes', 'Mirror finish with painted stripes.'),
  carbonstripe: F('Carbon Stripes', 'epic', 'carbon', 'stripes', 'Carbon weave with accent stripes.'),
  mattecamo: F('Night Camo', 'rare', 'metallic', 'camo', 'Metal-flake camouflage.'),
  pearlwaves: F('Pearl Tide', 'epic', 'pearl', 'gradient', 'Pearl coat graded into the accent.'),
  candycheck: F('Candy Check', 'epic', 'candy', 'check', 'Translucent chequers over silver.'),
  holostars: F('Holo Stars', 'legendary', 'holo', 'stars', 'Holographic foil scattered with stars.', true),
  brushedhex: F('Brushed Hex', 'epic', 'brushed', 'hex', 'Engraved hexagons in bare metal.'),
  satinchevron: F('Satin Chevron', 'rare', 'satin', 'chevrons', 'Soft-sheen forward arrows.'),
  metalpixel: F('Metal Pixel', 'rare', 'metallic', 'pixel', 'Flake paint in pixel blocks.'),
  glowcircuit: F('Overclock', 'legendary', 'glow', 'cells', 'Pulsing glowing cells.', true),
  pearldrip: F('Pearl Drip', 'epic', 'pearl', 'drip', 'Pearl paint dripping down the doors.'),
  mattetiger: F('Stealth Tiger', 'rare', 'matte', 'tiger', 'Flat paint with dark stripes.'),
};

/* ---------- Bodies, wheels and parts ---------- */

export const BODIES: Record<string, { name: string; rarity: Rarity; desc: string }> = {
  sport: { name: 'Vela Sport', rarity: 'starter', desc: 'A balanced two-door sports coupé.' },
  compact: { name: 'Pip Compact', rarity: 'starter', desc: 'A short, chunky hatchback.' },
  muscle: { name: 'Brava Muscle', rarity: 'common', desc: 'Long bonnet, wide hips, loud.' },
  rally: { name: 'Gravel Rally', rarity: 'rare', desc: 'High-riding rally hatch with arches.' },
  super: { name: 'Apex Super', rarity: 'epic', desc: 'A low mid-engined wedge.' },
  future: { name: 'Prism Concept', rarity: 'legendary', desc: 'A canopy pod with fins from the future.' },
};

export type RimStyle = 'spokes' | 'split' | 'twist' | 'mesh' | 'dish' | 'turbine' | 'star' | 'y' | 'block' | 'wire' | 'disc' | 'fan';
export const WHEELS: Record<string, { name: string; rarity: Rarity; style: RimStyle; spokes: number; depth: number; desc: string }> = {
  five: { name: 'Classic Five', rarity: 'starter', style: 'spokes', spokes: 5, depth: 0.3, desc: 'Five straight spokes.' },
  six: { name: 'Six Star', rarity: 'starter', style: 'star', spokes: 6, depth: 0.25, desc: 'Six tapered spokes.' },
  split5: { name: 'Split Five', rarity: 'common', style: 'split', spokes: 5, depth: 0.35, desc: 'Five pairs of thin spokes.' },
  split7: { name: 'Split Seven', rarity: 'rare', style: 'split', spokes: 7, depth: 0.3, desc: 'Seven pairs of thin spokes.' },
  twist: { name: 'Vortex', rarity: 'rare', style: 'twist', spokes: 6, depth: 0.25, desc: 'Curved spokes that look like they spin when parked.' },
  twist10: { name: 'Cyclone', rarity: 'epic', style: 'twist', spokes: 10, depth: 0.2, desc: 'Ten swept spokes.' },
  mesh: { name: 'Mesh', rarity: 'common', style: 'mesh', spokes: 12, depth: 0.2, desc: 'A fine cross-laced mesh.' },
  mesh20: { name: 'Lattice', rarity: 'rare', style: 'mesh', spokes: 20, depth: 0.15, desc: 'Dense lattice mesh.' },
  dish: { name: 'Deep Dish', rarity: 'common', style: 'dish', spokes: 4, depth: 0.6, desc: 'A wide lip and a deep dish.' },
  dish8: { name: 'Stepped Dish', rarity: 'rare', style: 'dish', spokes: 8, depth: 0.55, desc: 'Eight short spokes deep inside a big lip.' },
  turbine: { name: 'Turbine', rarity: 'epic', style: 'turbine', spokes: 14, depth: 0.25, desc: 'Turbine blades round the hub.' },
  fan: { name: 'Fan', rarity: 'rare', style: 'fan', spokes: 9, depth: 0.3, desc: 'Broad fan blades.' },
  y5: { name: 'Y-Spoke', rarity: 'common', style: 'y', spokes: 5, depth: 0.3, desc: 'Five spokes that fork towards the rim.' },
  y6: { name: 'Fork Six', rarity: 'rare', style: 'y', spokes: 6, depth: 0.28, desc: 'Six forked spokes.' },
  block: { name: 'Block', rarity: 'common', style: 'block', spokes: 4, depth: 0.35, desc: 'Chunky rally blocks.' },
  block8: { name: 'Gravel Eight', rarity: 'rare', style: 'block', spokes: 8, depth: 0.32, desc: 'Eight-hole rally wheel.' },
  wire: { name: 'Wire', rarity: 'epic', style: 'wire', spokes: 24, depth: 0.25, desc: 'Laced wire spokes, old-school.' },
  wire36: { name: 'Gentleman', rarity: 'legendary', style: 'wire', spokes: 36, depth: 0.22, desc: 'Thirty-six wire spokes and a knock-off spinner.' },
  disc: { name: 'Aero Disc', rarity: 'rare', style: 'disc', spokes: 0, depth: 0.1, desc: 'A smooth cover for less drag (looks only).' },
  disc3: { name: 'Tri Disc', rarity: 'epic', style: 'disc', spokes: 3, depth: 0.12, desc: 'An aero disc with three cut-outs.' },
  star10: { name: 'Ten Star', rarity: 'rare', style: 'star', spokes: 10, depth: 0.24, desc: 'Ten slim spokes.' },
  spokes3: { name: 'Tri-Spoke', rarity: 'epic', style: 'spokes', spokes: 3, depth: 0.35, desc: 'Three bold spokes.' },
  spokes4: { name: 'Quad', rarity: 'common', style: 'spokes', spokes: 4, depth: 0.32, desc: 'Four wide spokes.' },
  fan15: { name: 'Hurricane', rarity: 'legendary', style: 'fan', spokes: 15, depth: 0.22, desc: 'Fifteen thin curved blades.' },
};

export const RIM_FINISHES: Record<string, { name: string; rarity: Rarity; color: number | 'paint' | 'accent'; metal: number; rough: number }> = {
  silver: { name: 'Silver', rarity: 'starter', color: 0xc8ccd4, metal: 0.9, rough: 0.3 },
  black: { name: 'Gloss Black', rarity: 'starter', color: 0x16171c, metal: 0.4, rough: 0.25 },
  gunmetal: { name: 'Gunmetal', rarity: 'common', color: 0x4a4f5a, metal: 0.85, rough: 0.35 },
  white: { name: 'White', rarity: 'common', color: 0xf0f0f0, metal: 0.1, rough: 0.4 },
  gold: { name: 'Gold', rarity: 'rare', color: 0xd8a83a, metal: 1, rough: 0.25 },
  bronze: { name: 'Bronze', rarity: 'rare', color: 0x8a5a2b, metal: 0.9, rough: 0.35 },
  chrome: { name: 'Chrome', rarity: 'epic', color: 0xe8ecf2, metal: 1, rough: 0.05 },
  paint: { name: 'Body Colour', rarity: 'common', color: 'paint', metal: 0.3, rough: 0.3 },
  accent: { name: 'Accent Colour', rarity: 'common', color: 'accent', metal: 0.3, rough: 0.3 },
};

export const TIRES: Record<string, { name: string; rarity: Rarity; tread: 'street' | 'slick' | 'offroad' | 'block'; wall: 'plain' | 'redline' | 'white' | 'letters' | 'blue' }> = {
  street: { name: 'Street', rarity: 'starter', tread: 'street', wall: 'plain' },
  slick: { name: 'Race Slick', rarity: 'common', tread: 'slick', wall: 'plain' },
  redline: { name: 'Redline', rarity: 'rare', tread: 'street', wall: 'redline' },
  whitewall: { name: 'Whitewall', rarity: 'rare', tread: 'street', wall: 'white' },
  offroad: { name: 'All-Terrain', rarity: 'common', tread: 'offroad', wall: 'letters' },
  block: { name: 'Mud Block', rarity: 'rare', tread: 'block', wall: 'plain' },
  blueline: { name: 'Blueline', rarity: 'epic', tread: 'slick', wall: 'blue' },
};

type Simple = Record<string, { name: string; rarity: Rarity; desc: string }>;
const S = (rows: [string, string, Rarity, string][]): Simple => Object.fromEntries(rows.map(([id, name, rarity, desc]) => [id, { name, rarity, desc }]));

export const FRONT_BUMPERS = S([
  ['stock', 'Stock', 'starter', 'The bumper it came with.'],
  ['splitter', 'Splitter', 'common', 'A flat splitter lip.'],
  ['rally', 'Rally Guard', 'rare', 'Skid plate and spot lamps.'],
  ['canard', 'Canards', 'rare', 'Aggressive vents with dive planes.'],
  ['round', 'Retro', 'common', 'A rounded chrome bar.'],
  ['wide', 'Wide Intake', 'epic', 'One huge open intake.'],
]);
export const REAR_BUMPERS = S([
  ['stock', 'Stock', 'starter', 'The bumper it came with.'],
  ['sport', 'Sport', 'common', 'Sharper lines and vents.'],
  ['tow', 'Tow Hook', 'common', 'With a bright tow strap.'],
  ['race', 'Race Cut', 'rare', 'Cut away to show the diffuser.'],
  ['retro', 'Retro', 'rare', 'A rounded chrome bar.'],
]);
export const DIFFUSERS = S([
  ['none', 'None', 'starter', 'A clean underside.'],
  ['small', 'Small', 'common', 'A few short fins.'],
  ['race', 'Race', 'rare', 'Tall fins under the rear.'],
  ['light', 'Light Bar', 'epic', 'Fins with a rain light in the middle.'],
  ['double', 'Twin Deck', 'epic', 'Two decks of fins.'],
]);
export const HOODS = S([
  ['stock', 'Stock', 'starter', 'Plain and smooth.'],
  ['scoop', 'Scoop', 'common', 'A raised air scoop.'],
  ['vents', 'Vents', 'common', 'Two heat vents.'],
  ['bulge', 'Power Bulge', 'rare', 'A raised centre section.'],
  ['carbon', 'Carbon', 'rare', 'A bare carbon bonnet.'],
  ['blower', 'Blower', 'epic', 'A supercharger sticking through the bonnet.'],
]);
export const SPOILERS = S([
  ['none', 'None', 'starter', 'Clean tail.'],
  ['lip', 'Lip', 'starter', 'A small lip on the boot.'],
  ['ducktail', 'Ducktail', 'common', 'A flicked-up tail.'],
  ['wing', 'Wing', 'common', 'A classic rear wing.'],
  ['gt', 'GT Wing', 'rare', 'Tall endplates and a wide plane.'],
  ['swan', 'Swan Neck', 'epic', 'A wing hung from above.'],
  ['double', 'Biplane', 'epic', 'Two stacked planes.'],
  ['light', 'Light Blade', 'legendary', 'A glowing blade in the accent colour.'],
]);
export const ROOFS = S([
  ['none', 'None', 'starter', 'Plain roof.'],
  ['scoop', 'Roof Scoop', 'common', 'An intake on the roof.'],
  ['rack', 'Roof Rack', 'common', 'Rails and a crossbar.'],
  ['lightbar', 'Light Bar', 'rare', 'A row of rally lamps.'],
  ['fin', 'Shark Fin', 'rare', 'A tall stabiliser fin.'],
  ['spoiler', 'Roof Spoiler', 'common', 'A spoiler at the back of the roof.'],
  ['box', 'Cargo Box', 'rare', 'For your holiday luggage.'],
]);
export const MIRRORS = S([
  ['stock', 'Stock', 'starter', 'Body-colour mirrors.'],
  ['aero', 'Aero', 'common', 'Slim mirrors on stalks.'],
  ['round', 'Round', 'common', 'Small round chrome mirrors.'],
  ['none', 'None', 'rare', 'Who needs to look back?'],
]);
export const TINTS: Record<string, { name: string; rarity: Rarity; color: number; opacity: number }> = {
  clear: { name: 'Clear', rarity: 'starter', color: 0x9fb4c8, opacity: 0.6 },
  light: { name: 'Light', rarity: 'starter', color: 0x3c4552, opacity: 0.78 },
  dark: { name: 'Dark', rarity: 'common', color: 0x15181f, opacity: 0.92 },
  blue: { name: 'Ice Blue', rarity: 'common', color: 0x3a7bd5, opacity: 0.7 },
  gold: { name: 'Gold Mirror', rarity: 'rare', color: 0xb8892e, opacity: 0.82 },
  rose: { name: 'Rose', rarity: 'rare', color: 0xd14f86, opacity: 0.72 },
  green: { name: 'Emerald', rarity: 'rare', color: 0x1d8a5a, opacity: 0.75 },
};
export const HEADLIGHTS: Record<string, { name: string; rarity: Rarity; color: number; shape: 'round' | 'slim' | 'square' | 'bar' | 'twin' }> = {
  standard: { name: 'Standard', rarity: 'starter', color: 0xfff4e0, shape: 'square' },
  xenon: { name: 'Xenon', rarity: 'common', color: 0xdbe9ff, shape: 'slim' },
  round: { name: 'Classic Round', rarity: 'common', color: 0xfff0c8, shape: 'round' },
  amber: { name: 'Amber', rarity: 'rare', color: 0xffc04a, shape: 'twin' },
  bar: { name: 'LED Bar', rarity: 'rare', color: 0xe8f6ff, shape: 'bar' },
  pink: { name: 'Pink Neon', rarity: 'epic', color: 0xff5fb0, shape: 'slim' },
  cyan: { name: 'Cyan Neon', rarity: 'epic', color: 0x40fff0, shape: 'bar' },
};
export const TAILLIGHTS: Record<string, { name: string; rarity: Rarity; shape: 'square' | 'bar' | 'round' | 'split' | 'ring' }> = {
  standard: { name: 'Standard', rarity: 'starter', shape: 'square' },
  bar: { name: 'Light Bar', rarity: 'common', shape: 'bar' },
  round: { name: 'Twin Round', rarity: 'common', shape: 'round' },
  split: { name: 'Split', rarity: 'rare', shape: 'split' },
  ring: { name: 'Halo Rings', rarity: 'epic', shape: 'ring' },
};
export const LIVERIES = S([
  ['none', 'None', 'starter', 'Just the paint.'],
  ['number', 'Race Number', 'starter', 'A roundel with your number on each door.'],
  ['stripe', 'Le Stripe', 'common', 'A single wide stripe over the car.'],
  ['band', 'Chequer Band', 'common', 'A chequered band down the sides.'],
  ['splat', 'Team Splat', 'common', 'A big CHROMASHIFT splat on the doors.'],
  ['bolt', 'Bolt', 'rare', 'A lightning bolt along each side.'],
  ['wave', 'Surf', 'rare', 'A curling wave from nose to doors.'],
  ['logo', 'CHROMASHIFT', 'rare', 'The game’s name down the sides.'],
  ['sponsor', 'Sponsors', 'rare', 'Made-up sponsor stickers all over.'],
  ['sun', 'Sunburst', 'epic', 'A sunrise on the bonnet.'],
  ['pixels', 'Glitch', 'epic', 'Glitching pixel blocks.'],
  ['crown', 'Champion', 'legendary', 'A gold crown and laurels. For winners.'],
]);
export const PLATES: Record<string, { name: string; rarity: Rarity; bg: number; fg: number }> = {
  white: { name: 'White', rarity: 'starter', bg: 0xf2f2ee, fg: 0x15161b },
  yellow: { name: 'Yellow', rarity: 'starter', bg: 0xffd23f, fg: 0x15161b },
  black: { name: 'Black', rarity: 'common', bg: 0x15161b, fg: 0xf2f2ee },
  blue: { name: 'Euro Blue', rarity: 'common', bg: 0xf2f2ee, fg: 0x1f3fa0 },
  pink: { name: 'Chroma', rarity: 'rare', bg: 0xff3f8e, fg: 0xffffff },
  teal: { name: 'Teal', rarity: 'rare', bg: 0x19d3be, fg: 0x0b2b2b },
  retro: { name: 'Retro', rarity: 'rare', bg: 0x2a2a2a, fg: 0xffc04a },
  gold: { name: 'Gold', rarity: 'epic', bg: 0xd8a83a, fg: 0x2a1a05 },
  neon: { name: 'Neon', rarity: 'epic', bg: 0x0c0b14, fg: 0x40fff0 },
  race: { name: 'Race Plate', rarity: 'legendary', bg: 0xffffff, fg: 0xd7192f },
};
export const UNDERGLOWS: Record<string, { name: string; rarity: Rarity; color: number | null }> = {
  none: { name: 'None', rarity: 'starter', color: null },
  pink: { name: 'Pink', rarity: 'common', color: 0xff3f8e },
  cyan: { name: 'Cyan', rarity: 'common', color: 0x19d3be },
  blue: { name: 'Blue', rarity: 'common', color: 0x2f6dff },
  green: { name: 'Green', rarity: 'common', color: 0x2fdf6f },
  purple: { name: 'Purple', rarity: 'rare', color: 0x8b5cff },
  amber: { name: 'Amber', rarity: 'rare', color: 0xffa21a },
  white: { name: 'White', rarity: 'rare', color: 0xffffff },
  red: { name: 'Red', rarity: 'rare', color: 0xff2a2a },
  rainbow: { name: 'Rainbow', rarity: 'legendary', color: -1 },
};
export const EXHAUSTS = S([
  ['single', 'Single', 'starter', 'One round tailpipe.'],
  ['dual', 'Dual', 'starter', 'Two pipes, one each side.'],
  ['quad', 'Quad', 'common', 'Four pipes.'],
  ['center', 'Centre', 'rare', 'A big pipe in the middle.'],
  ['side', 'Side Pipes', 'epic', 'Pipes out of the sills.'],
  ['shotgun', 'Shotgun', 'rare', 'Two big pipes side by side.'],
]);
export const HORNS: Record<string, { name: string; rarity: Rarity; notes: number[]; wave: 'square' | 'sawtooth' | 'triangle' | 'sine' }> = {
  beep: { name: 'Beep', rarity: 'starter', notes: [440, 554], wave: 'square' },
  low: { name: 'Truck', rarity: 'common', notes: [175, 220], wave: 'sawtooth' },
  toot: { name: 'Toot Toot', rarity: 'common', notes: [660, 660], wave: 'square' },
  chord: { name: 'Big Chord', rarity: 'rare', notes: [330, 415, 494], wave: 'sawtooth' },
  rise: { name: 'Rising', rarity: 'rare', notes: [392, 523, 659], wave: 'triangle' },
  tune: { name: 'Jingle', rarity: 'epic', notes: [523, 659, 784, 1047], wave: 'square' },
  chirp: { name: 'Chirp', rarity: 'rare', notes: [1200, 1800], wave: 'sine' },
  fanfare: { name: 'Fanfare', rarity: 'legendary', notes: [392, 523, 659, 784, 1047], wave: 'sawtooth' },
};
export const ENGINES: Record<string, { name: string; rarity: Rarity; base: number; spread: number; wave: OscillatorKind; grit: number; desc: string }> = {
  inline4: { name: 'Inline Four', rarity: 'starter', base: 70, spread: 340, wave: 'sawtooth', grit: 0.25, desc: 'A buzzy four-cylinder.' },
  v8: { name: 'V8 Rumble', rarity: 'common', base: 45, spread: 210, wave: 'sawtooth', grit: 0.55, desc: 'Deep and burbly.' },
  v12: { name: 'V12 Scream', rarity: 'epic', base: 85, spread: 520, wave: 'sawtooth', grit: 0.15, desc: 'A high, smooth howl.' },
  turbo: { name: 'Turbo', rarity: 'rare', base: 60, spread: 300, wave: 'square', grit: 0.35, desc: 'With a whistling turbo on top.' },
  rotary: { name: 'Rotary', rarity: 'rare', base: 95, spread: 480, wave: 'square', grit: 0.2, desc: 'A rasping, revvy buzz.' },
  electric: { name: 'Electric', rarity: 'rare', base: 140, spread: 900, wave: 'sine', grit: 0, desc: 'A rising sci-fi whine.' },
};
export type OscillatorKind = 'sine' | 'square' | 'sawtooth' | 'triangle';
export const WHEEL_FX: Record<string, { name: string; rarity: Rarity; color: number | null }> = {
  none: { name: 'None', rarity: 'starter', color: null },
  pink: { name: 'Pink Rims Glow', rarity: 'rare', color: 0xff3f8e },
  cyan: { name: 'Cyan Rims Glow', rarity: 'rare', color: 0x19d3be },
  gold: { name: 'Gold Halo', rarity: 'epic', color: 0xffc21a },
  rainbow: { name: 'Rainbow Rims', rarity: 'legendary', color: -1 },
};
export const TRAILS: Record<string, { name: string; rarity: Rarity; color: number | null; kind: 'none' | 'lines' | 'ribbon' | 'sparkle' | 'paint' | 'comet' | 'bubble' | 'pixel' | 'rainbow' | 'flame' }> = {
  none: { name: 'None', rarity: 'starter', color: null, kind: 'none' },
  lines: { name: 'Speed Lines', rarity: 'common', color: 0xffffff, kind: 'lines' },
  pink: { name: 'Pink Ribbon', rarity: 'common', color: 0xff3f8e, kind: 'ribbon' },
  cyan: { name: 'Cyan Ribbon', rarity: 'common', color: 0x19d3be, kind: 'ribbon' },
  sparkle: { name: 'Sparkle', rarity: 'rare', color: 0xfff2b0, kind: 'sparkle' },
  paint: { name: 'Paint Drips', rarity: 'rare', color: 0xff3f8e, kind: 'paint' },
  comet: { name: 'Comet', rarity: 'epic', color: 0x9fd8ff, kind: 'comet' },
  bubble: { name: 'Bubbles', rarity: 'rare', color: 0xbff4ff, kind: 'bubble' },
  pixel: { name: '8-Bit', rarity: 'epic', color: 0x5dff7a, kind: 'pixel' },
  rainbow: { name: 'Rainbow Road', rarity: 'legendary', color: -1, kind: 'rainbow' },
  flame: { name: 'Afterburner', rarity: 'legendary', color: 0xff7a1a, kind: 'flame' },
};
export const BOOST_FX: Record<string, { name: string; rarity: Rarity; color: number; kind: 'flame' | 'burst' | 'prism' | 'rings' | 'stars' }> = {
  standard: { name: 'Blue Flame', rarity: 'starter', color: 0x5fa8ff, kind: 'flame' },
  pink: { name: 'Pink Burst', rarity: 'common', color: 0xff3f8e, kind: 'burst' },
  green: { name: 'Toxic', rarity: 'common', color: 0x7dff4a, kind: 'flame' },
  prism: { name: 'Prism', rarity: 'epic', color: 0xffffff, kind: 'prism' },
  rings: { name: 'Smoke Rings', rarity: 'rare', color: 0xd9e2ee, kind: 'rings' },
  stars: { name: 'Star Shower', rarity: 'legendary', color: 0xffd23f, kind: 'stars' },
};
export const DRIFT_FX: Record<string, { name: string; rarity: Rarity; color: number; kind: 'smoke' | 'sparks' | 'paint' | 'bubbles' | 'stars' }> = {
  white: { name: 'White Smoke', rarity: 'starter', color: 0xe8ecf2, kind: 'smoke' },
  pink: { name: 'Pink Smoke', rarity: 'common', color: 0xff7ab8, kind: 'smoke' },
  cyan: { name: 'Cyan Smoke', rarity: 'common', color: 0x7ff0e6, kind: 'smoke' },
  yellow: { name: 'Yellow Smoke', rarity: 'common', color: 0xffe066, kind: 'smoke' },
  rainbow: { name: 'Rainbow Smoke', rarity: 'legendary', color: -1, kind: 'smoke' },
  sparks: { name: 'Sparks', rarity: 'rare', color: 0xffb030, kind: 'sparks' },
  paint: { name: 'Paint Spray', rarity: 'epic', color: 0xff3f8e, kind: 'paint' },
  bubbles: { name: 'Bubbles', rarity: 'rare', color: 0xbff4ff, kind: 'bubbles' },
  stars: { name: 'Stars', rarity: 'epic', color: 0xffd23f, kind: 'stars' },
};
export const ACCESSORIES = S([
  ['none', 'None', 'starter', 'Nothing on top.'],
  ['antenna', 'Antenna Ball', 'common', 'A smiley ball on a springy aerial.'],
  ['flag', 'Team Flag', 'common', 'A little flag in your identity colour.'],
  ['duck', 'Rubber Duck', 'rare', 'A duck mascot riding on the dash.'],
  ['crown', 'Crown Topper', 'epic', 'A gold crown on the roof.'],
  ['dice', 'Fuzzy Dice', 'common', 'Hanging from the mirror.'],
  ['cone', 'Traffic Cone', 'rare', 'Stolen from the canyon. Don’t tell.'],
  ['propeller', 'Propeller', 'epic', 'A spinning propeller cap.'],
  ['halo', 'Halo', 'legendary', 'A glowing ring above the car.'],
  ['palm', 'Tiny Palm', 'rare', 'A potted palm, for the summer.'],
]);
export const VICTORIES = S([
  ['confetti', 'Confetti', 'starter', 'A shower of confetti.'],
  ['fireworks', 'Fireworks', 'rare', 'Fireworks over the car.'],
  ['paint', 'Paint Burst', 'common', 'An explosion of CHROMASHIFT paint.'],
  ['spin', 'Donuts', 'rare', 'Smoky donuts on the line.'],
  ['lights', 'Light Show', 'epic', 'Spotlights sweeping the sky.'],
  ['stars', 'Star Rain', 'legendary', 'Golden stars falling around you.'],
]);
export const BADGES = S([
  ['none', 'None', 'starter', 'No badge.'],
  ['splat', 'Splat', 'starter', 'The CHROMASHIFT splat.'],
  ['bolt', 'Bolt', 'common', 'A lightning bolt.'],
  ['star', 'Star', 'common', 'A five-point star.'],
  ['wing', 'Wings', 'rare', 'A winged emblem.'],
  ['shield', 'Crest', 'rare', 'A shield crest.'],
  ['flag', 'Chequers', 'rare', 'Crossed chequered flags.'],
  ['skull', 'Jolly Roger', 'epic', 'A friendly skull.'],
  ['diamond', 'Diamond', 'epic', 'A cut diamond.'],
  ['trophy', 'Trophy', 'legendary', 'A golden trophy. Earned, not bought.'],
]);

/** Items earned by racing instead of bought. */
const EARNED: Record<string, Unlock> = {
  'livery:crown': { kind: 'wins', n: 10 },
  'badge:trophy': { kind: 'wins', n: 5 },
  'plate:race': { kind: 'podiums', n: 10 },
  'victory:stars': { kind: 'wins', n: 25 },
  'trail:rainbow': { kind: 'races', n: 50 },
  'accessory:halo': { kind: 'podiums', n: 25 },
  'wheel:fan15': { kind: 'races', n: 30 },
};

export const SLOT_LABEL: Record<CarSlot, string> = {
  body: 'Body', paint: 'Paint', accent: 'Accent colour', finish: 'Finish', wheel: 'Wheels', rim: 'Rim finish', tire: 'Tyres',
  frontBumper: 'Front bumper', rearBumper: 'Rear bumper', diffuser: 'Diffuser', hood: 'Bonnet', spoiler: 'Spoiler', roof: 'Roof',
  mirrors: 'Mirrors', tint: 'Window tint', headlights: 'Headlights', taillights: 'Tail lights', livery: 'Livery', plate: 'Plate',
  underglow: 'Underglow', exhaust: 'Exhaust', horn: 'Horn', engine: 'Engine sound', wheelfx: 'Wheel glow', trail: 'Trail',
  boostfx: 'Boost effect', driftfx: 'Drift smoke', accessory: 'Accessory', victory: 'Victory', badge: 'Badge',
};

const TABLES: Record<CarSlot, Record<string, { name: string; rarity: Rarity; desc?: string }>> = {
  body: BODIES,
  paint: Object.fromEntries(Object.entries(CAR_COLORS).map(([k, v]) => [k, { ...v, desc: 'Main body colour.' }])),
  accent: Object.fromEntries(Object.entries(CAR_COLORS).map(([k, v]) => [k, { ...v, desc: 'Stripes, patterns and trim.' }])),
  finish: CAR_FINISHES,
  wheel: WHEELS,
  rim: Object.fromEntries(Object.entries(RIM_FINISHES).map(([k, v]) => [k, { ...v, desc: 'The colour and shine of the rims.' }])),
  tire: Object.fromEntries(Object.entries(TIRES).map(([k, v]) => [k, { ...v, desc: `${v.tread} tread, ${v.wall} sidewall.` }])),
  frontBumper: FRONT_BUMPERS,
  rearBumper: REAR_BUMPERS,
  diffuser: DIFFUSERS,
  hood: HOODS,
  spoiler: SPOILERS,
  roof: ROOFS,
  mirrors: MIRRORS,
  tint: Object.fromEntries(Object.entries(TINTS).map(([k, v]) => [k, { ...v, desc: 'Window glass tint.' }])),
  headlights: Object.fromEntries(Object.entries(HEADLIGHTS).map(([k, v]) => [k, { ...v, desc: `${v.shape} lamps.` }])),
  taillights: Object.fromEntries(Object.entries(TAILLIGHTS).map(([k, v]) => [k, { ...v, desc: `${v.shape} lamps.` }])),
  livery: LIVERIES,
  plate: Object.fromEntries(Object.entries(PLATES).map(([k, v]) => [k, { ...v, desc: 'Number-plate style (your text).' }])),
  underglow: Object.fromEntries(Object.entries(UNDERGLOWS).map(([k, v]) => [k, { ...v, desc: 'Light under the car.' }])),
  exhaust: EXHAUSTS,
  horn: Object.fromEntries(Object.entries(HORNS).map(([k, v]) => [k, { ...v, desc: 'Press the horn button to play it.' }])),
  engine: ENGINES,
  wheelfx: Object.fromEntries(Object.entries(WHEEL_FX).map(([k, v]) => [k, { ...v, desc: 'A glow round the rims.' }])),
  trail: Object.fromEntries(Object.entries(TRAILS).map(([k, v]) => [k, { ...v, desc: 'Left behind you at speed.' }])),
  boostfx: Object.fromEntries(Object.entries(BOOST_FX).map(([k, v]) => [k, { ...v, desc: 'Out of the exhaust when you boost.' }])),
  driftfx: Object.fromEntries(Object.entries(DRIFT_FX).map(([k, v]) => [k, { ...v, desc: 'From the tyres when you drift.' }])),
  accessory: ACCESSORIES,
  victory: VICTORIES,
  badge: BADGES,
};

export const CAR_ITEMS: CarItem[] = CAR_SLOTS.flatMap((slot) =>
  Object.entries(TABLES[slot]).map(([id, v]) => {
    const unlock = EARNED[`${slot}:${id}`];
    return {
      key: `car:${slot}:${id}`,
      slot,
      id,
      name: v.name,
      desc: v.desc ?? '',
      rarity: v.rarity,
      price: unlock ? 0 : PRICE[v.rarity],
      ...(unlock ? { unlock } : {}),
    };
  }),
);
export const CAR_ITEM: Record<string, CarItem> = Object.fromEntries(CAR_ITEMS.map((i) => [i.key, i]));
export const carItemsFor = (slot: CarSlot) => CAR_ITEMS.filter((i) => i.slot === slot);
/** Free for everyone. */
export const FREE_CAR_ITEMS = new Set(CAR_ITEMS.filter((i) => i.rarity === 'starter').map((i) => i.key));

export const DEFAULT_CAR: CarLoadout = {
  body: 'sport', paint: 'magenta', accent: 'white', finish: 'gloss', wheel: 'five', rim: 'silver', tire: 'street',
  frontBumper: 'stock', rearBumper: 'stock', diffuser: 'none', hood: 'stock', spoiler: 'lip', roof: 'none', mirrors: 'stock',
  tint: 'light', headlights: 'standard', taillights: 'standard', livery: 'number', plate: 'white', underglow: 'none',
  exhaust: 'dual', horn: 'beep', engine: 'inline4', wheelfx: 'none', trail: 'none', boostfx: 'standard', driftfx: 'white',
  accessory: 'none', victory: 'confetti', badge: 'splat', number: 7, plateText: 'CHROMA',
};

export const cleanPlate = (s: unknown) =>
  (typeof s === 'string' ? s : '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 7) || 'CHROMA';

/** Any untrusted loadout made valid: unknown ids fall back to the defaults. */
export function sanitizeCarLoadout(raw: unknown): CarLoadout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_CAR };
  for (const slot of CAR_SLOTS) {
    const v = r[slot];
    if (typeof v === 'string' && TABLES[slot][v]) (out as Record<string, unknown>)[slot] = v;
  }
  const n = Number(r.number);
  out.number = Number.isInteger(n) && n >= 0 && n <= 99 ? n : DEFAULT_CAR.number;
  out.plateText = cleanPlate(r.plateText);
  return out;
}

/** A bot's car: a random but tidy combination. */
export function botCar(seed: number): CarLoadout {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const of = (slot: CarSlot) => Object.keys(TABLES[slot]);
  return sanitizeCarLoadout({
    ...DEFAULT_CAR,
    body: pick(of('body')),
    paint: pick(of('paint')),
    accent: pick(['white', 'black', 'silver', 'yellow', 'teal', 'magenta']),
    finish: pick(['gloss', 'metallic', 'stripes', 'side', 'gradient', 'pearl', 'splat', 'check', 'twin', 'satin', 'carbonstripe', 'fade']),
    wheel: pick(of('wheel')),
    rim: pick(['silver', 'black', 'gunmetal', 'gold', 'white']),
    spoiler: pick(of('spoiler')),
    hood: pick(of('hood')),
    livery: pick(['number', 'stripe', 'band', 'splat', 'bolt', 'sponsor', 'logo']),
    frontBumper: pick(of('frontBumper')),
    number: Math.floor(rnd() * 99) + 1,
    plateText: pick(['ZOOM', 'FAST1', 'BOTZ', 'VROOM', 'GOGO', 'SKRRT', 'APEX']),
  });
}

/** Rarity order for sorting. */
export const RARITY_ORDER: Record<Rarity, number> = { starter: 0, common: 1, rare: 2, epic: 3, legendary: 4 };
