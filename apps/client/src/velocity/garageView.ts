import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RACE_IDENTITIES, type CarLoadout, type CarSlot, type Cosmetics } from '@chromashift/shared';
import { buildCharacter, type Rig } from '../characters/model';
import { SHADOW_LAYER } from '../characters/compact';
import { engine, type View } from '../game/engine';
import { Post } from '../rendering/post';
import { prefersReducedMotion, useSettings, type GraphicsSettings } from '../settings/settings';
import { CarModel } from './carModel';

/*
 * The garage: a showroom built for the car. A dark polished floor, a turntable with a light ring,
 * a curved wall with LED strips in CHROMASHIFT's paints, soft spotlights, and studio reflections on
 * the paint. The camera orbits (drag, wheel or pinch) and glides to whatever part is being chosen.
 * The car is the same model as on the track, built from the same loadout.
 */

export type GarageShot = 'show' | 'front' | 'rear' | 'side' | 'wheel' | 'lights' | 'roof' | 'interior';

const SHOTS: Record<GarageShot, { yaw: number; pitch: number; dist: number; target: [number, number, number] }> = {
  show: { yaw: 0.75, pitch: 0.2, dist: 7.6, target: [0, 0.55, 0] },
  front: { yaw: 0.02, pitch: 0.1, dist: 5.6, target: [0, 0.5, 0.6] },
  rear: { yaw: Math.PI, pitch: 0.18, dist: 5.6, target: [0, 0.6, -0.6] },
  side: { yaw: Math.PI / 2, pitch: 0.08, dist: 6.4, target: [0, 0.5, 0] },
  wheel: { yaw: 1.25, pitch: 0.04, dist: 2.8, target: [0.9, 0.35, 1.35] },
  lights: { yaw: 0.45, pitch: 0.06, dist: 3.4, target: [0.5, 0.5, 2] },
  roof: { yaw: 0.6, pitch: 0.75, dist: 5.2, target: [0, 1.1, -0.2] },
  interior: { yaw: 0.5, pitch: 0.35, dist: 3.2, target: [0, 1, 0.3] },
};

/** Where to look for each kind of part. */
export const SHOT_FOR: Partial<Record<CarSlot, GarageShot>> = {
  body: 'show', paint: 'show', accent: 'show', finish: 'show', livery: 'side', wheel: 'wheel', rim: 'wheel', tire: 'wheel', wheelfx: 'wheel',
  frontBumper: 'front', headlights: 'lights', hood: 'front', badge: 'front', rearBumper: 'rear', diffuser: 'rear', spoiler: 'rear',
  taillights: 'rear', exhaust: 'rear', plate: 'rear', roof: 'roof', accessory: 'roof', mirrors: 'interior', tint: 'interior',
  underglow: 'side', trail: 'rear', boostfx: 'rear', driftfx: 'side', victory: 'show', horn: 'front', engine: 'front',
};

const ACCENTS = [0xff3f8e, 0x19d3be, 0xffc21a];

