import * as THREE from 'three';
import {
  CAR_HALF, DRIFT_FX, ITEM_INFO, PART_COUNT, QUERY_TRACK, RACE_IDENTITIES, RB, TRAILS, VICTORIES, emptyRaceInput,
  type CarView, type RaceEvent, type RaceInput, type RaceResult,
} from '@chromashift/shared';
import RAPIER from '@dimforge/rapier3d-compat';
import { audio } from '../audio/audio';
import { engine, type View } from '../game/engine';
import type { InputManager } from '../game/input';
import { Post } from '../rendering/post';
import { visualTier } from '../rendering/sky';
import { prefersReducedMotion, useSettings, type GraphicsSettings } from '../settings/settings';
import { useUi } from '../state/ui';
import { CarModel } from './carModel';
import { RaceAudio } from './raceAudio';
import type { RaceSource } from './raceSource';
import { initialRaceHud, raceControl, useRaceHud, useRaceMap, type RaceHudState } from './state';
import { buildTrackScene, type TrackScene } from './trackScene';

/*
 * Draws and drives a VELOCITY race from any RaceSource (this device, or a host elsewhere). The
 * render loop is ours, not React's: the HUD store is refreshed about 15 times a second.
 */

export interface RaceOutcome {
  result: RaceResult;
  you: number;
  xp: number;
  recorded: boolean;
}

type HudStore = typeof useRaceHud;

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

/** Chase camera: behind and above, swinging with the car, wider at speed, never through a wall. */
class RaceCamera {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private yaw = 0;
  private ready = false;
  shake = 0;
  constructor(aspect: number, far: number) {
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.15, far);
  }
  update(dt: number, car: CarView, world: RAPIER.World, preset: 'near' | 'far' | 'hood', lookBack: boolean, boosting: boolean, reduced: boolean) {
    const cam = this.camera;
    const q = tmpQ.set(car.q.x, car.q.y, car.q.z, car.q.w);
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(q);
    const speed = Math.hypot(car.v.x, car.v.z);
    // Follow a blend of where the car points and where it's going (drifts look sideways on).
    let heading = Math.atan2(fwd.x, fwd.z);
    if (speed > 4) {
      const travel = Math.atan2(car.v.x, car.v.z);
      let d = travel - heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 1.6) heading += d * 0.45;
    }
    if (lookBack) heading += Math.PI;
    if (!this.ready) this.yaw = heading;
    let dy = heading - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * (lookBack ? 30 : 7));
    const fovTarget = 62 + Math.min(18, speed * 0.32) + (boosting ? 7 : 0);
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 4);
    if (preset === 'hood') {
      const p = tmpV2.set(0, 0.62, lookBack ? -1.2 : 0.35).applyQuaternion(q).add(car.p as THREE.Vector3Like);
      cam.position.copy(p);
      cam.quaternion.copy(q);
      if (lookBack) cam.rotateY(Math.PI);
      cam.rotateY(Math.PI);
      cam.updateProjectionMatrix();
      this.ready = true;
      return;
    }
    const dist = (preset === 'far' ? 8.6 : 6.3) + speed * 0.025;
    const height = preset === 'far' ? 3 : 2.15;
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    const want = tmpV2.set(car.p.x - dx * dist, car.p.y + height, car.p.z - dz * dist);
    // Pull in if a wall is in the way.
    const ox = car.p.x, oy = car.p.y + 1.1, oz = car.p.z;
    const rx = want.x - ox, ry = want.y - oy, rz = want.z - oz;
    const rl = Math.hypot(rx, ry, rz) || 1;
    ray.origin = { x: ox, y: oy, z: oz };
    ray.dir = { x: rx / rl, y: ry / rl, z: rz / rl };
    const hit = world.castRay(ray, rl, true, undefined, QUERY_TRACK);
    if (hit && hit.timeOfImpact < rl) {
      const k = Math.max(0.25, (hit.timeOfImpact - 0.4) / rl);
      want.set(ox + rx * k, oy + ry * k, oz + rz * k);
    }
    if (!this.ready) this.pos.copy(want);
    this.pos.lerp(want, Math.min(1, dt * 9));
    this.pos.y = Math.max(this.pos.y, car.p.y + 0.6);
    cam.position.copy(this.pos);
    if (this.shake > 0 && !reduced) {
      const s = this.shake * useSettings.getState().gameplay.cameraShake;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(car.p.x + dx * 4, car.p.y + 1, car.p.z + dz * 4);
    cam.updateProjectionMatrix();
    this.ready = true;
  }
}

