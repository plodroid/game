export type ModeId = 'turf' | 'zones' | 'knockout' | 'practice' | 'blitz' | 'rush' | 'suddendeath' | 'brawl';
/** The rule set a mode plays by. */
export type ModeKind = 'turf' | 'zones' | 'knockout' | 'practice';

export interface ModeDef {
  id: ModeId;
  kind: ModeKind;
  /** Zones: seconds each team must hold. Knockout: tickets per team. */
  counter?: number;
  name: string;
  description: string;
  /** Default match length in seconds. 0 = untimed. */
  duration: number;
  respawnTime: number;
}

export const MODES: Record<ModeId, ModeDef> = {
  turf: {
    id: 'turf',
    kind: 'turf',
    name: 'Turf Control',
    description: 'Cover the most floor with your colour before time runs out.',
    duration: 180,
    respawnTime: 4,
  },
  zones: {
    id: 'zones',
    kind: 'zones',
    name: 'Zone Control',
    description: 'Paint the marked zones to hold them. Holding counts your timer down — reach zero to win.',
    duration: 240,
    respawnTime: 5,
  },
  knockout: {
    id: 'knockout',
    kind: 'knockout',
    name: 'Knockout',
    description: 'Each team shares respawn tickets. Run the rivals out of tickets, then splat the rest.',
    duration: 240,
    respawnTime: 5,
  },
  practice: {
    id: 'practice',
    kind: 'practice',
    name: 'Practice',
    description: 'Free roam with training targets. No timer, no pressure.',
    duration: 0,
    respawnTime: 1.5,
  },
  blitz: {
    id: 'blitz',
    kind: 'turf',
    name: 'Turf Blitz',
    description: 'A 90-second turf sprint with near-instant respawns. Paint fast, splat faster.',
    duration: 90,
    respawnTime: 2,
  },
  rush: {
    id: 'rush',
    kind: 'zones',
    counter: 50,
    name: 'Zone Rush',
    description: 'Zone Control with half the hold time. Grab the zones early and keep them.',
    duration: 150,
    respawnTime: 4,
  },
  suddendeath: {
    id: 'suddendeath',
    kind: 'knockout',
    counter: 3,
    name: 'Sudden Death',
    description: 'Only three respawn tickets per team. Every splat counts.',
    duration: 180,
    respawnTime: 5,
  },
  brawl: {
    id: 'brawl',
    kind: 'knockout',
    counter: 30,
    name: 'Brawl',
    description: 'Thirty tickets per team and a long clock: a big, messy fight.',
    duration: 300,
    respawnTime: 3,
  },
};

export const kindOf = (mode: string): ModeKind => MODES[mode as ModeId]?.kind ?? 'turf';

export const MODE_IDS = Object.keys(MODES) as ModeId[];
export const ZONE_TARGET = 100;
export const ZONE_CAPTURE_SHARE = 0.6;
export const KNOCKOUT_TICKETS = 12;
/** Match lengths a host can pick, 1 to 10 minutes; 0 means no time limit. */
export const DURATION_OPTIONS = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 0];

export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard', 'expert'];
