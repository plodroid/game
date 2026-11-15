import { describe, expect, it } from 'vitest';
import {
  assetFromWeaponParts, assetStats, blankAsset, composeEuler, nodeGrid, sanitizeAsset, ASSET_LIMITS, type MeshNode, type VoxNode,
} from './asset';
import {
  addFace, bevelEdges, boxMesh, cylinderMesh, deleteFaces, deleteVerts, extrudeFaces, faceCentre, faceNormal, flipFaces, insetFaces, isClosed, loopCut,
  mergeVerts, meshEdges, meshFromQuads, mirrorX, polyBuffers, setFaceMaterial, sphereMesh, subdivide, translateVerts, transformVerts, unwrap, wedgeMesh, type PolyMesh,
} from './polymesh';
import { decodeVoxels, encodeVoxels, greedyMesh, VoxelGrid } from './voxel';

/** Every face looks away from the middle of the mesh (true for convex shapes). */
function facesOutward(m: PolyMesh) {
  let cx = 0, cy = 0, cz = 0;
  const n = m.verts.length / 3;
  for (let i = 0; i < n; i++) {
    cx += m.verts[i * 3] / n;
    cy += m.verts[i * 3 + 1] / n;
    cz += m.verts[i * 3 + 2] / n;
  }
  return m.faces.every((f) => {
    const c = faceCentre(m, f), nr = faceNormal(m, f);
    return (c[0] - cx) * nr[0] + (c[1] - cy) * nr[1] + (c[2] - cz) * nr[2] > 0;
  });
}

/** Surface area of a voxel surface, in voxel faces. */
function area(s: ReturnType<typeof greedyMesh>) {
  let a = 0;
  for (let q = 0; q < s.positions.length / 3; q += 4) {
    const p = (i: number) => [s.positions[(q + i) * 3], s.positions[(q + i) * 3 + 1], s.positions[(q + i) * 3 + 2]];
    const [a0, a1, a3] = [p(0), p(1), p(3)];
    a += Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]) * Math.hypot(a3[0] - a0[0], a3[1] - a0[1], a3[2] - a0[2]);
  }
  return a;
}