export class GarageView implements View {
  readonly kind = 'menu';
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private post: Post;
  private car: CarModel | null = null;
  private turntable = new THREE.Group();
  private ring: THREE.Mesh;
  private driver: Rig | null = null;
  private envMap: THREE.Texture;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private yaw = SHOTS.show.yaw;
  private pitch = SHOTS.show.pitch;
  private dist = SHOTS.show.dist;
  private target = new THREE.Vector3(...SHOTS.show.target);
  private want = { ...SHOTS.show, target: new THREE.Vector3(...SHOTS.show.target) };
  private spin = 0;
  private idle = 0;
  private dragging: { x: number; y: number; id: number } | null = null;
  private pinch: { d: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private time = 0;
  private strips: THREE.MeshBasicMaterial[] = [];

  constructor(loadout: CarLoadout) {
    const g = useSettings.getState().graphics;
    const r = engine.renderer;
    this.camera = new THREE.PerspectiveCamera(36, engine.aspect, 0.1, 120);
    // Studio reflections.
    const pm = new THREE.PMREMGenerator(r);
    this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.9;
    this.scene.background = new THREE.Color(0x0e0c13);
    this.scene.fog = new THREE.Fog(0x0e0c13, 16, 34);
    const keep = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T) => (this.disposables.push(x), x);
    const lambert = g.paintQuality === 0;
    // Floor: dark, polished.
    const floor = new THREE.Mesh(
      keep(new THREE.CircleGeometry(30, 64)),
      keep(lambert ? new THREE.MeshLambertMaterial({ color: 0x1b1822 }) : new THREE.MeshStandardMaterial({ color: 0x17141d, roughness: 0.18, metalness: 0.4 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Turntable with a glowing rim.
    const plate = new THREE.Mesh(keep(new THREE.CylinderGeometry(3.4, 3.5, 0.16, 64)), keep(new THREE.MeshStandardMaterial({ color: 0x24202c, roughness: 0.3, metalness: 0.6 })));
    plate.position.y = 0.08;
    plate.receiveShadow = true;
    this.scene.add(plate);
    this.ring = new THREE.Mesh(keep(new THREE.TorusGeometry(3.45, 0.035, 8, 96)), keep(new THREE.MeshBasicMaterial({ color: 0xff3f8e })));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.16;
    this.scene.add(this.ring);
    this.scene.add(this.turntable);
    // Curved back wall with LED strips.
    const wall = new THREE.Mesh(keep(new THREE.CylinderGeometry(14, 14, 8, 96, 1, true)), keep(new THREE.MeshStandardMaterial({ color: 0x1d1924, roughness: 0.85, side: THREE.BackSide })));
    wall.position.y = 4;
    this.scene.add(wall);
    for (let i = 0; i < 3; i++) {
      const m = keep(new THREE.MeshBasicMaterial({ color: ACCENTS[i], side: THREE.DoubleSide }));
      this.strips.push(m);
      const s = new THREE.Mesh(keep(new THREE.CylinderGeometry(13.9, 13.9, 0.08, 96, 1, true)), m);
      s.position.y = 1.2 + i * 1.6;
      this.scene.add(s);
    }
    // Ceiling light panels.
    for (const x of [-2.5, 0, 2.5]) {
      const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.6, 6)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff })));
      p.rotation.x = Math.PI / 2;
      p.position.set(x, 7.6, 0);
      this.scene.add(p);
    }
    // Lights: soft key from above front, a cool fill, a warm rim from behind.
    this.scene.add(new THREE.HemisphereLight(0xdcd4ff, 0x18141f, 0.6));
    const key = new THREE.SpotLight(0xffffff, 150, 30, 0.6, 0.6, 1.4);
    key.position.set(3.5, 8, 5);
    key.target.position.set(0, 0.5, 0);
    if (g.shadowQuality > 0) {
      key.castShadow = true;
      key.shadow.mapSize.set(Math.min(2048, g.shadowResolution), Math.min(2048, g.shadowResolution));
      key.shadow.bias = -0.0004;
      key.shadow.radius = 3;
      key.shadow.camera.layers.enable(SHADOW_LAYER);
    }
    const fill = new THREE.SpotLight(0x9fb8ff, 55, 30, 0.7, 0.8, 1.4);
    fill.position.set(-6, 5, 2);
    const rim = new THREE.SpotLight(0xffc8a0, 90, 30, 0.6, 0.7, 1.4);
    rim.position.set(0, 6, -7);
    this.scene.add(key, key.target, fill, rim);
    this.setLoadout(loadout);
    this.post = new Post(r, this.scene, this.camera, g);
    r.shadowMap.autoUpdate = true;
    this.attach();
    this.resize();
  }

  /** Builds the car for a loadout (called whenever something is previewed or equipped). */
  setLoadout(l: CarLoadout) {
    const g = useSettings.getState().graphics;
    this.car?.dispose();
    this.car = new CarModel(l, { lambert: g.paintQuality === 0, detail: Math.max(1, g.modelDetail), identity: 0, showIdentity: false, texSize: g.textureQuality >= 1 ? 1024 : 512 });
    // The wheels touch the turntable: their bottom is at the suspension's resting height.
    this.car.group.position.set(0, 0.16 + 0.79, 0);
    this.car.setWheels(0.25, 0, [0.3, 0.3, 0.3, 0.3]);
    this.car.setLights(false, false);
    this.car.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.turntable.add(this.car.group);
  }

  /** The player's character standing beside the car (optional). */
  setDriver(cosmetics: Cosmetics | null) {
    if (this.driver) {
      this.driver.root.removeFromParent();
      this.driver.dispose();
      this.driver = null;
    }
    if (!cosmetics) return;
    const g = useSettings.getState().graphics;
    this.driver = buildCharacter({ cosmetics, team: new THREE.Color(RACE_IDENTITIES[0].color), weapon: 'pulse', detail: g.modelDetail, lambert: g.paintQuality === 0 });
    // On the far side of the car, a little behind the front wheel, looking out at the camera.
    this.driver.root.position.set(-2.3, 0.16, 0.9);
    this.driver.root.rotation.y = 0.9;
    this.driver.root.scale.setScalar(1.05);
    this.turntable.add(this.driver.root);
  }

  /** Glides the camera to a part. */
  look(shot: GarageShot) {
    const s = SHOTS[shot];
    this.want = { ...s, target: new THREE.Vector3(...s.target) };
    // Shots are relative to the car: unwind the turntable so the shot shows what it should.
    this.spin = 0;
    this.idle = 0;
  }

  private attach() {
    const el = engine.renderer.domElement;
    el.addEventListener('pointerdown', this.down);
    addEventListener('pointermove', this.move);
    addEventListener('pointerup', this.up);
    addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
  }
  private detach() {
    const el = engine.renderer.domElement;
    el.removeEventListener('pointerdown', this.down);
    removeEventListener('pointermove', this.move);
    removeEventListener('pointerup', this.up);
    removeEventListener('pointercancel', this.up);
    el.removeEventListener('wheel', this.wheel);
  }
  private down = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      this.dragging = null;
    } else this.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
    this.idle = 0;
  };
  private move = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.want.dist = Math.max(2.2, Math.min(12, this.want.dist * (this.pinch.d / Math.max(1, d))));
      this.pinch.d = d;
      return;
    }
    if (!this.dragging || this.dragging.id !== e.pointerId) return;
    const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
    this.dragging.x = e.clientX;
    this.dragging.y = e.clientY;
    this.want.yaw -= dx * 0.008;
    this.want.pitch = Math.max(-0.05, Math.min(1.2, this.want.pitch + dy * 0.005));
    this.idle = 0;
  };
  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.dragging?.id === e.pointerId) this.dragging = null;
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.want.dist = Math.max(2.2, Math.min(12, this.want.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    this.idle = 0;
  };

  /** Controller: right stick orbits, triggers zoom. */
  pad(dx: number, dy: number, zoom: number, dt: number) {
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(zoom) < 0.01) return;
    this.want.yaw -= dx * dt * 2.2;
    this.want.pitch = Math.max(-0.05, Math.min(1.2, this.want.pitch + dy * dt * 1.4));
    this.want.dist = Math.max(2.2, Math.min(12, this.want.dist * (1 + zoom * dt)));
    this.idle = 0;
  }

  update(dt: number) {
    this.time += dt;
    this.idle += dt;
    const reduced = prefersReducedMotion();
    // Turn slowly on its own when nobody's touching it.
    if (this.idle > 4 && !reduced) this.spin += dt * 0.18;
    this.turntable.rotation.y = this.spin;
    const k = Math.min(1, dt * 4);
    let dy = this.want.yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * k;
    this.pitch += (this.want.pitch - this.pitch) * k;
    this.dist += (this.want.dist - this.dist) * k;
    this.target.lerp(this.want.target, k);
    const t = this.target.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.spin);
    const c = this.camera;
    c.position.set(t.x + Math.sin(this.yaw + this.spin) * Math.cos(this.pitch) * this.dist, t.y + Math.sin(this.pitch) * this.dist, t.z + Math.cos(this.yaw + this.spin) * Math.cos(this.pitch) * this.dist);
    c.position.y = Math.max(0.25, c.position.y);
    c.lookAt(t);
    this.car?.update(dt);
    this.driver?.root.updateMatrixWorld();
    // LED strips breathe through the paints.
    if (!reduced) this.strips.forEach((m, i) => m.color.setHSL(((this.time * 0.03 + i / 3) % 1), 0.85, 0.58));
    (this.ring.material as THREE.MeshBasicMaterial).color.setHSL((this.time * 0.05) % 1, 0.9, 0.6);
  }

  render(dt: number) {
    this.post.render(dt);
  }

  resize() {
    this.camera.aspect = engine.aspect;
    // On wide screens the item panel covers the left: centre the car in the space beside it.
    const shift = innerWidth > 760 ? Math.min(190, innerWidth * 0.17) : 0;
    if (shift) this.camera.setViewOffset(innerWidth, innerHeight, -shift, 0, innerWidth, innerHeight);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.post.setSize();
  }

  applyGraphics(g: GraphicsSettings) {
    this.post.dispose();
    this.post = new Post(engine.renderer, this.scene, this.camera, g);
  }

  restore() {}

  dispose() {
    this.detach();
    this.car?.dispose();
    this.setDriver(null);
    for (const d of this.disposables) d.dispose();
    this.envMap.dispose();
    this.post.dispose();
    this.scene.environment = null;
  }
}
