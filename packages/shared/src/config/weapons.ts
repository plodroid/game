// Single source of truth for weapon balance. Every system (sim, bots, UI, audio, visuals) reads from here.
/** The five originals, free for everyone. Every other weapon is a tuning of one of them. */
export type BaseWeaponId = 'pulse' | 'roller' | 'arc' | 'lobber' | 'dual';
/** The hand-made weapons are listed by name; the generated families add more ids (`ember-pulse`). */
export type WeaponId = string;
export type WeaponKind = 'auto' | 'roller' | 'burst' | 'lobber' | 'dual';

/** How a weapon's model differs from its base: proportions and one extra part. */
export interface WeaponLook {
  /** Length and girth multipliers. */
  len: number;
  bulk: number;
  extra: 'none' | 'scope' | 'drum' | 'fins' | 'tank' | 'spikes' | 'rings' | 'grip';
  /** A hand-modelled gun: replaces the base shape. Built in the weapon frame (barrel toward -Z). */
  parts?: WeaponPart[];
  /** Where shots leave a hand-modelled gun: [y, z]. */
  muzzle?: [number, number];
}

/** One primitive of a hand-modelled gun: position, size (x, y, z) and colour. */
export interface WeaponPart {
  s: 'box' | 'cyl' | 'sphere' | 'cone' | 'torus';
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  c: 'team' | 'dark' | 'light' | 'shell';
}

export interface WeaponDef {
  id: WeaponId;
  base: BaseWeaponId;
  /** Coins; the originals are free. */
  price: number;
  look: WeaponLook;
  name: string;
  tagline: string;
  kind: WeaponKind;
  /** Damage per projectile on a direct hit. */
  damage: number;
  /** Seconds between shots. */
  fireInterval: number;
  /** Effective straight-flight range in metres (after that projectiles drop). */
  range: number;
  /** Cone half-angle in degrees (roller/lobber: fan spread between pellets). */
  spread: number;
  projectileSpeed: number;
  /** Gravity once the straight phase is over. */
  gravity: number;
  pellets: number;
  /** Paint radius on impact, metres. */
  paintRadius: number;
  /** Percent of the ink tank used per shot. */
  inkPerShot: number;
  /** Multiplier on ink refill rate. */
  reloadSpeed: number;
  /** Movement speed multiplier while firing. */
  moveWhileFiring: number;
  splashRadius: number;
  splashDamage: number;
  /** Paint drops along the flight path. 0 disables. */
  dripInterval: number;
  dripRadius: number;
  dodgeCooldown: number;
  /** Extra upward launch angle in degrees (lobber arcs). */
  aimUp: number;
  /** Explode at the end of the straight phase instead of dropping. */
  burstAtRange: boolean;
  roll?: { width: number; inkPerSec: number; damage: number; speedMult: number };
  /** Owner only: never sold, and only the game's owner can use it. */
  admin?: boolean;
  /** A limited weapon can only be bought until this time (ms since 1970); owners keep it. */
  limitedUntil?: number;
  /** 1–5 ratings shown in the UI, derived by hand from the numbers above. */
  ratings: { range: number; damage: number; paint: number; mobility: number };
}

const ORIGINAL = { price: 0, look: { len: 1, bulk: 1, extra: 'none' } } as const;

