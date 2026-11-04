import { CELL_BLOCKED, GRAVITY } from '../constants';
import { UP, v3, type Vec3 } from '../vec';
import type { GameWorld } from '../world/world';

export const EDGE = { WALK: 0, JUMP: 1, DROP: 2, PAD: 3 } as const;

export interface NavEdge {
  to: number;
  cost: number;
  kind: number;
}

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  edges: NavEdge[];
}

const SPACING = 2.2;
const LINK = 3.4;
const HASH = 4;
const DIRS = [v3(1, 0, 0), v3(-1, 0, 0), v3(0, 0, 1), v3(0, 0, -1)];
const key = (x: number, z: number) => (x + 1024) * 4096 + (z + 1024);

/**
 * Waypoint graph generated from the paint surfaces, so every map gets bot navigation
 * for free. Built once per match; queries are cheap enough to run at bot think rate.
 */
export class NavGraph {
  readonly nodes: NavNode[] = [];
  private hash = new Map<number, number[]>();
  private a = v3();
  private b = v3();

  constructor(private w: GameWorld) {
    this.sample();
    this.link();
    this.linkPads();
  }

  private sample() {
    const { grid } = this.w;
    const o = v3();
    for (const s of grid.surfaces) {
      // Floors and ramps only; beams narrower than 1.5 m are left to humans as risky shortcuts.
      if (s.n.y < 0.75 || Math.min(s.uLen, s.vLen) < 1.5) continue;
      const nu = Math.max(1, Math.floor(s.uLen / SPACING)), nv = Math.max(1, Math.floor(s.vLen / SPACING));
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nv; j++) {
          const pu = ((i + 0.5) * s.uLen) / nu, pv = ((j + 0.5) * s.vLen) / nv;
          const cell = s.offset + Math.min(s.rows - 1, Math.floor(pv / s.cv)) * s.cols + Math.min(s.cols - 1, Math.floor(pu / s.cu));
          if (grid.cells[cell] === CELL_BLOCKED) continue;
          const x = s.origin.x + s.u.x * pu + s.v.x * pv;
          const y = s.origin.y + s.u.y * pu + s.v.y * pv;
          const z = s.origin.z + s.u.z * pu + s.v.z * pv;
          o.x = x;
          o.y = y + 0.1;
          o.z = z;
          if (this.w.raycast(o, UP, 1.9)) continue;
          o.y = y + 0.5;
          if (DIRS.some((d) => this.w.raycast(o, d, 0.5))) continue;
          this.add(x, y, z);
        }
    }
  }

  private add(x: number, y: number, z: number) {
    const id = this.nodes.length;
    this.nodes.push({ id, x, y, z, edges: [] });
    const k = key(Math.floor(x / HASH), Math.floor(z / HASH));
    let list = this.hash.get(k);
    if (!list) this.hash.set(k, (list = []));
    list.push(id);
  }

  private los(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.a.x = ax;
    this.a.y = ay;
    this.a.z = az;
    this.b.x = bx;
    this.b.y = by;
    this.b.z = bz;
    return this.w.lineOfSight(this.a, this.b);
  }

  private groundAt(x: number, y: number, z: number, tol: number) {
    this.a.x = x;
    this.a.y = y + 1;
    this.a.z = z;
    const h = this.w.raycast(this.a, DOWN, 1 + tol + 0.5);
    return !!h && Math.abs(h.point.y - y) < tol;
  }

  private link() {
    for (const a of this.nodes) {
      const cx = Math.floor(a.x / HASH), cz = Math.floor(a.z / HASH);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const bid of this.hash.get(key(cx + dx, cz + dz)) ?? []) {
            if (bid <= a.id) continue;
            const b = this.nodes[bid];
            const dxz = Math.hypot(b.x - a.x, b.z - a.z);
            if (dxz > LINK || dxz < 0.01) continue;
            const dy = b.y - a.y;
            const clear = this.los(a.x, a.y + 0.5, a.z, b.x, b.y + 0.5, b.z) && this.los(a.x, a.y + 1.4, a.z, b.x, b.y + 1.4, b.z);
            if (clear && Math.abs(dy) <= dxz + 0.3) {
              let solid = true;
              for (const t of [0.25, 0.5, 0.75])
                if (!this.groundAt(a.x + (b.x - a.x) * t, a.y + dy * t, a.z + (b.z - a.z) * t, 0.45)) solid = false;
              if (solid) {
                a.edges.push({ to: b.id, cost: Math.hypot(dxz, dy), kind: EDGE.WALK });
                b.edges.push({ to: a.id, cost: Math.hypot(dxz, dy), kind: EDGE.WALK });
                continue;
              }
              if (Math.abs(dy) < 0.5) {
                // Same height but a gap in between: hop it.
                a.edges.push({ to: b.id, cost: dxz * 1.6, kind: EDGE.JUMP });
                b.edges.push({ to: a.id, cost: dxz * 1.6, kind: EDGE.JUMP });
                continue;
              }
            }
            if (dy < -0.5) this.vertical(a, b, dxz);
            else if (dy > 0.5) this.vertical(b, a, dxz);
          }
    }
  }

  /** hi → lo drops and lo → hi jumps between levels. */
  private vertical(hi: NavNode, lo: NavNode, dxz: number) {
    const drop = hi.y - lo.y;
    if (dxz <= 4.5 && drop <= 7.5 && this.los(hi.x, hi.y + 1, hi.z, lo.x, hi.y + 1, lo.z) && this.los(lo.x, hi.y + 1, lo.z, lo.x, lo.y + 0.6, lo.z))
      hi.edges.push({ to: lo.id, cost: dxz + drop * 0.3, kind: EDGE.DROP });
    if (drop <= 2.3 && dxz <= 3.2 && this.los(lo.x, lo.y + 1, lo.z, lo.x, hi.y + 1.3, lo.z) && this.los(lo.x, hi.y + 1.3, lo.z, hi.x, hi.y + 1.3, hi.z))
      lo.edges.push({ to: hi.id, cost: dxz + drop * 1.5, kind: EDGE.JUMP });
  }

  private linkPads() {
    const pos = v3(), vel = v3();
    for (const pad of this.w.map.pads) {
      const from = this.nearest(v3(pad.x, pad.y, pad.z), 2.5);
      if (from < 0) continue;
      pos.x = pad.x;
      pos.y = pad.y + 0.2;
      pos.z = pad.z;
      vel.x = pad.vx;
      vel.y = pad.vy;
      vel.z = pad.vz;
      for (let t = 0; t < 3; t += 1 / 30) {
        vel.y -= GRAVITY / 30;
        pos.x += vel.x / 30;
        pos.y += vel.y / 30;
        pos.z += vel.z / 30;
        if (vel.y >= 0) continue;
        const h = this.w.raycast(pos, DOWN, 0.6);
        if (!h) continue;
        const to = this.nearest(h.point, 2.5);
        if (to >= 0 && to !== from) this.nodes[from].edges.push({ to, cost: 4, kind: EDGE.PAD });
        break;
      }
    }
  }

  /** Closest node (preferring similar height) within maxDist, or -1. */
  nearest(p: Vec3, maxDist = 6): number {
    let best = -1, bestD = maxDist * maxDist;
    const cx = Math.floor(p.x / HASH), cz = Math.floor(p.z / HASH);
    const r = Math.ceil(maxDist / HASH);
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++)
        for (const id of this.hash.get(key(cx + dx, cz + dz)) ?? []) {
          const n = this.nodes[id];
          const dy = (n.y - p.y) * 3;
          const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2 + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
    return best;
  }

  /** A* over the graph. `extra` adds per-node cost (e.g. enemy paint). */
  path(from: number, to: number, extra?: (n: NavNode) => number): number[] | null {
    const n = this.nodes.length;
    if (from < 0 || to < 0 || from >= n || to >= n) return null;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const goal = this.nodes[to];
    const h = (k: NavNode) => Math.hypot(k.x - goal.x, k.y - goal.y, k.z - goal.z);
    g[from] = 0;
    heap.push(h(this.nodes[from]), from);
    let iterations = 0;
    while (heap.size && iterations++ < n * 3) {
      const cur = heap.pop();
      if (cur === to) {
        const out = [to];
        let c = to;
        while (came[c] >= 0) out.push((c = came[c]));
        return out.reverse();
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const e of this.nodes[cur].edges) {
        if (closed[e.to]) continue;
        const ng = g[cur] + e.cost + (extra ? extra(this.nodes[e.to]) : 0);
        if (ng < g[e.to]) {
          g[e.to] = ng;
          came[e.to] = cur;
          heap.push(ng + h(this.nodes[e.to]), e.to);
        }
      }
    }
    return null;
  }

  edgeKind(from: number, to: number): number {
    for (const e of this.nodes[from]?.edges ?? []) if (e.to === to) return e.kind;
    return EDGE.WALK;
  }
}

const DOWN = Object.freeze(v3(0, -1, 0));

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}
