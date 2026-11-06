import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Objects on this layer are drawn only into shadow maps (the sun's shadow camera enables it). */
export const SHADOW_LAYER = 1;
// The shadow pass draws with its own depth material; this one is never seen.
const shadowOnly = new THREE.MeshBasicMaterial();

/**
 * One material for every plain part: each vertex carries its part's colour, roughness, metalness
 * and glow, fed into exactly the same lighting maths, so many parts draw in one call and look
 * the same as with their own materials.
 */
const shared = new Map<THREE.Side, THREE.MeshStandardMaterial>();
function sharedMaterial(side: THREE.Side) {
  let m = shared.get(side);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, side });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 surf;\nattribute vec3 glow;\nvarying vec2 vSurf;\nvarying vec3 vGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSurf;\nvarying vec3 vGlow;')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vGlow;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;');
  };
  m.customProgramCacheKey = () => 'chromashift-shared-standard';
  shared.set(side, m);
  return m;
}

const baseCompile = new THREE.MeshStandardMaterial().onBeforeCompile;
/** A plain standard material: nothing the shared material can't reproduce per vertex. */
function plain(x: THREE.Material): x is THREE.MeshStandardMaterial {
  const m = x as THREE.MeshStandardMaterial;
  return (
    m.type === 'MeshStandardMaterial' &&
    !m.map &&
    !m.alphaMap &&
    !m.normalMap &&
    !m.bumpMap &&
    !m.emissiveMap &&
    !m.roughnessMap &&
    !m.metalnessMap &&
    !m.aoMap &&
    !m.lightMap &&
    !m.envMap &&
    !m.displacementMap &&
    !m.transparent &&
    m.opacity === 1 &&
    m.alphaTest === 0 &&
    !m.vertexColors &&
    !m.flatShading &&
    !m.wireframe &&
    m.envMapIntensity === 1 &&
    m.depthTest &&
    m.depthWrite &&
    m.colorWrite &&
    !m.polygonOffset &&
    m.blending === THREE.NormalBlending &&
    m.fog &&
    m.toneMapped &&
    m.onBeforeCompile === baseCompile
  );
}

/** Per-vertex copies of a part's material for the shared material. */
function surfaced(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial) {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3),
    surf = new Float32Array(n * 2),
    glow = new Float32Array(n * 3);
  const e = m.emissive,
    k = m.emissiveIntensity;
  for (let i = 0; i < n; i++) {
    col.set([m.color.r, m.color.g, m.color.b], i * 3);
    surf.set([m.roughness, m.metalness], i * 2);
    glow.set([e.r * k, e.g * k, e.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 2));
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 3));
  return g;
}

/** A part's geometry in its joint's space, with just the attributes in `keep`. */
function baked(m: THREE.Mesh, toJoint: THREE.Matrix4, keep: string[]) {
  const g = new THREE.BufferGeometry();
  for (const k of keep) {
    const a = m.geometry.getAttribute(k);
    if (a) g.setAttribute(k, a.clone());
  }
  if (m.geometry.index) g.setIndex(m.geometry.index.clone());
  return g.applyMatrix4(toJoint);
}

/** Merges parts into one geometry, or null if they can't be combined. */
function merge(
  parts: { m: THREE.Mesh; rel: THREE.Matrix4 }[],
  keep: string[],
  perPart?: (g: THREE.BufferGeometry, m: THREE.Mesh) => THREE.BufferGeometry,
) {
  const gs = parts.map((p) => (perPart ? perPart(baked(p.m, p.rel, keep), p.m) : baked(p.m, p.rel, keep)));
  // Mixed indexed and non-indexed geometry can only merge as non-indexed.
  const flat = gs.some((g) => !g.index) ? gs.map((g) => (g.index ? g.toNonIndexed() : g)) : gs;
  return mergeGeometries(flat, false);
}

/**
 * Same picture, far fewer draw calls. A character is dozens of small parts hung on a dozen
 * animated joints. Everything that rides rigidly on a joint (down to the next joint) is merged:
 * parts sharing a material become one mesh, and the joint casts its shadow from one merged copy
 * drawn only into the shadow map. Parts in `keep` (animated on their own), hidden parts, see-through
 * parts and mirrored parts (negative scale) are left as they are.
 */
export function compactRig(
  root: THREE.Object3D,
  joints: THREE.Object3D[],
  keep: Set<THREE.Object3D>,
  track: (g: THREE.BufferGeometry) => void,
) {
  root.updateMatrixWorld(true);
  const isJoint = new Set(joints);
  const inv = new THREE.Matrix4();
  for (const joint of joints) {
    // The rigid parts under this joint, stopping at the next joint.
    const parts: { m: THREE.Mesh; rel: THREE.Matrix4 }[] = [];
    inv.copy(joint.matrixWorld).invert();
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (isJoint.has(c) || keep.has(c) || !c.visible) continue;
        const m = c as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material) && c.children.length === 0) {
          const rel = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
          if (rel.determinant() > 0) parts.push({ m, rel });
        } else if (!m.isMesh) walk(c);
      }
    };
    walk(joint);
    if (parts.length < 2) continue;

    // Shadow: one depth-only copy of everything on this joint that casts.
    const casters = parts.filter((p) => p.m.castShadow);
    if (casters.length > 1) {
      const geo = merge(casters, ['position']);
      if (geo) {
        track(geo);
        const proxy = new THREE.Mesh(geo, shadowOnly);
        proxy.castShadow = true;
        proxy.layers.set(SHADOW_LAYER);
        joint.add(proxy);
        for (const p of casters) p.m.castShadow = false;
      }
    }

    // Picture: plain parts share one material; other parts sharing a material become one mesh.
    const groups = new Map<string, typeof parts>();
    for (const p of parts) {
      const mat = p.m.material as THREE.Material;
      // See-through parts stay separate so they keep sorting against each other as before.
      if (mat.transparent) continue;
      const flags = `${p.m.castShadow}:${p.m.receiveShadow}:${p.m.renderOrder}`;
      const key =
        plain(mat) && p.m.geometry.getAttribute('normal')
          ? `shared:${mat.side}:${flags}`
          : `${mat.id}:${flags}`;
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      let geo: THREE.BufferGeometry | null;
      let mat: THREE.Material;
      if (key.startsWith('shared:')) {
        geo = merge(list, ['position', 'normal'], (g, m) =>
          surfaced(g, m.material as THREE.MeshStandardMaterial),
        );
        mat = sharedMaterial((list[0].m.material as THREE.Material).side);
      } else {
        const attrs = ['position', 'normal', 'uv', 'color'].filter((k) =>
          list.every((p) => p.m.geometry.getAttribute(k)),
        );
        const own = list[0].m.material as THREE.MeshStandardMaterial;
        if (
          !attrs.includes('normal') ||
          ((own.map || own.alphaMap) && !attrs.includes('uv')) ||
          (own.vertexColors && !attrs.includes('color'))
        )
          continue;
        geo = merge(list, attrs);
        mat = own;
      }
      if (!geo) continue;
      track(geo);
      const one = new THREE.Mesh(geo, mat);
      one.castShadow = list[0].m.castShadow;
      one.receiveShadow = list[0].m.receiveShadow;
      one.renderOrder = list[0].m.renderOrder;
      joint.add(one);
      for (const p of list) p.m.removeFromParent();
    }
  }
}
