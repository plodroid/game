import * as THREE from 'three';
import {
  greedyMesh, nodeGrid, polyBuffers, unwrap, wedgeMesh, type AssetMaterial, type FaceUV, type MaterialRole, type MeshNode, type ModelAsset, type ModelNode,
  type PolyMesh, type PrimNode, type VoxelGrid, type VoxNode,
} from '@chromashift/shared';
import { boxUV, chamferBox, polyGeometry } from './kit';
import { PaintSurface } from './paint';
import { surfaceMaterial } from './surfaces';

/*
 * Turns a Studio asset into what the game draws: primitives, the greedy-meshed surface of each
 * voxel grid, and polygon meshes with their painted textures, in the asset's hierarchy. The Studio
 * uses the same functions node by node, so what you edit is what the game shows.
 */

export interface BuildCtx {
  lambert?: boolean;
  /** Surface texture size (0 = plain colours). */
  size?: number;
  /** Corner shading on voxel models. */
  ao?: boolean;
  /** Gives the game's own material for a role (team paint, the finish …); undefined keeps the asset's. */
  role?: (role: MaterialRole, m: AssetMaterial) => THREE.Material | undefined;
  shadows?: boolean;
}

export interface AssetMaterials {
  list: THREE.Material[];
  /** The same materials with vertex colours on, for voxel shading; made on first use. */
  shaded(): THREE.Material[];
  dispose(): void;
}

export function assetMaterials(a: ModelAsset, ctx: BuildCtx): AssetMaterials {
  const own: THREE.Material[] = [];
  const list = a.materials.map((m) => {
    const given = m.role !== 'none' ? ctx.role?.(m.role, m) : undefined;
    if (given) return given;
    const glass = m.role === 'glass' || m.surface === 'glass';
    const mat = surfaceMaterial({
      color: m.color,
      rough: m.rough,
      metal: m.metal,
      surface: glass ? 'glass' : m.surface,
      emissive: m.role === 'glow' ? Math.max(1.5, m.emissive) : m.emissive,
      opacity: glass ? Math.min(m.opacity, 0.5) : m.opacity,
      lambert: ctx.lambert,
      size: ctx.size,
    });
    own.push(mat);
    return mat;
  });
  let shaded: THREE.Material[] | null = null;
  return {
    list,
    shaded() {
      if (!shaded)
        shaded = list.map((m) => {
          const c = m.clone();
          (c as THREE.MeshStandardMaterial).vertexColors = true;
          own.push(c);
          return c;
        });
      return shaded;
    },
    dispose() {
      for (const m of own) m.dispose();
    },
  };
}

const unit = new Map<string, THREE.BufferGeometry>();
const shared = (key: string, make: () => THREE.BufferGeometry) => {
  let g = unit.get(key);
  if (!g) unit.set(key, (g = make()));
  return g;
};

/** The geometry of a primitive, one unit across; the node's scale sizes it. Returns whether it is shared. */
export function primGeometry(n: PrimNode): { geo: THREE.BufferGeometry; owned: boolean; baked: boolean } {
  switch (n.shape) {
    case 'box':
      // A chamfer must not stretch with the box, so chamfered boxes are built at their real size.
      if (n.bevel && n.s.every((v) => v > 0)) return { geo: chamferBox(n.s[0], n.s[1], n.s[2], n.bevel * Math.min(...n.s)), owned: true, baked: true };
      return { geo: shared('box', () => boxUV(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 1)), owned: false, baked: false };
    case 'cyl':
      return { geo: shared('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 20)), owned: false, baked: false };
    case 'sphere':
      return { geo: shared('sphere', () => new THREE.SphereGeometry(0.5, 20, 14)), owned: false, baked: false };
    case 'cone':
      return { geo: shared('cone', () => new THREE.ConeGeometry(0.5, 1, 20)), owned: false, baked: false };
    case 'torus':
      return { geo: shared('torus', () => new THREE.TorusGeometry(0.5, 0.12, 10, 24)), owned: false, baked: false };
    case 'capsule':
      return { geo: shared('capsule', () => new THREE.CapsuleGeometry(0.25, 0.5, 4, 14)), owned: false, baked: false };
    case 'wedge':
      return { geo: shared('wedge', () => polyGeometry(wedgeMesh(1, 1, 1), 0)), owned: false, baked: false };
  }
}

/** The drawn surface of a voxel grid: centred on x and z, standing on y = 0, one group per material. */
export function voxGeometry(grid: VoxelGrid, size: number, ao = true): THREE.BufferGeometry {
  const s = greedyMesh(grid, ao);
  const g = new THREE.BufferGeometry();
  const n = s.positions.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const ox = grid.nx / 2, oz = grid.nz / 2;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (s.positions[i * 3] - ox) * size;
    pos[i * 3 + 1] = s.positions[i * 3 + 1] * size;
    pos[i * 3 + 2] = (s.positions[i * 3 + 2] - oz) * size;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s.ao[i];
  }
  // Quads grouped by material so each group is one draw.
  const byMat = new Map<number, number[]>();
  for (let q = 0; q < s.quads; q++) {
    const m = s.materials[q * 4] - 1;
    (byMat.get(m) ?? byMat.set(m, []).get(m)!).push(q);
  }
  const idx = new Uint32Array(s.quads * 6);
  let o = 0;
  for (const [m, quads] of [...byMat].sort((a, b) => a[0] - b[0])) {
    const start = o;
    for (const q of quads) for (let k = 0; k < 6; k++) idx[o++] = s.indices[q * 6 + k];
    g.addGroup(start, o - start, m);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(s.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // Box-projected UVs in metres, so surface looks (brushed, concrete …) lie flat on every face.
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const nx = Math.abs(s.normals[i * 3]), ny = Math.abs(s.normals[i * 3 + 1]);
    uv[i * 2] = nx > 0.5 ? pos[i * 3 + 2] : pos[i * 3];
    uv[i * 2 + 1] = ny > 0.5 ? pos[i * 3 + 2] : pos[i * 3 + 1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/** A polygon mesh as a geometry with one group per material slot. `uvs` are the painting UVs, if painted. */
export function meshGeometry(m: PolyMesh, smooth: number, uvs?: FaceUV[]): THREE.BufferGeometry & { userData: { triFace: Uint32Array } } {
  const b = polyBuffers(m, smooth, uvs);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2));
  else {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((b.positions.length / 3) * 2), 2));
    boxUV(g, 1);
  }
  for (const [slot, start, count] of b.groups) g.addGroup(start, count, slot);
  g.userData.triFace = b.triFace;
  g.computeBoundingSphere();
  return g as THREE.BufferGeometry & { userData: { triFace: Uint32Array } };
}

/** Materials for a painted mesh: the slot's material with the painted textures laid over it. */
export function paintedMaterials(base: THREE.Material[], paint: PaintSurface): THREE.Material[] {
  return base.map((m) => {
    const c = m.clone() as THREE.MeshStandardMaterial;
    c.color.set(0xffffff);
    c.map = paint.texture;
    if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      c.normalMap = null;
      if (paint.ormTexture) {
        c.roughnessMap = c.metalnessMap = paint.ormTexture;
        c.roughness = c.metalness = 1;
      } else c.roughnessMap = null;
      if (paint.glowTexture) {
        c.emissive = new THREE.Color(0xffffff);
        c.emissiveMap = paint.glowTexture;
        c.emissiveIntensity = 1.6;
      }
    }
    c.needsUpdate = true;
    return c;
  });
}