/** Pooled point particles of one look (smoke, sparks, flames…). */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private n = 0;
  constructor(
    private cap: number,
    size: number,
    additive: boolean,
    private grav: number,
    private drag: number,
    tex: THREE.Texture,
  ) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : 0.75 });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    const c = color === -1 ? new THREE.Color().setHSL(Math.random(), 0.9, 0.6) : new THREE.Color(color);
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.life[i] = life;
    this.max[i] = life;
  }
  update(dt: number) {
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap with the last live one.
        const j = --this.n;
        for (let a = 0; a < 3; a++) {
          this.pos[i * 3 + a] = this.pos[j * 3 + a];
          this.vel[i * 3 + a] = this.vel[j * 3 + a];
          this.col[i * 3 + a] = this.col[j * 3 + a];
        }
        this.life[i] = this.life[j];
        this.max[i] = this.max[j];
        i--;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= k;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      }
      // Fade by darkening (additive) or by scaling colour (normal).
      const f = Math.min(1, (this.life[i] / this.max[i]) * 2.5);
      this.col[i * 3] *= 0.985 + 0.015 * f;
      this.col[i * 3 + 1] *= 0.985 + 0.015 * f;
      this.col[i * 3 + 2] *= 0.985 + 0.015 * f;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

let dotTex: THREE.Texture | null = null;
function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

interface Seat {
  index: number;
  localId: number;
  input: InputManager;
  hud: HudStore;
  cam: RaceCamera;
  post: Post;
  steer: number;
  lookBack: boolean;
  lapStart: number;
  lastLap: number | null;
  notice: { id: number; text: string; tone: 'good' | 'bad' | 'neutral'; t: number } | null;
  hit: { part: number; at: number } | null;
}

