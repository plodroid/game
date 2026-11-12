import { DEFAULT_CAR, sanitizeCarLoadout, type CarLoadout, type RaceResult } from '@chromashift/shared';

/*
 * A player's VELOCITY data, kept on their profile (and account) next to everything else, under
 * one versioned key so nothing older is touched: saved car builds, lifetime stats, and records per
 * track and per car body. Small numbers and ids only.
 */

export interface RaceStats {
  races: number;
  finished: number;
  wins: number;
  seconds: number;
  thirds: number;
  /** Metres and seconds. */
  distance: number;
  driveTime: number;
  laps: number;
  checkpoints: number;
  collisions: number;
  overtakes: number;
  driftTime: number;
  boosts: number;
  clean: number;
  /** Races counted from verified online results. */
  verified: number;
}

export interface TrackRecord {
  races: number;
  wins: number;
  bestLap: number | null;
  bestRace: number | null;
  bestPos: number | null;
  /** Car body used for the best race. */
  car: string;
}

export interface CarRecord {
  races: number;
  wins: number;
  distance: number;
}

export interface Racing {
  v: 1;
  builds: CarLoadout[];
  active: number;
  stats: RaceStats;
  tracks: Record<string, TrackRecord>;
  cars: Record<string, CarRecord>;
  /** Last race id recorded (stops a reconnect from counting a race twice). */
  last: string;
}

export const MAX_BUILDS = 3;

export const emptyRaceStats = (): RaceStats => ({
  races: 0, finished: 0, wins: 0, seconds: 0, thirds: 0, distance: 0, driveTime: 0, laps: 0, checkpoints: 0, collisions: 0,
  overtakes: 0, driftTime: 0, boosts: 0, clean: 0, verified: 0,
});

export const emptyRacing = (): Racing => ({
  v: 1,
  builds: [{ ...DEFAULT_CAR }, { ...DEFAULT_CAR, body: 'compact', paint: 'teal', finish: 'stripes', accent: 'white', number: 12 }, { ...DEFAULT_CAR, body: 'muscle', paint: 'yellow', accent: 'black', finish: 'stripes', number: 33, rim: 'black' }],
  active: 0,
  stats: emptyRaceStats(),
  tracks: {},
  cars: {},
  last: '',
});

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 36000 ? v : null);

/** Anything stored or synced, made valid. Unknown fields are dropped; nothing valid is lost. */
export function sanitizeRacing(raw: unknown): Racing {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Racing>;
  const out = emptyRacing();
  if (Array.isArray(r.builds) && r.builds.length) out.builds = r.builds.slice(0, MAX_BUILDS).map(sanitizeCarLoadout);
  while (out.builds.length < MAX_BUILDS) out.builds.push({ ...DEFAULT_CAR });
  out.active = Number.isInteger(r.active) && r.active! >= 0 && r.active! < MAX_BUILDS ? r.active! : 0;
  const s = (r.stats ?? {}) as Partial<RaceStats>;
  for (const k of Object.keys(out.stats) as (keyof RaceStats)[]) out.stats[k] = num(s[k]);
  if (r.tracks && typeof r.tracks === 'object')
    for (const [id, t] of Object.entries(r.tracks).slice(0, 80)) {
      if (!t || typeof t !== 'object' || id.length > 40) continue;
      out.tracks[id] = { races: num(t.races), wins: num(t.wins), bestLap: time(t.bestLap), bestRace: time(t.bestRace), bestPos: t.bestPos ? num(t.bestPos) || null : null, car: typeof t.car === 'string' ? t.car.slice(0, 24) : '' };
    }
  if (r.cars && typeof r.cars === 'object')
    for (const [id, c] of Object.entries(r.cars).slice(0, 20)) if (c && typeof c === 'object' && id.length <= 24) out.cars[id] = { races: num(c.races), wins: num(c.wins), distance: num(c.distance) };
  out.last = typeof r.last === 'string' ? r.last.slice(0, 64) : '';
  return out;
}

/** The build the player drives. */
export const activeCar = (r: Racing) => r.builds[r.active] ?? r.builds[0] ?? DEFAULT_CAR;

