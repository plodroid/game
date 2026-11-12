import { type RoadSurface } from './config';

/*
 * Race tracks. A track is a closed centre line through control points, each with a height, a road
 * half-width, a bank angle and a surface. Built-in tracks are written as turtle segments (straights
 * and turns), editor tracks as raw control points; both become the same sampled `TrackPath`, which
 * everything else uses: physics colliders, rendering, checkpoints, the starting grid, the racing
 * line the bots follow and the minimap.
 */

export type TrackTheme = 'coast' | 'neon' | 'canyon' | 'city' | 'docks' | 'garden' | 'core' | 'arcade' | 'snow' | 'sunset';
export const TRACK_THEMES: TrackTheme[] = ['coast', 'neon', 'canyon', 'city', 'docks', 'garden', 'core', 'arcade', 'snow', 'sunset'];
export const SURFACES: RoadSurface[] = ['asphalt', 'dirt', 'grass', 'sand', 'ice', 'snow', 'metal'];

/** One turtle segment: a straight (`len`) or a turn (`turn` degrees, left positive, radius `r`). */
export interface Seg {
  len?: number;
  turn?: number;
  r?: number;
  /** Height at the end of the segment. */
  y?: number;
  /** Road half-width at the end. */
  w?: number;
  /** Bank in degrees (positive leans into a left turn); turns bank a little by default. */
  bank?: number;
  surf?: RoadSurface;
  tunnel?: boolean;
  /** A row of pickup boxes (Arcade races). */
  items?: boolean;
  /** Tyre stacks and crates on the verges. */
  obstacles?: boolean;
}

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
  /** Road half-width. */
  w: number;
  bank: number;
  surf: RoadSurface;
  tunnel?: boolean;
  items?: boolean;
  obstacles?: boolean;
}

export interface TrackDef {
  id: string;
  name: string;
  description: string;
  theme: TrackTheme;
  /** Suggested laps. */
  laps: number;
  /** Default half-width. */
  width: number;
  /** RoadSurface between the road edge and the wall. */
  verge: RoadSurface;
  /** Verge width, metres. */
  shoulder: number;
  /** Wall height (0 for tyre walls only drawn). */
  wall: number;
  /** Ground height around the track and sea level (null: no sea). */
  ground: number;
  sea: number | null;
  /** Built-in tracks: turtle segments. */
  segs?: Seg[];
  /** Editor tracks: control points. */
  points?: ControlPoint[];
  /** Distance along the first segment where the start line sits. */
  startAt?: number;
  /** Player-made (from the track editor). */
  custom?: boolean;
}

/** Sample spacing along the centre line, metres. */
export const TRACK_DS = 2;
const DEFAULT_BANK = 5;

