import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  addFace, bevelEdges, boxMesh, cylinderMesh, defaultMaterial, deleteFaces, deleteVerts, encodeVoxels, extrudeFaces, flipFaces, greedyMesh, insetFaces, loopCut,
  mergeVerts, meshEdges, meshFromQuads, mirrorX, newNodeId, nodeGrid, sanitizeAsset, setFaceMaterial, sphereMesh, subdivide, transformVerts, unwrap, VoxelGrid, wedgeMesh,
  type AssetMaterial, type FaceUV, type MeshNode, type ModelAsset, type ModelNode, type PolyMesh, type PrimNode, type PrimShape, type VoxNode,
} from '@chromashift/shared';
import { assetMaterials, faceLooks, meshGeometry, paintedMaterials, primGeometry, voxGeometry, type AssetMaterials } from '../modeling/assetBuild';
import { decalCanvas, PaintSurface, type DecalId, type PaintChannel } from '../modeling/paint';

/*
 * The Studio's 3D side: the scene, cameras and gizmo, picking, and every editing operation. The
 * React workspace drives it through plain methods and redraws when `onChange` fires. The asset
 * being edited lives here in editable form (voxel grids, polygon meshes, paint canvases) and is
 * written back into the saved format by `serialize`.
 */

export type StudioMode = 'simple' | 'editor' | 'paint';
export type Element = 'object' | 'vertex' | 'edge' | 'face';
export type Gizmo = 'translate' | 'rotate' | 'scale';
export type VoxTool = 'add' | 'remove' | 'paint' | 'box' | 'fill' | 'smooth' | 'flatten' | 'select';
export type PaintTool = 'brush' | 'erase' | 'fill' | 'face' | 'decal';

export interface StudioSettings {
  gizmo: Gizmo;
  element: Element;
  voxTool: VoxTool;
  paintTool: PaintTool;
  /** Brush radius in voxels (voxel tools) and in centimetres (texture brush). */
  voxRadius: number;
  brushSize: number;
  brushOpacity: number;
  brushHardness: number;
  color: string;
  /** Grey painted into the rough / metal / glow channels. */
  value: number;
  channel: PaintChannel;
  layer: number;
  decal: DecalId;
  decalSize: number;
  decalAngle: number;
  decalText: string;
  material: number;
  symmetry: boolean;
  snap: boolean;
  local: boolean;
  ortho: boolean;
  amount: number;
  helpers: boolean;
}

const D2R = Math.PI / 180;
const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
/** Click selection: with Shift an item already chosen is dropped, otherwise it is added. */
function toggle<T>(set: Set<T>, item: T, add: boolean) {
  if (add && set.has(item)) set.delete(item);
  else set.add(item);
}

export class StudioEngine {
  asset: ModelAsset;
  mode: StudioMode = 'simple';
  sel: string | null = null;
  verts = new Set<number>();
  edges = new Set<string>();
  faces = new Set<number>();
  voxSel = new Set<number>();
  settings: StudioSettings = {
    gizmo: 'translate', element: 'face', voxTool: 'add', paintTool: 'brush', voxRadius: 0, brushSize: 3, brushOpacity: 1, brushHardness: 0.7, color: '#ff4d94', value: 1,
    channel: 'color', layer: 0, decal: 'stripe', decalSize: 12, decalAngle: 0, decalText: '7', material: 0, symmetry: false, snap: true, local: true, ortho: false, amount: 0.05, helpers: true,
  };
  dirty = false;
  onChange: () => void = () => {};
  onNote: (text: string) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(40, 1, 0.005, 2000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  private camera: THREE.Camera = this.persp;
  private orbit: OrbitControls;
  private tc: TransformControls;
  private root = new THREE.Group();
  private helpers = new THREE.Group();
  private overlay = new THREE.Group();
  private pivot = new THREE.Object3D();
  private objects = new Map<string, THREE.Object3D>();
  private owned = new Map<string, { dispose(): void }[]>();
  private mats!: AssetMaterials;
  private grids = new Map<string, VoxelGrid>();
  private paints = new Map<string, PaintSurface>();
  private uvs = new Map<string, FaceUV[]>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private raf = 0;
  private ray = new THREE.Raycaster();
  private dragging = false;
  private dragBase: { mesh: PolyMesh; inv: THREE.Matrix4; ids: number[] } | null = null;
  private stroke: { kind: 'vox' | 'paint' | 'box'; from?: [number, number, number]; changed: boolean } | null = null;
  private down: { x: number; y: number } | null = null;
  private boxPreview = new THREE.Box3Helper(new THREE.Box3(), 0xffffff);
  private scale = 1;
  private ro: ResizeObserver;
  private paintDirty = false;

  constructor(private host: HTMLElement, asset: ModelAsset) {
    this.asset = asset;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.setClearColor(0x17141c);
    host.appendChild(r.domElement);
    r.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x44405a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(1, 2, 1.5);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    fill.position.set(-1.5, 0.6, -1);
    this.scene.add(sun, fill, this.root, this.helpers, this.overlay);
    this.orbit = new OrbitControls(this.persp, r.domElement);
    this.orbit.enableDamping = true;
    this.tc = new TransformControls(this.persp, r.domElement);
    this.tc.setSize(0.8);
    this.scene.add(this.tc.getHelper());
    this.tc.addEventListener('dragging-changed', (e) => this.gizmoDrag(!!e.value));
    this.tc.addEventListener('objectChange', () => this.gizmoMoved());
    this.boxPreview.visible = false;
    this.scene.add(this.boxPreview);
    const el = r.domElement;
    el.addEventListener('pointerdown', this.pd);
    el.addEventListener('pointermove', this.pm);
    el.addEventListener('pointerup', this.pu);
    el.addEventListener('pointercancel', this.pu);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.load(asset, true);
    this.frame();
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.orbit.update();
      if (this.paintDirty) {
        this.paintDirty = false;
        for (const p of this.paints.values()) p.refresh();
      }
      r.render(this.scene, this.camera);
    };
    loop();
  }

  /* ---------- Document ---------- */

  /** Size of the working area: weapons and accessories are hand-sized, props and vehicles metres. */
  private workScale() {
    return this.asset.kind === 'weapon' ? 1 : this.asset.kind === 'accessory' ? 2 : this.asset.kind === 'vehicle' ? 6 : 8;
  }

