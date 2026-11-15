/*
 * Voxel models. The grid is the editable source (every voxel can be picked, painted and removed);
 * what gets drawn is a surface built from it by greedy meshing, so a model of tens of thousands of
 * voxels is still only a few hundred quads and one draw call per material.
 */

/** A grid of material indices: 0 is empty, k is palette entry k - 1. */
export class VoxelGrid {
  readonly cells: Uint8Array;
  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly nz: number,
    cells?: Uint8Array,
  ) {
    this.cells = cells && cells.length === nx * ny * nz ? cells : new Uint8Array(nx * ny * nz);
  }

  index(x: number, y: number, z: number) {
    return x + this.nx * (y + this.ny * z);
  }
  inside(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }
  get(x: number, y: number, z: number) {
    return this.inside(x, y, z) ? this.cells[this.index(x, y, z)] : 0;
  }
  /** Sets one voxel; returns true if it changed. */
  set(x: number, y: number, z: number, m: number) {
    if (!this.inside(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.cells[i] === m) return false;
    this.cells[i] = m;
    return true;
  }
  clone() {
    return new VoxelGrid(this.nx, this.ny, this.nz, this.cells.slice());
  }
  count() {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i]) n++;
    return n;
  }

  /** Fills a box (inclusive corners, any order). */
  fillBox(a: [number, number, number], b: [number, number, number], m: number) {
    let changed = 0;
    for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++)
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) if (this.set(x, y, z, m)) changed++;
    return changed;
  }

  /**
   * A round brush. `mode` add fills empty cells, remove clears, paint recolours filled cells only.
   * Returns how many voxels changed.
   */
  brush(cx: number, cy: number, cz: number, radius: number, m: number, mode: 'add' | 'remove' | 'paint') {
    const r = Math.max(0, radius), r2 = (r + 0.35) * (r + 0.35), c = Math.ceil(r);
    let changed = 0;
    for (let z = cz - c; z <= cz + c; z++)
      for (let y = cy - c; y <= cy + c; y++)
        for (let x = cx - c; x <= cx + c; x++) {
          if (!this.inside(x, y, z)) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (d > r2) continue;
          const cur = this.cells[this.index(x, y, z)];
          if (mode === 'add' ? cur === 0 : cur !== 0) if (this.set(x, y, z, mode === 'remove' ? 0 : m)) changed++;
        }
    return changed;
  }

  /** Every voxel joined (face to face) to the start one; `sameMaterial` stops at other materials. */
  connected(x: number, y: number, z: number, sameMaterial = true): number[] {
    const start = this.get(x, y, z);
    if (!start) return [];
    const seen = new Uint8Array(this.cells.length), out: number[] = [];
    const stack = [this.index(x, y, z)];
    seen[stack[0]] = 1;
    const { nx, ny, nz } = this;
    while (stack.length) {
      const i = stack.pop()!;
      out.push(i);
      const px = i % nx, py = Math.floor(i / nx) % ny, pz = Math.floor(i / (nx * ny));
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const qx = px + dx, qy = py + dy, qz = pz + dz;
        if (qx < 0 || qy < 0 || qz < 0 || qx >= nx || qy >= ny || qz >= nz) continue;
        const j = this.index(qx, qy, qz);
        if (seen[j]) continue;
        const v = this.cells[j];
        if (!v || (sameMaterial && v !== start)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return out;
  }

  /** Paint bucket: recolours the connected region of one material. */
  flood(x: number, y: number, z: number, m: number) {
    const cells = this.connected(x, y, z, true);
    for (const i of cells) this.cells[i] = m;
    return cells.length;
  }

  /** Swaps one material for another everywhere (0 as `to` deletes it). */
  replace(from: number, to: number) {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++)
      if (this.cells[i] === from) {
        this.cells[i] = to;
        n++;
      }
    return n;
  }

  /**
   * One smoothing pass inside a sphere (or everywhere with radius < 0): lone bumps (few filled
   * neighbours) are removed and pits (many filled neighbours) are filled with the commonest
   * neighbouring material. Works from a copy, so the result doesn't depend on scan order.
   */
  smooth(cx = 0, cy = 0, cz = 0, radius = -1) {
    const src = this.cells.slice();
    const { nx, ny, nz } = this;
    const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : src[x + nx * (y + ny * z)]);
    let changed = 0;
    const tally = new Uint16Array(256);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          if (radius >= 0 && (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 > (radius + 0.35) ** 2) continue;
          let filled = 0;
          tally.fill(0);
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy && !dz) continue;
                const v = at(x + dx, y + dy, z + dz);
                if (v) {
                  filled++;
                  tally[v]++;
                }
              }
          const i = x + nx * (y + ny * z);
          if (src[i] && filled <= 9) {
            this.cells[i] = 0;
            changed++;
          } else if (!src[i] && filled >= 17) {
            let best = 1;
            for (let k = 1; k < 256; k++) if (tally[k] > tally[best]) best = k;
            this.cells[i] = best;
            changed++;
          }
        }
    return changed;
  }

  /** Levels a patch: clears everything on the far side of a plane through (c) facing `axis`·`dir`. */
  flatten(cx: number, cy: number, cz: number, radius: number, axis: 0 | 1 | 2, dir: 1 | -1) {
    let changed = 0;
    const r = Math.ceil(radius), c = [cx, cy, cz];
    for (let z = cz - r; z <= cz + r; z++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          const p = [x, y, z];
          const off = (p[axis] - c[axis]) * dir;
          if (off <= 0) continue;
          const u = (axis + 1) % 3, v = (axis + 2) % 3;
          if ((p[u] - c[u]) ** 2 + (p[v] - c[v]) ** 2 > (radius + 0.35) ** 2) continue;
          if (this.set(x, y, z, 0)) changed++;
        }
    return changed;
  }

  /** Copies the half with x below the middle onto the other half (or the other way round). */
  mirrorX(fromLow = true) {
    const { nx } = this;
    let changed = 0;
    for (let z = 0; z < this.nz; z++)
      for (let y = 0; y < this.ny; y++)
        for (let x = 0; x < Math.floor(nx / 2); x++) {
          const a = fromLow ? x : nx - 1 - x, b = nx - 1 - a;
          if (this.set(b, y, z, this.get(a, y, z))) changed++;
        }
    return changed;
  }

  /** Moves the listed voxels by whole cells (those pushed outside are lost). Returns their new indices. */
  move(indices: number[], dx: number, dy: number, dz: number, copy = false) {
    const { nx, ny } = this;
    const taken = indices.map((i) => ({ x: i % nx, y: Math.floor(i / nx) % ny, z: Math.floor(i / (nx * ny)), m: this.cells[i] }));
    if (!copy) for (const i of indices) this.cells[i] = 0;
    const out: number[] = [];
    for (const t of taken) {
      const x = t.x + dx, y = t.y + dy, z = t.z + dz;
      if (!this.inside(x, y, z) || !t.m) continue;
      const j = this.index(x, y, z);
      this.cells[j] = t.m;
      out.push(j);
    }
    return out;
  }

  /** A copy at another resolution (nearest neighbour), for changing how fine a model is. */
  resample(nx: number, ny: number, nz: number) {
    const out = new VoxelGrid(nx, ny, nz);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++)
          out.cells[out.index(x, y, z)] = this.get(Math.floor(((x + 0.5) * this.nx) / nx), Math.floor(((y + 0.5) * this.ny) / ny), Math.floor(((z + 0.5) * this.nz) / nz));
    return out;
  }

  /** The filled box, or null when the grid is empty: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds(): [number, number, number, number, number, number] | null {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -1, y1 = -1, z1 = -1;
    for (let z = 0; z < this.nz; z++)
      for (let y = 0; y < this.ny; y++)
        for (let x = 0; x < this.nx; x++)
          if (this.cells[this.index(x, y, z)]) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
            x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
          }
    return x1 < 0 ? null : [x0, y0, z0, x1, y1, z1];
  }
}

const NEIGHBOURS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export interface VoxelSurface {
  /** Four corners per quad, in voxel units from the grid's corner. */
  positions: Float32Array;
  normals: Float32Array;
  /** Palette entry (1-based, as in the grid) of each vertex. */
  materials: Uint8Array;
  /** Corner darkening 0..1 (1 = open), from the three voxels touching each corner. */
  ao: Float32Array;
  indices: Uint32Array;
  quads: number;
}