const BASES: Record<BaseWeaponId, WeaponDef> = {
  pulse: {
    id: 'pulse',
    base: 'pulse',
    ...ORIGINAL,
    name: 'Pulse Sprayer',
    tagline: 'Balanced automatic. Steady coverage, forgiving aim.',
    kind: 'auto',
    damage: 28,
    fireInterval: 0.1,
    range: 15,
    spread: 5.5,
    projectileSpeed: 48,
    gravity: 30,
    pellets: 1,
    paintRadius: 0.95,
    inkPerShot: 0.95,
    reloadSpeed: 1,
    moveWhileFiring: 0.72,
    splashRadius: 0,
    splashDamage: 0,
    dripInterval: 0.12,
    dripRadius: 0.5,
    dodgeCooldown: 1.1,
    aimUp: 0,
    burstAtRange: false,
    ratings: { range: 3, damage: 3, paint: 3, mobility: 3 },
  },
  roller: {
    id: 'roller',
    base: 'roller',
    ...ORIGINAL,
    name: 'Stripe Roller',
    tagline: 'Hold to roll wide stripes. Tap to flick a wave of paint.',
    kind: 'roller',
    damage: 50,
    fireInterval: 0.55,
    range: 9,
    spread: 18,
    projectileSpeed: 26,
    gravity: 30,
    pellets: 7,
    paintRadius: 1.1,
    inkPerShot: 8,
    reloadSpeed: 1.1,
    moveWhileFiring: 0.85,
    splashRadius: 0,
    splashDamage: 0,
    dripInterval: 0.16,
    dripRadius: 0.55,
    dodgeCooldown: 1.0,
    aimUp: 4,
    burstAtRange: false,
    roll: { width: 1.9, inkPerSec: 6, damage: 150, speedMult: 0.85 },
    ratings: { range: 1, damage: 5, paint: 5, mobility: 4 },
  },
  arc: {
    id: 'arc',
    base: 'arc',
    ...ORIGINAL,
    name: 'Arc Blaster',
    tagline: 'Deliberate bursts that detonate at range. Owns choke points.',
    kind: 'burst',
    damage: 125,
    fireInterval: 0.78,
    range: 12,
    spread: 1.5,
    projectileSpeed: 36,
    gravity: 20,
    pellets: 1,
    paintRadius: 2.1,
    inkPerShot: 9,
    reloadSpeed: 1,
    moveWhileFiring: 0.6,
    splashRadius: 2.4,
    splashDamage: 55,
    dripInterval: 0.12,
    dripRadius: 0.6,
    dodgeCooldown: 1.3,
    aimUp: 0,
    burstAtRange: true,
    ratings: { range: 3, damage: 5, paint: 3, mobility: 2 },
  },
  lobber: {
    id: 'lobber',
    base: 'lobber',
    ...ORIGINAL,
    name: 'Prism Lobber',
    tagline: 'Splits into three arcing shells. Reaches high ground.',
    kind: 'lobber',
    damage: 75,
    fireInterval: 0.95,
    range: 20,
    spread: 9,
    projectileSpeed: 24,
    gravity: 26,
    pellets: 3,
    paintRadius: 1.65,
    inkPerShot: 10,
    reloadSpeed: 1,
    moveWhileFiring: 0.55,
    splashRadius: 2.2,
    splashDamage: 50,
    dripInterval: 0,
    dripRadius: 0,
    dodgeCooldown: 1.4,
    aimUp: 14,
    burstAtRange: false,
    ratings: { range: 5, damage: 3, paint: 4, mobility: 2 },
  },
  dual: {
    id: 'dual',
    base: 'dual',
    ...ORIGINAL,
    name: 'Dual Stream',
    tagline: 'Twin rapid emitters and a quick dodge. Stay moving.',
    kind: 'dual',
    damage: 20,
    fireInterval: 0.07,
    range: 11,
    spread: 7,
    projectileSpeed: 44,
    gravity: 34,
    pellets: 1,
    paintRadius: 0.75,
    inkPerShot: 0.75,
    reloadSpeed: 1.15,
    moveWhileFiring: 0.92,
    splashRadius: 0,
    splashDamage: 0,
    dripInterval: 0.14,
    dripRadius: 0.42,
    dodgeCooldown: 0.65,
    aimUp: 0,
    burstAtRange: false,
    ratings: { range: 2, damage: 2, paint: 2, mobility: 5 },
  },
};

type Tuning = Partial<Omit<WeaponDef, 'id' | 'base' | 'kind' | 'roll'>> & {
  name: string;
  tagline: string;
  price: number;
  look: WeaponLook;
  ratings: WeaponDef['ratings'];
  roll?: Partial<NonNullable<WeaponDef['roll']>>;
};

