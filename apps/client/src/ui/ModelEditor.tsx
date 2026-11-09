import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { WeaponPart } from '@chromashift/shared';
import { Icon } from './icons';

/*
 * A small 3D editor for weapon models, in the style of Blockbench: add shapes, drag the coloured
 * arrows to move them (red = side, green = up, blue = forward), switch to scale or rotate, and edit
 * the exact numbers, name and description in the sidebar.
 */

const COLOURS: Record<WeaponPart['c'], number> = { team: 0xff4d94, dark: 0x45405a, light: 0xe9e4ef, shell: 0x9a93b4 };
const SHAPES: { s: WeaponPart['s']; label: string }[] = [
  { s: 'box', label: 'Block' },
  { s: 'cyl', label: 'Cylinder' },
  { s: 'sphere', label: 'Sphere' },
  { s: 'cone', label: 'Cone' },
  { s: 'torus', label: 'Ring' },
];
const SHAPE_NAME: Record<WeaponPart['s'], string> = { box: 'Block', cyl: 'Cylinder', sphere: 'Sphere', cone: 'Cone', torus: 'Ring' };
const Z = Math.PI / 2;

const geometry = (s: WeaponPart['s']) =>
  s === 'box' ? new THREE.BoxGeometry(1, 1, 1)
  : s === 'cyl' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 14).rotateX(Z)
  : s === 'sphere' ? new THREE.SphereGeometry(0.5, 16, 12)
  : s === 'cone' ? new THREE.ConeGeometry(0.5, 1, 14).rotateX(-Z)
  : new THREE.TorusGeometry(0.5, 0.12, 8, 20);

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const deg = (r: number) => round((r * 180) / Math.PI, 1);
const rad = (d: number) => (d * Math.PI) / 180;

type Mode = 'translate' | 'rotate' | 'scale';

export interface ModelDraft {
  name: string;
  tagline: string;
  parts: WeaponPart[];
  muzzle: [number, number];
}

export function Num({ label, value, step = 0.01, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="me-num">
      <span>{label}</span>
      <input type="number" className="input" step={step} value={Number.isFinite(value) ? round(value, 3) : 0} onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)} />
    </label>
  );
}

