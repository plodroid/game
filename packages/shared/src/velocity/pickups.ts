/*
 * Arcade pickups. Every box gives one item, chosen with odds that depend on race position: the
 * leader mostly gets defensive items, cars at the back get more help. The host decides everything;
 * clients only show it.
 */

export const ITEMS = ['turbo', 'shield', 'slick', 'shock', 'repair', 'slipstream', 'decoy'] as const;
export type ItemId = (typeof ITEMS)[number];

export const ITEM_INFO: Record<ItemId, { name: string; text: string }> = {
  turbo: { name: 'Turbo Burst', text: 'A strong push of speed for two seconds.' },
  shield: { name: 'Prism Shield', text: 'Bumps can’t hurt you for five seconds, and you shove others aside.' },
  slick: { name: 'Paint Slick', text: 'Drops a slippery splat behind you. Cars that hit it lose grip for a moment.' },
  shock: { name: 'Shockwave', text: 'Pushes nearby cars away from you.' },
  repair: { name: 'Repair Burst', text: 'Fixes some of your car’s damage.' },
  slipstream: { name: 'Slipstream Charge', text: 'For six seconds, following close behind another car gives you extra speed.' },
  decoy: { name: 'Decoy Beacon', text: 'Leaves a fake pickup box. Whoever drives into it gets bounced and loses their item.' },
};

/** Odds per item by place in the field (0 = leading, 1 = last). */
export function rollItem(place: number, rnd: number): ItemId {
  const t = Math.max(0, Math.min(1, place));
  const w: Record<ItemId, number> = {
    turbo: 1 + 3 * t,
    shield: 2.2 - t,
    slick: 2.4 - 1.6 * t,
    shock: 0.4 + 1.8 * t,
    repair: 1.2,
    slipstream: 0.6 + 2.2 * t,
    decoy: 2 - 1.5 * t,
  };
  const total = ITEMS.reduce((s, i) => s + w[i], 0);
  let r = rnd * total;
  for (const i of ITEMS) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return 'turbo';
}

/** Seconds a taken box stays away. */
export const BOX_RESPAWN = 4;
export const SLICK_LIFE = 14;
export const DECOY_LIFE = 25;
export const SHOCK_RADIUS = 14;
