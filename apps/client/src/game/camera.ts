import * as THREE from 'three';
import { clamp, dirFromAngles, v3, type GameWorld, type Vec3 } from '@chromashift/shared';

const dir = v3(), pivot = v3(), want = v3();

/** Over-the-shoulder follow camera with collision, damping, FOV kick and shake. */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = -0.12;
  private smoothPivot = new THREE.Vector3();
  private dist = 3.9;
  private shake = 0;
  private fov = 72;
  private init = false;

  constructor(aspect: number, far: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, far);
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  snapTo(yaw: number, pitch = -0.12) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** `target` is the capsule centre. */
  update(dt: number, world: GameWorld, target: Vec3, o: { smoothing: number; diving: boolean; fast: boolean; shake: number }) {
    this.pitch = clamp(this.pitch, -1.25, 1.2);
    const lift = o.diving ? 0.2 : 0.62;
    if (!this.init) {
      this.smoothPivot.set(target.x, target.y + lift, target.z);
      this.init = true;
    }
    // Follow is damped; rotation is not, so aiming stays 1:1 with the mouse.
    const rate = 60 - o.smoothing * 48;
    const f = 1 - Math.exp(-rate * dt);
    this.smoothPivot.x += (target.x - this.smoothPivot.x) * f;
    this.smoothPivot.y += (target.y + lift - this.smoothPivot.y) * Math.min(1, f * 0.85);
    this.smoothPivot.z += (target.z - this.smoothPivot.z) * f;
    pivot.x = this.smoothPivot.x;
    pivot.y = this.smoothPivot.y;
    pivot.z = this.smoothPivot.z;

    dirFromAngles(dir, this.yaw, this.pitch);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const back = (o.diving ? 3.5 : 3.9) + Math.max(0, -this.pitch) * 0.6;
    const side = 0.62, up = 0.16;
    want.x = pivot.x - dir.x * back + rx * side;
    want.y = pivot.y - dir.y * back + up;
    want.z = pivot.z - dir.z * back + rz * side;
    // Pull in when geometry is between the player and the camera.
    const dx = want.x - pivot.x, dy = want.y - pivot.y, dz = want.z - pivot.z;
    const len = Math.hypot(dx, dy, dz);
    const hit = world.raycast(pivot, { x: dx / len, y: dy / len, z: dz / len }, len);
    const allowed = hit ? Math.max(0.4, hit.dist - 0.28) : len;
    // Snap in instantly when blocked, ease back out when clear.
    this.dist = allowed < this.dist ? allowed : this.dist + (allowed - this.dist) * (1 - Math.exp(-8 * dt));
    const k = this.dist / len;
    const cam = this.camera;
    cam.position.set(pivot.x + dx * k, pivot.y + dy * k, pivot.z + dz * k);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    if (this.shake > 0.001 && o.shake > 0) {
      const s = this.shake * this.shake * 0.12 * o.shake;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.3;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);

    const fov = 72 + (o.fast ? 7 : 0);
    this.fov += (fov - this.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
