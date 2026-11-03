/** Bump whenever the network protocol or simulation rules change incompatibly. */
export const PROTOCOL_VERSION = 1;
export const GAME_VERSION = '0.1.0';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const INPUT_SEND_RATE = 30;

export const MAX_PLAYERS = 8;
export const TEAM_SIZE = 4;
export const DEFAULT_PORT = 2567;
export const ROOM_NAME = 'arena';

/** Target edge length of one paint-ownership cell, metres. */
export const PAINT_CELL = 0.4;
/** Cell values in the paint grid. */
export const CELL_EMPTY = 0;
export const CELL_BLOCKED = 255;

export const PLAYER_RADIUS = 0.4;
export const PLAYER_HALF_HEIGHT = 0.5;
/** Distance from capsule centre down to the feet. */
export const FEET_OFFSET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;

export const MAX_HP = 100;
export const MAX_INK = 100;
export const GRAVITY = 24;

export type Team = 0 | 1;
