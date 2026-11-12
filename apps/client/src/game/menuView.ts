import * as THREE from 'three';
import { Animator, type AnimState } from '../characters/animator';
import { buildCharacter, type Rig } from '../characters/model';
import { teamColors } from '../rendering/palette';
import { menuBeach, type Beach } from '../rendering/beach';
import { SHADOW_LAYER } from '../characters/compact';
import { Ocean } from '../rendering/ocean';
import { Post } from '../rendering/post';
import { SummerSky, visualTier } from '../rendering/sky';
import { prefersReducedMotion, useSettings, type GraphicsSettings } from '../settings/settings';
import { useProfile } from '../state/profile';
import { useUi, type Screen } from '../state/ui';
import { engine, type View } from './engine';
import { WEAPONS } from '@chromashift/shared';

const drawSize = new THREE.Vector2();

/** The menu beach: sea level, and the sand the plinth stands on. */
const SEA = -0.95;
const FLOOR = -0.34;
const PAINT: Partial<Record<Screen, number>> = {
  play: 0xff4d94,
  custom: 0xff4d94,
  auth: 0xff4d94,
  online: 0x2fd3d0,
  lobby: 0x2fd3d0,
  locker: 0x8b72ff,
  progression: 0x9be03c,
  profile: 0xffc532,
  settings: 0x9a93b4,
  social: 0x2fd3d0,
};

/**
 * Live 3D backdrop for the menus: the player's character on a paint-splattered plinth on a beach
 * on a hot summer day: real sky and clouds, the sea, palms and the sun casting their shadow on the
 * sand. A rim light takes the paint of the menu section on screen.
 */
export class MenuView implements View {
  readonly kind = 'menu';
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private rig: Rig | null = null;
  private anim: Animator | null = null;
  private post: Post;
  private time = 0;
  private emoteT = 0;
  private lookX = 0;
  /** Turn added by dragging in the locker, so every side of the character can be seen. */
  private dragYaw = 0;
  private outcome: 'none' | 'win' | 'lose' = 'none';
  private unsub: () => void;
  private unsubScreen: () => void;
  private sky: SummerSky;
  private ocean: Ocean;
  private beach: Beach;
  private envMap: THREE.Texture | null = null;
  private rim = new THREE.DirectionalLight(0xffffff, 2.2);
  private rimTint = new THREE.Color(0xffffff);

  constructor() {
    const colors = teamColors();
    const g = useSettings.getState().graphics;
    const tier = visualTier(g);
    const lambert = g.paintQuality === 0;
    // The sun is behind the camera and to the right, so it lights the character's face and the
    // clouds out to sea; the sky behind them is the deep blue away from the sun.
    this.sky = new SummerSky(engine.renderer, { sunDir: new THREE.Vector3(0.62, 0.66, 0.42).normalize(), turbidity: 2, clouds: 0.4, seed: 3.7 }, tier, 1.6);
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.FogExp2(this.sky.light.haze.clone(), 0.0062);
    this.beach = menuBeach({ tier, lambert, seaLevel: SEA, floor: FLOOR });
    this.scene.add(this.beach.group);
    this.ocean = new Ocean(this.sky, { tier, level: SEA, x: 0, z: -40, far: 200, shores: this.beach.shores });
    this.scene.add(this.ocean.mesh);
    if (g.reflections && !lambert) {
      this.envMap = this.sky.environment();
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = 0.85;
    }
    this.setTint(useUi.getState().screen, true);
    this.unsubScreen = useUi.subscribe((st, prev) => {
      if (st.tryOn !== prev.tryOn) {
        this.refresh();
        if (st.tryOn?.emote) this.emoteT = 2.4;
      }
      if (st.screen === prev.screen) return;
      if (prev.screen === 'locker') useUi.getState().setTryOn(null);
      this.setTint(st.screen);
      // The victory or defeat pose belongs to the results screen only.
      if (prev.screen === 'results') this.outcome = 'none';
    });

    // Key: the sun, casting the character's shadow on the sand. Fill: blue sky above, warm sand below.
    // Rim: from behind, in the section's paint, so the silhouette stands off the sea.
    const skyTint = this.sky.light.skyAmbient.clone();
    skyTint.multiplyScalar(1 / Math.max(skyTint.r, skyTint.g, skyTint.b));
    this.scene.add(new THREE.HemisphereLight(skyTint, 0xe2c9a0, this.envMap ? 0.65 : 1.4));
    const key = new THREE.DirectionalLight(this.sky.light.sunColor, 3.1);
    key.position.copy(this.sky.look.sunDir).multiplyScalar(14);
    if (g.shadowQuality > 0) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      const sc = key.shadow.camera;
      sc.left = sc.bottom = -6;
      sc.right = sc.top = 6;
      sc.near = 1;
      sc.far = 40;
      sc.layers.enable(SHADOW_LAYER);
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.02;
      key.shadow.radius = 2.5;
    }
    this.rim.intensity = 1.6;
    this.rim.position.set(-2, 5, -8);
    this.scene.add(key, this.rim);