  private load(asset: ModelAsset, first = false) {
    this.asset = asset;
    for (const list of this.owned.values()) for (const o of list) o.dispose();
    this.owned.clear();
    this.objects.clear();
    this.grids.clear();
    this.uvs.clear();
    for (const p of this.paints.values()) p.dispose();
    this.paints.clear();
    this.root.clear();
    this.mats?.dispose();
    this.mats = assetMaterials(asset, { size: 128 });
    for (const n of asset.nodes) if (n.t === 'vox') this.grids.set(n.id, nodeGrid(n));
    for (const n of asset.nodes) this.buildNode(n);
    this.reparent();
    for (const n of asset.nodes)
      if (n.t === 'mesh' && n.paint)
        void PaintSurface.from(n.paint).then((p) => {
          if (!this.asset.nodes.includes(n)) return p.dispose();
          this.paints.set(n.id, p);
          this.buildNode(n);
          this.reparent();
        });
    if (first || this.scale !== this.workScale()) this.buildHelpers();
    if (this.sel && !asset.nodes.some((n) => n.id === this.sel)) this.sel = null;
    this.clearSub();
    this.refreshOverlay();
  }

  private buildHelpers() {
    this.scale = this.workScale();
    this.helpers.clear();
    const s = this.scale;
    const grid = new THREE.GridHelper(1.6 * s, 32, 0x5a5470, 0x2e2a3a);
    const axes = new THREE.AxesHelper(0.25 * s);
    this.helpers.add(grid, axes);
  }

  node(id = this.sel): ModelNode | undefined {
    return this.asset.nodes.find((n) => n.id === id);
  }
  grid(id = this.sel) {
    return id ? this.grids.get(id) : undefined;
  }
  paint(id = this.sel) {
    return id ? this.paints.get(id) : undefined;
  }

  private disposeNode(id: string) {
    for (const o of this.owned.get(id) ?? []) o.dispose();
    this.owned.delete(id);
    this.objects.get(id)?.removeFromParent();
    this.objects.delete(id);
  }

  private buildNode(n: ModelNode) {
    const old = this.objects.get(n.id);
    const parent = old?.parent ?? null;
    const kids = old ? [...old.children].filter((c) => [...this.objects.values()].includes(c)) : [];
    this.disposeNode(n.id);
    const own: { dispose(): void }[] = [];
    let o: THREE.Object3D, baked = false;
    if (n.t === 'group') o = new THREE.Group();
    else if (n.t === 'prim') {
      const p = primGeometry(n);
      baked = p.baked;
      if (p.owned) own.push(p.geo);
      o = new THREE.Mesh(p.geo, this.mats.list[n.mat] ?? this.mats.list[0]);
    } else if (n.t === 'vox') {
      const geo = voxGeometry(this.grids.get(n.id) ?? nodeGrid(n), n.size, true);
      own.push(geo);
      o = new THREE.Mesh(geo, this.mats.shaded());
    } else {
      const mesh: PolyMesh = { verts: n.verts, faces: n.faces };
      const paint = this.paints.get(n.id);
      const uv = paint ? unwrap(mesh) : undefined;
      if (uv) this.uvs.set(n.id, uv);
      else this.uvs.delete(n.id);
      const geo = meshGeometry(mesh, n.smooth, uv);
      own.push(geo);
      let mats = this.mats.list;
      if (paint && uv) {
        paint.setUnderlay(uv, faceLooks(n, this.asset, this.mats.list));
        mats = paintedMaterials(this.mats.list, paint);
        own.push(...mats);
      }
      o = new THREE.Mesh(geo, mats);
    }
    o.userData.id = n.id;
    o.visible = !n.hidden;
    o.position.set(n.p[0], n.p[1], n.p[2]);
    o.rotation.set(n.r[0] * D2R, n.r[1] * D2R, n.r[2] * D2R);
    if (baked) o.scale.set(1, 1, 1);
    else o.scale.set(n.s[0] || 1e-4, n.s[1] || 1e-4, n.s[2] || 1e-4);
    o.userData.baked = baked;
    this.objects.set(n.id, o);
    this.owned.set(n.id, own);
    (parent ?? this.root).add(o);
    for (const k of kids) o.add(k);
    if (this.tc.object === old) this.attachGizmo();
    return o;
  }

  private reparent() {
    for (const n of this.asset.nodes) {
      const o = this.objects.get(n.id);
      if (o) ((n.parent && this.objects.get(n.parent)) || this.root).add(o);
    }
  }

  /** The asset as it would be saved: grids and paint written back into their nodes. */
  serialize(): ModelAsset {
    for (const n of this.asset.nodes) {
      if (n.t === 'vox') {
        const g = this.grids.get(n.id);
        if (g) {
          n.data = encodeVoxels(g);
          n.n = [g.nx, g.ny, g.nz];
        }
      } else if (n.t === 'mesh') {
        const p = this.paints.get(n.id)?.toData();
        if (p) n.paint = p;
        else delete n.paint;
      }
    }
    this.asset.updatedAt = Date.now();
    return sanitizeAsset(JSON.parse(JSON.stringify(this.asset))) ?? this.asset;
  }

  /** Call after every finished change: records an undo step. */
  commit() {
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.onChange();
  }

