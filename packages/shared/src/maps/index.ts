import { CORE } from './core';
import { FLOAT } from './float';
import { ARCADE, CANYON, DOCKS, GARDENS } from './more';
import { SKYLINE } from './skyline';
import type { BuiltinMapId, MapDef, MapId } from './types';

/** Every playable map; player-made ones are added here as they are loaded. */
export const MAPS: Record<MapId, MapDef> = { skyline: SKYLINE, core: CORE, float: FLOAT, docks: DOCKS, gardens: GARDENS, canyon: CANYON, arcade: ARCADE };
/** The built-in maps only. */
export const MAP_IDS = Object.keys(MAPS) as BuiltinMapId[];
export * from './types';
