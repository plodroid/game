import { describe, expect, it } from 'vitest';
import { COSMETIC_ITEMS, itemsFor, sanitizeCosmetics, botLook, type Slot } from './cosmetics';

describe('catalogue', () => {
  it('has unique, short keys and roughly 300 items in the big shelves', () => {
    const keys = COSMETIC_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of COSMETIC_ITEMS) expect(i.id.length).toBeLessThanOrEqual(24);
    for (const s of ['headgear', 'face', 'back', 'outfit', 'accent', 'hairColor', 'title', 'banner', 'finish'] as Exclude<Slot, 'weapon'>[])
      expect(itemsFor(s).length, s).toBeGreaterThanOrEqual(280);
  });
  it('keeps the emote wheel valid, and old styled emotes mean their move', () => {
    expect(itemsFor('emote').length).toBeGreaterThanOrEqual(50);
    const c = sanitizeCosmetics({ emotes: ['wave-spin', 'nope', 'backflip'] } as never);
    expect(c.emotes).toEqual(['wave', '', 'backflip', '', '', '', '', '']);
    expect(c.emote).toBe('wave');
    expect(sanitizeCosmetics(botLook(3)).emotes!.length).toBe(8);
  });
});