/** Turtle segments to control points (every ~14 m), with the loop closed exactly. */
export function segsToPoints(def: TrackDef): ControlPoint[] {
  const segs = def.segs ?? [];
  const pts: ControlPoint[] = [];
  let x = 0, z = 0, th = 0, y = 0, w = def.width, bank = 0;
  let surf: RoadSurface = 'asphalt';
  const push = (o: Partial<ControlPoint>) => pts.push({ x, y, z, w, bank, surf, ...o });
  push({});
  for (const s of segs) {
    const y0 = y, w0 = w, b0 = bank;
    const y1 = s.y ?? y, w1 = s.w ?? w;
    surf = s.surf ?? 'asphalt';
    if (s.turn) {
      const r = s.r ?? 40;
      const arc = (Math.abs(s.turn) * Math.PI * r) / 180;
      const steps = Math.max(2, Math.ceil(arc / 12));
      const b1 = s.bank ?? Math.sign(s.turn) * Math.min(12, DEFAULT_BANK + 260 / r);
      const dth = ((s.turn * Math.PI) / 180) / steps;
      for (let i = 1; i <= steps; i++) {
        // Walk the arc as short chords (exact enough at 12 m steps).
        const mid = th + dth * 0.5;
        const chord = 2 * r * Math.sin(Math.abs(dth) / 2);
        x += Math.cos(mid) * chord;
        z -= Math.sin(mid) * chord;
        th += dth;
        const t = i / steps;
        // Bank ramps in over the first third and out over the last third.
        const k = Math.min(1, Math.min(t, 1 - t + 1 / steps) * 3);
        y = y0 + (y1 - y0) * t;
        w = w0 + (w1 - w0) * t;
        bank = i === steps ? 0 : b1 * k;
        push({ tunnel: s.tunnel, items: s.items && i === Math.ceil(steps / 2), obstacles: s.obstacles });
      }
      bank = 0;
    } else {
      const len = s.len ?? 50;
      const steps = Math.max(1, Math.ceil(len / 16));
      for (let i = 1; i <= steps; i++) {
        x += (Math.cos(th) * len) / steps;
        z -= (Math.sin(th) * len) / steps;
        const t = i / steps;
        y = y0 + (y1 - y0) * (t * t * (3 - 2 * t));
        w = w0 + (w1 - w0) * t;
        bank = b0 * (1 - t) + (s.bank ?? 0) * t;
        push({ tunnel: s.tunnel, items: s.items && i === Math.ceil(steps / 2), obstacles: s.obstacles });
      }
    }
  }
  // The last point lands near the first: spread the gap over the whole loop so it closes exactly.
  const last = pts.pop()!;
  const ex = last.x - pts[0].x, ez = last.z - pts[0].z, ey = last.y - pts[0].y;
  let total = 0;
  const along = pts.map((p, i) => (i ? (total += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z)) : 0));
  total += Math.hypot(last.x - pts[pts.length - 1].x, last.z - pts[pts.length - 1].z);
  pts.forEach((p, i) => {
    const f = along[i] / total;
    p.x -= ex * f;
    p.z -= ez * f;
    p.y -= ey * f;
  });
  return pts;
}

export interface Obstacle {
  i: number;
  /** Lateral offset from the centre line (left positive). */
  off: number;
  kind: 'tires' | 'crate' | 'cone';
}