function tune(base: BaseWeaponId, id: WeaponId, t: Tuning): WeaponDef {
  const b = BASES[base];
  return { ...b, ...t, id, base, kind: b.kind, roll: b.roll && { ...b.roll, ...t.roll } };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ...BASES,
  mist: tune('pulse', 'mist', {
    name: 'Mist Sprayer',
    tagline: 'A wide, fast fog of paint. Covers ground in seconds, weak in a duel.',
    price: 900,
    look: { len: 0.8, bulk: 1.2, extra: 'drum' },
    damage: 18, fireInterval: 0.075, range: 10, spread: 11, paintRadius: 1.15, inkPerShot: 0.8, moveWhileFiring: 0.8,
    ratings: { range: 2, damage: 2, paint: 5, mobility: 4 },
  }),
  needle: tune('pulse', 'needle', {
    name: 'Needle Line',
    tagline: 'Tight, long-range stream. Rewards a steady hand.',
    price: 1100,
    look: { len: 1.45, bulk: 0.8, extra: 'scope' },
    damage: 34, fireInterval: 0.14, range: 22, spread: 2, projectileSpeed: 62, paintRadius: 0.75, inkPerShot: 1.3, moveWhileFiring: 0.6,
    ratings: { range: 5, damage: 3, paint: 2, mobility: 2 },
  }),
  gusher: tune('pulse', 'gusher', {
    name: 'Gusher',
    tagline: 'Heavy automatic with a big tank. Slow on foot, hard to push past.',
    price: 1300,
    look: { len: 1.15, bulk: 1.45, extra: 'tank' },
    damage: 32, fireInterval: 0.11, range: 16, spread: 6, paintRadius: 1.05, inkPerShot: 0.85, moveWhileFiring: 0.5, dodgeCooldown: 1.4,
    ratings: { range: 3, damage: 4, paint: 4, mobility: 1 },
  }),
  flicker: tune('pulse', 'flicker', {
    name: 'Flicker',
    tagline: 'Compact and twitchy. Strafe and spray up close.',
    price: 800,
    look: { len: 0.7, bulk: 0.85, extra: 'grip' },
    damage: 22, fireInterval: 0.08, range: 11, spread: 7.5, paintRadius: 0.8, inkPerShot: 0.8, moveWhileFiring: 0.88, dodgeCooldown: 0.9,
    ratings: { range: 2, damage: 2, paint: 3, mobility: 5 },
  }),
  brush: tune('roller', 'brush', {
    name: 'Broad Brush',
    tagline: 'Quick flicks and a nimble roll. Paint while you run.',
    price: 900,
    look: { len: 0.85, bulk: 0.7, extra: 'fins' },
    damage: 36, fireInterval: 0.32, range: 7, spread: 14, pellets: 5, inkPerShot: 4.5, moveWhileFiring: 0.95,
    roll: { width: 1.3, inkPerSec: 4, damage: 90, speedMult: 1.05 },
    ratings: { range: 1, damage: 3, paint: 4, mobility: 5 },
  }),
  dozer: tune('roller', 'dozer', {
    name: 'Paint Dozer',
    tagline: 'A huge drum that flattens everything in a wide lane.',
    price: 1400,
    look: { len: 1.15, bulk: 1.4, extra: 'rings' },
    damage: 70, fireInterval: 0.8, range: 10, spread: 22, pellets: 9, inkPerShot: 12, moveWhileFiring: 0.7,
    roll: { width: 2.6, inkPerSec: 9, damage: 180, speedMult: 0.7 },
    ratings: { range: 2, damage: 5, paint: 5, mobility: 2 },
  }),
  sweeper: tune('roller', 'sweeper', {
    name: 'Swift Sweeper',
    tagline: 'Long reach for a roller. Flick waves from mid range.',
    price: 1100,
    look: { len: 1.3, bulk: 0.9, extra: 'none' },
    damage: 44, fireInterval: 0.5, range: 12, spread: 12, pellets: 6, projectileSpeed: 30, inkPerShot: 7,
    roll: { width: 1.6, inkPerSec: 6, damage: 120, speedMult: 0.9 },
    ratings: { range: 3, damage: 4, paint: 4, mobility: 3 },
  }),
  thumper: tune('arc', 'thumper', {
    name: 'Thumper',
    tagline: 'Slow, booming shots with a huge splash.',
    price: 1300,
    look: { len: 1.1, bulk: 1.35, extra: 'rings' },
    damage: 140, fireInterval: 1.0, range: 11, splashRadius: 3.2, splashDamage: 65, paintRadius: 2.6, inkPerShot: 11, moveWhileFiring: 0.5,
    ratings: { range: 3, damage: 5, paint: 4, mobility: 1 },
  }),
  snap: tune('arc', 'snap', {
    name: 'Snap Blaster',
    tagline: 'Fast bursts with a tight blast. A duelist favourite.',
    price: 1000,
    look: { len: 0.85, bulk: 0.85, extra: 'grip' },
    damage: 100, fireInterval: 0.55, range: 10, splashRadius: 1.8, splashDamage: 45, paintRadius: 1.6, inkPerShot: 7, moveWhileFiring: 0.75,
    ratings: { range: 2, damage: 4, paint: 2, mobility: 4 },
  }),
  popper: tune('arc', 'popper', {
    name: 'Long Popper',
    tagline: 'Bursts that travel far before they pop.',
    price: 1200,
    look: { len: 1.4, bulk: 0.95, extra: 'scope' },
    damage: 110, fireInterval: 0.85, range: 17, projectileSpeed: 44, splashRadius: 2.2, splashDamage: 50, paintRadius: 1.9, inkPerShot: 9,
    ratings: { range: 4, damage: 4, paint: 3, mobility: 2 },
  }),
  mortar: tune('lobber', 'mortar', {
    name: 'Drip Mortar',
    tagline: 'One heavy shell, one big splat.',
    price: 1200,
    look: { len: 1.05, bulk: 1.3, extra: 'tank' },
    damage: 120, fireInterval: 1.15, pellets: 1, spread: 0, paintRadius: 2.6, splashRadius: 3, splashDamage: 70, inkPerShot: 12,
    ratings: { range: 4, damage: 5, paint: 4, mobility: 1 },
  }),
  scatter: tune('lobber', 'scatter', {
    name: 'Scatter Lobber',
    tagline: 'Five small shells in a wide fan. Floods an area.',
    price: 1100,
    look: { len: 0.9, bulk: 1.15, extra: 'drum' },
    damage: 45, fireInterval: 0.9, pellets: 5, spread: 15, paintRadius: 1.3, splashRadius: 1.6, splashDamage: 30, inkPerShot: 10,
    ratings: { range: 4, damage: 2, paint: 5, mobility: 2 },
  }),
  comet: tune('lobber', 'comet', {
    name: 'Comet Launcher',
    tagline: 'Fast, flat shells that reach across the map.',
    price: 1400,
    look: { len: 1.35, bulk: 0.95, extra: 'fins' },
    damage: 70, fireInterval: 1.0, range: 26, projectileSpeed: 32, aimUp: 8, pellets: 2, spread: 5, paintRadius: 1.5, inkPerShot: 10,
    ratings: { range: 5, damage: 3, paint: 3, mobility: 2 },
  }),
  twinjet: tune('dual', 'twinjet', {
    name: 'Twin Jets',
    tagline: 'Heavier duals. Hit harder, dodge a little less.',
    price: 1100,
    look: { len: 1.1, bulk: 1.25, extra: 'tank' },
    damage: 26, fireInterval: 0.08, range: 12, paintRadius: 0.85, inkPerShot: 0.9, moveWhileFiring: 0.85, dodgeCooldown: 0.8,
    ratings: { range: 2, damage: 3, paint: 3, mobility: 4 },
  }),
  ribbon: tune('dual', 'ribbon', {
    name: 'Ribbon Duals',
    tagline: 'Long, thin streams from both hands.',
    price: 1200,
    look: { len: 1.4, bulk: 0.8, extra: 'scope' },
    damage: 22, fireInterval: 0.09, range: 16, spread: 3.5, projectileSpeed: 52, paintRadius: 0.7, inkPerShot: 0.85,
    ratings: { range: 4, damage: 2, paint: 2, mobility: 4 },
  }),
  fizz: tune('dual', 'fizz', {
    name: 'Fizz Pistols',
    tagline: 'Tiny, frantic and always on the move.',
    price: 800,
    look: { len: 0.75, bulk: 0.8, extra: 'spikes' },
    damage: 16, fireInterval: 0.055, range: 9, spread: 9, paintRadius: 0.65, inkPerShot: 0.6, moveWhileFiring: 0.98, dodgeCooldown: 0.5,
    ratings: { range: 1, damage: 2, paint: 3, mobility: 5 },
  }),
};

