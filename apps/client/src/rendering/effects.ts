import * as THREE from 'three';
import { SPECIALS, type Effect, type Team, type Vec3, type WeaponId } from '@chromashift/shared';

const PROJ_SCALE: Record<WeaponId, number> = { pulse: 0.15, roller: 0.15, arc: 0.27, lobber: 0.22, dual: 0.12 };
const MAX_PROJ = 512;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number; team: number; grav: number;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  r: number;
}

/** Pooled, instanced visual effects. Nothing here allocates per frame. */
export class Effects {
  readonly group = new THREE.Group();
  private proj: THREE.InstancedMesh[];
  private parts: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private live = 0;
  private rings: Ring[] = [];
  private shields = new Map<number, THREE.Mesh>();
  private beacons = new Map<number, THREE.Group>();
  private novas = new Map<number, THREE.Mesh>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, 1);
  private colors: [THREE.Color, THREE.Color];
  private projMats: THREE.MeshStandardMaterial[];
  private shieldGeo = new THREE.SphereGeometry(1, 28, 18);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  constructor(
    scene: THREE.Scene,
    private density: number,
    colors: [THREE.Color, THREE.Color],
  ) {
    this.colors = colors;
    scene.add(this.group);
    const pg = new THREE.IcosahedronGeometry(1, 1);
    this.projMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.15 }));
    this.proj = this.projMats.map((mat) => {
      const im = new THREE.InstancedMesh(pg, mat, MAX_PROJ);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    });
    const max = Math.round(300 + 1400 * density);
    for (let i = 0; i < max; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, team: 0, grav: 18 });
    this.parts = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.2 }), max);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.parts.count = 0;
    this.parts.frustumCulled = false;
    this.group.add(this.parts);
  }

  setColors(c: [THREE.Color, THREE.Color]) {
    this.colors = c;
    this.projMats.forEach((m, i) => {
      m.color.copy(c[i]);
      m.emissive.copy(c[i]);
    });
  }

  setProjectiles(list: Iterable<{ pos: Vec3; vel: Vec3; team: Team; weapon: WeaponId }>) {
    const counts = [0, 0];
    for (const p of list) {
      const im = this.proj[p.team];
      const i = counts[p.team];
      if (i >= MAX_PROJ) continue;
      counts[p.team]++;
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
      this.v.set(p.vel.x / sp, p.vel.y / sp, p.vel.z / sp);
      this.q.setFromUnitVectors(this.fwd, this.v);
      const sc = PROJ_SCALE[p.weapon];
      this.s.set(sc, sc, sc * Math.min(2.4, 1 + sp / 40));
      this.m.compose(this.v.set(p.pos.x, p.pos.y, p.pos.z), this.q, this.s);
      im.setMatrixAt(i, this.m);
    }
    for (let t = 0; t < 2; t++) {
      this.proj[t].count = counts[t];
      this.proj[t].instanceMatrix.needsUpdate = true;
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, team: number, grav = 18) {
    if (this.live >= this.pool.length) return;
    const p = this.pool[this.live++];
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.max = life; p.size = size; p.team = team; p.grav = grav;
  }

  /** Paint impact: droplets thrown off the surface. */
  splash(at: Vec3, team: number, radius: number) {
    const n = Math.round((4 + radius * 6) * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3.5 * radius;
      this.spawn(at.x, at.y + 0.05, at.z, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, 0.35 + Math.random() * 0.35, 0.04 + Math.random() * 0.06 * radius, team);
    }
  }

  burst(at: Vec3, team: number, count: number, speed: number, size: number, grav = 18) {
    const n = Math.round(count * this.density);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.5 + Math.random() * 0.5);
      this.spawn(at.x, at.y, at.z, Math.cos(a) * s * sp, u * sp + speed * 0.3, Math.sin(a) * s * sp, 0.4 + Math.random() * 0.5, size * (0.6 + Math.random() * 0.6), team, grav);
    }
  }

  muzzle(at: Vec3, dir: Vec3, team: number) {
    const n = Math.max(1, Math.round(3 * this.density));
    for (let i = 0; i < n; i++)
      this.spawn(at.x, at.y, at.z, dir.x * 6 + (Math.random() - 0.5) * 2, dir.y * 6 + Math.random(), dir.z * 6 + (Math.random() - 0.5) * 2, 0.12, 0.05, team, 4);
  }

  ripple(at: Vec3, team: number) {
    if (Math.random() > this.density) return;
    this.spawn(at.x + (Math.random() - 0.5) * 0.5, at.y + 0.04, at.z + (Math.random() - 0.5) * 0.5, 0, 1.2 + Math.random(), 0, 0.3, 0.05, team, 10);
  }

  ring(at: Vec3, team: number, radius: number, dur = 0.45) {
    let r = this.rings.find((x) => x.t >= x.dur);
    // Bounded pool: when every ring is busy, recycle the most advanced one.
    if (!r && this.rings.length >= 24) r = this.rings.reduce((a, b) => (b.t / b.dur > a.t / a.dur ? b : a));
    if (!r) {
      const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      mesh.rotation.x = -Math.PI / 2;
      this.group.add(mesh);
      r = { mesh, t: 0, dur, r: radius };
      this.rings.push(r);
    }
    r.t = 0;
    r.dur = dur;
    r.r = radius;
    (r.mesh.material as THREE.MeshBasicMaterial).color.copy(this.colors[team]);
    r.mesh.position.set(at.x, at.y + 0.08, at.z);
    r.mesh.visible = true;
  }

  /** Mirrors live shields/beacons/nova windups from the simulation. */
  syncEffects(list: readonly Effect[]) {
    const seen = new Set<number>();
    for (const e of list) {
      seen.add(e.id);
      if (e.kind === 'shield') {
        let m = this.shields.get(e.id);
        if (!m) {
          m = new THREE.Mesh(this.shieldGeo, shieldMaterial(this.colors[e.team]));
          m.scale.setScalar(SPECIALS.shield.radius);
          this.group.add(m);
          this.shields.set(e.id, m);
        }
        m.position.set(e.pos.x, e.pos.y, e.pos.z);
        (m.material as THREE.ShaderMaterial).uniforms.strength.value = 0.4 + 0.6 * Math.min(1, e.t / 1.5);
      } else if (e.kind === 'beacon') {
        let g = this.beacons.get(e.id);
        if (!g) {
          g = beaconMesh(this.colors[e.team]);
          this.group.add(g);
          this.beacons.set(e.id, g);
        }
        g.position.set(e.pos.x, e.pos.y + 0.02, e.pos.z);
        g.children[1].rotation.z += 0.03;
      } else if (e.kind === 'nova' || e.kind === 'disrupt') {
        let m = this.novas.get(e.id);
        if (!m) {
          m = new THREE.Mesh(this.shieldGeo, new THREE.MeshBasicMaterial({ color: this.colors[e.team], transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
          this.group.add(m);
          this.novas.set(e.id, m);
        }
        const k = 1 - Math.max(0, e.t) / (e.kind === 'nova' ? SPECIALS.nova.windup : SPECIALS.disrupt.windup);
        m.scale.setScalar(0.4 + k * 0.9);
        m.position.set(e.pos.x, e.pos.y, e.pos.z);
      }
    }
    // Shields and novas share one sphere geometry; beacons own theirs.
    const drop = (map: Map<number, THREE.Object3D>, ownGeometry: boolean) => {
      for (const [id, o] of map) {
        if (seen.has(id)) continue;
        this.group.remove(o);
        o.traverse((x) => {
          const mesh = x as THREE.Mesh;
          if (!mesh.isMesh) return;
          (mesh.material as THREE.Material).dispose();
          if (ownGeometry) mesh.geometry.dispose();
        });
        map.delete(id);
      }
    };
    drop(this.shields, false);
    drop(this.novas, false);
    drop(this.beacons, true);
  }

  update(dt: number) {
    const im = this.parts;
    const col = im.instanceColor!.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.live; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Swap-remove keeps live particles packed at the front.
        this.live--;
        const last = this.pool[this.live];
        this.pool[this.live] = p;
        this.pool[i] = last;
        i--;
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const sc = p.size * Math.sqrt(p.life / p.max);
      this.m.makeScale(sc, sc, sc).setPosition(p.x, p.y, p.z);
      im.setMatrixAt(n, this.m);
      const c = this.colors[p.team];
      col[n * 3] = c.r;
      col[n * 3 + 1] = c.g;
      col[n * 3 + 2] = c.b;
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor!.needsUpdate = true;
    for (const r of this.rings) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.mesh.scale.setScalar(0.2 + r.r * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      r.mesh.visible = r.t < r.dur;
    }
    for (const m of this.shields.values()) (m.material as THREE.ShaderMaterial).uniforms.time.value += dt;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.group.removeFromParent();
  }
}

function shieldMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color.clone() }, time: { value: 0 }, strength: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 wp = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-wp.xyz); vP = position; gl_Position = projectionMatrix*wp; }`,
    fragmentShader: `uniform vec3 color; uniform float time; uniform float strength; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float hex = step(0.92, fract(vP.y * 6.0 + time * 0.6)) * 0.25;
        gl_FragColor = vec4(color, (f * 0.85 + 0.08 + hex) * strength); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function beaconMesh(color: THREE.Color) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.4 }));
  disc.position.y = 0.06;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 1.15, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 4), new THREE.MeshBasicMaterial({ color }));
  arrow.position.y = 0.9;
  g.add(disc, ring, arrow);
  return g;
}