/** A sampled track, everything precomputed. Arrays are indexed by sample. */
export interface TrackPath {
  def: TrackDef;
  n: number;
  length: number;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  /** Unit tangent. */
  tx: Float32Array; ty: Float32Array; tz: Float32Array;
  /** Unit left across the road (banked). */
  lx: Float32Array; ly: Float32Array; lz: Float32Array;
  /** Unit road normal. */
  ux: Float32Array; uy: Float32Array; uz: Float32Array;
  /** Road half-width. */
  w: Float32Array;
  dist: Float32Array;
  /** Signed curvature of the centre line, 1/m (left positive), smoothed. */
  curv: Float32Array;
  surf: Uint8Array;
  tunnel: Uint8Array;
  /** Racing line: lateral offset from the centre (left positive). */
  line: Float32Array;
  /** Fastest sensible speed along the racing line, m/s, for the reference grip. */
  speed: Float32Array;
  /** Sample index of each checkpoint; [0] is the start/finish line. */
  checkpoints: number[];
  /** Six grid slots (row by row) behind the start line. */
  grid: { x: number; y: number; z: number; yaw: number; i: number }[];
  /** Samples with a row of pickups. */
  items: number[];
  obstacles: Obstacle[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
const smooth = (t: number) => t * t * (3 - 2 * t);

export function controlPoints(def: TrackDef): ControlPoint[] {
  return def.points?.length ? def.points : segsToPoints(def);
}

/** Builds the sampled path for a track. Pure maths, the same on every device. */
export function buildPath(def: TrackDef): TrackPath {
  const cp = controlPoints(def);
  const m = cp.length;
  // A dense polyline through the control points (Catmull-Rom), then resampled every TRACK_DS metres.
  const dx: number[] = [], dy: number[] = [], dz: number[] = [], dw: number[] = [], db: number[] = [], dsurf: number[] = [], dtun: number[] = [], dseg: number[] = [];
  const SUB = 16;
  for (let i = 0; i < m; i++) {
    const a = cp[(i - 1 + m) % m], b = cp[i], c = cp[(i + 1) % m], d = cp[(i + 2) % m];
    for (let k = 0; k < SUB; k++) {
      const t = k / SUB;
      dx.push(catmull(a.x, b.x, c.x, d.x, t));
      dz.push(catmull(a.z, b.z, c.z, d.z, t));
      dy.push(catmull(a.y, b.y, c.y, d.y, t));
      const s = smooth(t);
      dw.push(b.w + (c.w - b.w) * s);
      db.push(b.bank + (c.bank - b.bank) * s);
      dsurf.push(SURFACES.indexOf(t < 0.5 ? b.surf : c.surf));
      dtun.push(b.tunnel && (c.tunnel || t < 0.5) ? 1 : 0);
      dseg.push(i);
    }
  }
  const D = dx.length;
  const cum = new Float64Array(D + 1);
  for (let i = 1; i <= D; i++) {
    const j = i % D;
    cum[i] = cum[i - 1] + Math.hypot(dx[j] - dx[i - 1], dy[j] - dy[i - 1], dz[j] - dz[i - 1]);
  }
  const total = cum[D];
  const n = Math.max(32, Math.round(total / TRACK_DS));
  const step = total / n;
  const arr = () => new Float32Array(n);
  const px = arr(), py = arr(), pz = arr(), w = arr(), bank = arr();
  const surf = new Uint8Array(n), tunnel = new Uint8Array(n);
  const segOf = new Int32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (j < D - 1 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    const k = (j + 1) % D;
    px[i] = dx[j] + (dx[k] - dx[j]) * f;
    py[i] = dy[j] + (dy[k] - dy[j]) * f;
    pz[i] = dz[j] + (dz[k] - dz[j]) * f;
    w[i] = dw[j] + (dw[k] - dw[j]) * f;
    bank[i] = db[j] + (db[k] - db[j]) * f;
    surf[i] = Math.max(0, dsurf[j]);
    tunnel[i] = dtun[j];
    segOf[i] = dseg[j];
  }
  // Start line: part-way along the first straight, so the grid sits on a straight.
  const first = def.segs?.[0];
  const startAt = def.startAt ?? (first?.len ? first.len * 0.7 : 0);
  const shift = Math.round(startAt / step) % n;
  const rot = <T extends Float32Array | Uint8Array | Int32Array>(a: T): T => {
    if (!shift) return a;
    const out = a.slice() as T;
    for (let i = 0; i < n; i++) out[i] = a[(i + shift) % n];
    return out;
  };
  const P = {
    px: rot(px), py: rot(py), pz: rot(pz), w: rot(w), bank: rot(bank), surf: rot(surf), tunnel: rot(tunnel), seg: rot(segOf),
  };
  const tx = arr(), ty = arr(), tz = arr(), lx = arr(), ly = arr(), lz = arr(), ux = arr(), uy = arr(), uz = arr();
  const dist = arr(), heading = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let ax = P.px[b] - P.px[a], ay = P.py[b] - P.py[a], az = P.pz[b] - P.pz[a];
    const l = Math.hypot(ax, ay, az) || 1;
    ax /= l;
    ay /= l;
    az /= l;
    tx[i] = ax;
    ty[i] = ay;
    tz[i] = az;
    heading[i] = Math.atan2(-az, ax);
    // Flat left = up × tangent, then banked about the tangent.
    let fx = az, fz = -ax;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const b2 = (P.bank[i] * Math.PI) / 180;
    // Positive bank lowers the left edge (leans into a left turn).
    const c = Math.cos(b2), s = Math.sin(b2);
    // up0 = (0,1,0); left' = left·c − up0·s ... projected so it stays perpendicular to the tangent.
    let qx = fx * c, qy = -s, qz = fz * c;
    const dq = qx * ax + qy * ay + qz * az;
    qx -= dq * ax;
    qy -= dq * ay;
    qz -= dq * az;
    const ql = Math.hypot(qx, qy, qz) || 1;
    lx[i] = qx / ql;
    ly[i] = qy / ql;
    lz[i] = qz / ql;
    // up = tangent × left
    ux[i] = ay * lz[i] - az * ly[i];
    uy[i] = az * lx[i] - ax * lz[i];
    uz[i] = ax * ly[i] - ay * lx[i];
    dist[i] = i * step;
  }
  // Curvature from the change of heading, smoothed over ±6 m.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = heading[(i + 1) % n] - heading[(i - 1 + n) % n];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    raw[i] = d / (2 * step);
  }
  const curv = arr();
  const half = Math.max(1, Math.round(6 / step));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) s += raw[(i + k + n) % n];
    curv[i] = s / (half * 2 + 1);
  }

  const out: TrackPath = {
    def, n, length: total,
    px: P.px, py: P.py, pz: P.pz, tx, ty, tz, lx, ly, lz, ux, uy, uz,
    w: P.w, dist, curv, surf: P.surf, tunnel: P.tunnel,
    line: arr(), speed: arr(),
    checkpoints: [], grid: [], items: [], obstacles: [],
    bounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
  };
  for (let i = 0; i < n; i++) {
    const b = out.bounds, r = P.w[i] + def.shoulder + 2;
    b.minX = Math.min(b.minX, P.px[i] - r);
    b.maxX = Math.max(b.maxX, P.px[i] + r);
    b.minZ = Math.min(b.minZ, P.pz[i] - r);
    b.maxZ = Math.max(b.maxZ, P.pz[i] + r);
    b.minY = Math.min(b.minY, P.py[i]);
    b.maxY = Math.max(b.maxY, P.py[i]);
  }
  racingLine(out);
  speedProfile(out, 11.2, 11);
  // Checkpoints every ~110 m.
  const K = Math.max(6, Math.min(24, Math.round(total / 110)));
  for (let k = 0; k < K; k++) out.checkpoints.push(Math.round((k * n) / K) % n);
  // Grid: two by two, behind the line, staggered.
  for (let g = 0; g < 6; g++) {
    const row = Math.floor(g / 2), side = g % 2 ? -1 : 1;
    const back = 9 + row * 8 + (side < 0 ? 3 : 0);
    const i = (n - Math.round(back / step)) % n;
    const off = side * Math.min(3.4, P.w[i] * 0.45);
    out.grid.push({
      x: P.px[i] + lx[i] * off,
      y: P.py[i] + ly[i] * off,
      z: P.pz[i] + lz[i] * off,
      yaw: Math.atan2(tx[i], tz[i]),
      i,
    });
  }
  // Pickup rows and verge obstacles from the flagged control points.
  const seen = new Set<number>();
  const pts = controlPoints(def);
  for (let i = 0; i < n; i++) {
    const c = pts[P.seg[i]];
    if (c?.items && !seen.has(P.seg[i])) {
      seen.add(P.seg[i]);
      out.items.push(i);
    }
  }
  if (!out.items.length) for (const f of [0.28, 0.55, 0.8]) out.items.push(Math.round(f * n));
  for (let i = 0; i < n; i += 9) {
    const c = pts[P.seg[i]];
    if (!c?.obstacles) continue;
    const side = (i / 9) % 2 ? 1 : -1;
    out.obstacles.push({ i, off: side * (P.w[i] + def.shoulder * 0.55), kind: (['tires', 'crate', 'cone'] as const)[i % 3] });
  }
  return out;
}

