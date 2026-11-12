import { WEAPONS, type WeaponKind } from './config/weapons';
import type { ModeId } from './config/modes';
import { hash2 } from './rng';
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

/* ---------- Coins ---------- */

/** Coins every match pays: an eighth of its XP. */
export const coinsForXp = (xp: number) => Math.round(xp / 8);
/** Bonus coins for each level reached. */
export const LEVEL_COINS = 300;
/** What a new account starts with, enough for a first purchase. */
export const STARTING_COINS = 500;

/** Coins earned by going from `xpBefore` to `xpAfter`: the match share plus level-up bonuses. */
export function coinsEarned(xpBefore: number, xpAfter: number) {
  const levels = levelInfo(xpAfter).level - levelInfo(xpBefore).level;
  return coinsForXp(xpAfter - xpBefore) + levels * LEVEL_COINS;
}

/* ---------- Quests ---------- */

export type QuestStat =
  | 'matches' | 'wins' | 'paint' | 'kills' | 'assists' | `kind:${WeaponKind}` | `mode:${ModeId}`
  | 'races' | 'raceWins' | 'podiums' | 'overtakes' | 'driftTime';

export interface Quest {
  id: string;
  text: string;
  stat: QuestStat;
  goal: number;
  reward: number;
}

const DAILY: Quest[] = [
  { id: 'd-play', text: 'Play 3 matches', stat: 'matches', goal: 3, reward: 120 },
  { id: 'd-win', text: 'Win 2 matches', stat: 'wins', goal: 2, reward: 160 },
  { id: 'd-paint', text: 'Paint 1,500 points of turf', stat: 'paint', goal: 1500, reward: 140 },
  { id: 'd-splat', text: 'Splat 12 rivals', stat: 'kills', goal: 12, reward: 160 },
  { id: 'd-assist', text: 'Get 8 assists', stat: 'assists', goal: 8, reward: 130 },
  { id: 'd-roller', text: 'Play 2 matches with a roller', stat: 'kind:roller', goal: 2, reward: 120 },
  { id: 'd-burst', text: 'Play 2 matches with a blaster', stat: 'kind:burst', goal: 2, reward: 120 },
  { id: 'd-lobber', text: 'Play 2 matches with a lobber', stat: 'kind:lobber', goal: 2, reward: 120 },
  { id: 'd-dual', text: 'Play 2 matches with duals', stat: 'kind:dual', goal: 2, reward: 120 },
  { id: 'd-auto', text: 'Play 2 matches with a sprayer', stat: 'kind:auto', goal: 2, reward: 120 },
  { id: 'd-zones', text: 'Play a Zones match', stat: 'mode:zones', goal: 1, reward: 110 },
  { id: 'd-knock', text: 'Play a Knockout match', stat: 'mode:knockout', goal: 1, reward: 110 },
];

const WEEKLY: Quest[] = [
  { id: 'w-play', text: 'Play 20 matches', stat: 'matches', goal: 20, reward: 700 },
  { id: 'w-win', text: 'Win 12 matches', stat: 'wins', goal: 12, reward: 900 },
  { id: 'w-paint', text: 'Paint 12,000 points of turf', stat: 'paint', goal: 12000, reward: 800 },
  { id: 'w-splat', text: 'Splat 80 rivals', stat: 'kills', goal: 80, reward: 900 },
  { id: 'w-assist', text: 'Get 40 assists', stat: 'assists', goal: 40, reward: 700 },
  { id: 'w-zones', text: 'Play 6 Zones matches', stat: 'mode:zones', goal: 6, reward: 650 },
  { id: 'w-knock', text: 'Play 6 Knockout matches', stat: 'mode:knockout', goal: 6, reward: 650 },
  { id: 'w-roller', text: 'Play 8 matches with a roller', stat: 'kind:roller', goal: 8, reward: 650 },
  { id: 'w-lobber', text: 'Play 8 matches with a lobber', stat: 'kind:lobber', goal: 8, reward: 650 },
];

/** VELOCITY quests: one extra daily and weekly slot, so the shooter's three stay exactly as they were. */
const RACE_DAILY: Quest[] = [
  { id: 'd-race', text: 'Finish 2 VELOCITY races', stat: 'races', goal: 2, reward: 140 },
  { id: 'd-podium', text: 'Finish a VELOCITY race in the top 3', stat: 'podiums', goal: 1, reward: 160 },
  { id: 'd-overtake', text: 'Overtake 10 cars in VELOCITY', stat: 'overtakes', goal: 10, reward: 140 },
  { id: 'd-drift', text: 'Drift for 30 seconds in VELOCITY', stat: 'driftTime', goal: 30, reward: 130 },
];
const RACE_WEEKLY: Quest[] = [
  { id: 'w-race', text: 'Finish 12 VELOCITY races', stat: 'races', goal: 12, reward: 700 },
  { id: 'w-racewin', text: 'Win 4 VELOCITY races', stat: 'raceWins', goal: 4, reward: 850 },
  { id: 'w-podium', text: 'Get 8 VELOCITY podiums', stat: 'podiums', goal: 8, reward: 750 },
];

const DAY = 86_400_000;
/** UTC day number; quests turn over at midnight UTC so everyone shares the same set. */
export const dayIndex = (now = Date.now()) => Math.floor(now / DAY);
/** Weeks start on Monday (day 0 of the epoch was a Thursday). */
export const weekIndex = (now = Date.now()) => Math.floor((dayIndex(now) + 3) / 7);
export const dayEndsAt = (now = Date.now()) => (dayIndex(now) + 1) * DAY;
export const weekEndsAt = (now = Date.now()) => ((weekIndex(now) + 1) * 7 - 3) * DAY;

const idHash = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** A stable shuffle of the pool for this period, so every player gets the same quests. */
function pick(pool: Quest[], n: number, seed: number) {
  const order = (q: Quest) => hash2(seed, idHash(q.id));
  return [...pool].sort((a, b) => order(a) - order(b)).slice(0, n);
}

export const dailyQuests = (day = dayIndex()) => [...pick(DAILY, 3, day * 2 + 1), ...pick(RACE_DAILY, 1, day * 2 + 1)];
export const weeklyQuests = (week = weekIndex()) => [...pick(WEEKLY, 3, week * 2 + 2), ...pick(RACE_WEEKLY, 1, week * 2 + 2)];

/** How much one VELOCITY race moves each quest stat. */
export function raceQuestProgress(r: { players: { id: number; position: number; finished: boolean; stats: { overtakes: number; driftTime: number } }[] }, playerId: number): Partial<Record<QuestStat, number>> {
  const p = r.players.find((x) => x.id === playerId);
  if (!p) return {};
  const field = r.players.length;
  return {
    races: p.finished ? 1 : 0,
    raceWins: p.finished && p.position === 1 && field > 1 ? 1 : 0,
    podiums: p.finished && p.position <= 3 && field > 1 ? 1 : 0,
    overtakes: Math.min(20, p.stats.overtakes),
    driftTime: Math.round(p.stats.driftTime),
  };
}

/** How much one match moves each quest stat. */
export function questProgress(result: MatchResult, playerId: number): Partial<Record<QuestStat, number>> {
  const p = result.players.find((x) => x.id === playerId);
  if (!p || result.mode === 'practice') return {};
  return {
    matches: 1,
    wins: result.winner === p.team ? 1 : 0,
    paint: Math.round(p.paint),
    kills: p.kills,
    assists: p.assists,
    [`kind:${WEAPONS[p.weapon]?.kind ?? 'auto'}`]: 1,
    [`mode:${result.mode}`]: 1,
  };
}
