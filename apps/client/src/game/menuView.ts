import * as THREE from 'three';
import { Animator, type AnimState } from '../characters/animator';
import { buildCharacter, type Rig } from '../characters/model';
import { teamColors } from '../rendering/palette';
import { Post } from '../rendering/post';
import { prefersReducedMotion, useSettings, type GraphicsSettings } from '../settings/settings';
import { useProfile } from '../state/profile';
import { engine, type View } from './engine';
import { WEAPONS } from '@chromashift/shared';

const skyFrag = `uniform vec3 a; uniform vec3 b; uniform vec3 c; varying vec3 vDir;
void main(){ float y = vDir.y * 0.5 + 0.5; vec3 col = mix(c, mix(b, a, smoothstep(0.45, 1.0, y)), smoothstep(0.0, 0.5, y));
  gl_FragColor = vec4(col, 1.0); }`;

/** Live 3D backdrop for the menus: the player's character on a painted stage. */
export class MenuView implements View {
  readonly kind = 'menu';
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private rig: Rig | null = null;
  private anim: Animator | null = null;
  private post: Post;
  private drops: THREE.InstancedMesh;
  private dropData: { x: number; y: number; z: number; s: number; v: number; t: number }[] = [];
  private rings: THREE.Mesh[] = [];
  private time = 0;
  private emoteT = 0;
  private lookX = 0;
  private outcome: 'none' | 'win' | 'lose' = 'none';
  private unsub: () => void;
  private platformMat: THREE.MeshStandardMaterial;
  private m = new THREE.Matrix4();

  constructor() {
    const colors = teamColors();
    const g = useSettings.getState().graphics;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(80, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: { a: { value: new THREE.Color(0x1a1840) }, b: { value: new THREE.Color(0x2b1f4f) }, c: { value: new THREE.Color(0x0b0c16) } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0x120f26, 14, 60);
    this.scene.add(new THREE.HemisphereLight(0xb6b2ff, 0x1b1430, 1.4));
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(4, 8, 6);
    this.scene.add(key);
    const rimA = new THREE.DirectionalLight(colors[0], 2.2);
    rimA.position.set(-6, 3, -5);
    const rimB = new THREE.DirectionalLight(colors[1], 1.6);
    rimB.position.set(6, 2, -6);
    this.scene.add(rimA, rimB);

    this.platformMat = new THREE.MeshStandardMaterial({ map: platformTexture(colors), roughness: 0.45, metalness: 0.05 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.35, 0.5, 48), [
      new THREE.MeshStandardMaterial({ color: 0x272a3d, roughness: 0.6 }),
      this.platformMat,
      new THREE.MeshStandardMaterial({ color: 0x272a3d }),
    ]);
    platform.position.y = -0.25;
    this.scene.add(platform);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.011;
    this.scene.add(shadow);

    // Floating rings and pillars give depth without costing much.
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3 + i * 1.6, 0.025, 6, 96),
        new THREE.MeshBasicMaterial({ color: i % 2 ? colors[1] : colors[0], transparent: true, opacity: 0.35 - i * 0.06 }),
      );
      ring.rotation.x = Math.PI / 2 + (i - 1.5) * 0.08;
      ring.position.y = -0.1 + i * 0.05;
      this.rings.push(ring);
      this.scene.add(ring);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4, r = 9 + (i % 3) * 3;
      const h = 2 + (i % 4) * 1.5;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), new THREE.MeshStandardMaterial({ color: 0x2b2e48, roughness: 0.7 }));
      p.position.set(Math.cos(a) * r, h / 2 - 1.5, Math.sin(a) * r - 4);
      this.scene.add(p);
    }
    const n = Math.round(20 + 50 * g.particles);
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.15, emissiveIntensity: 0.3 }), n);
    this.drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2.8 + Math.random() * 6;
      this.dropData.push({ x: Math.cos(a) * r, y: Math.random() * 6 - 1, z: Math.sin(a) * r - 1.5, s: 0.03 + Math.random() * 0.07, v: 0.15 + Math.random() * 0.35, t: Math.random() * 10 });
      const col = colors[i % 2];
      this.drops.instanceColor.setXYZ(i, col.r, col.g, col.b);
    }
    this.scene.add(this.drops);

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
    if (!reduced) {
      this.rings.forEach((r, i) => (r.rotation.z += dt * (0.05 + i * 0.02) * (i % 2 ? -1 : 1)));
      this.dropData.forEach((d, i) => {
        d.t += dt;
        d.y += d.v * dt;
        if (d.y > 6) d.y = -1.5;
        const s = d.s * (0.8 + Math.sin(d.t * 2) * 0.2);
        this.m.makeScale(s, s, s).setPosition(d.x + Math.sin(d.t * 0.7) * 0.2, d.y, d.z);
        this.drops.setMatrixAt(i, this.m);
      });
      this.drops.instanceMatrix.needsUpdate = true;
    }
    const wide = innerWidth / innerHeight > 1.1;
    const sway = reduced ? 0 : Math.sin(this.time * 0.25) * 0.25;
    this.camera.position.set((wide ? -1.7 : 0) + sway, 1.55, 7.2);
    this.camera.lookAt(wide ? -1.7 + sway * 0.5 : 0, 1.0, 0);
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

function platformTexture(colors: [THREE.Color, THREE.Color]) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9d4cc';
  ctx.fillRect(0, 0, 512, 512);
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
  splat(190, 230, 150, a);
  splat(360, 330, 110, b);
  splat(300, 140, 70, a);
  splat(140, 390, 60, b);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