/**
 * Greedy meshing: for each of the six directions, each slice of the grid becomes a 2D mask of
 * visible faces, and equal neighbours in the mask are merged into the biggest rectangles.
 * `ao` adds corner shading; faces with different shading are not merged, so it costs some quads.
 */
export function greedyMesh(g: VoxelGrid, ao = false): VoxelSurface {
  const dims = [g.nx, g.ny, g.nz];
  const pos: number[] = [], nor: number[] = [], mat: number[] = [], occ: number[] = [], idx: number[] = [];
  const cell = (p: number[]) => g.get(p[0], p[1], p[2]);
  const solid = (p: number[]) => (cell(p) ? 1 : 0);
  let quads = 0;
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const nu = dims[u], nv = dims[v];
    const mask = new Int32Array(nu * nv);
    const p = [0, 0, 0], q = [0, 0, 0];
    for (const dir of [1, -1]) {
      for (let s = 0; s < dims[d]; s++) {
        // Mask: material (and corner shading) of every face of this slice that looks along dir.
        let any = false;
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            p[d] = s; p[u] = i; p[v] = j;
            q[d] = s + dir; q[u] = i; q[v] = j;
            const m = cell(p);
            let key = 0;
            if (m && !cell(q)) {
              key = m;
              if (ao) {
                // Four corners, two bits each: how many of the three touching voxels are filled.
                let bits = 0;
                for (let c = 0; c < 4; c++) {
                  const du = c & 1 ? 1 : -1, dv = c & 2 ? 1 : -1;
                  q[u] = i + du; q[v] = j;
                  const a = solid(q);
                  q[u] = i; q[v] = j + dv;
                  const b = solid(q);
                  q[u] = i + du; q[v] = j + dv;
                  const cc = solid(q);
                  bits |= (a && b ? 3 : a + b + cc) << (c * 2);
                }
                q[u] = i; q[v] = j;
                key |= bits << 8;
              }
              any = true;
            }
            mask[i + j * nu] = key;
          }
        if (!any) continue;
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; ) {
            const key = mask[i + j * nu];
            if (!key) {
              i++;
              continue;
            }
            let w = 1;
            while (i + w < nu && mask[i + w + j * nu] === key) w++;
            let h = 1;
            grow: for (; j + h < nv; h++) for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * nu] !== key) break grow;
            for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) mask[i + a + (j + b) * nu] = 0;
            const base = pos.length / 3;
            const face = dir === 1 ? s + 1 : s;
            const corners: [number, number][] = [[i, j], [i + w, j], [i + w, j + h], [i, j + h]];
            const bits = key >> 8;
            const shade = [bits & 3, (bits >> 2) & 3, (bits >> 6) & 3, (bits >> 4) & 3];
            corners.forEach(([cu, cv], c) => {
              const out = [0, 0, 0];
              out[d] = face; out[u] = cu; out[v] = cv;
              pos.push(out[0], out[1], out[2]);
              const n = [0, 0, 0];
              n[d] = dir;
              nor.push(n[0], n[1], n[2]);
              mat.push(key & 255);
              occ.push(ao ? 1 - shade[c] * 0.22 : 1);
            });
            // u × v points along +d, so the winding flips for faces that look along -d.
            if (dir === 1) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
            quads++;
            i += w;
          }
      }
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), materials: new Uint8Array(mat), ao: new Float32Array(occ), indices: new Uint32Array(idx), quads };
}

