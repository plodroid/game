import * as THREE from 'three';
import { Animator, type AnimState } from '../characters/animator';
import { buildCharacter, type Rig } from '../characters/model';
import { teamColors } from '../rendering/palette';
import { Post } from '../rendering/post';
import { prefersReducedMotion, useSettings, type GraphicsSettings } from '../settings/settings';
import { useProfile } from '../state/profile';
import { useUi, type Screen } from '../state/ui';
import { engine, type View } from './engine';
import { WEAPONS } from '@chromashift/shared';

/** The light-grey studio paper, tinted towards the paint of the menu section on screen. */
const STUDIO = 0xdcdcd8;
const PAINT: Partial<Record<Screen, number>> = {
  play: 0xff2e88,
  custom: 0xff2e88,
  auth: 0xff2e88,
  online: 0x13cbb5,
  lobby: 0x13cbb5,
  locker: 0x3156e0,
  progression: 0x1f7a52,
  profile: 0xf5b800,
  settings: 0x33363f,
};

/**
 * Live 3D backdrop for the menus: the player's character on a paint-splattered plinth in a photo
 * studio, in front of a seamless paper sweep (floor, cove and wall in one curve, so no horizon).
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
  private outcome: 'none' | 'win' | 'lose' = 'none';
  private unsub: () => void;
  private unsubScreen: () => void;
  private paper: THREE.MeshStandardMaterial;
  private tint = new THREE.Color(STUDIO);

  constructor() {
    const colors = teamColors();
    const g = useSettings.getState().graphics;
    this.paper = new THREE.MeshStandardMaterial({ color: STUDIO, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(sweep(60), this.paper));
    this.scene.background = this.paper.color;
    this.scene.fog = new THREE.Fog(STUDIO, 20, 48);
    this.setTint(useUi.getState().screen, true);
    this.unsubScreen = useUi.subscribe((st, prev) => {
      if (st.screen === prev.screen) return;
      this.setTint(st.screen);
      // The victory or defeat pose belongs to the results screen only.
      if (prev.screen === 'results') this.outcome = 'none';
    });

    // Studio light: a warm key, a cool fill and a rim from behind for the silhouette.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc6c6c2, 1.7));
    const key = new THREE.DirectionalLight(0xfffaf3, 2.2);
    key.position.set(4, 7, 6);
    const fill = new THREE.DirectionalLight(0xdce6ff, 0.55);
    fill.position.set(-6, 3, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 1.5);
    rim.position.set(-2, 5, -8);
    this.scene.add(key, fill, rim);

    const top = new THREE.MeshStandardMaterial({ map: platformTexture(colors, true), roughness: 0.45, metalness: 0.05 });
    const side = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.7 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.34, 64), [side, top, side]);
    platform.position.y = -0.17;
    this.scene.add(platform);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.32, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.011;
    this.scene.add(shadow);
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

  /** The paper takes a little of the section's paint; the home screen keeps it neutral. */
  private setTint(screen: Screen, now = false) {
    const paint = PAINT[screen];
    this.tint.set(STUDIO);
    if (paint !== undefined) this.tint.lerp(new THREE.Color(paint), 0.2);
    if (now) this.paper.color.copy(this.tint);
  }

  private onPointer = (e: PointerEvent) => {
    this.lookX = (e.clientX / innerWidth - 0.5) * 2;
  };

  /** Rebuilds the character after locker changes. */
  refresh() {
    const p = useProfile.getState();
    const g = useSettings.getState().graphics;
    if (this.rig) {
      this.rig.root.removeFromParent();
      this.rig.dispose();
    }
    this.rig = buildCharacter({ cosmetics: p.cosmetics, team: teamColors()[0], weapon: p.weapon, detail: Math.max(1, g.modelDetail), lambert: false });
    this.rig.root.rotation.y = Math.PI + 0.35;
    this.scene.add(this.rig.root);
    this.anim = new Animator(this.rig, WEAPONS[p.weapon].kind);
    this.anim.spawned();
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
    const target = Math.PI + 0.35 + this.lookX * 0.35;
    rig.root.rotation.y += (target - rig.root.rotation.y) * (1 - Math.exp(-3 * dt));
    const st: AnimState = {
      alive: true, grounded: true, diving: false, swimming: false, climbing: false, firing: false, rolling: false,
      sliding: false, dodge: -1, dodgeX: 0, dodgeZ: 0, speed: 0, vy: 0, landT: 1, aimPitch: -0.15,
      ink: 0.5 + Math.sin(this.time * 0.6) * 0.4, emote: useProfile.getState().cosmetics.emote, emoteT: this.emoteT,
      outcome: this.outcome, hiddenBlob: false, wallYaw: 0,
    };
    this.anim!.update(dt, st);
    // Ease the studio paper towards the section's tint.
    this.paper.color.lerp(this.tint, reduced ? 1 : 1 - Math.exp(-5 * dt));
    (this.scene.fog as THREE.Fog).color.copy(this.paper.color);
    // Wide screens put the character right of the menu sheet; tall ones above the bottom sheet.
    const aspect = innerWidth / innerHeight;
    const wide = aspect > 1.1, tall = aspect < 0.8;
    const sway = reduced ? 0 : Math.sin(this.time * 0.25) * 0.25;
    this.camera.position.set((wide ? -1.7 : 0) + sway, tall ? 1.4 : 1.55, tall ? 11 : 7.2);
    this.camera.lookAt(wide ? -1.7 + sway * 0.5 : 0, tall ? -0.95 : 1.0, 0);
  }

  render(dt: number) {
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
    ctx.fillStyle = '#efefec';
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

/** A seamless paper sweep: floor, a curved cove and the wall, as one ribbon `width` metres wide. */
function sweep(width: number) {
  // The floor is level with the plinth's base.
  const floor = -0.34;
  const profile: [number, number][] = [];
  for (let z = 14; z > -6; z -= 2) profile.push([z, floor]);
  for (let i = 0; i <= 18; i++) {
    const a = -Math.PI / 2 - (i / 18) * (Math.PI / 2);
    profile.push([-6 + Math.cos(a) * 4, floor + 4 + Math.sin(a) * 4]);
  }
  for (let y = 6; y <= 30; y += 6) profile.push([-10, y]);
  const pos: number[] = [], idx: number[] = [];
  for (const [z, y] of profile) pos.push(-width / 2, y, z, width / 2, y, z);
  for (let k = 0; k < profile.length - 1; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