/** The look of each face's own material, for the underlay of a painted mesh. */
export function faceLooks(node: MeshNode, a: ModelAsset, mats: THREE.Material[]) {
  return (face: number) => {
    const slot = node.faces[face]?.m ?? 0, m = a.materials[slot];
    const live = mats[slot] as THREE.MeshStandardMaterial | undefined;
    // A role material (team paint, finish) shows in the game's own colour.
    return { color: live?.color ? live.color.getHex() : (m?.color ?? 0x808080), rough: live?.roughness ?? m?.rough ?? 0.6, metal: live?.metalness ?? m?.metal ?? 0 };
  };
}

function setTransform(o: THREE.Object3D, n: ModelNode, baked = false) {
  o.position.set(n.p[0], n.p[1], n.p[2]);
  o.rotation.set((n.r[0] * Math.PI) / 180, (n.r[1] * Math.PI) / 180, (n.r[2] * Math.PI) / 180);
  if (baked) o.scale.set(1, 1, 1);
  else o.scale.set(n.s[0] || 1e-4, n.s[1] || 1e-4, n.s[2] || 1e-4);
}

export interface BuiltAsset {
  group: THREE.Group;
  /** Node id → its object. */
  objects: Map<string, THREE.Object3D>;
  points: Record<string, THREE.Vector3>;
  /** Resolves when painted textures have loaded. */
  ready: Promise<void>;
  dispose(): void;
}

export function buildAsset(a: ModelAsset, ctx: BuildCtx = {}): BuiltAsset {
  const group = new THREE.Group();
  group.name = `asset:${a.id}`;
  const mats = assetMaterials(a, ctx);
  const owned: { dispose(): void }[] = [mats];
  const objects = new Map<string, THREE.Object3D>();
  const jobs: Promise<void>[] = [];
  const cast = ctx.shadows !== false;
  for (const n of a.nodes) {
    let o: THREE.Object3D;
    let baked = false;
    if (n.t === 'group') o = new THREE.Group();
    else if (n.t === 'prim') {
      const p = primGeometry(n);
      baked = p.baked;
      if (p.owned) owned.push(p.geo);
      o = new THREE.Mesh(p.geo, mats.list[n.mat] ?? mats.list[0]);
    } else if (n.t === 'vox') {
      const geo = voxGeometry(nodeGrid(n as VoxNode), n.size, ctx.ao !== false);
      owned.push(geo);
      o = new THREE.Mesh(geo, ctx.ao !== false ? mats.shaded() : mats.list);
    } else {
      const mesh: PolyMesh = { verts: n.verts, faces: n.faces };
      const uvs = n.paint ? unwrap(mesh) : undefined;
      const geo = meshGeometry(mesh, n.smooth, uvs);
      owned.push(geo);
      const m = new THREE.Mesh(geo, mats.list);
      o = m;
      if (n.paint && uvs)
        jobs.push(
          PaintSurface.from(n.paint).then((paint) => {
            paint.setUnderlay(uvs, faceLooks(n, a, mats.list));
            const pm = paintedMaterials(mats.list, paint);
            m.material = pm;
            owned.push(paint, ...pm);
          }),
        );
    }
    o.name = n.name;
    o.visible = !n.hidden;
    setTransform(o, n, baked);
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = cast;
    }
    objects.set(n.id, o);
  }
  for (const n of a.nodes) (n.parent && objects.get(n.parent) ? objects.get(n.parent)! : group).add(objects.get(n.id)!);
  const points: Record<string, THREE.Vector3> = {};
  for (const [k, p] of Object.entries(a.points)) points[k] = new THREE.Vector3(p[0], p[1], p[2]);
  return {
    group,
    objects,
    points,
    ready: Promise.all(jobs).then(() => undefined),
    dispose() {
      for (const o of owned) o.dispose();
      group.removeFromParent();
    },
  };
}