/* ---------- Saving ---------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Run-length pairs (count 1-255, value), as text. Models are mostly air and big flat areas. */
export function encodeVoxels(g: VoxelGrid): string {
  const out: number[] = [];
  const c = g.cells;
  for (let i = 0; i < c.length; ) {
    let n = 1;
    while (n < 255 && i + n < c.length && c[i + n] === c[i]) n++;
    out.push(n, c[i]);
    i += n;
  }
  return bytesToBase64(Uint8Array.from(out));
}

export const VOXEL_MAX = 96;

/** Reads a saved grid; anything malformed gives an empty grid of the stated (clamped) size. */
export function decodeVoxels(nx: number, ny: number, nz: number, data: unknown): VoxelGrid {
  const clamp = (n: number) => Math.max(1, Math.min(VOXEL_MAX, Math.round(Number.isFinite(n) ? n : 16)));
  const g = new VoxelGrid(clamp(nx), clamp(ny), clamp(nz));
  if (typeof data !== 'string' || /[^A-Za-z0-9+/=]/.test(data)) return g;
  const b = base64ToBytes(data);
  let o = 0;
  for (let i = 0; i + 1 < b.length && o < g.cells.length; i += 2) {
    const n = b[i], v = b[i + 1];
    for (let k = 0; k < n && o < g.cells.length; k++) g.cells[o++] = v;
  }
  return g;
}
