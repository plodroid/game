export type SpecialId = 'surge' | 'nova' | 'shield' | 'beacon' | 'disrupt';

export interface SpecialDef {
  id: SpecialId;
  name: string;
  description: string;
  duration: number;
  radius: number;
  /** Seconds between activation and effect (telegraphing for fairness). */
  windup: number;
}

export const SPECIALS: Record<SpecialId, SpecialDef> = {
  surge: {
    id: 'surge',
    name: 'Color Surge',
    description: 'Move 35% faster and refill ink twice as fast for 6 seconds.',
    duration: 6,
    radius: 0,
    windup: 0,
  },
  nova: {
    id: 'nova',
    name: 'Paint Nova',
    description: 'After a short charge, burst into a huge paint explosion that damages nearby rivals.',
    duration: 0,
    radius: 5.5,
    windup: 0.55,
  },
  shield: {
    id: 'shield',
    name: 'Shield Burst',
    description: 'Project a dome that blocks rival paint for 7 seconds or until it breaks.',
    duration: 7,
    radius: 3,
    windup: 0,
  },
  beacon: {
    id: 'beacon',
    name: 'Bounce Beacon',
    description: 'Drop a launch pad that springs teammates high into the air for 16 seconds.',
    duration: 16,
    radius: 1.3,
    windup: 0,
  },
  disrupt: {
    id: 'disrupt',
    name: 'Disruption Pulse',
    description: 'A pulse that slows rivals in sight, blocks their paint dive and reveals them.',
    duration: 4.5,
    radius: 10,
    windup: 0.25,
  },
};

export const SPECIAL_IDS = Object.keys(SPECIALS) as SpecialId[];

/** Square metres of fresh territory needed to fill the special meter. */
export const SPECIAL_CHARGE_AREA = 38;
export const SHIELD_HP = 500;
export const NOVA_DAMAGE_MAX = 120;
export const NOVA_DAMAGE_MIN = 45;
export const BEACON_LAUNCH = 17;
export const SURGE_SPEED = 1.35;
export const DISRUPT_SLOW = 0.6;
