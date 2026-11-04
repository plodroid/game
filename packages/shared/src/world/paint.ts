import { CELL_BLOCKED, CELL_EMPTY, PAINT_CELL, type Team } from '../constants';
import type { Block, MapDef } from '../maps/types';
import { blockAxes, dot, v3, type Vec3 } from '../vec';

/** One paintable rectangular face. Cells are laid out row-major (u fastest). */
export interface Surface {
  id: number;
  block: number;
  /** Index into blockFaces() of its block. */
  face: number;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  uLen: number;
  vLen: number;
  cols: number;
  rows: number;
  cu: number;
  cv: number;
  cellArea: number;
  offset: number;
  /** Floors and ramps count towards territory; walls are paintable but not scored. */
  scoring: boolean;
  /** Atlas rectangle origin in cells. The surface occupies (ax+1 .. ax+cols, ay+1 .. ay+rows). */
  ax: number;
  ay: number;
  min: Vec3;
  max: Vec3;
}

/** Atlas width in cells. Rendering multiplies this by its texels-per-cell factor. */
export const ATLAS_COLS = 256;
const HASH_CELL = 4;

// [normal axis, sign, u axis, u sign, v axis, v sign]. The last (-Y) face is render-only, never painted.
const FACE_DEFS = [
  [1, 1, 0, 1, 2, -1],
  [0, 1, 2, -1, 1, 1],
  [0, -1, 2, 1, 1, 1],
  [2, 1, 0, 1, 1, 1],
  [2, -1, 0, -1, 1, 1],
  [1, -1, 0, 1, 2, 1],
] as const;
export const PAINTABLE_FACES = 5;

export interface FaceFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  uLen: number;
  vLen: number;
}

/** The six faces of a block as rectangles: P(u, v) = origin + u·U + v·V, with U × V = N. */
export function blockFaces(b: Block): FaceFrame[] {
  const A = blockAxes(b.yaw, b.pitch);
  return FACE_DEFS.map(([a, s, ua, us, va, vs]) => {
    const nA = A[a], uA = A[ua], vA = A[va];
    const n = v3(nA.x * s, nA.y * s, nA.z * s);
    const u = v3(uA.x * us, uA.y * us, uA.z * us);
    const v = v3(vA.x * vs, vA.y * vs, vA.z * vs);
    const ha = halfOf(b, a), hu = halfOf(b, ua), hv = halfOf(b, va);
    const origin = v3(
      b.c.x + n.x * ha - u.x * hu - v.x * hv,
      b.c.y + n.y * ha - u.y * hu - v.y * hv,
      b.c.z + n.z * ha - u.z * hu - v.z * hv,
    );
    return { origin, u, v, n, uLen: hu * 2, vLen: hv * 2 };
  });
}

const halfOf = (b: Block, i: number) => (i === 0 ? b.h.x : i === 1 ? b.h.y : b.h.z);

function insideBlock(p: Vec3, b: Block, axes: Vec3[], eps: number): boolean {
  const dx = p.x - b.c.x, dy = p.y - b.c.y, dz = p.z - b.c.z;
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    if (Math.abs(dx * a.x + dy * a.y + dz * a.z) > halfOf(b, i) - eps) return false;
  }
  return true;
}

export class PaintGrid {
  readonly surfaces: Surface[] = [];
  readonly cells: Uint8Array;
  readonly totalScoringArea: number;
  readonly atlasRows: number;
  /** Scored area currently held by each team (m²). */
  readonly teamArea = [0, 0];
  /** Cell indices covered by each objective zone, plus the zone's scoring area. */
  readonly zoneCells: { cells: Int32Array; area: number }[] = [];
  private hash = new Map<number, number[]>();
  private seen: Int32Array;
  private stamp = 0;
  private blockedTemplate: Uint8Array;