export function ModelEditor({ draft, onChange, onClose }: { draft: ModelDraft; onChange: (patch: Partial<ModelDraft>) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(draft.parts.length ? 0 : -1);
  const [mode, setMode] = useState<Mode>('translate');
  const [snap, setSnap] = useState(true);
  const parts = draft.parts;
  /** The latest props, for the 3D side to read without re-creating the scene. */
  const live = useRef({ parts, sel, onChange });
  live.current = { parts, sel, onChange };
  const muzzle = useRef(draft.muzzle);
  muzzle.current = draft.muzzle;
  const api = useRef<{ sync(): void; frame(): void; setMode(m: Mode): void; setSnap(on: boolean): void } | null>(null);

  // The scene is built once; props flow in through `sync`.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setClearColor(0x15121a);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(0.62, 0.42, 0.78);
    const target = new THREE.Vector3(0, 0.1, -0.08);
    camera.lookAt(target);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x44405a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const grid = new THREE.GridHelper(1.6, 32, 0x5a5470, 0x2e2a3a);
    grid.position.y = -0.02;
    scene.add(grid);
    const axes = new THREE.AxesHelper(0.25);
    axes.position.y = -0.02;
    scene.add(axes);
    // A faint hand-height marker so size is easy to judge.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 10).rotateX(-Z), new THREE.MeshBasicMaterial({ color: 0xffb547 }));
    arrow.name = 'muzzle';
    scene.add(arrow);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.copy(target);
    orbit.enableDamping = true;
    orbit.update();
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSize(0.8);
    scene.add(tc.getHelper());
    tc.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      dragging = !!e.value;
    });
    let dragging = false;
    const meshes: THREE.Mesh[] = [];
    const shapes: string[] = [];
    const outline = new THREE.BoxHelper(new THREE.Object3D(), 0xffffff);
    outline.visible = false;
    scene.add(outline);

    const apply = (m: THREE.Mesh, p: WeaponPart) => {
      m.position.set(p.x, p.y, p.z);
      m.scale.set(Math.max(0.005, p.w), Math.max(0.005, p.h), Math.max(0.005, p.d));
      m.rotation.set(rad(p.rx ?? 0), rad(p.ry ?? 0), rad(p.rz ?? 0));
      (m.material as THREE.MeshStandardMaterial).color.setHex(COLOURS[p.c]);
    };

    const sync = () => {
      const { parts: ps, sel: s } = live.current;
      while (meshes.length > ps.length) {
        const m = meshes.pop()!;
        shapes.pop();
        if (tc.object === m) tc.detach();
        scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      ps.forEach((p, i) => {
        if (!meshes[i]) {
          const m = new THREE.Mesh(geometry(p.s), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 }));
          m.userData.i = i;
          scene.add(m);
          meshes[i] = m;
          shapes[i] = p.s;
        } else if (shapes[i] !== p.s) {
          meshes[i].geometry.dispose();
          meshes[i].geometry = geometry(p.s);
          shapes[i] = p.s;
        }
        // The part being dragged is already where the pointer put it.
        if (!(dragging && tc.object === meshes[i])) apply(meshes[i], p);
      });
      const m = meshes[s];
      if (m && tc.object !== m) tc.attach(m);
      if (!m) tc.detach();
      outline.visible = !!m;
      if (m) outline.setFromObject(m);
    };

    const syncMuzzle = () => arrow.position.set(0, muzzle.current[0], muzzle.current[1]);

    tc.addEventListener('objectChange', () => {
      const m = tc.object as THREE.Mesh | undefined;
      if (!m) return;
      const { parts: ps, sel: s, onChange: change } = live.current;
      const p = ps[s];
      if (!p) return;
      const next: WeaponPart = {
        ...p,
        x: round(m.position.x), y: round(m.position.y), z: round(m.position.z),
        w: round(m.scale.x), h: round(m.scale.y), d: round(m.scale.z),
        rx: deg(m.rotation.x), ry: deg(m.rotation.y), rz: deg(m.rotation.z),
      };
      outline.setFromObject(m);
      change({ parts: ps.map((q, i) => (i === s ? next : q)) });
    });

    // Click a shape to select it (a drag is orbiting, not a click).
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (!down || dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) setSel(hit.object.userData.i as number);
    };
    renderer.domElement.addEventListener('pointerdown', pd);
    renderer.domElement.addEventListener('pointerup', pu);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      orbit.update();
      syncMuzzle();
      const m = meshes[live.current.sel];
      if (m && outline.visible) outline.setFromObject(m);
      renderer.render(scene, camera);
    };
    loop();

    api.current = {
      sync,
      frame: () => {
        camera.position.set(0.62, 0.42, 0.78);
        orbit.target.copy(target);
        orbit.update();
      },
      setMode: (m) => tc.setMode(m),
      setSnap: (on) => {
        tc.setTranslationSnap(on ? 0.005 : null);
        tc.setRotationSnap(on ? rad(5) : null);
        tc.setScaleSnap(on ? 0.005 : null);
      },
    };
    api.current.setSnap(true);
    sync();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pd);
      renderer.domElement.removeEventListener('pointerup', pu);
      tc.dispose();
      orbit.dispose();
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.sync();
  });
  useEffect(() => api.current?.setMode(mode), [mode]);
  useEffect(() => api.current?.setSnap(snap), [snap]);

  const set = (patch: Partial<WeaponPart>) => onChange({ parts: parts.map((p, i) => (i === sel ? { ...p, ...patch } : p)) });
  const add = (s: WeaponPart['s']) => {
    const p: WeaponPart = { s, x: 0, y: 0.1, z: -0.1, w: 0.08, h: 0.08, d: s === 'cyl' || s === 'cone' ? 0.16 : 0.08, c: 'shell', n: `${SHAPE_NAME[s]} ${parts.length + 1}` };
    onChange({ parts: [...parts, p] });
    setSel(parts.length);
  };
  const remove = () => {
    if (sel < 0) return;
    onChange({ parts: parts.filter((_, i) => i !== sel) });
    setSel(Math.min(sel, parts.length - 2));
  };
  const duplicate = (mirror = false) => {
    const p = parts[sel];
    if (!p) return;
    onChange({ parts: [...parts, { ...p, x: mirror ? -p.x : p.x + 0.03, n: `${p.n ?? SHAPE_NAME[p.s]} copy`.slice(0, 24) }] });
    setSel(parts.length);
  };
  const cur = parts[sel];

  // Keyboard: W / E / R switch tools, Delete removes the selected shape, Ctrl+D copies it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'KeyW') setMode('translate');
      else if (e.code === 'KeyE') setMode('rotate');
      else if (e.code === 'KeyR') setMode('scale');
      else if (e.code === 'Delete' || e.code === 'Backspace') remove();
      else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicate();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  return (
    <div className="me" role="dialog" aria-label="Model editor">
      <header className="me__bar">
        <button className="btn btn--ghost btn--sm" onClick={onClose}>
          <Icon.back size={16} /> Done
        </button>
        <strong className="me__title">Model editor</strong>
        <span className="me__tools" role="toolbar" aria-label="Tools">
          {(['translate', 'rotate', 'scale'] as Mode[]).map((m, i) => (
            <button key={m} className="btn btn--sm" aria-pressed={mode === m} data-on={mode === m} onClick={() => setMode(m)} title={`${m} (${'WER'[i]})`}>
              {m === 'translate' ? 'Move' : m === 'rotate' ? 'Rotate' : 'Resize'}
            </button>
          ))}
          <button className="btn btn--sm" aria-pressed={snap} data-on={snap} onClick={() => setSnap(!snap)} title="Snap to a grid">
            Snap
          </button>
          <button className="btn btn--sm" onClick={() => api.current?.frame()} title="Reset the camera">
            Reset view
          </button>
        </span>
      </header>

      <div className="me__body">
        <aside className="me__side me__side--left">
          <div className="me__head">Add</div>
          <div className="me__add">
            {SHAPES.map((x) => (
              <button key={x.s} className="btn btn--sm" onClick={() => add(x.s)}>
                <Icon.plus size={14} /> {x.label}
              </button>
            ))}
          </div>
          <div className="me__head">Parts ({parts.length})</div>
          <div className="me__list">
            {parts.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nothing yet. Add a block to begin, or use the starter gun.</p>}
            {parts.map((p, i) => (
              <button key={i} className="me__part" data-on={i === sel} onClick={() => setSel(i)}>
                <i style={{ background: `#${COLOURS[p.c].toString(16).padStart(6, '0')}` }} />
                <span>{p.n || `${SHAPE_NAME[p.s]} ${i + 1}`}</span>
                <em>{SHAPE_NAME[p.s]}</em>
              </button>
            ))}
          </div>
          <div className="me__add">
            <button className="btn btn--sm" disabled={!cur} onClick={() => duplicate()}>
              Copy
            </button>
            <button className="btn btn--sm" disabled={!cur} onClick={() => duplicate(true)}>
              Mirror copy
            </button>
            <button className="btn btn--sm btn--danger" disabled={!cur} onClick={remove}>
              Delete
            </button>
          </div>
          <p className="muted small" style={{ margin: 8 }}>
            Drag the arrows to move a part (red side, green up, blue forward). W move · E rotate · R resize · Delete removes. Scroll to zoom, drag empty space to turn the view.
          </p>
        </aside>

        <div className="me__view" ref={host} />

        <aside className="me__side me__side--right">
          <div className="me__head">Weapon</div>
          <label className="me-field">
            <span>Name</span>
            <input className="input" value={draft.name} maxLength={28} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label className="me-field">
            <span>Description</span>
            <textarea className="input" rows={2} value={draft.tagline} maxLength={90} onChange={(e) => onChange({ tagline: e.target.value })} />
          </label>
          <div className="me__grid">
            <Num label="Muzzle up" value={draft.muzzle[0]} onChange={(v) => onChange({ muzzle: [v, draft.muzzle[1]] })} />
            <Num label="Muzzle forward" value={draft.muzzle[1]} onChange={(v) => onChange({ muzzle: [draft.muzzle[0], v] })} />
          </div>

          <div className="me__head">{cur ? 'Selected part' : 'No part selected'}</div>
          {cur && (
            <>
              <label className="me-field">
                <span>Name</span>
                <input className="input" value={cur.n ?? ''} maxLength={24} placeholder={`${SHAPE_NAME[cur.s]} ${sel + 1}`} onChange={(e) => set({ n: e.target.value })} />
              </label>
              <div className="me__grid">
                <label className="me-field">
                  <span>Shape</span>
                  <select className="input" value={cur.s} onChange={(e) => set({ s: e.target.value as WeaponPart['s'] })}>
                    {SHAPES.map((x) => (
                      <option key={x.s} value={x.s}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="me-field">
                  <span>Colour</span>
                  <select className="input" value={cur.c} onChange={(e) => set({ c: e.target.value as WeaponPart['c'] })}>
                    <option value="team">Team paint</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="shell">Shell</option>
                  </select>
                </label>
              </div>
              <div className="me__head me__head--sub">Position</div>
              <div className="me__grid me__grid--3">
                <Num label="X side" value={cur.x} onChange={(v) => set({ x: v })} />
                <Num label="Y up" value={cur.y} onChange={(v) => set({ y: v })} />
                <Num label="Z forward" value={cur.z} onChange={(v) => set({ z: v })} />
              </div>
              <div className="me__head me__head--sub">Size</div>
              <div className="me__grid me__grid--3">
                <Num label="Width" value={cur.w} onChange={(v) => set({ w: Math.max(0.005, v) })} />
                <Num label="Height" value={cur.h} onChange={(v) => set({ h: Math.max(0.005, v) })} />
                <Num label="Length" value={cur.d} onChange={(v) => set({ d: Math.max(0.005, v) })} />
              </div>
              <div className="me__head me__head--sub">Rotation (degrees)</div>
              <div className="me__grid me__grid--3">
                <Num label="X" step={5} value={cur.rx ?? 0} onChange={(v) => set({ rx: v })} />
                <Num label="Y" step={5} value={cur.ry ?? 0} onChange={(v) => set({ ry: v })} />
                <Num label="Z" step={5} value={cur.rz ?? 0} onChange={(v) => set({ rz: v })} />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
