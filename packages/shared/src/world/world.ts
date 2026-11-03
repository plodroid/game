import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from '../constants';
import type { MapDef } from '../maps/types';
import { blockQuat, v3, type Vec3 } from '../vec';
import { PaintGrid } from './paint';

let ready: Promise<void> | null = null;
/** Loads the Rapier WASM module once per process/page. */
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

// Collision groups: upper 16 bits = membership, lower 16 = filter.
const WORLD_GROUPS = 0x0001ffff;
const PLAYER_GROUPS = 0x00020000; // collides with nothing; only used as a controller shape
const QUERY_WORLD = 0xffff0001;

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  dist: number;
}

/** Map geometry, physics queries and paint ownership. One per match, client or server. */
export class GameWorld {
  readonly physics: RAPIER.World;
  readonly grid: PaintGrid;
  readonly controller: RAPIER.KinematicCharacterController;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  private hit: RayHit = { point: v3(), normal: v3(), dist: 0 };

  /** Requires initPhysics() to have resolved. */
  constructor(readonly map: MapDef) {
    this.physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
    for (const b of map.blocks) {
      if (!b.solid) continue;
      const desc = RAPIER.ColliderDesc.cuboid(b.h.x, b.h.y, b.h.z)
        .setTranslation(b.c.x, b.c.y, b.c.z)
        .setRotation(blockQuat(b.yaw, b.pitch))
        .setCollisionGroups(WORLD_GROUPS);
      this.physics.createCollider(desc);
    }
    // Populates the broad-phase so scene queries see the static map.
    this.physics.step();
    this.grid = new PaintGrid(map);

    const c = this.physics.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    c.enableAutostep(0.4, 0.2, false);
    c.enableSnapToGround(0.35);
    c.setSlideEnabled(true);
    this.controller = c;
  }

  createPlayerCollider(): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setCollisionGroups(PLAYER_GROUPS);
    return this.physics.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider) {
    this.physics.removeCollider(c, false);
  }

  /**
   * Moves a capsule by `delta` with slope/step handling. Returns the applied
   * translation (written into `out`) and whether the capsule ended grounded.
   */
  moveCapsule(col: RAPIER.Collider, pos: Vec3, delta: Vec3, out: Vec3): boolean {
    col.setTranslation(pos);
    this.controller.computeColliderMovement(col, delta, undefined, QUERY_WORLD);
    const m = this.controller.computedMovement();
    out.x = m.x;
    out.y = m.y;
    out.z = m.z;
    col.setTranslation({ x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z });
    return this.controller.computedGrounded();
  }

  /** Static-geometry raycast. The returned object is reused — copy what you keep. */
  raycast(o: Vec3, dir: Vec3, maxDist: number): RayHit | null {
    this.ray.origin = o;
    this.ray.dir = dir;
    const h = this.physics.castRayAndGetNormal(this.ray, maxDist, true, undefined, QUERY_WORLD);
    if (!h) return null;
    const t = h.timeOfImpact;
    this.hit.dist = t;
    this.hit.point.x = o.x + dir.x * t;
    this.hit.point.y = o.y + dir.y * t;
    this.hit.point.z = o.z + dir.z * t;
    this.hit.normal.x = h.normal.x;
    this.hit.normal.y = h.normal.y;
    this.hit.normal.z = h.normal.z;
    return this.hit;
  }

  /** True when nothing static blocks the segment a→b. */
  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    return !this.raycast(a, { x: dx / d, y: dy / d, z: dz / d }, d - 0.05);
  }

  dispose() {
    this.physics.free();
  }
}
