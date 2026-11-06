// Single source of truth for weapon balance. Every system (sim, bots, UI, audio, visuals) reads from here.
/** The five originals, free for everyone. Every other weapon is a tuning of one of them. */
export type BaseWeaponId = 'pulse' | 'roller' | 'arc' | 'lobber' | 'dual';
export type WeaponId =
  | BaseWeaponId
  | 'mist' | 'needle' | 'gusher' | 'flicker'
  | 'brush' | 'dozer' | 'sweeper'
  | 'thumper' | 'snap' | 'popper'
  | 'mortar' | 'scatter' | 'comet'
  | 'twinjet' | 'ribbon' | 'fizz';
export type WeaponKind = 'auto' | 'roller' | 'burst' | 'lobber' | 'dual';

/** How a weapon's model differs from its base: proportions and one extra part. */
export interface WeaponLook {
  /** Length and girth multipliers. */
  len: number;
  bulk: number;
  extra: 'none' | 'scope' | 'drum' | 'fins' | 'tank' | 'spikes' | 'rings' | 'grip';
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

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Seconds a projectile flies (almost) straight before gravity takes over. */
export const straightTime = (w: WeaponDef) => (w.kind === 'lobber' ? 0 : w.range / w.projectileSpeed);