    const top = new THREE.MeshStandardMaterial({ map: platformTexture(colors, true), roughness: 0.45, metalness: 0.05 });
    const side = new THREE.MeshStandardMaterial({ color: 0xb48a5e, roughness: 0.85 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.34, 64), [side, top, side]);
    platform.position.y = -0.17;
    platform.castShadow = platform.receiveShadow = g.shadowQuality > 0;
    this.scene.add(platform);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.32, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.011;
    // A soft contact shadow when the sun casts no real one.
    if (g.shadowQuality === 0) this.scene.add(shadow);
    else {
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
    }
    // Paint spilled on the studio floor around the plinth.
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ map: platformTexture(colors, false), transparent: true, roughness: 0.4, depthWrite: false }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(0.5, -0.335, 0.6);
    this.scene.add(spill);

    this.post = new Post(engine.renderer, this.scene, this.camera, g);
    this.refresh();
    let prev = useProfile.getState();
    this.unsub = useProfile.subscribe((s) => {
      if (s.cosmetics !== prev.cosmetics || s.weapon !== prev.weapon) this.refresh();
      prev = s;
    });
    addEventListener('pointermove', this.onPointer);
    this.resize();
  }

  /** The rim light takes the section's paint; the home screen keeps it white. */
  private setTint(screen: Screen, now = false) {
    const paint = PAINT[screen];
    this.rimTint.set(0xffffff);
    if (paint !== undefined) this.rimTint.lerp(new THREE.Color(paint), 0.7);
    if (now) this.rim.color.copy(this.rimTint);
  }

  private onPointer = (e: PointerEvent) => {
    this.lookX = (e.clientX / innerWidth - 0.5) * 2;
  };

  /** Rebuilds the character after locker changes. */
  refresh() {
    const p = useProfile.getState();
    const t = useUi.getState().tryOn;
    const g = useSettings.getState().graphics;
    const cosmetics = { ...p.cosmetics, ...t?.cosmetics };
    const weapon = t?.weapon ?? p.weapon;
    if (this.rig) {
      this.rig.root.removeFromParent();
      this.rig.dispose();
    }
    this.rig = buildCharacter({ cosmetics, team: teamColors()[0], weapon, detail: Math.max(1, g.modelDetail), lambert: false });
    this.rig.root.rotation.y = Math.PI + 0.35;
    this.scene.add(this.rig.root);
    this.anim = new Animator(this.rig, WEAPONS[weapon].kind);
    this.anim.spawned();
  }

  /** Turns the character by a drag of `dx` pixels (the locker only). */
  spin(dx: number) {
    this.dragYaw += dx * 0.012;
  }

  /** Small reactions to menu interactions. */
  react(kind: 'emote' | 'hop') {
    if (kind === 'emote') this.emoteT = 2.4;
    else this.anim?.fire();
  }

  setOutcome(o: 'none' | 'win' | 'lose') {
    this.outcome = o;
  }

  update(dt: number) {
    this.time += dt;
    const reduced = prefersReducedMotion();
    const rig = this.rig!;
    this.emoteT = Math.max(0, this.emoteT - dt);
    // The drag turn is kept while in the locker and unwinds the shortest way when you leave it.
    if (useUi.getState().screen !== 'locker') this.dragYaw = Math.atan2(Math.sin(this.dragYaw), Math.cos(this.dragYaw)) * Math.exp(-3 * dt);
    const locker = useUi.getState().screen === 'locker';
    const target = Math.PI + 0.35 + (locker ? 0 : this.lookX * 0.35) + this.dragYaw;
    rig.root.rotation.y += (target - rig.root.rotation.y) * (1 - Math.exp(-3 * dt));
    const st: AnimState = {
      alive: true, grounded: true, diving: false, swimming: false, climbing: false, firing: false, rolling: false,
      sliding: false, dodge: -1, dodgeX: 0, dodgeZ: 0, speed: 0, vy: 0, landT: 1, aimPitch: -0.15,
      ink: 0.5 + Math.sin(this.time * 0.6) * 0.4, emote: useUi.getState().tryOn?.emote ?? useProfile.getState().cosmetics.emote, emoteT: this.emoteT,
      outcome: this.outcome, hiddenBlob: false, wallYaw: 0,
    };
    this.anim!.update(dt, st);
    // Ease the rim light towards the section's paint; the clouds drift and the sea moves.
    this.rim.color.lerp(this.rimTint, reduced ? 1 : 1 - Math.exp(-5 * dt));
    this.sky.update(reduced ? 0 : dt);
    this.ocean.update(dt);
    // Wide screens put the character right of the menu sheet; tall ones above the bottom sheet.
    const aspect = innerWidth / innerHeight;
    const wide = aspect > 1.1, tall = aspect < 0.8;
    const sway = reduced ? 0 : Math.sin(this.time * 0.25) * 0.25;
    this.camera.position.set((wide ? -1.7 : 0) + sway, tall ? 1.4 : 1.55, tall ? 11 : 7.2);
    this.camera.lookAt(wide ? -1.7 + sway * 0.5 : 0, tall ? -0.95 : 1.0, 0);
  }

  render(dt: number) {
    this.sky.fitTo(this.camera, engine.renderer.getDrawingBufferSize(drawSize).y);
    this.post.render(dt);
  }

  resize() {
    this.camera.aspect = engine.aspect;
    this.camera.updateProjectionMatrix();
    this.post.setSize();
  }

  applyGraphics(g: GraphicsSettings) {
    this.post.dispose();
    this.post = new Post(engine.renderer, this.scene, this.camera, g);
  }

  restore() {}

  /** For the hardware benchmark. */
  get benchScene() {
    return { scene: this.scene, camera: this.camera };
  }

  dispose() {
    removeEventListener('pointermove', this.onPointer);
    this.unsub();
    this.unsubScreen();
    this.rig?.dispose();
    this.post.dispose();
    this.beach.dispose();
    this.ocean.dispose();
    this.sky.dispose();
    this.envMap?.dispose();
    this.scene.environment = null;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

function platformTexture(colors: [THREE.Color, THREE.Color], solid: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  if (solid) {
    ctx.fillStyle = '#2b2533';
    ctx.fillRect(0, 0, 512, 512);
  }
  const splat = (x: number, y: number, r: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2, rr = r * (0.85 + Math.sin(i * 2.7 + x) * 0.12);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (1.05 + Math.random() * 0.3);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.06 + Math.random() * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const a = `#${colors[0].getHexString()}`, b = `#${colors[1].getHexString()}`;
  if (solid) {
    splat(190, 230, 150, a);
    splat(360, 330, 110, b);
    splat(300, 140, 70, a);
    splat(140, 390, 60, b);
  } else {
    // Seen from the front, so the spill sits mostly in front of and beside the plinth.
    splat(110, 330, 46, b);
    splat(420, 300, 34, a);
    splat(380, 420, 22, b);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
