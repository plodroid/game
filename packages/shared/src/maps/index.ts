import { CORE } from './core';
import { FLOAT } from './float';
import { SKYLINE } from './skyline';
import type { MapDef, MapId } from './types';

export const MAPS: Record<MapId, MapDef> = { skyline: SKYLINE, core: CORE, float: FLOAT };
export const MAP_IDS = Object.keys(MAPS) as MapId[];
export * from './types';