describe('voxels', () => {
  it('adds, removes, selects and paints single voxels', () => {
    const g = new VoxelGrid(8, 8, 8);
    expect(g.set(1, 2, 3, 2)).toBe(true);
    expect(g.set(1, 2, 3, 2)).toBe(false);
    expect(g.get(1, 2, 3)).toBe(2);
    expect(g.set(9, 0, 0, 1)).toBe(false);
    expect(g.count()).toBe(1);
    g.set(1, 2, 3, 5);
    expect(g.get(1, 2, 3)).toBe(5);
    g.set(1, 2, 3, 0);
    expect(g.count()).toBe(0);
  });

  it('brushes add, paint and remove without touching what they should not', () => {
    const g = new VoxelGrid(16, 16, 16);
    const added = g.brush(8, 8, 8, 3, 1, 'add');
    expect(added).toBeGreaterThan(100);
    expect(g.brush(8, 8, 8, 3, 2, 'add')).toBe(0);
    expect(g.brush(8, 8, 8, 1, 2, 'paint')).toBeGreaterThan(0);
    expect(g.count()).toBe(added);
    expect(g.get(8, 8, 8)).toBe(2);
    expect(g.get(8, 8, 11)).toBe(1);
    g.brush(8, 8, 8, 6, 0, 'remove');
    expect(g.count()).toBe(0);
  });

  it('greedy meshing covers exactly the visible faces with few quads', () => {
    const g = new VoxelGrid(8, 8, 8);
    g.fillBox([1, 1, 1], [4, 3, 2], 1);
    const s = greedyMesh(g);
    // A solid 4 × 3 × 2 box is six rectangles.
    expect(s.quads).toBe(6);
    expect(area(s)).toBe(2 * (4 * 3 + 4 * 2 + 3 * 2));
    expect(s.indices.length).toBe(36);
    // Two materials side by side can't share a quad.
    g.fillBox([1, 1, 1], [2, 3, 2], 2);
    const t = greedyMesh(g);
    expect(t.quads).toBe(10);
    expect(area(t)).toBe(area(s));
    expect(new Set(t.materials)).toEqual(new Set([1, 2]));
  });

  it('every quad faces outwards', () => {
    const g = new VoxelGrid(6, 6, 6);
    g.brush(3, 3, 3, 2, 1, 'add');
    const s = greedyMesh(g, true);
    for (let i = 0; i < s.indices.length; i += 3) {
      const [a, b, c] = [s.indices[i], s.indices[i + 1], s.indices[i + 2]].map((k) => [s.positions[k * 3], s.positions[k * 3 + 1], s.positions[k * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const k = s.indices[i];
      expect(n[0] * s.normals[k * 3] + n[1] * s.normals[k * 3 + 1] + n[2] * s.normals[k * 3 + 2]).toBeGreaterThan(0);
    }
    expect(Math.min(...s.ao)).toBeLessThan(1);
  });

  it('fills, floods, replaces, mirrors, moves and smooths', () => {
    const g = new VoxelGrid(10, 6, 6);
    g.fillBox([0, 0, 0], [3, 0, 3], 1);
    g.fillBox([6, 0, 0], [7, 0, 1], 1);
    expect(g.connected(0, 0, 0).length).toBe(16);
    expect(g.flood(0, 0, 0, 3)).toBe(16);
    expect(g.get(6, 0, 0)).toBe(1);
    expect(g.replace(1, 4)).toBe(4);
    g.replace(4, 0);
    g.mirrorX();
    expect(g.get(9, 0, 0)).toBe(3);
    expect(g.count()).toBe(32);
    const moved = g.move(g.connected(0, 0, 0), 0, 2, 0);
    expect(moved.length).toBe(16);
    expect(g.get(0, 2, 0)).toBe(3);
    expect(g.get(0, 0, 0)).toBe(0);
    // A lone voxel is a bump; smoothing removes it.
    const h = new VoxelGrid(8, 8, 8);
    h.fillBox([0, 0, 0], [7, 2, 7], 1);
    h.set(4, 3, 4, 1);
    h.smooth();
    expect(h.get(4, 3, 4)).toBe(0);
    expect(h.get(4, 1, 4)).toBe(1);
  });

  it('saves and reloads exactly, at any resolution', () => {
    for (const n of [4, 17, 48]) {
      const g = new VoxelGrid(n, n + 1, n + 2);
      for (let i = 0; i < g.cells.length; i += 3) g.cells[i] = 1 + (i % 7);
      g.fillBox([0, 0, 0], [n - 1, 0, n + 1], 9);
      const back = decodeVoxels(n, n + 1, n + 2, encodeVoxels(g));
      expect(back.cells).toEqual(g.cells);
    }
    // Rubbish gives an empty grid, never a throw.
    expect(decodeVoxels(4, 4, 4, '!!!not base64').count()).toBe(0);
    expect(decodeVoxels(4, 4, 4, 42).count()).toBe(0);
    expect(decodeVoxels(1e9, -3, NaN, '').cells.length).toBeLessThanOrEqual(96 * 96 * 96);
  });

  it('resamples to a finer grid keeping the shape', () => {
    const g = new VoxelGrid(4, 4, 4);
    g.fillBox([0, 0, 0], [1, 1, 1], 2);
    const fine = g.resample(8, 8, 8);
    expect(fine.count()).toBe(64);
    expect(fine.bounds()).toEqual([0, 0, 0, 3, 3, 3]);
  });

  it('a 48-cube sculpt meshes quickly into far fewer quads than faces', () => {
    const g = new VoxelGrid(48, 48, 48);
    g.brush(24, 24, 24, 20, 1, 'add');
    const t0 = performance.now();
    const s = greedyMesh(g);
    expect(performance.now() - t0).toBeLessThan(400);
    expect(s.quads).toBeLessThan(area(s) / 2);
  });
});

describe('polygon meshes', () => {
  it('primitives are closed and face outwards', () => {
    for (const m of [boxMesh(), cylinderMesh(), cylinderMesh(0.5, 0, 1, 8), sphereMesh(), wedgeMesh()]) {
      expect(isClosed(m)).toBe(true);
      expect(facesOutward(m)).toBe(true);
    }
  });

  it('moves and transforms vertices', () => {
    const m = translateVerts(boxMesh(2, 2, 2), [0, 1], [0, -1, 0]);
    expect(m.verts[1]).toBe(-2);
    expect(m.verts[7]).toBe(1);
    const t = transformVerts(boxMesh(2, 2, 2), [6], [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 1]);
    expect(t.verts.slice(18, 21)).toEqual([2, 2, 3]);
  });

  it('extrudes a face and a region of faces', () => {
    const one = extrudeFaces(boxMesh(1, 1, 1), [4], 0.5);
    expect(one.verts.length / 3).toBe(12);
    expect(one.faces.length).toBe(10);
    expect(isClosed(one)).toBe(true);
    expect(faceCentre(one, one.faces[4])[1]).toBeCloseTo(1);
    // Two neighbouring faces move as one piece: no wall between them.
    const top = subdivide(boxMesh(1, 1, 1));
    const up = top.faces.map((f, i) => (faceNormal(top, f)[1] > 0.9 ? i : -1)).filter((i) => i >= 0);
    expect(up.length).toBe(4);
    const region = extrudeFaces(top, up, 0.25);
    expect(region.faces.length).toBe(top.faces.length + 8);
    expect(isClosed(region)).toBe(true);
  });

  it('insets a face', () => {
    const m = insetFaces(boxMesh(2, 2, 2), [4], 0.25);
    expect(m.faces.length).toBe(10);
    expect(isClosed(m)).toBe(true);
    const inner = m.faces[4].v.map((i) => [m.verts[i * 3], m.verts[i * 3 + 2]]);
    for (const [x, z] of inner) {
      expect(Math.abs(x)).toBeCloseTo(0.75);
      expect(Math.abs(z)).toBeCloseTo(0.75);
    }
  });

  it('bevels one edge and all edges of a box', () => {
    const box = boxMesh(2, 2, 2);
    const e = meshEdges(box);
    expect(e.length).toBe(12);
    const one = bevelEdges(box, [[e[0].a, e[0].b]], 0.2);
    expect(one.faces.length).toBe(7);
    expect(one.verts.length / 3).toBe(10);
    expect(isClosed(one)).toBe(true);
    expect(facesOutward(one)).toBe(true);
    const all = bevelEdges(box, e.map((x) => [x.a, x.b] as [number, number]), 0.2);
    // Six faces, twelve strips, eight corner triangles.
    expect(all.faces.length).toBe(26);
    expect(all.verts.length / 3).toBe(24);
    expect(isClosed(all)).toBe(true);
    expect(facesOutward(all)).toBe(true);
    // An open border edge is left alone.
    const open = deleteFaces(box, [4]);
    const be = meshEdges(open).find((x) => x.faces.length === 1)!;
    expect(bevelEdges(open, [[be.a, be.b]], 0.2).faces.length).toBe(5);
  });

  it('subdivides flat and smooth', () => {
    const flat = subdivide(boxMesh(2, 2, 2));
    expect(flat.faces.length).toBe(24);
    expect(isClosed(flat)).toBe(true);
    const round = subdivide(boxMesh(2, 2, 2), true);
    // Corners are pulled in towards a sphere.
    expect(Math.hypot(round.verts[0], round.verts[1], round.verts[2])).toBeLessThan(Math.hypot(1, 1, 1) - 0.1);
    expect(isClosed(round)).toBe(true);
  });

  it('cuts a loop round a box', () => {
    const box = boxMesh(2, 2, 2);
    // An upright edge: the cut runs round the box horizontally.
    const e = meshEdges(box).find((x) => box.verts[x.a * 3] === box.verts[x.b * 3] && box.verts[x.a * 3 + 2] === box.verts[x.b * 3 + 2])!;
    const cut = loopCut(box, e.a, e.b);
    expect(cut.faces.length).toBe(10);
    expect(cut.verts.length / 3).toBe(12);
    expect(isClosed(cut)).toBe(true);
  });

  it('merges, deletes, adds faces, flips and mirrors', () => {
    const box = boxMesh(1, 1, 1);
    const pinched = mergeVerts(box, [6, 7]);
    expect(pinched.verts.length / 3).toBe(7);
    expect(deleteVerts(box, [0]).faces.length).toBe(3);
    const open = deleteFaces(box, [4]);
    expect(isClosed(open)).toBe(false);
    const hole = box.faces[4].v;
    const again = addFace(open, hole.map((i) => open.verts.findIndex((_, k) => k % 3 === 0 && open.verts[k] === box.verts[i * 3] && open.verts[k + 1] === box.verts[i * 3 + 1] && open.verts[k + 2] === box.verts[i * 3 + 2]) / 3));
    expect(isClosed(again)).toBe(true);
    expect(faceNormal(flipFaces(box, [4]), flipFaces(box, [4]).faces[4])[1]).toBeCloseTo(-1);
    // Half a box, mirrored, is a whole closed one.
    const half = translateVerts(boxMesh(1, 1, 1), [0, 1, 2, 3, 4, 5, 6, 7], [0.5, 0, 0]);
    const leftGone = deleteFaces(half, half.faces.map((f, i) => (faceNormal(half, f)[0] < -0.9 ? i : -1)).filter((i) => i >= 0));
    const whole = mirrorX(leftGone);
    expect(isClosed(whole)).toBe(true);
    expect(whole.verts.length / 3).toBe(12);
  });

  it('gives materials, smooth and crisp normals and unique painting UVs', () => {
    const m = setFaceMaterial(boxMesh(1, 1, 1), [4], 2);
    const uv = unwrap(m);
    const b = polyBuffers(m, 30, uv);
    expect(b.positions.length / 9).toBe(12);
    expect(b.groups.map((g) => g[0])).toEqual([0, 2]);
    expect(b.groups[1][2]).toBe(6);
    // A box corner is 90°, sharper than 30°: normals stay flat.
    expect(Math.abs(b.normals[0]) + Math.abs(b.normals[1]) + Math.abs(b.normals[2])).toBeCloseTo(1);
    // A smooth sphere shares normals.
    const s = polyBuffers(sphereMesh(1, 16, 12), 60);
    expect(Math.abs(s.normals[3]) + Math.abs(s.normals[4]) + Math.abs(s.normals[5])).toBeGreaterThan(1.01);
    // Every face has its own rectangle inside the texture, none overlapping.
    expect(uv.length).toBe(6);
    for (const f of uv) {
      for (const [x, y] of f.uv) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
      expect(f.scale).toBe(uv[0].scale);
    }
    for (let i = 0; i < uv.length; i++)
      for (let j = i + 1; j < uv.length; j++) {
        const [ax, ay, aw, ah] = uv[i].rect, [bx, by, bw, bh] = uv[j].rect;
        expect(ax + aw <= bx + 1e-9 || bx + bw <= ax + 1e-9 || ay + ah <= by + 1e-9 || by + bh <= ay + 1e-9).toBe(true);
      }
  });

  it('turns a voxel sculpt into an editable closed mesh', () => {
    const g = new VoxelGrid(6, 6, 6);
    g.fillBox([1, 1, 1], [3, 2, 2], 2);
    const s = greedyMesh(g);
    const m = meshFromQuads(s.positions, s.normals, s.materials, 0.1);
    expect(m.faces.length).toBe(6);
    expect(m.verts.length / 3).toBe(8);
    expect(isClosed(m)).toBe(true);
    expect(facesOutward(m)).toBe(true);
    expect(m.faces[0].m).toBe(1);
  });
});

describe('assets', () => {
  const sample = () => {
    const a = blankAsset('weapon', 'Test gun');
    const g = new VoxelGrid(8, 8, 8);
    g.fillBox([0, 0, 0], [3, 3, 3], 2);
    const vox: VoxNode = { id: 'vx', name: 'Body', t: 'vox', n: [8, 8, 8], size: 0.02, data: encodeVoxels(g), p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
    const box = extrudeFaces(boxMesh(0.1, 0.1, 0.3), [4], 0.05);
    const mesh: MeshNode = { id: 'ms', name: 'Barrel', t: 'mesh', verts: box.verts, faces: box.faces, smooth: 30, p: [0, 0.1, -0.2], r: [0, 0, 0], s: [1, 1, 1], parent: 'gr' };
    a.nodes = [{ id: 'gr', name: 'Group', t: 'group', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, vox, mesh, { id: 'pr', name: 'Grip', t: 'prim', shape: 'box', mat: 2, p: [0, 0, 0], r: [10, 0, 0], s: [0.05, 0.12, 0.06] }];
    return a;
  };

  it('survives saving and loading with voxels, meshes, groups and points intact', () => {
    const a = sample();
    const back = sanitizeAsset(JSON.parse(JSON.stringify(a)))!;
    expect(back).toEqual({ ...a, updatedAt: back.updatedAt });
    expect(nodeGrid(back.nodes[1] as VoxNode).count()).toBe(64);
    expect(assetStats(back)).toMatchObject({ nodes: 4, voxels: 64, prims: 1 });
    expect(back.points.muzzle).toEqual([0, 0.12, -0.45]);
  });

  it('refuses or repairs anything malformed', () => {
    expect(sanitizeAsset(null)).toBeNull();
    expect(sanitizeAsset({ id: 'x', kind: 'weapon' })).toBeNull();
    expect(sanitizeAsset({ id: 'ok-id', kind: 'spaceship' })).toBeNull();
    const a = sample() as unknown as Record<string, unknown>;
    (a.nodes as Record<string, unknown>[]).push({ t: 'mesh', id: 'gr', verts: [0, 0, 0, 1, NaN, 0, 1, 1, 'x'], faces: [{ v: [0, 1, 2], m: 99 }, { v: [0, 7, 2] }, { v: 'no' }] });
    (a.nodes as Record<string, unknown>[]).push({ t: 'laser' }, { t: 'prim', shape: 'banana', mat: -4, parent: 'nope', s: [1e9, 1, 1] });
    (a.nodes as { parent?: string }[])[0].parent = 'gr';
    a.materials = [{ color: 'red', rough: 9, role: 'admin', surface: 'lava' }];
    const c = sanitizeAsset(a)!;
    expect(c.materials).toHaveLength(1);
    expect(c.materials[0]).toMatchObject({ rough: 1, role: 'none', surface: 'plain' });
    // The duplicate id was replaced, the bad face indices dropped, the unknown node removed.
    expect(new Set(c.nodes.map((n) => n.id)).size).toBe(c.nodes.length);
    const bad = c.nodes.find((n) => n.t === 'mesh' && n.verts.length === 9) as MeshNode;
    expect(bad.faces).toEqual([{ v: [0, 1, 2], m: 0 }]);
    expect(c.nodes.some((n) => (n.t as string) === 'laser')).toBe(false);
    const prim = c.nodes.at(-1)!;
    expect(prim).toMatchObject({ t: 'prim', shape: 'box', mat: 0, s: [200, 1, 1] });
    expect(prim.parent).toBeUndefined();
    expect(c.nodes[0].parent).toBeUndefined();
    // Voxel values past the palette fall back to the first material.
    expect(Math.max(...nodeGrid(c.nodes[1] as VoxNode).cells)).toBe(1);
  });

  it('caps sizes', () => {
    const a = sample() as unknown as { nodes: unknown[] };
    a.nodes = Array.from({ length: 400 }, (_, i) => ({ t: 'group', id: `g${i}`, name: 'g' }));
    expect(sanitizeAsset(a)!.nodes.length).toBe(ASSET_LIMITS.nodes);
  });

  it('opens a gun from the old editor without changing how it sits', () => {
    const a = assetFromWeaponParts('old-gun', 'Old', [
      { s: 'box', x: 0, y: 0.1, z: -0.05, w: 0.1, h: 0.1, d: 0.3, c: 'shell' },
      { s: 'cyl', x: 0, y: 0.12, z: -0.3, w: 0.05, h: 0.06, d: 0.2, c: 'dark', ry: 30 },
      { s: 'torus', x: 0, y: 0.12, z: -0.4, w: 0.07, h: 0.07, d: 0.07, c: 'team' },
    ], [0.12, -0.42]);
    expect(sanitizeAsset(a)).not.toBeNull();
    expect(a.nodes.map((n) => (n.t === 'prim' ? n.mat : -1))).toEqual([0, 2, 1]);
    // The old cylinder lay along the barrel: here it is an upright one, turned and with its sizes swapped.
    expect(a.nodes[1].s).toEqual([0.05, 0.2, 0.06]);
    expect(a.nodes[1].r).toEqual(composeEuler([0, 30, 0], [90, 0, 0]));
    expect(a.points.muzzle).toEqual([0, 0.12, -0.42]);
    // Turns about one axis add up, and doing nothing changes nothing.
    expect(composeEuler([30, 0, 0], [40, 0, 0])[0]).toBeCloseTo(70);
    expect(composeEuler([10, 20, 30], [0, 0, 0])).toEqual([10, 20, 30]);
    expect(composeEuler([0, 0, 0], [10, 20, 30])).toEqual([10, 20, 30]);
  });
});
