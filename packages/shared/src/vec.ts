// Minimal allocation-free vector helpers on plain {x,y,z} objects (shared by client and server).
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const UP: Readonly<Vec3> = Object.freeze(v3(0, 1, 0));

export function set(o: Vec3, x: number, y: number, z: number): Vec3 {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
}
export function copy(o: Vec3, a: Vec3): Vec3 {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
}
export function add(o: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(o, a.x + b.x, a.y + b.y, a.z + b.z);
}
export function sub(o: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(o, a.x - b.x, a.y - b.y, a.z - b.z);
}
export function scale(o: Vec3, a: Vec3, s: number): Vec3 {
  return set(o, a.x * s, a.y * s, a.z * s);
}
/** o = a + b * s */
export function addScaled(o: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  return set(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export function cross(o: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
export const len = (a: Vec3) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const dist2 = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
export const dist = (a: Vec3, b: Vec3) => Math.sqrt(dist2(a, b));
export const distXZ = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export function normalize(o: Vec3, a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? scale(o, a, 1 / l) : set(o, 0, 0, 0);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  return (a < 0 ? a + Math.PI * 2 : a) - Math.PI;
}
/** Frame-rate independent exponential approach factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** View direction. yaw 0 looks down -Z (three.js camera convention), pitch > 0 looks up. */
export function dirFromAngles(o: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return set(o, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
export const forwardXZ = (o: Vec3, yaw: number) => set(o, -Math.sin(yaw), 0, -Math.cos(yaw));
export const rightXZ = (o: Vec3, yaw: number) => set(o, Math.cos(yaw), 0, -Math.sin(yaw));
export const yawOf = (d: Vec3) => Math.atan2(-d.x, -d.z);
export const pitchOf = (d: Vec3) => Math.atan2(d.y, Math.hypot(d.x, d.z));

/** Axes of a box rotated by yaw (around Y) then pitch (around local X) — Euler order 'YXZ'. */
export function blockAxes(yaw: number, pitch: number): [Vec3, Vec3, Vec3] {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return [v3(cy, 0, -sy), v3(sp * sy, cp, sp * cy), v3(cp * sy, -sp, cp * cy)];
}
/** Quaternion {x,y,z,w} for the same rotation as blockAxes. */
export function blockQuat(yaw: number, pitch: number) {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}