  private restore(json: string) {
    const a = sanitizeAsset(JSON.parse(json));
    if (!a) return;
    this.load(a);
    this.attachGizmo();
    this.dirty = true;
    this.onChange();
  }
  get canUndo() {
    return this.undoStack.length > 1;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  undo() {
    if (this.undoStack.length < 2) return;
    this.redoStack.push(this.undoStack.pop()!);
    this.restore(this.undoStack[this.undoStack.length - 1]);
  }
  redo() {
    const j = this.redoStack.pop();
    if (!j) return;
    this.undoStack.push(j);
    this.restore(j);
  }
  /** The starting point of the history (call once after opening). */
  baseline() {
    this.undoStack = [JSON.stringify(this.serialize())];
    this.redoStack = [];
    this.dirty = false;
  }

  /* ---------- Modes, selection and the gizmo ---------- */

  setMode(m: StudioMode) {
    this.mode = m;
    if (m === 'paint') this.ensurePaint();
    this.attachGizmo();
    this.refreshOverlay();
    this.onChange();
  }

  set(patch: Partial<StudioSettings>) {
    Object.assign(this.settings, patch);
    if (patch.ortho !== undefined) this.useCamera(patch.ortho);
    if (patch.helpers !== undefined) this.helpers.visible = patch.helpers;
    if (patch.element !== undefined) this.clearSub();
    this.attachGizmo();
    this.refreshOverlay();
    this.onChange();
  }

  select(id: string | null) {
    if (id === this.sel) return;
    this.sel = id;
    this.clearSub();
    if (this.mode === 'paint') this.ensurePaint();
    this.attachGizmo();
    this.refreshOverlay();
    this.onChange();
  }

  private clearSub() {
    this.verts.clear();
    this.edges.clear();
    this.faces.clear();
    this.voxSel.clear();
  }

  /** Is the left button a drawing tool right now (so dragging edits instead of turning the view)? */
  private drawing() {
    const n = this.node();
    if (!n) return false;
    if (this.mode === 'editor' && n.t === 'vox') return true;
    if (this.mode === 'paint' && (n.t === 'vox' || n.t === 'mesh')) return true;
    return false;
  }

  /** The vertices the current sub-selection covers. */
  selectedVerts(): number[] {
    const n = this.node();
    if (!n || n.t !== 'mesh') return [];
    const out = new Set<number>(this.verts);
    for (const e of this.edges) e.split('_').forEach((v) => out.add(Number(v)));
    for (const f of this.faces) n.faces[f]?.v.forEach((v) => out.add(v));
    return [...out];
  }

  private attachGizmo() {
    const n = this.node(), o = n && this.objects.get(n.id);
    const s = this.settings;
    this.tc.setMode(s.gizmo);
    this.tc.setSpace(s.local ? 'local' : 'world');
    const k = this.scale;
    this.tc.setTranslationSnap(s.snap ? 0.005 * k : null);
    this.tc.setRotationSnap(s.snap ? 5 * D2R : null);
    this.tc.setScaleSnap(s.snap ? 0.05 : null);
    const draw = this.drawing();
    this.orbit.mouseButtons = { LEFT: draw ? (-1 as unknown as THREE.MOUSE) : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: draw ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN };
    this.orbit.touches = { ONE: draw ? (-1 as unknown as THREE.TOUCH) : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.tc.detach();
    if (!n || !o || n.locked || draw) return;
    if (this.mode === 'editor' && n.t === 'mesh' && s.element !== 'object') {
      const ids = this.selectedVerts();
      if (!ids.length) return;
      const c = new THREE.Vector3();
      for (const i of ids) c.add(new THREE.Vector3(n.verts[i * 3], n.verts[i * 3 + 1], n.verts[i * 3 + 2]));
      c.multiplyScalar(1 / ids.length);
      o.add(this.pivot);
      this.pivot.position.copy(c);
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.scale.set(1, 1, 1);
      this.pivot.updateMatrix();
      this.tc.attach(this.pivot);
    } else this.tc.attach(o);
  }

  private gizmoDrag(on: boolean) {
    this.orbit.enabled = !on;
    this.dragging = on;
    const n = this.node();
    if (!n) return;
    if (on && this.tc.object === this.pivot && n.t === 'mesh') {
      this.pivot.updateMatrix();
      this.dragBase = { mesh: { verts: n.verts.slice(), faces: n.faces }, inv: this.pivot.matrix.clone().invert(), ids: this.selectedVerts() };
    }
    if (!on) {
      const o = this.objects.get(n.id);
      if (this.tc.object === o && o?.userData.baked && n.t === 'prim') {
        n.s = [round(n.s[0] * o.scale.x), round(n.s[1] * o.scale.y), round(n.s[2] * o.scale.z)];
        this.buildNode(n);
        this.attachGizmo();
      }
      this.dragBase = null;
      if (this.tc.object === this.pivot) this.attachGizmo();
      this.commit();
    }
  }

  private gizmoMoved() {
    const n = this.node();
    if (!n) return;
    if (this.tc.object === this.pivot && this.dragBase && n.t === 'mesh') {
      this.pivot.updateMatrix();
      const d = this.pivot.matrix.clone().multiply(this.dragBase.inv).elements;
      // Column-major 4 × 4 → the 3 × 4 the mesh code takes.
      const m = transformVerts(this.dragBase.mesh, this.dragBase.ids, [d[0], d[4], d[8], d[12], d[1], d[5], d[9], d[13], d[2], d[6], d[10], d[14]]);
      n.verts = m.verts.map((v) => round(v, 5));
      this.refreshMesh(n);
      return;
    }
    const o = this.objects.get(n.id);
    if (!o) return;
    n.p = [round(o.position.x), round(o.position.y), round(o.position.z)];
    n.r = [round(o.rotation.x / D2R, 2), round(o.rotation.y / D2R, 2), round(o.rotation.z / D2R, 2)];
    if (!o.userData.baked) n.s = [round(o.scale.x), round(o.scale.y), round(o.scale.z)];
    this.onChange();
  }

  /** Redraws a mesh node after its vertices or faces changed (keeping the gizmo where it is). */
  private refreshMesh(n: MeshNode) {
    const o = this.objects.get(n.id) as THREE.Mesh | undefined;
    if (!o) return;
    const hadPivot = this.pivot.parent === o;
    const paint = this.paints.get(n.id);
    const mesh = { verts: n.verts, faces: n.faces };
    const uv = paint ? unwrap(mesh) : undefined;
    if (uv) this.uvs.set(n.id, uv);
    const geo = meshGeometry(mesh, n.smooth, uv);
    o.geometry.dispose();
    o.geometry = geo;
    const own = this.owned.get(n.id) ?? [];
    own[0] = geo;
    if (hadPivot) o.add(this.pivot);
    this.refreshOverlay();
  }

  /* ---------- Overlay: vertices, edges, selection ---------- */

  private refreshOverlay() {
    for (const c of [...this.overlay.children]) {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    this.overlay.clear();
    const n = this.node(), o = n && this.objects.get(n.id);
    if (!n || !o || !this.settings.helpers) return;
    o.updateWorldMatrix(true, false);
    const put = (x: THREE.Object3D) => {
      x.matrixAutoUpdate = false;
      x.matrix.copy(o.matrixWorld);
      x.renderOrder = 5;
      this.overlay.add(x);
    };
    if (this.mode === 'simple' || (this.mode === 'editor' && n.t !== 'vox' && (n.t !== 'mesh' || this.settings.element === 'object'))) {
      if ((o as THREE.Mesh).isMesh) {
        const box = new THREE.BoxHelper(o, 0xffffff);
        this.overlay.add(box);
      }
      return;
    }
    if (n.t === 'mesh' && this.mode === 'editor') {
      const pos: number[] = [], col: number[] = [];
      const sel = new THREE.Color(0xffb547), plain = new THREE.Color(0x9a93b4);
      for (const e of meshEdges({ verts: n.verts, faces: n.faces })) {
        const c = this.edges.has(ek(e.a, e.b)) ? sel : plain;
        for (const i of [e.a, e.b]) {
          pos.push(n.verts[i * 3], n.verts[i * 3 + 1], n.verts[i * 3 + 2]);
          col.push(c.r, c.g, c.b);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      put(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 })));
      if (this.settings.element === 'vertex') {
        const pc: number[] = [];
        for (let i = 0; i < n.verts.length / 3; i++) {
          const c = this.verts.has(i) ? sel : plain;
          pc.push(c.r, c.g, c.b);
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.Float32BufferAttribute(n.verts, 3));
        pg.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
        put(new THREE.Points(pg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false })));
      }
      if (this.faces.size) {
        const fp: number[] = [];
        for (const fi of this.faces) {
          const f = n.faces[fi];
          if (!f) continue;
          for (let i = 1; i + 1 < f.v.length; i++) for (const k of [0, i, i + 1]) fp.push(n.verts[f.v[k] * 3], n.verts[f.v[k] * 3 + 1], n.verts[f.v[k] * 3 + 2]);
        }
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
        put(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.4, depthTest: false, side: THREE.DoubleSide })));
      }
    }
    if (n.t === 'vox') {
      const g = this.grids.get(n.id);
      if (!g) return;
      // The bounds of the grid, and the selected voxels glowing.
      const b = new THREE.Box3(new THREE.Vector3((-g.nx / 2) * n.size, 0, (-g.nz / 2) * n.size), new THREE.Vector3((g.nx / 2) * n.size, g.ny * n.size, (g.nz / 2) * n.size));
      put(new THREE.Box3Helper(b, 0x5a5470));
      if (this.voxSel.size) {
        const pick = new VoxelGrid(g.nx, g.ny, g.nz);
        for (const i of this.voxSel) pick.cells[i] = 1;
        put(new THREE.Mesh(voxGeometry(pick, n.size, false), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.45, depthTest: false })));
      }
    }
  }

  /* ---------- Pointer ---------- */

  private pointer(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return r;
  }

  private pd = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    if (e.button !== 0 || e.altKey || this.dragging || !this.drawing()) return;
    const n = this.node()!;
    this.pointer(e);
    if (n.t === 'vox' && (this.mode === 'editor' || this.mode === 'paint')) {
      const tool = this.mode === 'paint' ? 'paint' : this.settings.voxTool;
      const cell = this.voxCell(n, tool === 'add' || (tool === 'box' && !e.shiftKey));
      if (!cell) return;
      if (tool === 'box' || (tool === 'select' && e.ctrlKey)) this.stroke = { kind: 'box', from: cell, changed: false };
      else {
        this.stroke = { kind: 'vox', changed: false };
        this.voxApply(n, cell, tool, e.shiftKey);
      }
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } else if (n.t === 'mesh' && this.mode === 'paint') {
      this.stroke = { kind: 'paint', changed: false };
      this.paintAt(n, e.shiftKey);
      this.renderer.domElement.setPointerCapture(e.pointerId);
    }
  };

  private pm = (e: PointerEvent) => {
    if (!this.stroke) return;
    const n = this.node();
    if (!n) return;
    this.pointer(e);
    if (this.stroke.kind === 'vox' && n.t === 'vox') {
      const tool = this.mode === 'paint' ? 'paint' : this.settings.voxTool;
      if (tool === 'fill' || tool === 'select') return;
      const cell = this.voxCell(n, tool === 'add');
      if (cell) this.voxApply(n, cell, tool, e.shiftKey);
    } else if (this.stroke.kind === 'box' && n.t === 'vox') {
      const cell = this.voxCell(n, this.settings.voxTool === 'box' && !e.shiftKey);
      const g = this.grids.get(n.id)!, a = this.stroke.from!;
      if (!cell) return;
      const lo = (k: number) => Math.min(a[k], cell[k]), hi = (k: number) => Math.max(a[k], cell[k]) + 1;
      this.boxPreview.box.set(new THREE.Vector3((lo(0) - g.nx / 2) * n.size, lo(1) * n.size, (lo(2) - g.nz / 2) * n.size), new THREE.Vector3((hi(0) - g.nx / 2) * n.size, hi(1) * n.size, (hi(2) - g.nz / 2) * n.size));
      const o = this.objects.get(n.id)!;
      o.updateWorldMatrix(true, false);
      this.boxPreview.matrixAutoUpdate = false;
      this.boxPreview.matrix.copy(o.matrixWorld);
      this.boxPreview.visible = true;
      this.boxPreview.userData.to = cell;
    } else if (this.stroke.kind === 'paint' && n.t === 'mesh' && (this.settings.paintTool === 'brush' || this.settings.paintTool === 'erase' || this.settings.paintTool === 'face')) this.paintAt(n, e.shiftKey);
  };

  private pu = (e: PointerEvent) => {
    const st = this.stroke;
    this.stroke = null;
    const n = this.node();
    if (st && n) {
      if (st.kind === 'box' && n.t === 'vox') {
        const to = (this.boxPreview.userData.to as [number, number, number] | undefined) ?? st.from!;
        this.boxPreview.visible = false;
        delete this.boxPreview.userData.to;
        const g = this.grids.get(n.id)!;
        if (this.settings.voxTool === 'select') {
          if (!e.shiftKey) this.voxSel.clear();
          for (let z = Math.min(st.from![2], to[2]); z <= Math.max(st.from![2], to[2]); z++)
            for (let y = Math.min(st.from![1], to[1]); y <= Math.max(st.from![1], to[1]); y++)
              for (let x = Math.min(st.from![0], to[0]); x <= Math.max(st.from![0], to[0]); x++) if (g.get(x, y, z)) this.voxSel.add(g.index(x, y, z));
          this.refreshOverlay();
          this.onChange();
        } else {
          const m = e.shiftKey ? 0 : this.settings.material + 1;
          g.fillBox(st.from!, to, m);
          if (this.settings.symmetry) g.fillBox([g.nx - 1 - st.from![0], st.from![1], st.from![2]], [g.nx - 1 - to[0], to[1], to[2]], m);
          this.remesh(n);
          this.commit();
        }
      } else if (st.changed) this.commit();
      return;
    }
    // A click (not a drag): select.
    if (!this.down || this.dragging || e.button !== 0 || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    this.pointer(e);
    this.click(e);
  };

  private click(e: PointerEvent) {
    const n = this.node();
    const add = e.shiftKey || e.ctrlKey;
    if (n && n.t === 'mesh' && this.mode === 'editor' && this.settings.element !== 'object') {
      const o = this.objects.get(n.id) as THREE.Mesh;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const px = (i: number) => {
        const v = new THREE.Vector3(n.verts[i * 3], n.verts[i * 3 + 1], n.verts[i * 3 + 2]).applyMatrix4(o.matrixWorld).project(this.camera);
        return [((v.x + 1) / 2) * rect.width + rect.left, ((1 - v.y) / 2) * rect.height + rect.top, v.z] as const;
      };
      if (this.settings.element === 'vertex') {
        let best = -1, bd = 14;
        for (let i = 0; i < n.verts.length / 3; i++) {
          const [x, y, z] = px(i), d = Math.hypot(x - e.clientX, y - e.clientY);
          if (z < 1 && d < bd) {
            bd = d;
            best = i;
          }
        }
        if (!add) this.verts.clear();
        if (best >= 0) toggle(this.verts, best, add);
      } else if (this.settings.element === 'edge') {
        let best = '', bd = 12;
        for (const ed of meshEdges({ verts: n.verts, faces: n.faces })) {
          const [ax, ay] = px(ed.a), [bx, by] = px(ed.b);
          const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
          const t = Math.max(0, Math.min(1, ((e.clientX - ax) * (bx - ax) + (e.clientY - ay) * (by - ay)) / l2));
          const d = Math.hypot(ax + (bx - ax) * t - e.clientX, ay + (by - ay) * t - e.clientY);
          if (d < bd) {
            bd = d;
            best = ek(ed.a, ed.b);
          }
        }
        if (!add) this.edges.clear();
        if (best) toggle(this.edges, best, add);
      } else {
        const hit = this.ray.intersectObject(o, false)[0];
        if (!add) this.faces.clear();
        if (hit?.faceIndex != null) {
          const fi = (o.geometry.userData.triFace as Uint32Array)[hit.faceIndex];
          toggle(this.faces, fi, add);
        }
      }
      this.attachGizmo();
      this.refreshOverlay();
      this.onChange();
      return;
    }
    if (this.drawing()) return;
    const meshes = [...this.objects.values()].filter((o) => (o as THREE.Mesh).isMesh && o.visible);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    const id = hit ? (hit.object.userData.id as string) : null;
    const target = id && this.node(id);
    this.select(target && !target.locked ? id : null);
  }

  /* ---------- Voxels ---------- */

  /** The voxel under the pointer: the one in front of the surface (to add) or the one hit. */
  private voxCell(n: VoxNode, outside: boolean): [number, number, number] | null {
    const o = this.objects.get(n.id) as THREE.Mesh, g = this.grids.get(n.id);
    if (!o || !g) return null;
    const hit = this.ray.intersectObject(o, false)[0];
    let p: THREE.Vector3, nrm: THREE.Vector3;
    if (hit?.face) {
      p = o.worldToLocal(hit.point.clone());
      nrm = hit.face.normal.clone();
    } else {
      if (!outside) return null;
      // Nothing there yet: build up from the floor of the grid.
      const inv = o.matrixWorld.clone().invert();
      const ro = this.ray.ray.origin.clone().applyMatrix4(inv), rd = this.ray.ray.direction.clone().transformDirection(inv);
      if (Math.abs(rd.y) < 1e-6) return null;
      const t = -ro.y / rd.y;
      if (t < 0) return null;
      p = ro.addScaledVector(rd, t);
      nrm = new THREE.Vector3(0, -1, 0);
      outside = false;
      p.y += n.size * 0.5;
    }
    p.addScaledVector(nrm, (outside ? 0.5 : -0.5) * n.size);
    const c: [number, number, number] = [Math.floor(p.x / n.size + g.nx / 2), Math.floor(p.y / n.size), Math.floor(p.z / n.size + g.nz / 2)];
    return g.inside(c[0], c[1], c[2]) ? c : null;
  }

  private voxApply(n: VoxNode, c: [number, number, number], tool: VoxTool, shift: boolean) {
    const g = this.grids.get(n.id)!, s = this.settings, m = s.material + 1, r = s.voxRadius;
    const each = (fn: (x: number) => number) => {
      let k = fn(c[0]);
      if (s.symmetry) k += fn(g.nx - 1 - c[0]);
      return k;
    };
    let changed = 0;
    switch (tool) {
      case 'add': changed = each((x) => g.brush(x, c[1], c[2], r, m, 'add')); break;
      case 'remove': changed = each((x) => g.brush(x, c[1], c[2], r, 0, 'remove')); break;
      case 'paint': changed = each((x) => g.brush(x, c[1], c[2], r, m, 'paint')); break;
      case 'smooth': changed = each((x) => g.smooth(x, c[1], c[2], Math.max(2, r + 1))); break;
      case 'flatten': changed = each((x) => g.flatten(x, c[1], c[2], Math.max(1, r), 1, 1)); break;
      case 'fill': changed = each((x) => g.flood(x, c[1], c[2], m)); break;
      case 'select': {
        if (!shift) this.voxSel.clear();
        for (const i of g.connected(c[0], c[1], c[2], true)) this.voxSel.add(i);
        this.refreshOverlay();
        this.onChange();
        return;
      }
    }
    if (changed) {
      this.remesh(n);
      if (this.stroke) this.stroke.changed = true;
    }
  }

  private remesh(n: VoxNode) {
    const o = this.objects.get(n.id) as THREE.Mesh | undefined, g = this.grids.get(n.id);
    if (!o || !g) return;
    const geo = voxGeometry(g, n.size, true);
    o.geometry.dispose();
    o.geometry = geo;
    (this.owned.get(n.id) ?? [])[0] = geo;
    this.refreshOverlay();
  }

  /** Operations on the selected voxels (or the whole grid). */
  voxOp(op: 'delete' | 'fillSel' | 'byMaterial' | 'mirror' | 'smoothAll' | 'clearSel' | 'all', dx = 0, dy = 0, dz = 0, copy = false) {
    const n = this.node(), g = this.grid();
    if (!n || n.t !== 'vox' || !g) return;
    switch (op) {
      case 'delete': for (const i of this.voxSel) g.cells[i] = 0; this.voxSel.clear(); break;
      case 'fillSel': for (const i of this.voxSel) g.cells[i] = this.settings.material + 1; break;
      case 'byMaterial':
        this.voxSel.clear();
        for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === this.settings.material + 1) this.voxSel.add(i);
        this.refreshOverlay();
        return this.onChange();
      case 'all':
        this.voxSel.clear();
        for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) this.voxSel.add(i);
        this.refreshOverlay();
        return this.onChange();
      case 'clearSel': this.voxSel.clear(); this.refreshOverlay(); return this.onChange();
      case 'mirror': g.mirrorX(); break;
      case 'smoothAll': g.smooth(); break;
    }
    if (dx || dy || dz) this.voxSel = new Set(g.move([...this.voxSel], dx, dy, dz, copy));
    this.remesh(n);
    this.commit();
  }

  voxMove(dx: number, dy: number, dz: number, copy = false) {
    const n = this.node(), g = this.grid();
    if (!n || n.t !== 'vox' || !g || !this.voxSel.size) return;
    this.voxSel = new Set(g.move([...this.voxSel], dx, dy, dz, copy));
    this.remesh(n);
    this.commit();
  }

  /** Changes how fine a voxel object is, keeping its size in the world. */
  voxResize(nx: number, ny: number, nz: number) {
    const n = this.node(), g = this.grid();
    if (!n || n.t !== 'vox' || !g) return;
    const c = (v: number) => Math.max(1, Math.min(96, Math.round(v)));
    const next = g.resample(c(nx), c(ny), c(nz));
    n.size = round((n.size * g.nx) / next.nx, 5);
    n.n = [next.nx, next.ny, next.nz];
    this.grids.set(n.id, next);
    this.voxSel.clear();
    this.remesh(n);
    this.commit();
  }

  /* ---------- Polygon meshes ---------- */

  meshOp(op: 'extrude' | 'inset' | 'bevel' | 'subdivide' | 'smooth' | 'loopcut' | 'delete' | 'merge' | 'mirror' | 'flip' | 'face' | 'material' | 'all' | 'none') {
    const n = this.node();
    if (!n || n.t !== 'mesh') return;
    const m: PolyMesh = { verts: n.verts, faces: n.faces }, a = this.settings.amount * this.scale;
    let out: PolyMesh | null = null;
    const faces = [...this.faces];
    switch (op) {
      case 'all':
        if (this.settings.element === 'vertex') for (let i = 0; i < n.verts.length / 3; i++) this.verts.add(i);
        else if (this.settings.element === 'edge') for (const e of meshEdges(m)) this.edges.add(ek(e.a, e.b));
        else n.faces.forEach((_, i) => this.faces.add(i));
        break;
      case 'none': this.clearSub(); break;
      case 'extrude': if (faces.length) out = extrudeFaces(m, faces, a); break;
      case 'inset': if (faces.length) out = insetFaces(m, faces, a * 0.5); break;
      case 'bevel': {
        const list: [number, number][] = [...this.edges].map((k) => k.split('_').map(Number) as [number, number]);
        for (const fi of faces) {
          const f = n.faces[fi];
          f?.v.forEach((v, i) => list.push([v, f.v[(i + 1) % f.v.length]]));
        }
        if (list.length) {
          out = bevelEdges(m, list, a * 0.4);
          this.clearSub();
        }
        break;
      }
      case 'subdivide': out = subdivide(m, false); this.clearSub(); break;
      case 'smooth': out = subdivide(m, true); this.clearSub(); break;
      case 'loopcut': {
        const e = [...this.edges][0];
        if (e) {
          const [x, y] = e.split('_').map(Number);
          out = loopCut(m, x, y);
          this.clearSub();
        } else this.onNote('Select one edge to cut a loop across it.');
        break;
      }
      case 'delete':
        if (faces.length) out = deleteFaces(m, faces);
        else if (this.selectedVerts().length) out = deleteVerts(m, this.selectedVerts());
        this.clearSub();
        break;
      case 'merge': {
        const ids = this.selectedVerts();
        out = mergeVerts(m, ids.length > 1 ? ids : undefined, 1e-3 * this.scale);
        this.clearSub();
        break;
      }
      case 'mirror': out = mirrorX(m); this.clearSub(); break;
      case 'flip': out = flipFaces(m, faces.length ? faces : undefined); break;
      case 'face': {
        const ids = [...this.verts];
        if (ids.length >= 3) out = addFace(m, ids, this.settings.material);
        else this.onNote('Select three or more vertices to make a face.');
        break;
      }
      case 'material': if (faces.length) out = setFaceMaterial(m, faces, this.settings.material); break;
    }
    if (out) {
      if (out.verts.length / 3 > 12000 || out.faces.length > 12000) return this.onNote('That would make the mesh too heavy.');
      n.verts = out.verts.map((v) => round(v, 5));
      n.faces = out.faces;
      this.refreshMesh(n);
      this.attachGizmo();
      this.commit();
    } else {
      this.attachGizmo();
      this.refreshOverlay();
      this.onChange();
    }
  }

  /** Turns the selected primitive or voxel object into a polygon mesh, to edit its vertices. */
  toMesh() {
    const n = this.node();
    if (!n || n.t === 'mesh' || n.t === 'group') return;
    let mesh: PolyMesh, mat = 0;
    const base = { id: n.id, name: n.name, parent: n.parent, p: n.p, r: n.r };
    let s: [number, number, number] = [1, 1, 1];
    if (n.t === 'prim') {
      const shapes: Record<PrimShape, () => PolyMesh> = {
        box: () => boxMesh(1, 1, 1), cyl: () => cylinderMesh(0.5, 0.5, 1, 16), cone: () => cylinderMesh(0.5, 0, 1, 16), sphere: () => sphereMesh(0.5, 16, 10),
        wedge: () => wedgeMesh(1, 1, 1), capsule: () => sphereMesh(0.5, 16, 10), torus: () => cylinderMesh(0.5, 0.5, 0.24, 20),
      };
      mesh = shapes[n.shape]();
      // Bake the size in, so edits are in real units.
      for (let i = 0; i < mesh.verts.length; i += 3) {
        mesh.verts[i] *= n.s[0];
        mesh.verts[i + 1] *= n.s[1];
        mesh.verts[i + 2] *= n.s[2];
      }
      mat = n.mat;
    } else {
      const g = this.grids.get(n.id)!, q = greedyMesh(g);
      mesh = meshFromQuads(q.positions, q.normals, q.materials, n.size);
      for (let i = 0; i < mesh.verts.length; i += 3) {
        mesh.verts[i] -= (g.nx / 2) * n.size;
        mesh.verts[i + 2] -= (g.nz / 2) * n.size;
      }
      s = n.s;
      this.grids.delete(n.id);
    }
    if (n.t === 'prim') for (const f of mesh.faces) f.m = mat;
    const next: MeshNode = { ...base, t: 'mesh', verts: mesh.verts.map((v) => round(v, 5)), faces: mesh.faces, smooth: n.t === 'vox' ? 0 : 30, s };
    if (!next.parent) delete next.parent;
    this.asset.nodes[this.asset.nodes.indexOf(n)] = next;
    this.buildNode(next);
    this.reparent();
    this.attachGizmo();
    this.refreshOverlay();
    this.commit();
  }

  /* ---------- Painting ---------- */

  /** Gives the selected mesh a paint surface (a base layer) if it has none yet. */
  ensurePaint(size = 512) {
    const n = this.node();
    if (!n || n.t !== 'mesh' || this.paints.has(n.id)) return;
    const p = new PaintSurface(size);
    p.addLayer('Base');
    p.addLayer('Details');
    this.settings.layer = 1;
    this.paints.set(n.id, p);
    this.buildNode(n);
    this.reparent();
  }

  private paintAt(n: MeshNode, shift: boolean) {
    const o = this.objects.get(n.id) as THREE.Mesh, paint = this.paints.get(n.id), uv = this.uvs.get(n.id);
    if (!o || !paint || !uv) return;
    const hit = this.ray.intersectObject(o, false)[0];
    if (hit?.faceIndex == null) return;
    const fi = (o.geometry.userData.triFace as Uint32Array)[hit.faceIndex];
    const s = this.settings, N = paint.size;
    const local = o.worldToLocal(hit.point.clone());
    const grey = Math.round(s.value * 255).toString(16).padStart(2, '0');
    const color = s.channel === 'color' ? s.color : `#${grey}${grey}${grey}`;
    const target = paint.target(s.channel, s.layer);
    const outline = (f: FaceUV) => f.uv.map(([x, y]) => [x * N, y * N] as [number, number]);
    /** Where a point in the mesh lands in a face's patch of the texture. */
    const toTex = (f: FaceUV, p: THREE.Vector3): [number, number] => {
      const d = [p.x - f.o[0], p.y - f.o[1], p.z - f.o[2]];
      const x = d[0] * f.u[0] + d[1] * f.u[1] + d[2] * f.u[2], y = d[0] * f.w[0] + d[1] * f.w[1] + d[2] * f.w[2];
      return [(f.rect[0] + x * f.scale) * N, (f.rect[1] + y * f.scale) * N];
    };
    const f = uv[fi];
    if (!f) return;
    switch (s.paintTool) {
      case 'face':
        if (n.faces[fi].m !== s.material) {
          n.faces[fi].m = s.material;
          this.buildNode(n);
          this.reparent();
        }
        break;
      case 'fill':
        paint.fill(target, color, shift ? undefined : outline(f), false);
        break;
      case 'decal': {
        const [x, y] = toTex(f, local);
        paint.stamp(target, decalCanvas(s.decal, color, s.decalText), x, y, (s.decalSize / 100) * this.scale * f.scale * N, s.decalAngle * D2R, outline(f));
        break;
      }
      default: {
        // The brush is a sphere in space: it paints every face it reaches, each in its own patch.
        const radius = (s.brushSize / 100) * this.scale;
        for (let k = 0; k < n.faces.length; k++) {
          const g = uv[k];
          if (!g) continue;
          const fc = n.faces[k].v;
          let near = false;
          for (const vi of fc) if (Math.hypot(n.verts[vi * 3] - local.x, n.verts[vi * 3 + 1] - local.y, n.verts[vi * 3 + 2] - local.z) < radius * 3 + 1e-6) near = true;
          if (k !== fi && !near) continue;
          // Distance from the face's plane: faces round a corner get a smaller dab.
          const nrm = [g.u[1] * g.w[2] - g.u[2] * g.w[1], g.u[2] * g.w[0] - g.u[0] * g.w[2], g.u[0] * g.w[1] - g.u[1] * g.w[0]];
          const off = Math.abs((local.x - g.o[0]) * nrm[0] + (local.y - g.o[1]) * nrm[1] + (local.z - g.o[2]) * nrm[2]);
          if (off >= radius) continue;
          const [x, y] = toTex(g, local);
          paint.dab(target, x, y, { radius: Math.sqrt(radius * radius - off * off) * g.scale * N, hardness: s.brushHardness, opacity: s.brushOpacity, color, erase: s.paintTool === 'erase' }, outline(g));
        }
      }
    }
    this.paintDirty = true;
    if (this.stroke) this.stroke.changed = true;
  }

  layerOp(op: 'add' | 'delete' | 'up' | 'down' | 'hide' | 'rename' | 'opacity' | 'clear', i = this.settings.layer, value?: string | number) {
    const p = this.paint();
    if (!p) return;
    const l = p.layers[i];
    switch (op) {
      case 'add':
        if (p.layers.length >= 6) return this.onNote('Six layers at most.');
        p.addLayer(String(value ?? `Layer ${p.layers.length + 1}`));
        this.settings.layer = p.layers.length - 1;
        break;
      case 'delete': if (l && p.layers.length > 1) p.layers.splice(i, 1); this.settings.layer = Math.max(0, Math.min(this.settings.layer, p.layers.length - 1)); break;
      case 'up':
      case 'down': {
        const j = op === 'up' ? i + 1 : i - 1;
        if (l && j >= 0 && j < p.layers.length) {
          [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
          this.settings.layer = j;
        }
        break;
      }
      case 'hide': if (l) l.hidden = !l.hidden; break;
      case 'rename': if (l) l.name = String(value ?? l.name).slice(0, 20) || l.name; break;
      case 'opacity': if (l) l.opacity = Math.max(0, Math.min(1, Number(value))); break;
      case 'clear': if (l) l.canvas.getContext('2d')!.clearRect(0, 0, p.size, p.size); break;
    }
    this.paintDirty = true;
    this.commit();
  }

  /* ---------- Objects ---------- */

  addNode(kind: PrimShape | 'group' | 'vox' | 'mesh') {
    if (this.asset.nodes.length >= 160) return this.onNote('This asset has as many parts as it can hold.');
    const k = this.scale;
    const base = { id: newNodeId(), p: [0, 0.1 * k, 0] as [number, number, number], r: [0, 0, 0] as [number, number, number] };
    let n: ModelNode;
    const count = this.asset.nodes.length + 1;
    if (kind === 'group') n = { ...base, t: 'group', name: `Group ${count}`, p: [0, 0, 0], s: [1, 1, 1] };
    else if (kind === 'vox') {
      const g = new VoxelGrid(24, 24, 24);
      g.fillBox([8, 0, 8], [15, 7, 15], this.settings.material + 1);
      n = { ...base, t: 'vox', name: `Voxels ${count}`, n: [24, 24, 24], size: round((0.4 * k) / 24, 5), data: encodeVoxels(g), p: [0, 0, 0], s: [1, 1, 1] };
      this.grids.set(n.id, g);
    } else if (kind === 'mesh') {
      const m = boxMesh(0.1 * k, 0.1 * k, 0.1 * k);
      for (const f of m.faces) f.m = this.settings.material;
      n = { ...base, t: 'mesh', name: `Mesh ${count}`, verts: m.verts, faces: m.faces, smooth: 30, s: [1, 1, 1] };
    } else n = { ...base, t: 'prim', name: `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`, shape: kind, mat: this.settings.material, s: [0.1 * k, 0.1 * k, (kind === 'torus' ? 0.1 : 0.1) * k] } as PrimNode;
    this.asset.nodes.push(n);
    this.buildNode(n);
    this.select(n.id);
    this.commit();
  }

  /** Edits the selected node's fields; rebuilds what it must. */
  patchNode(patch: Partial<ModelNode> & Record<string, unknown>, id = this.sel, record = true) {
    const n = this.node(id);
    if (!n) return;
    Object.assign(n, patch);
    if (patch.parent === null || patch.parent === '') delete n.parent;
    this.buildNode(n);
    this.reparent();
    this.attachGizmo();
    this.refreshOverlay();
    if (record) this.commit();
    else this.onChange();
  }

  duplicate() {
    const n = this.node();
    if (!n) return;
    this.serialize();
    const copy = JSON.parse(JSON.stringify(n)) as ModelNode;
    copy.id = newNodeId();
    copy.name = `${n.name} copy`.slice(0, 28);
    copy.p = [n.p[0] + 0.03 * this.scale, n.p[1], n.p[2]];
    this.asset.nodes.push(copy);
    if (copy.t === 'vox') this.grids.set(copy.id, nodeGrid(copy));
    this.buildNode(copy);
    this.reparent();
    this.select(copy.id);
    this.commit();
  }

  remove(id = this.sel) {
    const n = this.node(id);
    if (!n) return;
    // Children of a removed group move up to its parent.
    for (const c of this.asset.nodes)
      if (c.parent === n.id) {
        if (n.parent) c.parent = n.parent;
        else delete c.parent;
      }
    this.asset.nodes = this.asset.nodes.filter((x) => x !== n);
    this.tc.detach();
    this.disposeNode(n.id);
    this.grids.delete(n.id);
    this.paints.get(n.id)?.dispose();
    this.paints.delete(n.id);
    this.reparent();
    if (this.sel === n.id) this.sel = null;
    this.clearSub();
    this.refreshOverlay();
    this.commit();
  }

  /** Moves a node up or down in the outliner. */
  reorder(id: string, by: number) {
    const i = this.asset.nodes.findIndex((n) => n.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= this.asset.nodes.length) return;
    const list = this.asset.nodes;
    [list[i], list[j]] = [list[j], list[i]];
    this.commit();
  }

  /* ---------- Materials, points, asset fields ---------- */

  setMaterial(i: number, patch: Partial<AssetMaterial>) {
    const m = this.asset.materials[i];
    if (!m) return;
    Object.assign(m, patch);
    this.rebuildAll();
    this.commit();
  }
  addMaterial() {
    if (this.asset.materials.length >= 32) return;
    this.asset.materials.push(defaultMaterial({ name: `Material ${this.asset.materials.length + 1}`, color: parseInt(this.settings.color.slice(1), 16) }));
    this.settings.material = this.asset.materials.length - 1;
    this.rebuildAll();
    this.commit();
  }

  private rebuildAll() {
    this.mats.dispose();
    this.mats = assetMaterials(this.asset, { size: 128 });
    for (const n of this.asset.nodes) this.buildNode(n);
    this.reparent();
    this.attachGizmo();
    this.refreshOverlay();
  }

  patchAsset(patch: Partial<ModelAsset>) {
    Object.assign(this.asset, patch);
    this.commit();
  }

  /* ---------- View ---------- */

  private useCamera(ortho: boolean) {
    const from = this.camera, to = ortho ? this.ortho : this.persp;
    if (from === to) return;
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.orbit.object = to;
    this.tc.camera = to;
    this.resize();
  }

  /** Looks at the model from a standard side, or frames it in perspective. */
  view(v: 'persp' | 'front' | 'back' | 'left' | 'right' | 'top') {
    const d = 1.3 * this.scale, t = this.orbit.target;
    const pos: Record<typeof v, [number, number, number]> = { persp: [0.62 * d, 0.5 * d, 0.78 * d], front: [0, 0, -d], back: [0, 0, d], left: [-d, 0, 0], right: [d, 0, 0], top: [0, d, 0.001] };
    this.camera.position.set(t.x + pos[v][0], t.y + pos[v][1], t.z + pos[v][2]);
    this.camera.lookAt(t);
    this.orbit.update();
  }

  frame() {
    const s = this.scale;
    this.orbit.target.set(0, 0.1 * s, 0);
    this.view('persp');
  }

  focus() {
    const o = this.sel && this.objects.get(this.sel);
    if (!o) return;
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    const d = this.camera.position.clone().sub(this.orbit.target).setLength(Math.max(0.2 * this.scale, b.getSize(new THREE.Vector3()).length() * 1.6));
    this.orbit.target.copy(c);
    this.camera.position.copy(c).add(d);
    this.orbit.update();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const half = 0.6 * this.scale * (this.camera.position.distanceTo(this.orbit.target) / (1.3 * this.scale) || 1);
    this.ortho.left = -half * (w / h);
    this.ortho.right = half * (w / h);
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  /** A picture of the model as it looks now, for the drafts list. */
  snapshot(): string {
    const was = this.settings.helpers;
    this.helpers.visible = false;
    this.overlay.visible = false;
    const gizmo = this.tc.getHelper();
    gizmo.visible = false;
    this.renderer.render(this.scene, this.camera);
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 120;
    c.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, 160, 120);
    this.helpers.visible = was;
    this.overlay.visible = true;
    gizmo.visible = true;
    return c.toDataURL('image/jpeg', 0.7);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.tc.dispose();
    this.orbit.dispose();
    for (const list of this.owned.values()) for (const o of list) o.dispose();
    for (const p of this.paints.values()) p.dispose();
    this.mats.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