/** Records a finished race. Returns the new data and any personal records set. */
export function applyRace(prev: Racing, result: RaceResult, you: number, online: boolean, raceId: string): { racing: Racing; records: string[] } {
  const me = result.players.find((p) => p.id === you);
  if (!me || (raceId && prev.last === raceId)) return { racing: prev, records: [] };
  const r: Racing = { ...prev, stats: { ...prev.stats }, tracks: { ...prev.tracks }, cars: { ...prev.cars }, last: raceId };
  const s = r.stats;
  const field = result.players.length;
  s.races++;
  if (online) s.verified++;
  if (me.finished) s.finished++;
  if (me.finished && field > 1) {
    if (me.position === 1) s.wins++;
    if (me.position === 2) s.seconds++;
    if (me.position === 3) s.thirds++;
  }
  s.distance += me.stats.distance;
  s.driveTime += me.time ?? me.laps.reduce((a, b) => a + b, 0);
  s.laps += me.laps.length;
  s.checkpoints += me.laps.length * 8;
  s.collisions += me.stats.collisions;
  s.overtakes += me.stats.overtakes;
  s.driftTime += me.stats.driftTime;
  s.boosts += me.stats.boosts;
  if (me.finished && me.stats.collisions === 0) s.clean++;
  const records: string[] = [];
  const t = { ...(r.tracks[result.track] ?? { races: 0, wins: 0, bestLap: null, bestRace: null, bestPos: null, car: '' }) };
  t.races++;
  if (me.finished && me.position === 1 && field > 1) t.wins++;
  if (me.best && (t.bestLap === null || me.best < t.bestLap)) {
    if (t.bestLap !== null) records.push('New best lap');
    t.bestLap = me.best;
  }
  if (me.finished && me.time && result.laps === 3 && (t.bestRace === null || me.time < t.bestRace)) {
    if (t.bestRace !== null) records.push('New best race time');
    t.bestRace = me.time;
    t.car = me.body;
  }
  if (me.finished && (t.bestPos === null || me.position < t.bestPos)) t.bestPos = me.position;
  r.tracks[result.track] = t;
  const c = { ...(r.cars[me.body] ?? { races: 0, wins: 0, distance: 0 }) };
  c.races++;
  if (me.finished && me.position === 1 && field > 1) c.wins++;
  c.distance += me.stats.distance;
  r.cars[me.body] = c;
  return { racing: r, records };
}

/** Three-way merge for two devices: counts add up, records keep the best, builds follow the side that changed. */
export function mergeRacing(base: Racing, local: Racing, remote: Racing): Racing {
  const add = (b = 0, l = 0, r = 0) => Math.max(0, r + l - b);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const out: Racing = { ...remote, stats: { ...remote.stats }, tracks: { ...remote.tracks }, cars: { ...remote.cars } };
  for (const k of Object.keys(out.stats) as (keyof RaceStats)[]) out.stats[k] = add(base.stats[k], local.stats[k], remote.stats[k]);
  for (const id of new Set([...Object.keys(local.tracks), ...Object.keys(remote.tracks)])) {
    const b = base.tracks[id], l = local.tracks[id], r = remote.tracks[id];
    if (!l || !r) {
      out.tracks[id] = (l ?? r)!;
      continue;
    }
    const min = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.min(x, y));
    out.tracks[id] = {
      races: add(b?.races, l.races, r.races),
      wins: add(b?.wins, l.wins, r.wins),
      bestLap: min(l.bestLap, r.bestLap),
      bestRace: min(l.bestRace, r.bestRace),
      bestPos: min(l.bestPos, r.bestPos),
      car: (l.bestRace ?? Infinity) <= (r.bestRace ?? Infinity) ? l.car : r.car,
    };
  }
  for (const id of new Set([...Object.keys(local.cars), ...Object.keys(remote.cars)])) {
    const b = base.cars[id], l = local.cars[id], r = remote.cars[id];
    out.cars[id] = l && r ? { races: add(b?.races, l.races, r.races), wins: add(b?.wins, l.wins, r.wins), distance: add(b?.distance, l.distance, r.distance) } : (l ?? r)!;
  }
  out.builds = same(local.builds, base.builds) ? remote.builds : local.builds;
  out.active = local.active === base.active ? remote.active : local.active;
  out.last = local.last || remote.last;
  return out;
}

/** The body raced most. */
export function favouriteCar(r: Racing): string | null {
  let best: string | null = null, n = 0;
  for (const [id, c] of Object.entries(r.cars)) if (c.races > n) {
    n = c.races;
    best = id;
  }
  return best;
}

/** The track raced most. */
export function favouriteTrack(r: Racing): string | null {
  let best: string | null = null, n = 0;
  for (const [id, t] of Object.entries(r.tracks)) if (t.races > n) {
    n = t.races;
    best = id;
  }
  return best;
}
