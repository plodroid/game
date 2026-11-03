export interface CosmeticOption {
  id: string;
  name: string;
  /** Player level that unlocks it. */
  level: number;
}

export const HAIR: CosmeticOption[] = [
  { id: 'fin', name: 'Crest Fin', level: 1 },
  { id: 'spikes', name: 'Prism Spikes', level: 1 },
  { id: 'bob', name: 'Gloss Bob', level: 2 },
  { id: 'tails', name: 'Twin Drips', level: 4 },
  { id: 'mohawk', name: 'Ridge', level: 7 },
];

export const HEADGEAR: CosmeticOption[] = [
  { id: 'none', name: 'None', level: 1 },
  { id: 'cap', name: 'Rooftop Cap', level: 1 },
  { id: 'phones', name: 'Studio Phones', level: 3 },
  { id: 'visor', name: 'Shift Visor', level: 5 },
  { id: 'beanie', name: 'Knit Beanie', level: 6 },
  { id: 'halo', name: 'Chroma Halo', level: 10 },
];

export const OUTFITS: CosmeticOption[] = [
  { id: 'jacket', name: 'Track Jacket', level: 1 },
  { id: 'hoodie', name: 'Splash Hoodie', level: 2 },
  { id: 'vest', name: 'Utility Vest', level: 4 },
  { id: 'suit', name: 'Flow Suit', level: 8 },
];

export const ACCENTS: CosmeticOption[] = [
  { id: 'graphite', name: 'Graphite', level: 1 },
  { id: 'cream', name: 'Cream', level: 1 },
  { id: 'cobalt', name: 'Cobalt', level: 3 },
  { id: 'forest', name: 'Forest', level: 5 },
  { id: 'gold', name: 'Gold', level: 9 },
];

export const ACCENT_COLORS: Record<string, number> = {
  graphite: 0x2a2d3a,
  cream: 0xf2ead8,
  cobalt: 0x2f4fd8,
  forest: 0x1f6b4a,
  gold: 0xd9a21b,
};

export const SKIN_TONES = [0xf6d3b8, 0xe7b48f, 0xc98b62, 0x9a6440, 0x6b4128, 0x8fd0c8];

export const EMOTES: CosmeticOption[] = [
  { id: 'wave', name: 'Wave', level: 1 },
  { id: 'spin', name: 'Spin', level: 2 },
  { id: 'flex', name: 'Flex', level: 5 },
  { id: 'dance', name: 'Shuffle', level: 8 },
];

export interface Cosmetics {
  hair: string;
  headgear: string;
  outfit: string;
  accent: string;
  skin: number;
  emote: string;
}

export const DEFAULT_COSMETICS: Cosmetics = {
  hair: 'fin',
  headgear: 'none',
  outfit: 'jacket',
  accent: 'graphite',
  skin: 1,
  emote: 'wave',
};

const pick = (list: CosmeticOption[], id: unknown, fallback: string) =>
  typeof id === 'string' && list.some((o) => o.id === id) ? id : fallback;

/** Coerces untrusted cosmetics (network/storage) into a valid set. */
export function sanitizeCosmetics(c: Partial<Cosmetics> | undefined): Cosmetics {
  const d = DEFAULT_COSMETICS;
  const skin = Number(c?.skin);
  return {
    hair: pick(HAIR, c?.hair, d.hair),
    headgear: pick(HEADGEAR, c?.headgear, d.headgear),
    outfit: pick(OUTFITS, c?.outfit, d.outfit),
    accent: pick(ACCENTS, c?.accent, d.accent),
    skin: Number.isInteger(skin) && skin >= 0 && skin < SKIN_TONES.length ? skin : d.skin,
    emote: pick(EMOTES, c?.emote, d.emote),
  };
}