/**
 * The racing line: an elastic band pulled tight within the road (a minimum-curvature path),
 * which cuts to the inside of corners and swings wide before and after them.
 */
function racingLine(p: TrackPath) {
  const { n, line } = p;
  const lim = new Float32Array(n);
  for (let i = 0; i < n; i++) lim[i] = Math.max(0, p.w[i] - 1.7);
  const k = Math.max(2, Math.round(10 / TRACK_DS));
  const tx = new Float32Array(n), tz = new Float32Array(n);
  for (let it = 0; it < 160; it++) {
    for (let i = 0; i < n; i++) {
      tx[i] = p.px[i] + p.lx[i] * line[i];
      tz[i] = p.pz[i] + p.lz[i] * line[i];
    }
    for (let i = 0; i < n; i++) {
      const a = (i - k + n) % n, b = (i + k) % n;
      const mx = (tx[a] + tx[b]) / 2 - p.px[i], mz = (tz[a] + tz[b]) / 2 - p.pz[i];
      const lh = Math.hypot(p.lx[i], p.lz[i]) || 1;
      const o = (mx * p.lx[i] + mz * p.lz[i]) / (lh * lh);
      line[i] += (Math.max(-lim[i], Math.min(lim[i], o)) - line[i]) * 0.5;
    }
  }
}