/* ------------------------------------------------------------------------------------------------
 * Weapon families. Each base gets the same set of archetypes, and every archetype pushes the base's
 * numbers a different way (heavier, quicker, longer, wider...), so each result plays differently
 * and has a model of its own proportions and attachment. New ids are appended, so older network
 * messages and saves keep meaning the same weapon.
 * ---------------------------------------------------------------------------------------------- */

interface Archetype {
  id: string;
  name: string;
  line: string;
  tier: 1 | 2 | 3 | 4;
  /** Multipliers on damage, time between shots, range, spread, paint size, ink use, speed while firing. */
  m: [dmg: number, rate: number, range: number, spread: number, paint: number, ink: number, move: number];
  look: WeaponLook;
  /** Changes to the 1-5 ratings: range, damage, paint, mobility. */
  r: [number, number, number, number];
}

const ARCHETYPES: Archetype[] = [
  { id: 'heavy', name: 'Heavy', line: 'Hits hard, fires slowly.', tier: 2, m: [1.35, 1.3, 1, 0.9, 1.1, 1.2, 0.85], look: { len: 1, bulk: 1.3, extra: 'tank' }, r: [0, 1, 0, -1] },
  { id: 'feather', name: 'Feather', line: 'Light and quick, a little weak.', tier: 1, m: [0.8, 0.8, 0.9, 1.15, 0.9, 0.7, 1.15], look: { len: 0.85, bulk: 0.8, extra: 'none' }, r: [0, -1, 0, 1] },
  { id: 'marksman', name: 'Marksman', line: 'Tight, accurate shots from far away.', tier: 3, m: [1.2, 1.25, 1.4, 0.35, 0.85, 1.05, 0.8], look: { len: 1.4, bulk: 0.9, extra: 'scope' }, r: [2, 1, -1, -1] },
  { id: 'rapid', name: 'Rapid', line: 'Fires far faster, with less punch per shot.', tier: 2, m: [0.7, 0.62, 0.95, 1.3, 0.9, 0.85, 1], look: { len: 1, bulk: 1, extra: 'drum' }, r: [0, -1, 1, 0] },
  { id: 'wide', name: 'Wide', line: 'A broad spray that paints big areas.', tier: 2, m: [0.85, 1, 0.85, 1.7, 1.35, 1.2, 0.95], look: { len: 0.9, bulk: 1.15, extra: 'fins' }, r: [-1, -1, 2, 0] },
  { id: 'needle', name: 'Needle', line: 'A thin, fast line of paint.', tier: 3, m: [1.05, 0.9, 1.3, 0.5, 0.65, 0.8, 1.05], look: { len: 1.3, bulk: 0.7, extra: 'none' }, r: [1, 0, -1, 0] },
  { id: 'turbo', name: 'Turbo', line: 'Move almost freely while firing.', tier: 3, m: [0.9, 0.9, 0.9, 1.1, 0.9, 0.9, 1.3], look: { len: 0.95, bulk: 0.95, extra: 'fins' }, r: [0, 0, 0, 2] },
  { id: 'bulwark', name: 'Bulwark', line: 'Slow and sturdy, with a huge splash.', tier: 3, m: [1.15, 1.2, 0.9, 1.1, 1.45, 1.45, 0.7], look: { len: 0.95, bulk: 1.45, extra: 'rings' }, r: [-1, 1, 2, -2] },
  { id: 'phantom', name: 'Phantom', line: 'Cheap on ink, so you can keep firing.', tier: 3, m: [0.95, 1, 1.05, 1, 0.95, 0.45, 1.05], look: { len: 1.1, bulk: 0.85, extra: 'grip' }, r: [0, 0, 0, 1] },
  { id: 'comet', name: 'Comet', line: 'Shots fly further and faster.', tier: 2, m: [0.95, 1.05, 1.55, 0.9, 0.85, 1, 0.95], look: { len: 1.35, bulk: 0.9, extra: 'fins' }, r: [2, 0, -1, 0] },
  { id: 'ember', name: 'Ember', line: 'Burns through ink for a big splash.', tier: 3, m: [1.1, 0.95, 0.95, 1.2, 1.3, 1.6, 0.95], look: { len: 1, bulk: 1.1, extra: 'spikes' }, r: [0, 0, 2, 0] },
  { id: 'frost', name: 'Frost', line: 'Precise and steady, rarely wasted.', tier: 2, m: [1.1, 1.1, 1.2, 0.6, 0.9, 0.9, 0.95], look: { len: 1.15, bulk: 0.95, extra: 'scope' }, r: [1, 1, -1, 0] },
  { id: 'thunder', name: 'Thunder', line: 'Big hits, big recoil, big splash.', tier: 4, m: [1.55, 1.4, 1.05, 1.1, 1.3, 1.5, 0.75], look: { len: 1.1, bulk: 1.35, extra: 'spikes' }, r: [0, 2, 1, -1] },
  { id: 'velvet', name: 'Velvet', line: 'Smooth and forgiving to aim.', tier: 1, m: [0.9, 0.95, 1, 1.4, 1.1, 0.9, 1.1], look: { len: 0.9, bulk: 1.05, extra: 'drum' }, r: [0, -1, 1, 0] },
  { id: 'jade', name: 'Jade', line: 'A steady all-rounder with a little extra reach.', tier: 1, m: [1.05, 1, 1.15, 0.9, 1, 0.95, 1], look: { len: 1.1, bulk: 1, extra: 'grip' }, r: [1, 0, 0, 0] },
  { id: 'solar', name: 'Solar', line: 'Bright, wide and generous with paint.', tier: 3, m: [0.9, 0.85, 0.9, 1.35, 1.5, 1.15, 1], look: { len: 0.95, bulk: 1.2, extra: 'rings' }, r: [-1, -1, 2, 0] },
  { id: 'lunar', name: 'Lunar', line: 'Floaty shots that carry a long way.', tier: 2, m: [1, 1.1, 1.45, 0.8, 1, 1.05, 0.95], look: { len: 1.25, bulk: 1, extra: 'tank' }, r: [2, 0, 0, 0] },
  { id: 'tidal', name: 'Tidal', line: 'Floods a patch, then refills fast.', tier: 2, m: [0.85, 0.9, 0.9, 1.3, 1.25, 1.1, 1], look: { len: 1, bulk: 1.15, extra: 'tank' }, r: [0, -1, 1, 0] },
  { id: 'gale', name: 'Gale', line: 'Quick on the trigger, quick on your feet.', tier: 3, m: [0.8, 0.7, 1, 1.2, 0.85, 0.8, 1.25], look: { len: 0.9, bulk: 0.85, extra: 'fins' }, r: [0, -1, 0, 2] },
  { id: 'quartz', name: 'Quartz', line: 'Dense shots, short and punchy.', tier: 2, m: [1.3, 1.1, 0.75, 0.85, 1, 1.1, 0.95], look: { len: 0.8, bulk: 1.2, extra: 'none' }, r: [-1, 1, 0, 0] },
  { id: 'onyx', name: 'Onyx', line: 'Dark, deadly and demanding.', tier: 4, m: [1.45, 1.15, 1.2, 0.5, 0.9, 1.3, 0.8], look: { len: 1.3, bulk: 1.05, extra: 'scope' }, r: [1, 2, -1, -1] },
  { id: 'neon', name: 'Neon', line: 'A little of everything, and bright.', tier: 4, m: [1.1, 0.85, 1.15, 0.95, 1.2, 0.9, 1.1], look: { len: 1.05, bulk: 1.1, extra: 'rings' }, r: [1, 1, 1, 1] },
];