/** Renders and drives one race. */
export class RaceView implements View {
  readonly kind = 'match';
  private scene = new THREE.Scene();
  readonly seats: Seat[] = [];
  private track: TrackScene;
  private models = new Map<number, CarModel>();
  private smoke: Particles;
  private sparks: Particles;
  private flames: Particles;
  private bits: Particles;
  private skids: THREE.InstancedMesh;
  private skidN = 0;
  private boxMesh: THREE.InstancedMesh | null = null;
  private hazardMeshes = new Map<number, THREE.Mesh>();
  private shields = new Map<number, THREE.Mesh>();
  private sound = new RaceAudio();
  private inputs = new Map<number, RaceInput>();
  private hudT = 0;
  private time = 0;
  private noticeId = 1;
  private endedAt = 0;
  private done = false;
  private frame = 0;
  private lastCount = -1;
  private celebrated = new Set<number>();
  private skidMat: THREE.MeshBasicMaterial;
  private shieldGeo = new THREE.SphereGeometry(2.6, 20, 14);
  private shieldMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(
    readonly source: RaceSource,
    private onEnd: (o: RaceOutcome) => void,
  ) {
    const g = useSettings.getState().graphics;
    const r = engine.renderer;
    const tier = visualTier(g);
    this.track = buildTrackScene(this.scene, r, source.path, {
      tier,
      lambert: g.paintQuality === 0,
      shadows: g.shadowQuality > 0,
      shadowResolution: g.shadowResolution,
      drawDistance: g.drawDistance,
      reflections: g.reflections,
      textureQuality: g.textureQuality,
    });
    for (const info of source.roster) {
      const m = new CarModel(info.car, { lambert: g.paintQuality === 0, detail: g.modelDetail, identity: info.identity, showIdentity: true, texSize: g.textureQuality >= 2 ? 1024 : 512 });
      this.scene.add(m.group);
      this.models.set(info.id, m);
    }
    const tex = softDot();
    const dens = Math.max(0.25, g.particles);
    this.smoke = new Particles(Math.round(600 * dens) + 60, 2.2, false, -0.6, 1.2, tex);
    this.sparks = new Particles(Math.round(500 * dens) + 60, 0.28, true, 14, 0.6, tex);
    this.flames = new Particles(Math.round(500 * dens) + 60, 0.9, true, -1, 3, tex);
    this.bits = new Particles(Math.round(900 * dens) + 80, 0.45, true, 3, 0.4, tex);
    this.scene.add(this.smoke.points, this.sparks.points, this.flames.points, this.bits.points);
    this.skidMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.9).rotateX(-Math.PI / 2), this.skidMat, 700);
    this.skids.count = 0;
    this.skids.frustumCulled = false;
    this.scene.add(this.skids);
    if (source.config.preset === 'arcade') this.buildBoxes();
    // Minimap outline.
    const p = source.path, b = p.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const pts: string[] = [];
    for (let i = 0; i < p.n; i += 3) pts.push(`${(((p.px[i] - b.minX) / span) * 100).toFixed(1)},${(((p.pz[i] - b.minZ) / span) * 100).toFixed(1)}`);
    useRaceMap.setState({ path: `M${pts.join('L')}Z`, viewBox: `-4 -4 108 108` });

    const cam0 = new RaceCamera(engine.aspect, this.far(g));
    this.seats.push(this.makeSeat(0, source.localIds[0], engine.input, useRaceHud, cam0, g));
    engine.input.wantsLock = false;
    engine.input.unlock();
    engine.input.onPause = () => {
      if (this.source.phase() !== 'ended') useUi.getState().setPaused(true);
    };
    engine.input.onMap = engine.input.onView = engine.input.onChat = null;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    audio.startMusic('match');
    raceControl.finishNow = source.finishNow ? () => source.finishNow?.() : null;
  }

  private far(g: GraphicsSettings) {
    return Math.max(260, g.drawDistance * 2.2);
  }

  private makeSeat(index: number, localId: number, input: InputManager, hud: HudStore, cam: RaceCamera, g: GraphicsSettings): Seat {
    const share = 1 / Math.max(1, this.seats.length + (index ? 0 : 0) + 1);
    const info = this.source.roster.find((x) => x.id === localId);
    hud.setState({ ...initialRaceHud, active: true, laps: this.source.config.laps, cps: this.source.path.checkpoints.length, identity: info?.identity ?? 0, name: info?.name ?? '', arcade: this.source.config.preset === 'arcade', online: this.source.online, damage: new Array(PART_COUNT).fill(0) });
    return { index, localId, input, hud, cam, post: new Post(engine.renderer, this.scene, cam.camera, g, share), steer: 0, lookBack: false, lapStart: 0, lastLap: null, notice: null, hit: null };
  }

  /** Split screen: player two's car gets the right half. */
  addSeat(localId: number, input: InputManager, hud: HudStore) {
    if (this.seats.length > 1) return;
    const g = useSettings.getState().graphics;
    const cam = new RaceCamera(engine.aspect / 2, this.far(g));
    this.seats.push(this.makeSeat(1, localId, input, hud, cam, g));
    input.onPause = () => {
      if (this.source.phase() !== 'ended') useUi.getState().setPaused(true);
    };
    this.buildPosts(g);
  }

  private buildPosts(g: GraphicsSettings) {
    const share = 1 / this.seats.length;
    for (const s of this.seats) {
      s.post.dispose();
      s.post = new Post(engine.renderer, this.scene, s.cam.camera, g, share);
      s.cam.camera.aspect = engine.aspect * share;
      s.cam.camera.updateProjectionMatrix();
    }
  }

  private buildBoxes() {
    const g = new THREE.BoxGeometry(1.3, 1.3, 1.3);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3f8e, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.8 });
    this.boxMesh = new THREE.InstancedMesh(g, m, Math.max(1, this.source.boxes().length));
    this.boxMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.boxMesh.count * 3), 3);
    this.scene.add(this.boxMesh);
  }

  private notice(seat: Seat, text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral') {
    seat.notice = { id: this.noticeId++, text, tone, t: 2.4 };
  }

  private seatOf(id: number) {
    return this.seats.find((s) => s.localId === id);
  }

  private readInputs(paused: boolean) {
    const s = useSettings.getState().controls;
    for (const seat of this.seats) {
      const input = seat.input;
      input.pollPad();
      const inp = this.inputs.get(seat.localId) ?? { ...emptyRaceInput() };
      this.inputs.set(seat.localId, inp);
      inp.seq++;
      if (paused) {
        inp.steer = inp.throttle = inp.brake = 0;
        inp.buttons = 0;
        input.consumeRace();
        continue;
      }
      const ax = input.raceAxes();
      // Keys and D-pad steer smoothly; sticks are direct.
      const target = ax.steer * Math.min(1, s.raceSteer);
      if (ax.analog) seat.steer = target;
      else seat.steer += (target - seat.steer) * Math.min(1, (target === 0 ? 10 : 5.5) / 60 * 1);
      inp.steer = seat.steer;
      inp.throttle = ax.throttle;
      inp.brake = Math.max(ax.brake, input.raceHeld('reverse') ? 1 : 0);
      let b = 0;
      if (input.raceHeld('handbrake')) b |= RB.HANDBRAKE;
      if (input.raceHeld('boost')) b |= RB.BOOST;
      if (input.raceHeld('item') || input.racePressed('item')) b |= RB.ITEM;
      if (input.raceHeld('horn') || input.racePressed('horn')) b |= RB.HORN;
      if (input.raceHeld('reset') || input.racePressed('reset')) b |= RB.RESET;
      seat.lookBack = input.raceHeld('lookBack');
      if (seat.lookBack) b |= RB.LOOKBACK;
      inp.buttons = b;
      if (input.racePressed('camera')) {
        const order = ['near', 'far', 'hood'] as const;
        const cur = useSettings.getState().controls.raceCamera;
        useSettings.getState().set('controls', { raceCamera: order[(order.indexOf(cur) + 1) % 3] });
      }
      if (input.racePressed('pause') && this.source.phase() !== 'ended') useUi.getState().setPaused(true);
      input.consumeRace();
    }
  }

  update(dt: number) {
    this.time += dt;
    this.frame++;
    const ui = useUi.getState();
    const paused = ui.paused;
    this.readInputs(paused);
    const events = paused && !this.source.online ? [] : this.source.update(dt, this.inputs);
    const cars = this.source.cars();
    const reduced = prefersReducedMotion();
    for (const e of events) this.event(e, cars);
    const night = this.track.look.night ?? false;
    let n = 0;
    for (const c of cars) {
      const m = this.models.get(c.id);
      if (!m) continue;
      m.group.position.set(c.p.x, c.p.y, c.p.z);
      m.group.quaternion.set(c.q.x, c.q.y, c.q.z, c.q.w);
      m.setWheels(c.steer, (m.group.userData.spin = (m.group.userData.spin ?? 0) + (Math.hypot(c.v.x, c.v.z) / 0.36) * dt * (c.gear === 0 ? -1 : 1)), c.comp);
      m.setLights(c.throttle < 0.05 && Math.hypot(c.v.x, c.v.z) > 2, night);
      m.setDamage(c.damage);
      m.update(dt);
      m.group.visible = !c.ghost || Math.floor(this.time * 10) % 2 === 0 || c.finished;
      this.carEffects(c, m, dt, n++);
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.flames.update(dt);
    this.bits.update(dt);
    this.updatePickups(dt);
    this.track.update(reduced ? 0 : dt);
    // Cameras and audio follow the first seat's car.
    const preset = useSettings.getState().controls.raceCamera;
    for (const seat of this.seats) {
      const me = cars.find((c) => c.id === seat.localId);
      if (me) seat.cam.update(dt, me, this.source.world, preset, seat.lookBack, me.boost, reduced);
    }
    const me0 = cars.find((c) => c.id === this.seats[0].localId);
    if (me0) this.track.follow(me0.p.x, me0.p.y, me0.p.z);
    this.engineSounds(cars);
    this.hudT += dt;
    if (this.hudT > 1 / 15) {
      this.pushHud(cars);
      this.hudT = 0;
    }
    if (this.source.phase() === 'ended' && this.source.result() && !this.done) {
      if (!this.endedAt) this.endedAt = this.time;
      if (this.time - this.endedAt > 3.2) {
        this.done = true;
        const you = this.seats[0].localId;
        this.onEnd({ result: this.source.result()!, you, xp: this.source.xp(you), recorded: false });
      }
    }
  }

  private carEffects(c: CarView, m: CarModel, dt: number, k: number) {
    const q = tmpQ.set(c.q.x, c.q.y, c.q.z, c.q.w);
    const speed = Math.hypot(c.v.x, c.v.z);
    const dens = useSettings.getState().graphics.particles;
    const local = (x: number, y: number, z: number) => tmpV.set(x, y, z).applyQuaternion(q).add(c.p as THREE.Vector3Like);
    // Drift smoke and skid marks from the rear wheels.
    const sliding = (c.drift || c.slip > 0.45) && speed > 6 && !c.ghost;
    if (sliding) {
      const fx = DRIFT_FX[m.loadout.driftfx] ?? DRIFT_FX.white;
      for (const side of [1, -1]) {
        const p = local(side * 0.86, -0.75, -1.38);
        if (Math.random() < 0.8 * dens) {
          if (fx.kind === 'sparks') this.sparks.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 3 - c.v.x * 0.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3 - c.v.z * 0.2, fx.color, 0.4);
          else if (fx.kind === 'smoke') this.smoke.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5, fx.color, 1.1 + Math.random() * 0.6);
          else this.bits.emit(p.x, p.y + 0.3, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, fx.color, 0.9);
        }
        if (this.frame % 2 === k % 2) this.skid(p.x, p.y + 0.06, p.z, Math.atan2(c.v.x, c.v.z));
      }
    }
    // Boost flames out of the exhausts.
    if ((c.boost || c.turbo > 0) && !c.ghost)
      for (const e of m.exhausts) {
        const p = local(e.x, e.y, e.z - 0.1);
        const back = tmpV2.set(0, 0, -1).applyQuaternion(q);
        if (Math.random() < 0.9) this.flames.emit(p.x, p.y, p.z, back.x * 6 + c.v.x * 0.8, back.y * 6 + 0.3, back.z * 6 + c.v.z * 0.8, m.fx.boostColor, 0.22 + Math.random() * 0.12);
      }
    // Trails at speed.
    const trail = TRAILS[m.loadout.trail];
    if (trail && trail.kind !== 'none' && speed > 15 && !c.ghost && Math.random() < 0.6 * dens) {
      const p = local((Math.random() - 0.5) * 1.2, -0.2, -2.2);
      const col = trail.kind === 'rainbow' ? -1 : (trail.color ?? 0xffffff);
      if (trail.kind === 'flame' || trail.kind === 'comet') this.flames.emit(p.x, p.y, p.z, 0, 0.2, 0, col, 0.5);
      else if (trail.kind === 'paint') this.smoke.emit(p.x, p.y - 0.3, p.z, 0, -1, 0, col, 0.8);
      else this.bits.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, col, trail.kind === 'lines' ? 0.35 : 0.7);
    }
    // Smoke from a wrecked engine.
    const engineDmg = c.damage[7] ?? 0;
    if (engineDmg > 0.55 && Math.random() < (engineDmg - 0.5) * 0.8 * dens) {
      const p = local(0, 0.3, 1.6);
      this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.8 + c.v.x * 0.3, 1.2, (Math.random() - 0.5) * 0.8 + c.v.z * 0.3, engineDmg > 0.85 ? 0x2a2a2a : 0x9a9a9a, 1.6);
    }
    // Shield bubble.
    let s = this.shields.get(c.id);
    if (c.shield) {
      if (!s) {
        s = new THREE.Mesh(this.shieldGeo, this.shieldMat);
        this.scene.add(s);
        this.shields.set(c.id, s);
      }
      s.position.set(c.p.x, c.p.y + 0.2, c.p.z);
      s.scale.setScalar(1 + Math.sin(this.time * 6) * 0.03);
      s.visible = true;
    } else if (s) s.visible = false;
  }

  private skid(x: number, y: number, z: number, yaw: number) {
    const i = this.skidN++ % this.skids.instanceMatrix.count;
    tmpQ.setFromAxisAngle(UP, yaw);
    this.skids.setMatrixAt(i, new THREE.Matrix4().compose(tmpV.set(x, y, z), tmpQ, tmpV2.set(1, 1, 1)));
    this.skids.count = Math.min(this.skids.instanceMatrix.count, this.skidN);
    this.skids.instanceMatrix.needsUpdate = true;
  }

  private updatePickups(dt: number) {
    if (this.boxMesh) {
      const boxes = this.source.boxes();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.time * 0.7, this.time * 1.3, 0));
      const c = new THREE.Color();
      boxes.forEach((b, i) => {
        const s = b.on ? 1 : 0.001;
        this.boxMesh!.setMatrixAt(i, new THREE.Matrix4().compose(tmpV.set(b.x, b.y + Math.sin(this.time * 2 + i) * 0.2, b.z), q, tmpV2.set(s, s, s)));
        c.setHSL((this.time * 0.15 + i * 0.07) % 1, 0.85, 0.6);
        this.boxMesh!.setColorAt(i, c);
      });
      this.boxMesh.instanceMatrix.needsUpdate = true;
      if (this.boxMesh.instanceColor) this.boxMesh.instanceColor.needsUpdate = true;
    }
    const live = new Set<number>();
    for (const h of this.source.hazards()) {
      live.add(h.id);
      let m = this.hazardMeshes.get(h.id);
      if (!m) {
        m =
          h.kind === 'slick'
            ? new THREE.Mesh(new THREE.CircleGeometry(3.4, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff3f8e, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8 }))
            : new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshStandardMaterial({ color: 0xffdddd, emissive: 0xff3040, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
        this.scene.add(m);
        this.hazardMeshes.set(h.id, m);
      }
      m.position.set(h.x, h.y + (h.kind === 'slick' ? 0.05 : 0.6 + Math.sin(this.time * 2) * 0.2), h.z);
      if (h.kind === 'decoy') m.rotation.set(this.time * 0.7, this.time * 1.3, 0);
    }
    for (const [id, m] of this.hazardMeshes)
      if (!live.has(id)) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.removeFromParent();
        this.hazardMeshes.delete(id);
      }
    void dt;
  }

  private engineSounds(cars: CarView[]) {
    const cam = this.seats[0].cam.camera;
    const right = tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const list = cars
      .map((c) => {
        const d = Math.hypot(c.p.x - cam.position.x, c.p.y - cam.position.y, c.p.z - cam.position.z);
        const local = this.seats.some((s) => s.localId === c.id);
        return { c, d: local ? 0 : d, local };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .filter((x) => x.d < 70);
    const me = cars.find((c) => c.id === this.seats[0].localId);
    this.sound.engines(
      list.map(({ c, d, local }) => {
        const info = this.source.roster.find((r) => r.id === c.id)!;
        const dx = c.p.x - cam.position.x, dz = c.p.z - cam.position.z;
        return { id: c.id, loadout: info.car, rpm: c.rpm, throttle: c.throttle, gain: local ? 1 : 1 / (1 + d / 10), pan: local ? 0 : (dx * right.x + dz * right.z) / Math.max(1, d) };
      }),
      me ? { slip: me.drift ? Math.max(0.5, me.slip) : me.slip, speed: Math.hypot(me.v.x, me.v.z) } : null,
    );
  }

  private gainAt(x: number, y: number, z: number) {
    const p = this.seats[0].cam.camera.position;
    return 1 / (1 + Math.hypot(x - p.x, y - p.y, z - p.z) / 12);
  }

  private event(e: RaceEvent, cars: CarView[]) {
    const seat = 'id' in e ? this.seatOf(e.id) : undefined;
    const car = 'id' in e ? cars.find((c) => c.id === e.id) : undefined;
    switch (e.t) {
      case 'count':
        if (e.n !== this.lastCount) audio.play('count');
        this.lastCount = e.n;
        break;
      case 'go':
        audio.play('go');
        for (const s of this.seats) this.notice(s, 'GO!', 'good');
        break;
      case 'cp':
        if (seat) audio.play('click', { gain: 0.5 });
        break;
      case 'lap':
        if (seat) {
          seat.lastLap = e.time;
          seat.lapStart = this.source.time();
          if (e.lap < this.source.config.laps) {
            this.notice(seat, e.lap === this.source.config.laps - 1 ? 'Final lap!' : `Lap ${e.lap + 1}/${this.source.config.laps}${e.best ? '  ·  Best lap!' : ''}`, 'good');
            audio.play('ready');
          }
        }
        break;
      case 'finish':
        if (seat) {
          this.notice(seat, `Finished ${ordinal(e.pos)}!`, e.pos <= 3 ? 'good' : 'neutral');
          audio.jingle(e.pos <= 3);
          if (e.pos <= 3) this.celebrate(e.id, cars);
        }
        break;
      case 'impact': {
        const k = Math.min(1, e.dv / 14);
        for (let i = 0; i < 6 + k * 18; i++) this.sparks.emit(e.x, e.y, e.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8, 0xffc04a, 0.5 + Math.random() * 0.4);
        this.sound.impact(e.dv, this.gainAt(e.x, e.y, e.z));
        if (seat) {
          seat.cam.shake = Math.min(0.8, 0.15 + k * 0.6);
          if (e.part >= 0) seat.hit = { part: e.part, at: performance.now() };
          seat.input.rumble(0.3 + k * 0.6, 120 + k * 200);
        }
        break;
      }
      case 'drift':
        if (car) {
          const m = this.models.get(e.id);
          if (seat) {
            this.notice(seat, ['', 'Mini-turbo!', 'Super turbo!', 'Ultra turbo!'][e.tier], 'good');
            this.sound.whoosh(1, e.tier > 1);
          }
          if (m)
            for (const ex of m.exhausts)
              for (let i = 0; i < 10 * e.tier; i++) {
                const p = tmpV.copy(ex).applyQuaternion(tmpQ.set(car.q.x, car.q.y, car.q.z, car.q.w)).add(car.p as THREE.Vector3Like);
                this.flames.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, [0, 0x5fa8ff, 0xff7a1a, 0xb98cff][e.tier], 0.4);
              }
        }
        break;
      case 'item':
        if (seat) {
          audio.play('special', { gain: 0.6 });
          this.notice(seat, ITEM_INFO[e.item].name, 'good');
        }
        break;
      case 'use':
        if (e.item === 'shock')
          for (let i = 0; i < 80; i++) {
            const a = (i / 80) * Math.PI * 2;
            this.bits.emit(e.x, e.y + 0.4, e.z, Math.cos(a) * 18, 0.5, Math.sin(a) * 18, 0x9fe8ff, 0.6);
          }
        if (e.item === 'turbo' || e.item === 'slipstream') this.sound.whoosh(this.gainAt(e.x, e.y, e.z), true);
        if (e.item === 'repair') for (let i = 0; i < 30; i++) this.bits.emit(e.x, e.y + 1, e.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0x7dff8a, 0.8);
        break;
      case 'respawn':
        if (car) for (let i = 0; i < 24; i++) this.smoke.emit(car.p.x, car.p.y, car.p.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 0xffffff, 0.8);
        if (seat) this.notice(seat, 'Back on track', 'neutral');
        break;
      case 'horn': {
        const info = this.source.roster.find((r) => r.id === e.id);
        if (car && info) this.sound.horn(info.car.horn, seat ? 1 : this.gainAt(car.p.x, car.p.y, car.p.z));
        break;
      }
      case 'overtake':
        if (seat && this.source.phase() === 'racing') this.notice(seat, `Up to ${ordinal(e.pos)}`, 'good');
        break;
      case 'spin':
        if (seat) this.notice(seat, 'Slipped!', 'bad');
        break;
      case 'wrong':
        break;
    }
  }

  private celebrate(id: number, cars: CarView[]) {
    if (this.celebrated.has(id)) return;
    this.celebrated.add(id);
    const c = cars.find((x) => x.id === id);
    const info = this.source.roster.find((r) => r.id === id);
    if (!c || !info) return;
    const kind = VICTORIES[info.car.victory] ? info.car.victory : 'confetti';
    const col = RACE_IDENTITIES[info.identity % 6].color;
    const burst = (y: number, n: number, speed: number, color: number, life: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
        this.bits.emit(c.p.x, c.p.y + y, c.p.z, Math.cos(a) * Math.cos(e) * speed, Math.abs(Math.sin(e)) * speed + 2, Math.sin(a) * Math.cos(e) * speed, color, life);
      }
    };
    switch (kind) {
      case 'fireworks':
        for (let k = 0; k < 4; k++) setTimeout(() => burst(10 + k * 3, 90, 9, [0xff3f8e, 0x19d3be, 0xffc21a, 0x8b5cff][k], 1.6), k * 450);
        break;
      case 'paint':
        burst(1.5, 160, 10, col, 1.2);
        break;
      case 'stars':
        for (let i = 0; i < 160; i++) this.bits.emit(c.p.x + (Math.random() - 0.5) * 14, c.p.y + 10 + Math.random() * 6, c.p.z + (Math.random() - 0.5) * 14, 0, -2, 0, 0xffd23f, 3);
        break;
      case 'lights':
        for (let i = 0; i < 6; i++) for (let k = 0; k < 30; k++) this.bits.emit(c.p.x, c.p.y + k * 0.8, c.p.z, Math.cos(i) * k * 0.3, 0, Math.sin(i) * k * 0.3, [0xff3f8e, 0x19d3be, 0xffc21a][i % 3], 1.8);
        break;
      case 'spin':
        for (let i = 0; i < 60; i++) this.smoke.emit(c.p.x + (Math.random() - 0.5) * 6, c.p.y, c.p.z + (Math.random() - 0.5) * 6, 0, 1, 0, 0xe8ecf2, 2);
        break;
      default:
        burst(3, 200, 7, -1, 2.2);
    }
  }

  private pushHud(cars: CarView[]) {
    const src = this.source, p = src.path;
    const b = p.bounds, span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const dots = cars.map((c) => {
      const info = src.roster.find((r) => r.id === c.id);
      return { id: c.id, x: ((c.p.x - b.minX) / span) * 100, z: ((c.p.z - b.minZ) / span) * 100, identity: info?.identity ?? 0, me: this.seats.some((s) => s.localId === c.id) };
    });
    const ordered = [...cars].sort((a, c) => a.position - c.position);
    const lead = ordered[0];
    const now = performance.now();
    for (const seat of this.seats) {
      const me = cars.find((c) => c.id === seat.localId);
      if (!me) continue;
      if (seat.notice) {
        seat.notice.t -= 1 / 15;
        if (seat.notice.t <= 0) seat.notice = null;
      }
      const speed = Math.hypot(me.v.x, me.v.y, me.v.z) * 3.6;
      const board = ordered.map((c) => {
        const info = src.roster.find((r) => r.id === c.id);
        const gapS = c === lead ? '' : c.finished && lead.finished ? `+${(c.finishT - lead.finishT).toFixed(1)}s` : `${Math.max(0, Math.round((lead.prog - c.prog) * (p.length / p.n)))} m`;
        return { id: c.id, name: info?.name ?? '?', position: c.position, identity: info?.identity ?? 0, me: c.id === seat.localId, bot: !!info?.bot, gap: gapS, finished: c.finished };
      });
      const state: Partial<RaceHudState> = {
        active: true,
        phase: src.phase(),
        count: src.phase() === 'countdown' ? Math.max(1, Math.ceil(3 - src.phaseT())) : src.phase() === 'grid' ? 0 : -1,
        speed,
        rpm: me.rpm,
        gear: me.gear,
        lap: Math.min(src.config.laps, me.lap + 1),
        position: me.position,
        field: cars.length,
        time: src.time(),
        lapTime: me.finished ? 0 : src.time() - seat.lapStart,
        best: me.best,
        lastLap: seat.lastLap,
        cp: Math.max(0, me.nextCp - 1),
        wrong: me.wrong,
        drift: me.driftT,
        driftTier: me.drift ? (me.driftT > 3 ? 3 : me.driftT > 1.9 ? 2 : me.driftT > 0.9 ? 1 : 0) : 0,
        boostMeter: me.meter,
        boosting: me.boost,
        item: me.item,
        finished: me.finished,
        finishPos: me.finished ? me.position : 0,
        damage: Array.from(me.damage),
        hit: seat.hit && now - seat.hit.at < 1500 ? seat.hit : null,
        dots,
        notice: seat.notice ? { id: seat.notice.id, text: seat.notice.text, tone: seat.notice.tone } : null,
        board,
        ping: src.ping(),
        lookBack: seat.lookBack,
      };
      seat.hud.setState(state);
    }
    void CAR_HALF;
  }

  render(dt: number) {
    const r = engine.renderer;
    if (this.frame === 1) this.seats[0].post.warm();
    const q = useSettings.getState().graphics.shadowQuality;
    if (q > 0 && this.frame % (q >= 3 ? 1 : q === 2 ? 2 : 3) === 0) r.shadowMap.needsUpdate = true;
    if (this.seats.length === 1) {
      this.track.sky.fitTo(this.seats[0].cam.camera, r.getDrawingBufferSize(tmpSize).y);
      this.seats[0].post.render(dt);
      return;
    }
    const size = r.getSize(tmpSize);
    const w = size.x / this.seats.length;
    r.setScissorTest(true);
    this.seats.forEach((seat, i) => {
      r.setViewport(i * w, 0, w, size.y);
      r.setScissor(i * w, 0, w, size.y);
      this.track.sky.fitTo(seat.cam.camera, r.getDrawingBufferSize(tmpSize2).y);
      seat.post.render(dt);
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
  }

  resize() {
    const share = 1 / this.seats.length;
    for (const s of this.seats) {
      s.cam.camera.aspect = engine.aspect * share;
      s.cam.camera.updateProjectionMatrix();
      s.post.setSize();
    }
  }

  applyGraphics(g: GraphicsSettings) {
    this.buildPosts(g);
    const far = this.far(g);
    for (const s of this.seats) {
      s.cam.camera.far = far;
      s.cam.camera.updateProjectionMatrix();
    }
    this.track.setFar(far);
    engine.renderer.shadowMap.needsUpdate = true;
  }

  restore() {
    engine.renderer.shadowMap.needsUpdate = true;
  }

  dispose() {
    raceControl.finishNow = null;
    this.sound.dispose();
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    for (const p of [this.smoke, this.sparks, this.flames, this.bits]) p.dispose();
    this.skids.geometry.dispose();
    this.skidMat.dispose();
    this.boxMesh?.geometry.dispose();
    (this.boxMesh?.material as THREE.Material | undefined)?.dispose();
    for (const m of this.hazardMeshes.values()) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.shieldGeo.dispose();
    this.shieldMat.dispose();
    for (const s of this.seats) s.post.dispose();
    this.track.dispose();
    this.source.dispose();
    for (const s of this.seats) s.hud.setState({ ...initialRaceHud });
    engine.renderer.shadowMap.autoUpdate = true;
  }
}

const tmpSize = new THREE.Vector2(), tmpSize2 = new THREE.Vector2();
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
