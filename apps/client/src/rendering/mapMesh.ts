import * as THREE from 'three';
import { ATLAS_COLS, blockFaces, type GameWorld, type MaterialId, type MapTheme, type Surface } from '@chromashift/shared';
import { injectPaint, type PaintUniforms } from './paintAtlas';
import { surfaceTexture } from './textures';

const PROPS: Record<MaterialId, { rough: number; metal: number }> = {
  floor: { rough: 0.82, metal: 0 },
  wall: { rough: 0.9, metal: 0 },
  metal: { rough: 0.5, metal: 0.35 },
  trim: { rough: 0.6, metal: 0.2 },
  glass: { rough: 0.08, metal: 0.1 },
  base: { rough: 0.7, metal: 0.1 },
  crate: { rough: 0.88, metal: 0 },
  island: { rough: 0.95, metal: 0 },
  invisible: { rough: 1, metal: 0 },
};

// Cosine-ish hemisphere directions (local frame, z = normal) for baked AO.
const AO_DIRS = [
  [0, 0, 1], [0.7, 0, 0.7], [-0.7, 0, 0.7], [0, 0.7, 0.7], [0, -0.7, 0.7], [0.5, 0.5, 0.7], [-0.5, -0.5, 0.7],
].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

export interface MapMeshOptions {
  textureQuality: number;
  /** 0 = Lambert (cheapest), 1 = Standard, 2 = Standard + paint relief. */
  shading: number;
  aoRays: number;
  anisotropy: number;
  shadows: boolean;
}

/** Builds one merged mesh per material: few draw calls regardless of block count. */
export function buildMapMeshes(world: GameWorld, theme: MapTheme, paint: PaintUniforms, o: MapMeshOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'map';
  const surfOf = new Map<string, Surface>();
  for (const s of world.grid.surfaces) surfOf.set(`${s.block}:${s.face}`, s);
  const rows = Math.max(1, world.grid.atlasRows);
  const buckets = new Map<MaterialId, { pos: number[]; nor: number[]; uv: number[]; puv: number[]; col: number[]; idx: number[] }>();

  const ray = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const islandTop = new THREE.Color(theme.materials.island), islandSide = new THREE.Color(0x8a7b6a);
  const ao = (p: THREE.Vector3, n: THREE.Vector3) => {
    if (o.aoRays <= 0) return 1;
    // Tangent frame around the normal.
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.copy(n).cross(t1);
    let blocked = 0;
    const origin = { x: p.x + n.x * 0.04, y: p.y + n.y * 0.04, z: p.z + n.z * 0.04 };
    for (let i = 0; i < Math.min(o.aoRays, AO_DIRS.length); i++) {
      const d = AO_DIRS[i];
      ray.set(0, 0, 0).addScaledVector(t1, d.x).addScaledVector(t2, d.y).addScaledVector(n, d.z);
      const h = world.raycast(origin, ray, 2.2);
      if (h) blocked += 1 - h.dist / 2.2;
    }
    return 1 - Math.min(0.6, (blocked / Math.min(o.aoRays, AO_DIRS.length)) * 0.85);
  };

  world.map.blocks.forEach((b, bi) => {
    if (!b.visible) return;
    let bucket = buckets.get(b.mat);
    if (!bucket) buckets.set(b.mat, (bucket = { pos: [], nor: [], uv: [], puv: [], col: [], idx: [] }));
    const faces = blockFaces(b);
    faces.forEach((f, fi) => {
      // Hide undersides that sit on the ground or are never seen.
      if (fi === 5 && f.origin.y < 0.2 && b.mat !== 'island') return;
      const s = surfOf.get(`${bi}:${fi}`);
      const nu = Math.max(1, Math.ceil(f.uLen / 2)), nv = Math.max(1, Math.ceil(f.vLen / 2));
      const base = bucket.pos.length / 3;
      nrm.set(f.n.x, f.n.y, f.n.z);
      const tint = b.mat === 'island' ? (f.n.y > 0.5 ? islandTop : islandSide) : null;
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const u = (i / nu) * f.uLen, v = (j / nv) * f.vLen;
          const p = new THREE.Vector3(
            f.origin.x + f.u.x * u + f.v.x * v,
            f.origin.y + f.u.y * u + f.v.y * v,
            f.origin.z + f.u.z * u + f.v.z * v,
          );
          bucket.pos.push(p.x, p.y, p.z);
          bucket.nor.push(f.n.x, f.n.y, f.n.z);
          bucket.uv.push(u / 2, v / 2);
          if (s) bucket.puv.push((s.ax + 1 + u / s.cu) / ATLAS_COLS, (s.ay + 1 + v / s.cv) / rows);
          else bucket.puv.push(0.5 / ATLAS_COLS, 0.5 / rows);
          const a = ao(p, nrm);
          const c = tint ? [tint.r * a, tint.g * a, tint.b * a] : [a, a, a];
          bucket.col.push(c[0], c[1], c[2]);
        }
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = base + j * (nu + 1) + i, bb = a + 1, c = a + nu + 1, d = c + 1;
          bucket.idx.push(a, bb, d, a, d, c);
        }
    });
  });

  for (const [mat, d] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setAttribute('paintUv', new THREE.Float32BufferAttribute(d.puv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    g.setIndex(d.idx);
    g.computeBoundingSphere();
    const tex = surfaceTexture(mat, o.textureQuality, o.anisotropy);
    const color = mat === 'island' ? 0xffffff : theme.materials[mat];
    const glass = mat === 'glass';
    const m =
      o.shading === 0 && !glass
        ? new THREE.MeshLambertMaterial({ color, map: tex, vertexColors: true })
        : new THREE.MeshStandardMaterial({
            color,
            map: tex,
            vertexColors: true,
            roughness: PROPS[mat].rough,
            metalness: PROPS[mat].metal,
            transparent: glass,
            opacity: glass ? 0.45 : 1,
            depthWrite: !glass,
          });
    if (!glass) injectPaint(m, paint, o.shading >= 2);
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = o.shadows;
    mesh.castShadow = o.shadows && !glass;
    mesh.matrixAutoUpdate = false;
    mesh.name = `map:${mat}`;
    group.add(mesh);
  }
  return group;
}
