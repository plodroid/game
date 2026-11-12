import RAPIER from '@dimforge/rapier3d-compat';
import type { TrackPath } from './track';

/** Collision groups: track, cars, and cars passing through others just after a respawn. */
export const G_TRACK = 0x0001;
export const G_CAR = 0x0002;
export const G_GHOST = 0x0004;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
/** Wheel rays only see the track. */
export const QUERY_TRACK = groups(0xffff, G_TRACK);

/**
 * The static physics of a track: the road and its verges as one triangle mesh, walls along both
 * edges and the ground. Built the same way on every device.
 */
export function buildTrackColliders(world: RAPIER.World, p: TrackPath) {
  const { n, def } = p;
  const sh = def.shoulder;
  const verts = new Float32Array(n * 4 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = [p.w[i] + sh, p.w[i], -p.w[i], -(p.w[i] + sh)];
    for (let k = 0; k < 4; k++) {
      const b = (i * 4 + k) * 3;
      verts[b] = p.px[i] + p.lx[i] * o[k];
      verts[b + 1] = p.py[i] + p.ly[i] * o[k];
      verts[b + 2] = p.pz[i] + p.lz[i] * o[k];
    }
    const j = (i + 1) % n;
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k, b = j * 4 + k;
      // Counter-clockwise from above: the triangles face up, so contacts push cars up out of the road.
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const flags = (RAPIER as unknown as { TriMeshFlags?: { FIX_INTERNAL_EDGES: number } }).TriMeshFlags?.FIX_INTERNAL_EDGES;
  const road = RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx), flags)
    .setCollisionGroups(groups(G_TRACK, 0xffff))
    .setFriction(0.6);
  world.createCollider(road);

  // Walls: boxes every few metres along both outer edges, upright, 0.6 m thick.
  const wallH = Math.max(0.9, def.wall || 1);
  const step = 2;
  for (let i = 0; i < n; i += step) {
    const j = (i + step) % n;
    for (const side of [1, -1]) {
      const oi = side * (p.w[i] + sh + 0.3), oj = side * (p.w[j] + sh + 0.3);
      const ax = p.px[i] + p.lx[i] * oi, ay = p.py[i] + p.ly[i] * oi, az = p.pz[i] + p.lz[i] * oi;
      const bx = p.px[j] + p.lx[j] * oj, by = p.py[j] + p.ly[j] * oj, bz = p.pz[j] + p.lz[j] * oj;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const yaw = Math.atan2(bx - ax, bz - az);
      const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      const desc = RAPIER.ColliderDesc.cuboid(0.3, wallH / 2 + 1, len / 2 + 0.35)
        .setTranslation((ax + bx) / 2, Math.min(ay, by) + wallH / 2 - 1, (az + bz) / 2)
        .setRotation(q)
        .setCollisionGroups(groups(G_TRACK, 0xffff))
        .setFriction(0.15)
        .setRestitution(0.15);
      world.createCollider(desc);
    }
  }
  // Ground far below elevated parts and around ground-level ones: a car that leaves the road lands somewhere.
  const b = p.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hx = (b.maxX - b.minX) / 2 + 200, hz = (b.maxZ - b.minZ) / 2 + 200;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, 2, hz)
      .setTranslation(cx, Math.min(def.ground, b.minY) - 2.25, cz)
      .setCollisionGroups(groups(G_TRACK, 0xffff))
      .setFriction(0.8),
  );
  // Verge props (cones, crates, tyres) are scenery only: solid ones turned out to be invisible hazards.
}