const FAMILY_NOUN: Record<BaseWeaponId, string> = { pulse: 'Sprayer', roller: 'Roller', arc: 'Blaster', lobber: 'Lobber', dual: 'Duals' };
const clamp5 = (n: number) => Math.max(1, Math.min(5, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

for (const base of Object.keys(BASES) as BaseWeaponId[])
  for (const a of ARCHETYPES) {
    const b = BASES[base], id = `${a.id}-${base}`;
    const [dmg, rate, range, spread, paint, ink, move] = a.m;
    WEAPONS[id] = tune(base, id, {
      name: `${a.name} ${FAMILY_NOUN[base]}`,
      tagline: a.line,
      price: 500 + a.tier * 300 + (base === 'arc' || base === 'lobber' ? 100 : 0),
      look: { len: Math.min(1.5, b.look.len * a.look.len), bulk: Math.min(1.5, b.look.bulk * a.look.bulk), extra: a.look.extra },
      damage: Math.round(b.damage * dmg),
      fireInterval: Math.round(b.fireInterval * rate * 1000) / 1000,
      range: Math.round(b.range * range * 10) / 10,
      spread: Math.round(b.spread * spread * 10) / 10,
      paintRadius: r2(b.paintRadius * paint),
      inkPerShot: r2(b.inkPerShot * ink),
      moveWhileFiring: Math.min(1, r2(b.moveWhileFiring * move)),
      splashRadius: Math.round(b.splashRadius * paint * 10) / 10,
      splashDamage: Math.round(b.splashDamage * dmg),
      roll: b.roll && { damage: Math.round(b.roll.damage * dmg), width: r2(b.roll.width * (0.8 + 0.2 * paint)) },
      ratings: {
        range: clamp5(b.ratings.range + a.r[0]),
        damage: clamp5(b.ratings.damage + a.r[1]),
        paint: clamp5(b.ratings.paint + a.r[2]),
        mobility: clamp5(b.ratings.mobility + a.r[3]),
      },
    });
  }

/** The owner's own weapon: huge, fast and free to use, but nobody else can equip it. */
WEAPONS.overlord = tune('arc', 'overlord', {
  name: 'Overlord',
  tagline: 'Admin weapon. Wide, relentless and never runs dry.',
  price: 0,
  admin: true,
  look: { len: 1.3, bulk: 1.4, extra: 'rings' },
  damage: 200, fireInterval: 0.12, range: 30, spread: 3, projectileSpeed: 70, paintRadius: 3, inkPerShot: 0, splashRadius: 4, splashDamage: 120, moveWhileFiring: 1, dodgeCooldown: 0.4,
  ratings: { range: 5, damage: 5, paint: 5, mobility: 5 },
});

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Set by the client when the signed-in account is the owner; admin weapons are theirs alone. */
export const gate = {
  check: () => false,
  get owner() {
    return this.check();
  },
};

/** Ids that came from the owner's config. */
export const CUSTOM = new Set<WeaponId>();

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const PART_SHAPES = ['box', 'cyl', 'sphere', 'cone', 'torus'];
const PART_COLOURS = ['team', 'dark', 'light', 'shell'];

/** Makes a weapon from the owner's config safe to use: known base, clamped numbers, tidy model. */
function cleanDef(raw: Record<string, unknown>): WeaponDef | null {
  const id = typeof raw.id === 'string' && /^[a-z0-9-]{2,32}$/.test(raw.id) ? raw.id : null;
  const base = raw.base as BaseWeaponId;
  if (!id || !BASES[base]) return null;
  const b = BASES[base];
  const f = (k: keyof WeaponDef, lo: number, hi: number) => num(raw[k], lo, hi, b[k] as number);
  const look = (raw.look ?? {}) as Partial<WeaponLook>;
  const parts = Array.isArray(look.parts)
    ? look.parts.slice(0, 40).map(
        (p): WeaponPart => ({
          s: PART_SHAPES.includes(p.s) ? p.s : 'box',
          x: num(p.x, -1.5, 1.5, 0), y: num(p.y, -1.5, 1.5, 0), z: num(p.z, -1.5, 1.5, 0),
          w: num(p.w, 0.005, 1.5, 0.1), h: num(p.h, 0.005, 1.5, 0.1), d: num(p.d, 0.005, 1.5, 0.1),
          c: PART_COLOURS.includes(p.c) ? p.c : 'shell',
        }),
      )
    : undefined;
  const r = (raw.ratings ?? b.ratings) as WeaponDef['ratings'];
  const lim = num(raw.limitedUntil, 0, 4e12, 0);
  const m = look.muzzle;
  return {
    ...b,
    id,
    base,
    kind: b.kind,
    name: String(raw.name ?? id).slice(0, 28),
    tagline: String(raw.tagline ?? '').slice(0, 90),
    price: Math.round(f('price', 0, 100000)),
    damage: f('damage', 1, 1000), fireInterval: f('fireInterval', 0.03, 5), range: f('range', 1, 80), spread: f('spread', 0, 45),
    projectileSpeed: f('projectileSpeed', 5, 120), gravity: f('gravity', 0, 80), pellets: Math.round(f('pellets', 1, 12)),
    paintRadius: f('paintRadius', 0.1, 8), inkPerShot: f('inkPerShot', 0, 40), reloadSpeed: f('reloadSpeed', 0.1, 5),
    moveWhileFiring: f('moveWhileFiring', 0.1, 1.5), splashRadius: f('splashRadius', 0, 10), splashDamage: f('splashDamage', 0, 500),
    dodgeCooldown: f('dodgeCooldown', 0.1, 5),
    look: {
      len: num(look.len, 0.4, 2, 1),
      bulk: num(look.bulk, 0.4, 2, 1),
      extra: (['none', 'scope', 'drum', 'fins', 'tank', 'spikes', 'rings', 'grip'].includes(look.extra as string) ? look.extra : 'none') as WeaponLook['extra'],
      ...(parts?.length ? { parts } : {}),
      ...(parts?.length && Array.isArray(m) ? { muzzle: [num(m[0], -1, 1, 0.1), num(m[1], -2, 0.5, -0.4)] as [number, number] } : {}),
    },
    roll: b.roll && { ...b.roll, ...(raw.roll as object) },
    ratings: { range: num(r.range, 1, 5, 3), damage: num(r.damage, 1, 5, 3), paint: num(r.paint, 1, 5, 3), mobility: num(r.mobility, 1, 5, 3) },
    ...(raw.admin ? { admin: true } : {}),
    ...(lim ? { limitedUntil: lim } : {}),
  };
}

/** Applies the owner's weapon config: new weapons are added after the built-in ones, existing ones replaced. */
export function registerWeapons(list: Record<string, unknown>[]) {
  for (const raw of list) {
    const def = cleanDef(raw);
    if (!def) continue;
    if (!WEAPONS[def.id]) WEAPON_IDS.push(def.id);
    WEAPONS[def.id] = def;
    CUSTOM.add(def.id);
  }
}

/** Sets up the id `preview-draft` for the owner's editor to draw; it isn't a playable weapon. */
export function previewWeapon(raw: Record<string, unknown>) {
  const def = cleanDef({ ...raw, id: 'preview-draft' });
  if (def) WEAPONS['preview-draft'] = def;
}

/** Can this weapon still be bought? (Limited weapons close; admin ones are never sold.) */
export const onSale = (w: WeaponDef, now = Date.now()) => !w.admin && (!w.limitedUntil || w.limitedUntil > now);

/** Seconds a projectile flies (almost) straight before gravity takes over. */
export const straightTime = (w: WeaponDef) => (w.kind === 'lobber' ? 0 : w.range / w.projectileSpeed);
