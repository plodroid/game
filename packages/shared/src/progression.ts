import { ACCENTS, EMOTES, HAIR, HEADGEAR, OUTFITS, type CosmeticOption } from './config/cosmetics';
import type { MatchResult } from './sim/simulation';

export const MAX_MATCH_XP = 1200;

/** XP for one match. Shared so the server (verified) and the client (offline) agree. */
export function xpForMatch(result: MatchResult, playerId: number): number {
  const p = result.players.find((x) => x.id === playerId);
  if (!p || result.mode === 'practice') return 0;
  const win = result.winner === p.team;
  const xp = 100 + p.paint * 1 + p.kills * 25 + p.assists * 10 + (win ? 150 : 0);
  return Math.min(MAX_MATCH_XP, Math.round(xp));
}

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => 500 + 150 * (level - 1);

export function levelInfo(totalXp: number) {
  let level = 1, rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpToNext(level) && level < 99) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, needed: xpToNext(level), progress: rest / xpToNext(level) };
}

const ALL: [string, CosmeticOption[]][] = [
  ['Hair', HAIR],
  ['Headgear', HEADGEAR],
  ['Outfit', OUTFITS],
  ['Accent', ACCENTS],
  ['Emote', EMOTES],
];

/** Cosmetics that unlock exactly at `level`. */
export function unlocksAt(level: number) {
  return ALL.flatMap(([cat, list]) => list.filter((o) => o.level === level).map((o) => ({ category: cat, ...o })));
}

export const isUnlocked = (o: CosmeticOption, level: number) => level >= o.level;