  constructor(map: MapDef) {
    const axesOf = map.blocks.map((b) => blockAxes(b.yaw, b.pitch));
    const solidIdx = map.blocks.map((b, i) => (b.solid ? i : -1)).filter((i) => i >= 0);
    // Coarse AABBs for the occlusion broad-phase.
    const boxMin = map.blocks.map((b, i) => {
      const r = Math.abs(axesOf[i][0].x) * b.h.x + Math.abs(axesOf[i][1].x) * b.h.y + Math.abs(axesOf[i][2].x) * b.h.z;
      const ry = Math.abs(axesOf[i][0].y) * b.h.x + Math.abs(axesOf[i][1].y) * b.h.y + Math.abs(axesOf[i][2].y) * b.h.z;
      const rz = Math.abs(axesOf[i][0].z) * b.h.x + Math.abs(axesOf[i][1].z) * b.h.y + Math.abs(axesOf[i][2].z) * b.h.z;
      return [b.c.x - r, b.c.y - ry, b.c.z - rz, b.c.x + r, b.c.y + ry, b.c.z + rz];
    });
    const occluded = (p: Vec3, self: number) => {
      for (const j of solidIdx) {
        if (j === self) continue;
        const bb = boxMin[j];
        if (p.x < bb[0] || p.y < bb[1] || p.z < bb[2] || p.x > bb[3] || p.y > bb[4] || p.z > bb[5]) continue;
        if (insideBlock(p, map.blocks[j], axesOf[j], 0.005)) return true;
      }
      return false;
    };

    let offset = 0;
    const blockedList: number[] = [];
    map.blocks.forEach((b, bi) => {
      if (!b.paint || !b.visible) return;
      const faces = blockFaces(b);
      for (let fi = 0; fi < PAINTABLE_FACES; fi++) {
        const { origin, u, v, n, uLen, vLen } = faces[fi];
        const cols = Math.max(1, Math.round(uLen / PAINT_CELL));
        const rows = Math.max(1, Math.round(vLen / PAINT_CELL));
        if (cols + 2 > ATLAS_COLS) throw new Error(`Surface too wide for paint atlas on map ${map.id}`);
        const cu = uLen / cols, cv = vLen / rows;
        // Occlusion: a cell is dead if something solid sits on it or hangs just above it.
        const blocked: number[] = [];
        const q = v3();
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++) {
            const pu = (i + 0.5) * cu, pv = (j + 0.5) * cv;
            let dead = false;
            for (const lift of [0.06, 0.35]) {
              q.x = origin.x + u.x * pu + v.x * pv + n.x * lift;
              q.y = origin.y + u.y * pu + v.y * pv + n.y * lift;
              q.z = origin.z + u.z * pu + v.z * pv + n.z * lift;
              if (occluded(q, bi)) dead = true;
            }
            if (dead) blocked.push(j * cols + i);
          }
        if (blocked.length === cols * rows) continue;
        const corners = [0, 1].flatMap((i) =>
          [0, 1].map((j) => v3(origin.x + u.x * uLen * i + v.x * vLen * j, origin.y + u.y * uLen * i + v.y * vLen * j, origin.z + u.z * uLen * i + v.z * vLen * j)),
        );
        const min = v3(Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.y)), Math.min(...corners.map((c) => c.z)));
        const max = v3(Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.z)));
        const id = this.surfaces.length;
        this.surfaces.push({
          id, block: bi, face: fi, origin, u, v, n, uLen, vLen, cols, rows, cu, cv,
          cellArea: cu * cv, offset, scoring: n.y > 0.6, ax: 0, ay: 0, min, max,
        });
        for (const k of blocked) blockedList.push(offset + k);
        offset += cols * rows;
      }
    });

    this.cells = new Uint8Array(offset);
    for (const k of blockedList) this.cells[k] = CELL_BLOCKED;
    this.blockedTemplate = this.cells.slice();
    this.seen = new Int32Array(this.surfaces.length);

    let total = 0;
    for (const s of this.surfaces) {
      if (!s.scoring) continue;
      for (let k = 0; k < s.cols * s.rows; k++) if (this.cells[s.offset + k] !== CELL_BLOCKED) total += s.cellArea;
    }
    this.totalScoringArea = total;
    this.atlasRows = this.packAtlas();
    this.buildHash();

    for (const z of map.zones) {
      const list: number[] = [];
      let area = 0;
      for (const s of this.surfaces) {
        if (!s.scoring) continue;
        for (let j = 0; j < s.rows; j++)
          for (let i = 0; i < s.cols; i++) {
            const k = s.offset + j * s.cols + i;
            if (this.cells[k] === CELL_BLOCKED) continue;
            const pu = (i + 0.5) * s.cu, pv = (j + 0.5) * s.cv;
            const x = s.origin.x + s.u.x * pu + s.v.x * pv;
            const y = s.origin.y + s.u.y * pu + s.v.y * pv;
            const zz = s.origin.z + s.u.z * pu + s.v.z * pv;
            if (Math.abs(x - z.c.x) <= z.h.x && Math.abs(y - z.c.y) <= z.h.y && Math.abs(zz - z.c.z) <= z.h.z) {
              list.push(k);
              area += s.cellArea;
            }
          }
      }
      this.zoneCells.push({ cells: Int32Array.from(list), area });
    }
  }

  /** Shelf-pack surfaces into an ATLAS_COLS-wide atlas with a 1-cell border each. */
  private packAtlas(): number {
    const order = [...this.surfaces].sort((a, b) => b.rows - a.rows);
    let x = 0, y = 0, shelf = 0;
    for (const s of order) {
      const w = s.cols + 2, h = s.rows + 2;
      if (x + w > ATLAS_COLS) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      s.ax = x;
      s.ay = y;
      x += w;
      shelf = Math.max(shelf, h);
    }
    return y + shelf;
  }

  private buildHash() {
    for (const s of this.surfaces) {
      const x0 = Math.floor((s.min.x - 0.2) / HASH_CELL), x1 = Math.floor((s.max.x + 0.2) / HASH_CELL);
      const y0 = Math.floor((s.min.y - 0.2) / HASH_CELL), y1 = Math.floor((s.max.y + 0.2) / HASH_CELL);
      const z0 = Math.floor((s.min.z - 0.2) / HASH_CELL), z1 = Math.floor((s.max.z + 0.2) / HASH_CELL);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            const key = hashKey(x, y, z);
            let list = this.hash.get(key);
            if (!list) this.hash.set(key, (list = []));
            list.push(s.id);
          }
    }
  }

  /** Calls cb for every surface whose plane passes within r of center, front side only. */
  forEachSurfaceInSphere(c: Vec3, r: number, cb: (s: Surface, u0: number, v0: number, rr: number) => void) {
    const stamp = ++this.stamp;
    const x0 = Math.floor((c.x - r) / HASH_CELL), x1 = Math.floor((c.x + r) / HASH_CELL);
    const y0 = Math.floor((c.y - r) / HASH_CELL), y1 = Math.floor((c.y + r) / HASH_CELL);
    const z0 = Math.floor((c.z - r) / HASH_CELL), z1 = Math.floor((c.z + r) / HASH_CELL);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = this.hash.get(hashKey(x, y, z));
          if (!list) continue;
          for (const id of list) {
            if (this.seen[id] === stamp) continue;
            this.seen[id] = stamp;
            const s = this.surfaces[id];
            if (c.x < s.min.x - r || c.x > s.max.x + r || c.y < s.min.y - r || c.y > s.max.y + r || c.z < s.min.z - r || c.z > s.max.z + r) continue;
            const dx = c.x - s.origin.x, dy = c.y - s.origin.y, dz = c.z - s.origin.z;
            const d = dx * s.n.x + dy * s.n.y + dz * s.n.z;
            // Behind the face (other side of a wall) or out of reach.
            if (d < -0.2 || d > r) continue;
            const rr = d > 0 ? Math.sqrt(r * r - d * d) : r;
            const u0 = dx * s.u.x + dy * s.u.y + dz * s.u.z;
            const v0 = dx * s.v.x + dy * s.v.y + dz * s.v.z;
            if (u0 < -rr || v0 < -rr || u0 > s.uLen + rr || v0 > s.vLen + rr) continue;
            cb(s, u0, v0, rr);
          }
        }
  }

  /**
   * Paints a sphere for a team. Returns scored area newly claimed (m²) — the
   * number special charge and turf points are based on.
   */
  paintSphere(c: Vec3, r: number, team: Team): number {
    const val = team + 1;
    let claimed = 0;
    this.forEachSurfaceInSphere(c, r, (s, u0, v0, rr) => {
      const i0 = Math.max(0, Math.floor((u0 - rr) / s.cu)), i1 = Math.min(s.cols - 1, Math.floor((u0 + rr) / s.cu));
      const j0 = Math.max(0, Math.floor((v0 - rr) / s.cv)), j1 = Math.min(s.rows - 1, Math.floor((v0 + rr) / s.cv));
      const r2 = rr * rr;
      for (let j = j0; j <= j1; j++) {
        const dv = (j + 0.5) * s.cv - v0;
        for (let i = i0; i <= i1; i++) {
          const du = (i + 0.5) * s.cu - u0;
          if (du * du + dv * dv > r2) continue;
          const k = s.offset + j * s.cols + i;
          const prev = this.cells[k];
          if (prev === val || prev === CELL_BLOCKED) continue;
          this.cells[k] = val;
          if (s.scoring) {
            if (prev !== CELL_EMPTY) this.teamArea[prev - 1] -= s.cellArea;
            this.teamArea[team] += s.cellArea;
            claimed += s.cellArea;
          }
        }
      }
    });
    return claimed;
  }

  /** Team owning the paint at a point on a surface facing roughly `hint`, or -1. */
  ownerAt(p: Vec3, hint: Vec3, maxDist = 0.3): number {
    let best = -1, bestD = maxDist;
    this.forEachSurfaceInSphere(p, maxDist, (s, u0, v0) => {
      if (dot(s.n, hint) < 0.5 || u0 < 0 || v0 < 0 || u0 >= s.uLen || v0 >= s.vLen) return;
      const d = Math.abs((p.x - s.origin.x) * s.n.x + (p.y - s.origin.y) * s.n.y + (p.z - s.origin.z) * s.n.z);
      if (d > bestD) return;
      bestD = d;
      const val = this.cells[s.offset + Math.floor(v0 / s.cv) * s.cols + Math.floor(u0 / s.cu)];
      best = val === CELL_EMPTY || val === CELL_BLOCKED ? -1 : val - 1;
    });
    return best;
  }

  /** Counts scored cells near a point: out = [empty, team0, team1] in m². Used by bots. */
  survey(c: Vec3, r: number, out: number[]): number[] {
    out[0] = out[1] = out[2] = 0;
    this.forEachSurfaceInSphere(c, r, (s, u0, v0, rr) => {
      if (!s.scoring) return;
      // Sample a sparse 5×5 lattice instead of every cell; this runs often.
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++) {
          const pu = u0 + (a * rr) / 2.5, pv = v0 + (b * rr) / 2.5;
          if (pu < 0 || pv < 0 || pu >= s.uLen || pv >= s.vLen) continue;
          const val = this.cells[s.offset + Math.floor(pv / s.cv) * s.cols + Math.floor(pu / s.cu)];
          if (val !== CELL_BLOCKED) out[val] += 1;
        }
    });
    return out;
  }

  /** Coverage percentages [team0, team1] of the scored area. */
  coverage(): [number, number] {
    const t = this.totalScoringArea || 1;
    return [(this.teamArea[0] / t) * 100, (this.teamArea[1] / t) * 100];
  }

  zoneShare(zone: number): [number, number] {
    const z = this.zoneCells[zone];
    const counts = [0, 0];
    for (const k of z.cells) {
      const v = this.cells[k];
      if (v === 1 || v === 2) counts[v - 1]++;
    }
    const n = z.cells.length || 1;
    return [counts[0] / n, counts[1] / n];
  }

  reset() {
    this.cells.set(this.blockedTemplate);
    this.teamArea[0] = this.teamArea[1] = 0;
  }

  /** Run-length encoding [value, count, …] for late-join sync. */
  encode(): number[] {
    const out: number[] = [];
    const c = this.cells;
    let i = 0;
    while (i < c.length) {
      const v = c[i];
      let j = i + 1;
      while (j < c.length && c[j] === v) j++;
      out.push(v, j - i);
      i = j;
    }
    return out;
  }

  decode(rle: number[]) {
    let k = 0;
    for (let i = 0; i + 1 < rle.length; i += 2) {
      const v = rle[i] | 0, n = rle[i + 1] | 0;
      if (n < 0 || k + n > this.cells.length) throw new Error('Paint sync out of range');
      // Blocked cells are geometry, never data: keep the local template's values.
      for (let e = k + n; k < e; k++) if (this.blockedTemplate[k] !== CELL_BLOCKED) this.cells[k] = v === 1 || v === 2 ? v : 0;
    }
    this.recount();
  }

  private recount() {
    this.teamArea[0] = this.teamArea[1] = 0;
    for (const s of this.surfaces) {
      if (!s.scoring) continue;
      for (let k = s.offset, e = s.offset + s.cols * s.rows; k < e; k++) {
        const v = this.cells[k];
        if (v === 1 || v === 2) this.teamArea[v - 1] += s.cellArea;
      }
    }
  }
}

function hashKey(x: number, y: number, z: number) {
  return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
}