/** Fastest speed along the racing line, braking back from every corner. */
export function speedProfile(p: TrackPath, lateral: number, braking: number, out = p.speed) {
  const { n } = p;
  const x = new Float64Array(n), z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = p.px[i] + p.lx[i] * p.line[i];
    z[i] = p.pz[i] + p.lz[i] * p.line[i];
  }
  const k = Math.max(2, Math.round(8 / TRACK_DS));
  for (let i = 0; i < n; i++) {
    const a = (i - k + n) % n, b = (i + k) % n;
    // Curvature through three points (Menger).
    const ax = x[i] - x[a], az = z[i] - z[a], bx = x[b] - x[i], bz = z[b] - z[i], cx = x[b] - x[a], cz = z[b] - z[a];
    const area2 = Math.abs(ax * bz - az * bx);
    const kappa = (2 * area2) / Math.max(1e-6, Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz));
    // Banking helps: a banked road holds more speed.
    out[i] = Math.min(80, Math.sqrt(lateral / Math.max(1e-4, kappa)));
  }
  const step = p.length / n;
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 0; i--) {
      const next = out[(i + 1) % n];
      out[i] = Math.min(out[i], Math.sqrt(next * next + 2 * braking * step));
    }
  return out;
}

/** Nearest sample to a point, searched near a previous index (cheap, and never jumps between layers). */
export function nearestSample(p: TrackPath, x: number, y: number, z: number, near: number, back = 8, ahead = 14): number {
  const { n } = p;
  let best = near, bd = Infinity;
  for (let k = -back; k <= ahead; k++) {
    const i = (near + k + n) % n;
    const d = (p.px[i] - x) ** 2 + (p.pz[i] - z) ** 2 + ((p.py[i] - y) * 3) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Global nearest sample (for respawns and editor previews). */
export function nearestSampleGlobal(p: TrackPath, x: number, y: number, z: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < p.n; i++) {
    const d = (p.px[i] - x) ** 2 + (p.pz[i] - z) ** 2 + ((p.py[i] - y) * 3) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Signed distance from the centre line at sample i (left positive). */
export function lateralOffset(p: TrackPath, i: number, x: number, y: number, z: number) {
  return (x - p.px[i]) * p.lx[i] + (y - p.py[i]) * p.ly[i] + (z - p.pz[i]) * p.lz[i];
}

export interface TrackProblem {
  text: string;
  at?: { x: number; z: number };
}

/**
 * Checks a track can be raced: long enough, closed, room for six cars on the grid, and no part of
 * the road running into another (crossings need a bridge: at least 6.5 m of height between them).
 */
export function validateTrack(def: TrackDef): TrackProblem[] {
  const out: TrackProblem[] = [];
  const pts = controlPoints(def);
  if (pts.length < 4) return [{ text: 'A track needs at least four points.' }];
  let p: TrackPath;
  try {
    p = buildPath(def);
  } catch {
    return [{ text: 'The track could not be built from these points.' }];
  }
  if (p.length < 300) out.push({ text: `The lap is ${Math.round(p.length)} m. Make it at least 300 m.` });
  if (p.length > 6000) out.push({ text: 'The lap is longer than 6 km.' });
  for (let i = 0; i < p.n; i++) {
    if (p.w[i] < 4.5) {
      out.push({ text: 'The road is narrower than 9 m somewhere; six cars need more room.', at: { x: p.px[i], z: p.pz[i] } });
      break;
    }
  }
  // Steep slopes.
  for (let i = 0; i < p.n; i++) {
    if (Math.abs(p.ty[i]) > 0.3) {
      out.push({ text: 'A slope is steeper than 30%. Spread the climb over a longer stretch.', at: { x: p.px[i], z: p.pz[i] } });
      break;
    }
  }
  // Too-tight corners (cars can't make them).
  for (let i = 0; i < p.n; i++) {
    if (Math.abs(p.curv[i]) > 1 / 11) {
      out.push({ text: 'A corner is tighter than an 11 m radius.', at: { x: p.px[i], z: p.pz[i] } });
      break;
    }
  }
  const overlap = trackOverlap(p);
  if (overlap) out.push({ text: 'Two parts of the road run into each other. Move them apart, or lift one over the other by 7 m for a bridge.', at: overlap });
  return out;
}

/** The first place where two separate stretches of road overlap, or null. */
export function trackOverlap(p: TrackPath): { x: number; z: number } | null {
  const { n } = p;
  const sh = p.def.shoulder + 1.2;
  // Grid hash on x/z for speed.
  const cell = 24;
  const map = new Map<string, number[]>();
  for (let i = 0; i < n; i += 2) {
    const k = `${Math.floor(p.px[i] / cell)},${Math.floor(p.pz[i] / cell)}`;
    (map.get(k) ?? map.set(k, []).get(k)!).push(i);
  }
  const gap = Math.ceil(40 / TRACK_DS);
  for (let i = 0; i < n; i += 2) {
    const cx = Math.floor(p.px[i] / cell), cz = Math.floor(p.pz[i] / cell);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const j of map.get(`${cx + a},${cz + b}`) ?? []) {
          const along = Math.min(Math.abs(i - j), n - Math.abs(i - j));
          if (along < gap) continue;
          const d = Math.hypot(p.px[i] - p.px[j], p.pz[i] - p.pz[j]);
          if (d < p.w[i] + p.w[j] + sh * 2 && Math.abs(p.py[i] - p.py[j]) < 6.5) return { x: p.px[i], z: p.pz[i] };
        }
  }
  return null;
}

/** An untrusted track (editor, clipboard, network) made safe, or null if it can't be a track. */
export function sanitizeTrackDef(raw: unknown): TrackDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<TrackDef> & { kind?: unknown };
  if (r.kind !== undefined && r.kind !== 'track') return null;
  if (!Array.isArray(r.points) || r.points.length < 4 || r.points.length > 160) return null;
  const n = (v: unknown, lo: number, hi: number, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
  };
  const surf = (v: unknown, d: RoadSurface): RoadSurface => (SURFACES.includes(v as RoadSurface) ? (v as RoadSurface) : d);
  const points: ControlPoint[] = r.points.map((p) => {
    const q = (p ?? {}) as Partial<ControlPoint>;
    return {
      x: n(q.x, -1500, 1500, 0),
      y: n(q.y, -20, 60, 0),
      z: n(q.z, -1500, 1500, 0),
      w: n(q.w, 4.5, 14, 7),
      bank: n(q.bank, -18, 18, 0),
      surf: surf(q.surf, 'asphalt'),
      ...(q.tunnel ? { tunnel: true } : {}),
      ...(q.items ? { items: true } : {}),
      ...(q.obstacles ? { obstacles: true } : {}),
    };
  });
  const id = typeof r.id === 'string' && /^[a-z0-9-]{3,32}$/.test(r.id) ? r.id : null;
  if (!id) return null;
  const name = typeof r.name === 'string' ? r.name.replace(/[^\p{L}\p{N} '’!?.,&-]/gu, '').trim().slice(0, 28) || 'My Track' : 'My Track';
  return {
    id,
    name,
    description: typeof r.description === 'string' ? r.description.slice(0, 140) : 'A player-made track.',
    theme: TRACK_THEMES.includes(r.theme as TrackTheme) ? (r.theme as TrackTheme) : 'coast',
    laps: n(r.laps, 1, 10, 3),
    width: 7,
    verge: surf(r.verge, 'grass'),
    shoulder: n(r.shoulder, 1, 6, 3),
    wall: n(r.wall, 0.8, 2, 1.2),
    ground: n(r.ground, -20, 20, 0),
    sea: r.sea === null || r.sea === undefined ? null : n(r.sea, -40, 10, -1.2),
    points,
    startAt: n(r.startAt, 0, 400, 0),
    custom: true,
  };
}
