/*
 * Car damage. Sixteen parts, each 0 (fine) to 1 (wrecked), from real impacts: where the contact
 * was on the body and how hard (the change of velocity it caused). Repeated hits add up. With
 * mechanical damage on, a few parts change how the car drives, always within gentle limits.
 */

export const PARTS = [
  'frontBody', 'rearBody', 'leftBody', 'rightBody',
  'frontBumper', 'rearBumper', 'hood', 'engine',
  'steering', 'suspension',
  'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR',
  'headlightL', 'headlightR', 'taillightL', 'taillightR',
] as const;
export type Part = (typeof PARTS)[number];
export const PART_INDEX = Object.fromEntries(PARTS.map((p, i) => [p, i])) as Record<Part, number>;
export const PART_COUNT = PARTS.length;

export const PART_LABEL: Record<Part, string> = {
  frontBody: 'Front body', rearBody: 'Rear body', leftBody: 'Left side', rightBody: 'Right side',
  frontBumper: 'Front bumper', rearBumper: 'Rear bumper', hood: 'Bonnet', engine: 'Engine',
  steering: 'Steering', suspension: 'Suspension',
  wheelFL: 'Front-left wheel', wheelFR: 'Front-right wheel', wheelRL: 'Rear-left wheel', wheelRR: 'Rear-right wheel',
  headlightL: 'Left headlight', headlightR: 'Right headlight', taillightL: 'Left tail light', taillightR: 'Right tail light',
};

/** Below this change of velocity (m/s) a knock leaves no mark. */
const THRESHOLD = 2.6;

/**
 * Spreads one impact over the parts near the contact point.
 * `lx, ly, lz` is the contact in the car's own frame (x left, y up, z forward, metres).
 * Returns the part hit hardest.
 */
export function applyImpact(dmg: Float32Array, lx: number, lz: number, dv: number, halfX: number, halfZ: number): Part | null {
  const sev = (dv - THRESHOLD) / 22;
  if (sev <= 0) return null;
  const fx = Math.max(-1, Math.min(1, lx / halfX)), fz = Math.max(-1, Math.min(1, lz / halfZ));
  const front = Math.max(0, fz), rear = Math.max(0, -fz), left = Math.max(0, fx), right = Math.max(0, -fx);
  const add = (p: Part, k: number) => {
    if (k <= 0) return;
    const i = PART_INDEX[p];
    dmg[i] = Math.min(1, dmg[i] + sev * k);
  };
  // Ends of the car take hits on the bumpers first, then the panels behind them.
  add('frontBumper', front * 1.3);
  add('frontBody', front * 0.8);
  add('hood', front * 0.7);
  add('engine', front * front * 0.45);
  add('rearBumper', rear * 1.3);
  add('rearBody', rear * 0.8);
  add('leftBody', left * 1.1);
  add('rightBody', right * 1.1);
  // Lights at the corners, wheels along the sides near each end.
  add('headlightL', front * (0.4 + left) * 0.9);
  add('headlightR', front * (0.4 + right) * 0.9);
  add('taillightL', rear * (0.4 + left) * 0.9);
  add('taillightR', rear * (0.4 + right) * 0.9);
  const sideF = Math.max(0, 1 - Math.abs(fz - 0.64) * 2.2), sideR = Math.max(0, 1 - Math.abs(fz + 0.64) * 2.2);
  add('wheelFL', left * sideF * 0.75);
  add('wheelFR', right * sideF * 0.75);
  add('wheelRL', left * sideR * 0.75);
  add('wheelRR', right * sideR * 0.75);
  add('steering', (left + right) * sideF * 0.35 + front * 0.15);
  add('suspension', (left + right) * (sideF + sideR) * 0.25);
  let worst: Part = 'frontBody', w = -1;
  const weights: [Part, number][] = [
    ['frontBumper', front], ['rearBumper', rear], ['leftBody', left], ['rightBody', right],
  ];
  for (const [p, k] of weights)
    if (k > w) {
      w = k;
      worst = p;
    }
  return worst;
}

/** How each part's wear changes driving (only with mechanical damage on). All gentle. */
export interface DamageEffects {
  power: number;
  steer: number;
  /** Steering pull to one side, radians. */
  pull: number;
  brake: number;
  /** Per-wheel grip (FL, FR, RL, RR). */
  wheel: [number, number, number, number];
  /** Spring/damper factor. */
  suspension: number;
}

export function damageEffects(d: Float32Array, on: boolean): DamageEffects {
  if (!on) return { power: 1, steer: 1, pull: 0, brake: 1, wheel: [1, 1, 1, 1], suspension: 1 };
  const g = (p: Part) => d[PART_INDEX[p]];
  const wheel = (p: Part) => 1 - 0.32 * g(p);
  return {
    power: 1 - 0.3 * g('engine'),
    steer: 1 - 0.25 * g('steering'),
    pull: 0.03 * g('steering') * (g('wheelFL') + g('leftBody') > g('wheelFR') + g('rightBody') ? 1 : -1),
    brake: 1 - 0.2 * (g('wheelFL') + g('wheelFR') + g('wheelRL') + g('wheelRR')) / 4,
    wheel: [wheel('wheelFL'), wheel('wheelFR'), wheel('wheelRL'), wheel('wheelRR')],
    suspension: 1 - 0.35 * g('suspension'),
  };
}

/** 0 healthy … 4 critical, for the HUD. */
export function damageLevel(v: number): 0 | 1 | 2 | 3 | 4 {
  return v < 0.08 ? 0 : v < 0.3 ? 1 : v < 0.55 ? 2 : v < 0.8 ? 3 : 4;
}

/** Packs damage into bytes for the network. */
export const packDamage = (d: Float32Array) => Array.from(d, (v) => Math.round(v * 255));
export function unpackDamage(a: unknown, out: Float32Array) {
  if (!Array.isArray(a)) return;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, (Number(a[i]) || 0) / 255));
}
