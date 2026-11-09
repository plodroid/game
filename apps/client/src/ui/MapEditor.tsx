import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BUILTIN_LOOKS, CUSTOM_LIMITS, MAPS, type CustomBlock, type CustomMap, type MaterialId } from '@chromashift/shared';
import { Icon } from './icons';
import { Num } from './ModelEditor';

/*
 * A 3D editor for maps, in the style of Blockbench: add blocks, ramps, spawn points, jump pads and
 * objective zones, drag the coloured arrows to move them, resize or turn them, and edit exact
 * numbers, names and materials in the sidebar. Blocks marked "Mirror" get a copy for the other
 * team (shown as a faint ghost), like the built-in maps.
 */

type Kind = 'block' | 'spawn' | 'pad' | 'zone';
type Sel = { k: Kind; i: number } | null;
type Mode = 'translate' | 'rotate' | 'scale';

const MATS: { id: MaterialId; label: string }[] = [
  { id: 'floor', label: 'Floor' },
  { id: 'wall', label: 'Wall' },
  { id: 'metal', label: 'Metal' },
  { id: 'trim', label: 'Trim' },
  { id: 'glass', label: 'Glass (no paint)' },
  { id: 'base', label: 'Base' },
  { id: 'crate', label: 'Crate' },
  { id: 'island', label: 'Grass' },
  { id: 'invisible', label: 'Invisible wall' },
];
const LOOKS: Record<string, string> = { skyline: 'Skyline', core: 'Core', float: 'Float', docks: 'Docks', gardens: 'Gardens', canyon: 'Canyon', arcade: 'Arcade' };
const ZONE_H = 2.4;
const HALF = Math.PI / 2;
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const deg = (r: number) => round((r * 180) / Math.PI, 1);
const rad = (d: number) => (d * Math.PI) / 180;
const key = (k: Kind, i: number) => `${k}:${i}`;

const KIND_LABEL: Record<Kind, string> = { block: 'Block', spawn: 'Spawn', pad: 'Jump pad', zone: 'Zone' };
const LIMIT: Record<Kind, number> = { block: CUSTOM_LIMITS.blocks, spawn: CUSTOM_LIMITS.spawns, pad: CUSTOM_LIMITS.pads, zone: CUSTOM_LIMITS.zones };
const LIST: Record<Kind, 'blocks' | 'spawns' | 'pads' | 'zones'> = { block: 'blocks', spawn: 'spawns', pad: 'pads', zone: 'zones' };

