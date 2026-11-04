// Single source of truth for weapon balance. Every system (sim, bots, UI, audio, visuals) reads from here.
export type WeaponId = 'pulse' | 'roller' | 'arc' | 'lobber' | 'dual';
export type WeaponKind = 'auto' | 'roller' | 'burst' | 'lobber' | 'dual';

export interface WeaponDef {
  id: WeaponId;
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

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pulse: {
    id: 'pulse',
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

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Seconds a projectile flies (almost) straight before gravity takes over. */
export const straightTime = (w: WeaponDef) => (w.kind === 'lobber' ? 0 : w.range / w.projectileSpeed);
