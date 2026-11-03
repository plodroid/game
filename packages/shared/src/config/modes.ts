export type ModeId = 'turf' | 'zones' | 'knockout' | 'practice';

export interface ModeDef {
  id: ModeId;
  name: string;
  description: string;
  /** Default match length in seconds. 0 = untimed. */
  duration: number;
  respawnTime: number;
}

export const MODES: Record<ModeId, ModeDef> = {
  turf: {
    id: 'turf',
    name: 'Turf Control',
    description: 'Cover the most floor with your colour before time runs out.',
    duration: 180,
    respawnTime: 4,
  },
  zones: {
    id: 'zones',
    name: 'Zone Control',
    description: 'Paint the marked zones to hold them. Holding counts your timer down — reach zero to win.',
    duration: 240,
    respawnTime: 5,
  },
  knockout: {
    id: 'knockout',
    name: 'Knockout',
    description: 'Each team shares respawn tickets. Run the rivals out of tickets, then splat the rest.',
    duration: 240,
    respawnTime: 5,
  },
  practice: {
    id: 'practice',
    name: 'Practice',
    description: 'Free roam with training targets. No timer, no pressure.',
    duration: 0,
    respawnTime: 1.5,
  },
};

export const MODE_IDS = Object.keys(MODES) as ModeId[];
export const ZONE_TARGET = 100;
export const ZONE_CAPTURE_SHARE = 0.6;
export const KNOCKOUT_TICKETS = 12;
export const DURATION_OPTIONS = [60, 120, 180, 240, 300];

export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard', 'expert'];