export function MapEditor({
  map,
  onSave,
  onPlay,
  onClose,
}: {
  map: CustomMap;
  /** Returns false when the map was refused. */
  onSave: (m: CustomMap) => boolean;
  onPlay: (m: CustomMap) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<CustomMap>(map);
  const [saved, setSaved] = useState(JSON.stringify(map));
  const [sel, setSel] = useState<Sel>(map.blocks.length ? { k: 'block', i: 0 } : null);
  const [mode, setMode] = useState<Mode>('translate');
  const [snap, setSnap] = useState(true);
  const [note, setNote] = useState('');
  const dirty = useMemo(() => JSON.stringify(draft) !== saved, [draft, saved]);

  const live = useRef({ draft, sel, setDraft, setSel });
  live.current = { draft, sel, setDraft, setSel };
  const api = useRef<{ sync(): void; frame(): void; focus(): [number, number]; setMode(m: Mode): void; setSnap(on: boolean): void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15121a);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
    const home = () => {
      camera.position.set(34, 38, 52);
      orbit.target.set(0, 0, 0);
      orbit.update();
    };
    scene.add(new THREE.HemisphereLight(0xffffff, 0x44405a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(30, 60, 20);
    scene.add(sun);
    const grid = new THREE.GridHelper(120, 60, 0x5a5470, 0x2e2a3a);
    grid.position.y = -0.01;
    scene.add(grid);
    // The map's centre: mirrored items are copied through this point (turned 180°) for the other team.
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(120, 0.12).rotateX(-HALF), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.5 }));
    mid.position.y = 0.01;
    scene.add(mid);
    const mid2 = mid.clone();
    mid2.rotation.y = HALF;
    scene.add(mid2);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.maxPolarAngle = Math.PI * 0.495;
    home();
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSize(0.9);
    scene.add(tc.getHelper());
    let dragging = false;
    tc.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      dragging = !!e.value;
    });

    const objs = new Map<string, THREE.Object3D>();
    const ghosts = new Map<string, THREE.Object3D>();
    const pickable: THREE.Object3D[] = [];
    let sig = '';
    const outline = new THREE.BoxHelper(new THREE.Object3D(), 0xffffff);
    outline.visible = false;
    scene.add(outline);

    const dispose = (o: THREE.Object3D) =>
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
    const clear = () => {
      tc.detach();
      for (const o of [...objs.values(), ...ghosts.values()]) {
        scene.remove(o);
        dispose(o);
      }
      objs.clear();
      ghosts.clear();
      pickable.length = 0;
    };
    const standard = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });

    const make = (k: Kind): THREE.Object3D => {
      if (k === 'block') return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standard(0xffffff));
      if (k === 'zone') return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.28, depthWrite: false }));
      if (k === 'spawn') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.8, 14).translate(0, 0.9, 0), standard(0xff4d94));
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 10).rotateX(-HALF).translate(0, 1.3, -0.7), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        body.add(nose);
        return body;
      }
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 20).translate(0, 0.1, 0), standard(0x35e0c0));
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.2, 0), 3, 0xffffff, 0.8, 0.5);
      arrow.name = 'arrow';
      pad.add(arrow);
      return pad;
    };

    const rebuild = () => {
      clear();
      const d = live.current.draft;
      for (const k of ['block', 'spawn', 'pad', 'zone'] as Kind[]) {
        d[LIST[k]].forEach((_, i) => {
          const o = make(k);
          o.userData = { key: key(k, i) };
          scene.add(o);
          objs.set(key(k, i), o);
          pickable.push(o);
          // Mirrored copies are faint, not selectable.
          if (k !== 'zone') {
            const g = make(k);
            g.traverse((c) => {
              const m = c as THREE.Mesh;
              if (m.material && !(c instanceof THREE.ArrowHelper)) {
                m.material = (m.material as THREE.Material).clone();
                (m.material as THREE.Material).transparent = true;
                (m.material as THREE.Material).opacity = 0.3;
                (m.material as THREE.Material).depthWrite = false;
              }
            });
            scene.add(g);
            ghosts.set(key(k, i), g);
          }
        });
      }
    };

    /** Puts an object where its data says. */
    const place = (k: Kind, i: number, o: THREE.Object3D) => {
      const d = live.current.draft;
      if (k === 'block') {
        const b = d.blocks[i];
        const m = o as THREE.Mesh;
        o.position.set(b.x, b.y, b.z);
        o.scale.set(b.w, b.h, b.d);
        o.rotation.order = 'YXZ';
        o.rotation.set(b.pitch, b.yaw, 0);
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.setHex(b.mat === 'invisible' ? 0x8a86a8 : (MAPS[d.look].theme.materials[b.mat] ?? 0x888888));
        mat.transparent = b.mat === 'glass' || b.mat === 'invisible';
        mat.opacity = b.mat === 'glass' ? 0.4 : b.mat === 'invisible' ? 0.2 : 1;
        mat.depthWrite = !mat.transparent;
      } else if (k === 'spawn') {
        const s = d.spawns[i];
        o.position.set(s.x, s.y, s.z);
        o.rotation.set(0, s.yaw, 0);
      } else if (k === 'pad') {
        const p = d.pads[i];
        o.position.set(p.x, p.y, p.z);
        const a = o.getObjectByName('arrow') as THREE.ArrowHelper;
        const v = new THREE.Vector3(p.vx, p.vy, p.vz);
        if (v.lengthSq() > 1e-6) {
          a.setDirection(v.clone().normalize());
          a.setLength(Math.min(8, 1 + v.length() * 0.25), 0.8, 0.5);
        }
      } else {
        const z = d.zones[i];
        o.position.set(z.x, z.y, z.z);
        o.scale.set(z.w, ZONE_H, z.d);
      }
    };

    const sync = () => {
      const d = live.current.draft;
      const next = `${d.blocks.length},${d.spawns.length},${d.pads.length},${d.zones.length}`;
      if (next !== sig) {
        sig = next;
        rebuild();
      }
      for (const [id, o] of objs) {
        const [k, i] = id.split(':') as [Kind, string];
        if (dragging && tc.object === o) continue;
        place(k, Number(i), o);
      }
      const s = live.current.sel;
      const o = s ? objs.get(key(s.k, s.i)) : undefined;
      if (o && tc.object !== o) tc.attach(o);
      if (!o) tc.detach();
      outline.visible = !!o && s?.k !== 'spawn';
      if (o) outline.setFromObject(o);
      // The selected kind decides which tools make sense.
      tc.showX = tc.showY = tc.showZ = true;
    };

    tc.addEventListener('objectChange', () => {
      const o = tc.object;
      const s = live.current.sel;
      if (!o || !s) return;
      const { draft: d, setDraft: set } = live.current;
      const at = { x: round(o.position.x), y: round(o.position.y), z: round(o.position.z) };
      const list = LIST[s.k];
      let patch: Record<string, number>;
      if (s.k === 'block') {
        o.rotation.z = 0;
        patch = { ...at, w: Math.max(0.1, round(o.scale.x)), h: Math.max(0.1, round(o.scale.y)), d: Math.max(0.1, round(o.scale.z)), yaw: round(o.rotation.y), pitch: round(o.rotation.x) };
      } else if (s.k === 'spawn') {
        o.rotation.x = o.rotation.z = 0;
        o.scale.set(1, 1, 1);
        patch = { ...at, yaw: round(o.rotation.y) };
      } else if (s.k === 'pad') {
        o.rotation.set(0, 0, 0);
        o.scale.set(1, 1, 1);
        patch = at;
      } else {
        o.rotation.set(0, 0, 0);
        patch = { ...at, w: Math.max(1, round(o.scale.x)), d: Math.max(1, round(o.scale.z)) };
        o.scale.y = ZONE_H;
      }
      outline.setFromObject(o);
      set({ ...d, [list]: (d[list] as object[]).map((x, i) => (i === s.i ? { ...x, ...patch } : x)) } as CustomMap);
    });

    // Click an item to select it (a drag is orbiting, not a click).
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (!down || dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(pickable, true)[0];
      if (!hit) return;
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.key) o = o.parent;
      if (!o) return;
      const [k, i] = (o.userData.key as string).split(':');
      live.current.setSel({ k: k as Kind, i: Number(i) });
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
      // Ghosts follow their originals through the middle of the map.
      const d = live.current.draft;
      for (const [id, g] of ghosts) {
        const o = objs.get(id);
        const [k, i] = id.split(':') as [Kind, string];
        if (!o) continue;
        const on = k === 'block' ? d.blocks[Number(i)]?.mirror : true;
        g.visible = !!on;
        if (!on) continue;
        g.position.set(-o.position.x, o.position.y, -o.position.z);
        g.scale.copy(o.scale);
        g.rotation.order = o.rotation.order;
        g.rotation.set(o.rotation.x, o.rotation.y + Math.PI, o.rotation.z);
        if (k === 'pad') {
          const src = o.getObjectByName('arrow') as THREE.ArrowHelper, dst = g.getObjectByName('arrow') as THREE.ArrowHelper;
          if (src && dst) dst.setDirection(new THREE.Vector3(0, 1, 0).applyQuaternion(src.quaternion));
        }
      }
      const s = live.current.sel;
      const o = s ? objs.get(key(s.k, s.i)) : undefined;
      if (o && outline.visible) outline.setFromObject(o);
      renderer.render(scene, camera);
    };
    loop();

    api.current = {
      sync,
      frame: home,
      focus: () => [Math.round(orbit.target.x), Math.round(orbit.target.z)],
      setMode: (m) => tc.setMode(m),
      setSnap: (on) => {
        tc.setTranslationSnap(on ? 0.5 : null);
        tc.setRotationSnap(on ? rad(15) : null);
        tc.setScaleSnap(on ? 0.5 : null);
      },
    };
    api.current.setSnap(true);
    sync();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pd);
      renderer.domElement.removeEventListener('pointerup', pu);
      clear();
      tc.dispose();
      orbit.dispose();
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

  const patch = (p: Record<string, unknown>) => {
    if (!sel) return;
    const list = LIST[sel.k];
    setDraft({ ...draft, [list]: (draft[list] as object[]).map((x, i) => (i === sel.i ? { ...x, ...p } : x)) } as CustomMap);
  };

  const add = (k: Kind, over: Partial<CustomBlock> = {}) => {
    const list = LIST[k];
    if (draft[list].length >= LIMIT[k]) return setNote(`Up to ${LIMIT[k]} ${KIND_LABEL[k].toLowerCase()}s per map.`);
    const [x, z] = api.current?.focus() ?? [0, 0];
    const item =
      k === 'block'
        ? { x, y: 1, z, w: 4, h: 2, d: 4, yaw: 0, pitch: 0, mat: 'wall', paint: true, solid: true, mirror: true, ...over }
        : k === 'spawn'
          ? { x, y: 0, z, yaw: Math.PI }
          : k === 'pad'
            ? { x, y: 0, z, vx: 0, vy: 16, vz: -6 }
            : { x, y: 0.6, z, w: 8, d: 8 };
    setDraft({ ...draft, [list]: [...(draft[list] as object[]), item] } as CustomMap);
    setSel({ k, i: draft[list].length });
    setNote('');
  };
  const remove = () => {
    if (!sel) return;
    if (sel.k === 'spawn' && draft.spawns.length <= 1) return setNote('A map needs at least one spawn.');
    const list = LIST[sel.k];
    const left = draft[list].length - 1;
    setDraft({ ...draft, [list]: (draft[list] as object[]).filter((_, i) => i !== sel.i) } as CustomMap);
    setSel(left > 0 ? { k: sel.k, i: Math.min(sel.i, left - 1) } : null);
  };
  const duplicate = () => {
    if (!sel) return;
    const list = LIST[sel.k];
    if (draft[list].length >= LIMIT[sel.k]) return setNote(`Up to ${LIMIT[sel.k]} ${KIND_LABEL[sel.k].toLowerCase()}s per map.`);
    const src = draft[list][sel.i] as unknown as { x: number };
    setDraft({ ...draft, [list]: [...(draft[list] as object[]), { ...src, x: src.x + 2 }] } as CustomMap);
    setSel({ k: sel.k, i: draft[list].length });
  };

  const save = () => {
    if (!onSave(draft)) return setNote('That map couldn’t be saved.');
    setSaved(JSON.stringify(draft));
    setNote('Saved.');
  };
  const close = () => {
    if (dirty && !window.confirm('Leave without saving your changes?')) return;
    onClose();
  };

  // Keyboard: W / E / R switch tools, Delete removes the selection, Ctrl+D copies it, Ctrl+S saves.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (e.code === 'KeyW') setMode('translate');
      else if (e.code === 'KeyE') setMode('rotate');
      else if (e.code === 'KeyR') setMode('scale');
      else if (e.code === 'Delete' || e.code === 'Backspace') remove();
      else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        duplicate();
      } else if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  });

  const cur = sel ? (draft[LIST[sel.k]][sel.i] as unknown as Record<string, number | string | boolean | undefined>) : undefined;
  const blockCur = sel?.k === 'block' ? draft.blocks[sel.i] : undefined;
  const rows: { k: Kind; i: number; label: string; sub: string; colour: string }[] = [
    ...draft.blocks.map((b, i) => ({ k: 'block' as const, i, label: b.n || `${MATS.find((m) => m.id === b.mat)?.label.split(' ')[0]} ${i + 1}`, sub: b.mirror ? 'mirrored' : '', colour: `#${(MAPS[draft.look].theme.materials[b.mat] ?? 0x888888).toString(16).padStart(6, '0')}` })),
    ...draft.spawns.map((_, i) => ({ k: 'spawn' as const, i, label: `Spawn ${i + 1}`, sub: 'team start', colour: '#ff4d94' })),
    ...draft.pads.map((_, i) => ({ k: 'pad' as const, i, label: `Jump pad ${i + 1}`, sub: 'launches', colour: '#35e0c0' })),
    ...draft.zones.map((_, i) => ({ k: 'zone' as const, i, label: `Zone ${i + 1}`, sub: 'objective', colour: '#ffb547' })),
  ];
  const n = (k: string) => (typeof cur?.[k] === 'number' ? (cur[k] as number) : 0);

  return (
    <div className="me" role="dialog" aria-label="Map editor">
      <header className="me__bar">
        <button className="btn btn--ghost btn--sm" onClick={close}>
          <Icon.back size={16} /> Close
        </button>
        <strong className="me__title">
          Map editor{dirty ? ' •' : ''} <span className="muted small">{note}</span>
        </strong>
        <span className="me__tools" role="toolbar" aria-label="Tools">
          {(['translate', 'rotate', 'scale'] as Mode[]).map((m, i) => (
            <button key={m} className="btn btn--sm" aria-pressed={mode === m} data-on={mode === m} onClick={() => setMode(m)} title={`${m} (${'WER'[i]})`}>
              {m === 'translate' ? 'Move' : m === 'rotate' ? 'Turn' : 'Resize'}
            </button>
          ))}
          <button className="btn btn--sm" aria-pressed={snap} data-on={snap} onClick={() => setSnap(!snap)} title="Snap to a grid">
            Snap
          </button>
          <button className="btn btn--sm" onClick={() => api.current?.frame()}>
            Reset view
          </button>
          <button className="btn btn--sm btn--primary" onClick={save}>
            Save
          </button>
          <button
            className="btn btn--sm"
            onClick={() => {
              if (onSave(draft)) {
                setSaved(JSON.stringify(draft));
                onPlay(draft);
              }
            }}
            title="Save and play this map against bots"
          >
            Save &amp; play
          </button>
        </span>
      </header>

      <div className="me__body">
        <aside className="me__side me__side--left">
          <div className="me__head">Add</div>
          <div className="me__add">
            <button className="btn btn--sm" onClick={() => add('block')}>
              <Icon.plus size={14} /> Block
            </button>
            <button className="btn btn--sm" onClick={() => add('block', { w: 4, h: 0.6, d: 8, y: 1.2, pitch: 0.3, mat: 'metal' })}>
              <Icon.plus size={14} /> Ramp
            </button>
            <button className="btn btn--sm" onClick={() => add('block', { w: 12, h: 1, d: 12, y: -0.5, mat: 'floor' })}>
              <Icon.plus size={14} /> Floor
            </button>
            <button className="btn btn--sm" onClick={() => add('spawn')}>
              <Icon.plus size={14} /> Spawn
            </button>
            <button className="btn btn--sm" onClick={() => add('pad')}>
              <Icon.plus size={14} /> Jump pad
            </button>
            <button className="btn btn--sm" onClick={() => add('zone')}>
              <Icon.plus size={14} /> Zone
            </button>
          </div>
          <div className="me__head">Items ({rows.length})</div>
          <div className="me__list" style={{ maxHeight: '38vh' }}>
            {rows.map((r) => (
              <button key={key(r.k, r.i)} className="me__part" data-on={sel?.k === r.k && sel.i === r.i} onClick={() => setSel({ k: r.k, i: r.i })}>
                <i style={{ background: r.colour }} />
                <span>{r.label}</span>
                <em>{r.sub}</em>
              </button>
            ))}
          </div>
          <div className="me__add">
            <button className="btn btn--sm" disabled={!cur} onClick={duplicate}>
              Copy
            </button>
            <button className="btn btn--sm btn--danger" disabled={!cur} onClick={remove}>
              Delete
            </button>
          </div>
          <p className="muted small" style={{ margin: 8 }}>
            Build one team’s half: the yellow lines cross at the centre, and mirrored items get a faint copy turned 180° around it for the other team. Drag the arrows to move (red side, green up, blue forward). W move · E turn · R resize · Delete removes · Ctrl+S saves. Scroll to zoom, drag empty space to turn the view.
          </p>
        </aside>

        <div className="me__view" ref={host} />

        <aside className="me__side me__side--right">
          <div className="me__head">Map</div>
          <label className="me-field">
            <span>Name</span>
            <input className="input" value={draft.name} maxLength={28} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="me-field">
            <span>Description</span>
            <textarea className="input" rows={2} value={draft.description} maxLength={90} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="me-field">
            <span>Sky &amp; colours</span>
            <select className="input" value={draft.look} onChange={(e) => setDraft({ ...draft, look: e.target.value as CustomMap['look'] })}>
              {BUILTIN_LOOKS.map((l) => (
                <option key={l} value={l}>
                  {LOOKS[l]}
                </option>
              ))}
            </select>
          </label>

          <div className="me__head">{sel && cur ? `Selected ${KIND_LABEL[sel.k].toLowerCase()}` : 'Nothing selected'}</div>
          {sel && cur && (
            <>
              {blockCur && (
                <>
                  <label className="me-field">
                    <span>Name</span>
                    <input className="input" value={blockCur.n ?? ''} maxLength={24} placeholder={`Block ${sel.i + 1}`} onChange={(e) => patch({ n: e.target.value })} />
                  </label>
                  <label className="me-field">
                    <span>Material</span>
                    <select className="input" value={blockCur.mat} onChange={(e) => patch({ mat: e.target.value, paint: e.target.value !== 'glass' && e.target.value !== 'invisible' })}>
                      {MATS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="me__grid">
                    <label className="me-field me-check">
                      <input type="checkbox" checked={blockCur.paint} onChange={(e) => patch({ paint: e.target.checked })} />
                      <span>Paintable</span>
                    </label>
                    <label className="me-field me-check">
                      <input type="checkbox" checked={blockCur.solid} onChange={(e) => patch({ solid: e.target.checked })} />
                      <span>Solid</span>
                    </label>
                    <label className="me-field me-check">
                      <input type="checkbox" checked={blockCur.mirror} onChange={(e) => patch({ mirror: e.target.checked })} />
                      <span>Mirror</span>
                    </label>
                  </div>
                </>
              )}
              <div className="me__head me__head--sub">Position</div>
              <div className="me__grid me__grid--3">
                <Num label="X side" step={0.5} value={n('x')} onChange={(v) => patch({ x: v })} />
                <Num label="Y up" step={0.5} value={n('y')} onChange={(v) => patch({ y: v })} />
                <Num label="Z depth" step={0.5} value={n('z')} onChange={(v) => patch({ z: v })} />
              </div>
              {(sel.k === 'block' || sel.k === 'zone') && (
                <>
                  <div className="me__head me__head--sub">Size</div>
                  <div className="me__grid me__grid--3">
                    <Num label="Width" step={0.5} value={n('w')} onChange={(v) => patch({ w: Math.max(sel.k === 'zone' ? 1 : 0.1, v) })} />
                    {sel.k === 'block' && <Num label="Height" step={0.5} value={n('h')} onChange={(v) => patch({ h: Math.max(0.1, v) })} />}
                    <Num label="Depth" step={0.5} value={n('d')} onChange={(v) => patch({ d: Math.max(sel.k === 'zone' ? 1 : 0.1, v) })} />
                  </div>
                </>
              )}
              {sel.k === 'block' && (
                <>
                  <div className="me__head me__head--sub">Rotation (degrees)</div>
                  <div className="me__grid">
                    <Num label="Turn" step={15} value={deg(n('yaw'))} onChange={(v) => patch({ yaw: rad(v) })} />
                    <Num label="Tilt (ramp)" step={5} value={deg(n('pitch'))} onChange={(v) => patch({ pitch: Math.max(-1.5, Math.min(1.5, rad(v))) })} />
                  </div>
                </>
              )}
              {sel.k === 'spawn' && (
                <div className="me__grid">
                  <Num label="Facing °" step={15} value={deg(n('yaw'))} onChange={(v) => patch({ yaw: rad(v) })} />
                </div>
              )}
              {sel.k === 'pad' && (
                <>
                  <div className="me__head me__head--sub">Launch speed</div>
                  <div className="me__grid me__grid--3">
                    <Num label="Side" step={1} value={n('vx')} onChange={(v) => patch({ vx: v })} />
                    <Num label="Up" step={1} value={n('vy')} onChange={(v) => patch({ vy: Math.max(0, v) })} />
                    <Num label="Forward" step={1} value={n('vz')} onChange={(v) => patch({ vz: v })} />
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
