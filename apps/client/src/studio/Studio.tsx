import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  assetStats, MATERIAL_ROLES, PRIM_SHAPES, SURFACES_IDS, type AssetMaterial, type MaterialRole, type ModelAsset, type ModelNode, type PrimShape, type SurfaceId,
} from '@chromashift/shared';
import { isOwner } from '../auth/admin';
import { DECALS, type DecalId, type PaintChannel } from '../modeling/paint';
import { publishedAssets } from '../modeling/library';
import { useUi } from '../state/ui';
import { Help, toolForKey, typing } from '../ui/editorKit';
import { Icon } from '../ui/icons';
import { Num } from '../ui/ModelEditor';
import { StudioEngine, type Element, type Gizmo, type PaintTool, type StudioMode, type VoxTool } from './engine';
import { keepDraft, publishAsset, saveDraft } from './store';

/*
 * The modelling workspace, laid out like the tools people already know (Blender, Blockbench):
 * modes across the top, tools down the left edge, the scene in the middle, the outliner and a
 * contextual inspector on the right. Simple mode places and arranges shapes; Editor mode sculpts
 * voxels and edits vertices, edges and faces; Paint mode paints materials and textures.
 */

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SHAPE_LABEL: Record<PrimShape, string> = { box: 'Block', cyl: 'Cylinder', sphere: 'Sphere', cone: 'Cone', torus: 'Ring', wedge: 'Wedge', capsule: 'Capsule' };
const NODE_KIND: Record<ModelNode['t'], string> = { prim: 'Shape', vox: 'Voxels', mesh: 'Mesh', group: 'Group' };

/** Line icons for the tool rail (24 × 24, drawn as paths). */
const GLYPH: Record<string, string> = {
  translate: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  scale: 'M4 20h7M4 20v-7M4 20l8-8M13 5h6v6M19 5l-5 5',
  object: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12L4 7.5M12 12v9',
  vertex: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M4 4l5 5M20 4l-5 5M12 21v-6',
  edge: 'M5 19L19 5M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  face: 'M4 8l8-4 8 4v8l-8 4-8-4zM8 10l4-2 4 2v4l-4 2-4-2z',
  add: 'M5 9l7-4 7 4v7l-7 4-7-4zM12 10v6M9 13h6',
  remove: 'M5 9l7-4 7 4v7l-7 4-7-4zM9 13h6',
  paint: 'M4 20c2 0 3-1 3-3l9-9 3 3-9 9c-2 0-3 1-6 0zM14 6l2-2 4 4-2 2',
  box: 'M4 6h16v12H4zM4 6l4-3h16l-4 3M20 18l4-3V3',
  fill: 'M5 11l7-7 7 7-7 7zM3 20h18M19 14c1 1.5 2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 1-2 2-3.5',
  smooth: 'M3 15c3-8 6 4 9-4s6 4 9-4',
  flatten: 'M3 16h18M6 12l3-4 3 4M14 12l2-3 2 3',
  select: 'M5 3l12 9-6 1-3 6z',
  brush: 'M4 20c2 0 3-1 3-3l9-9 3 3-9 9c-2 0-3 1-6 0zM14 6l2-2 4 4-2 2',
  erase: 'M4 16l9-9 6 6-6 6H8zM13 19h7',
  facepaint: 'M4 8l8-4 8 4v8l-8 4-8-4zM9 12l2 2 4-4',
  decal: 'M12 3l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.3l6-.7z',
};
const G = ({ id }: { id: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={GLYPH[id] ?? GLYPH.object} />
  </svg>
);

function Tool({ id, label, k, on, onClick }: { id: string; label: string; k?: string; on: boolean; onClick: () => void }) {
  return (
    <button className="st__tool" data-on={on} aria-pressed={on} aria-label={label} title={k ? `${label} (${k})` : label} onClick={onClick}>
      <G id={id} />
    </button>
  );
}

const Sec = ({ title, children }: { title: string; children: ReactNode }) => (
  <>
    <div className="me__head">{title}</div>
    <div className="st__sec">{children}</div>
  </>
);

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="st__slider">
      <span>
        {label} <b className="num">{Math.round(value * 100) / 100}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.valueAsNumber)} />
    </label>
  );
}

interface Command {
  label: string;
  keys?: string;
  run: () => void;
}

export function Studio({ asset, onClose }: { asset: ModelAsset; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  /** The 3D view lives in an element of its own, so the layout can re-render around it freely. */
  const stage = useRef<HTMLDivElement | null>(null);
  const eng = useRef<StudioEngine | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const toast = useUi((s) => s.toast);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // On a narrow screen the side panels start closed, so the model is what you see first.
  const [panels, setPanels] = useState(() => ({ left: innerWidth > 1000, right: innerWidth > 1000 }));
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = (stage.current = document.createElement('div'));
    el.style.cssText = 'position:absolute;inset:0';
    host.current?.appendChild(el);
    const e = new StudioEngine(el, JSON.parse(JSON.stringify(asset)) as ModelAsset);
    e.onChange = bump;
    e.onNote = (text) => toast({ text, kind: 'info' });
    e.baseline();
    eng.current = e;
    if (import.meta.env.DEV) Object.assign(window, { __eng: e });
    bump();
    // Unfinished work is kept on this device every few seconds.
    const auto = setInterval(() => {
      if (!e.dirty) return;
      keepDraft(e.serialize(), e.snapshot());
      e.dirty = false;
    }, 15_000);
    return () => {
      clearInterval(auto);
      if (e.dirty) keepDraft(e.serialize(), e.snapshot());
      e.dispose();
      el.remove();
      eng.current = null;
    };
    // The asset is opened once; later edits live in the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const e = eng.current;
  const a = e?.asset;
  const n = e?.node();
  const s = e?.settings;
  const mode = e?.mode ?? 'simple';
  const paint = e?.paint();

  // Keep the 3D view inside whichever element is the viewport on this render.
  useEffect(() => {
    if (stage.current && host.current && stage.current.parentElement !== host.current) host.current.appendChild(stage.current);
  });

  // The painted texture, shown flat in the inspector.
  useEffect(() => {
    const box = preview.current;
    if (!box) return;
    box.replaceChildren();
    if (paint && mode === 'paint') box.appendChild(paint.composite);
  });

  const save = async () => {
    if (!e) return;
    setBusy(true);
    const err = await saveDraft(e.serialize(), e.snapshot());
    e.dirty = false;
    setBusy(false);
    toast(err ? { text: err, kind: 'warn' } : { text: 'Draft saved.', kind: 'success' });
  };
  const publish = async () => {
    if (!e || !window.confirm(`Publish “${e.asset.name}” for everyone? It replaces the live version of this asset.`)) return;
    setBusy(true);
    const data = e.serialize();
    await saveDraft(data, e.snapshot());
    const err = await publishAsset(data);
    e.dirty = false;
    setBusy(false);
    toast(err ? { text: err, kind: 'error' } : { text: `${data.name} is now official.`, kind: 'success' });
  };
  const close = () => {
    if (e?.dirty) keepDraft(e.serialize(), e.snapshot());
    onClose();
  };

  const commands: Command[] = useMemo(() => {
    if (!e) return [];
    const set = (p: Parameters<StudioEngine['set']>[0]) => () => e.set(p);
    return [
      { label: 'Mode: Simple', run: () => e.setMode('simple') },
      { label: 'Mode: Editor', run: () => e.setMode('editor') },
      { label: 'Mode: Paint', run: () => e.setMode('paint') },
      { label: 'Move', keys: 'V', run: set({ gizmo: 'translate' }) },
      { label: 'Rotate', keys: 'R', run: set({ gizmo: 'rotate' }) },
      { label: 'Scale', keys: 'S', run: set({ gizmo: 'scale' }) },
      { label: 'Select vertices', keys: '1', run: set({ element: 'vertex' }) },
      { label: 'Select edges', keys: '2', run: set({ element: 'edge' }) },
      { label: 'Select faces', keys: '3', run: set({ element: 'face' }) },
      { label: 'Select whole object', keys: '4', run: set({ element: 'object' }) },
      { label: 'Extrude faces', keys: 'E', run: () => e.meshOp('extrude') },
      { label: 'Inset faces', keys: 'I', run: () => e.meshOp('inset') },
      { label: 'Bevel edges', keys: 'B', run: () => e.meshOp('bevel') },
      { label: 'Subdivide', run: () => e.meshOp('subdivide') },
      { label: 'Subdivide smooth', run: () => e.meshOp('smooth') },
      { label: 'Loop cut', keys: 'K', run: () => e.meshOp('loopcut') },
      { label: 'Merge vertices', keys: 'M', run: () => e.meshOp('merge') },
      { label: 'Mirror mesh across X', run: () => e.meshOp('mirror') },
      { label: 'Flip faces', run: () => e.meshOp('flip') },
      { label: 'New face from vertices', run: () => e.meshOp('face') },
      { label: 'Select all', keys: 'A', run: () => (e.node()?.t === 'vox' ? e.voxOp('all') : e.meshOp('all')) },
      { label: 'Convert to mesh', run: () => e.toMesh() },
      { label: 'Duplicate', keys: 'Ctrl+D', run: () => e.duplicate() },
      { label: 'Delete', keys: 'Del', run: () => e.remove() },
      { label: 'Focus selection', keys: 'F', run: () => e.focus() },
      { label: 'View: perspective', keys: '0', run: () => e.view('persp') },
      { label: 'View: front', keys: '7', run: () => e.view('front') },
      { label: 'View: side', keys: '8', run: () => e.view('right') },
      { label: 'View: top', keys: '9', run: () => e.view('top') },
      { label: 'Toggle orthographic', keys: '5', run: () => e.set({ ortho: !e.settings.ortho }) },
      { label: 'Toggle grid and outlines', keys: 'H', run: () => e.set({ helpers: !e.settings.helpers }) },
      { label: 'Toggle snapping', run: () => e.set({ snap: !e.settings.snap }) },
      { label: 'Toggle symmetry', keys: 'X', run: () => e.set({ symmetry: !e.settings.symmetry }) },
      { label: 'Undo', keys: 'Ctrl+Z', run: () => e.undo() },
      { label: 'Redo', keys: 'Ctrl+Y', run: () => e.redo() },
      { label: 'Save draft', keys: 'Ctrl+S', run: () => void save() },
      ...PRIM_SHAPES.map((sh) => ({ label: `Add ${SHAPE_LABEL[sh].toLowerCase()}`, run: () => e.addNode(sh) })),
      { label: 'Add voxel object', run: () => e.addNode('vox') },
      { label: 'Add mesh', run: () => e.addNode('mesh') },
      { label: 'Add group', run: () => e.addNode('group') },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e]);

  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const en = eng.current;
      if (!en || help) return;
      const mod = ev.ctrlKey || ev.metaKey;
      if (search !== null) {
        if (ev.code === 'Escape') setSearch(null);
        return;
      }
      if (mod && ev.code === 'KeyK') {
        ev.preventDefault();
        return setSearch('');
      }
      if (typing(ev)) return;
      const cur = en.node();
      const tool = toolForKey(ev);
      if (mod && ev.code === 'KeyS') {
        ev.preventDefault();
        void save();
      } else if (mod && ev.code === 'KeyZ') {
        ev.preventDefault();
        if (ev.shiftKey) en.redo();
        else en.undo();
      } else if (mod && ev.code === 'KeyY') {
        ev.preventDefault();
        en.redo();
      } else if (mod && ev.code === 'KeyD') {
        ev.preventDefault();
        en.duplicate();
      } else if (tool) en.set({ gizmo: tool });
      else if (ev.code === 'Tab') {
        ev.preventDefault();
        en.setMode(en.mode === 'simple' ? 'editor' : en.mode === 'editor' ? 'paint' : 'simple');
      } else if (ev.code === 'F3' || ev.code === 'Space') {
        ev.preventDefault();
        setSearch('');
      } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(ev.code) && en.mode === 'editor') en.set({ element: (['vertex', 'edge', 'face', 'object'] as Element[])[Number(ev.code.slice(5)) - 1] });
      else if (ev.code === 'KeyE') en.meshOp('extrude');
      else if (ev.code === 'KeyI') en.meshOp('inset');
      else if (ev.code === 'KeyB') en.meshOp('bevel');
      else if (ev.code === 'KeyK') en.meshOp('loopcut');
      else if (ev.code === 'KeyM') en.meshOp('merge');
      else if (ev.code === 'KeyA') {
        if (cur?.t === 'vox') en.voxOp('all');
        else en.meshOp('all');
      }
      else if (ev.code === 'KeyX') en.set({ symmetry: !en.settings.symmetry });
      else if (ev.code === 'KeyH') en.set({ helpers: !en.settings.helpers });
      else if (ev.code === 'KeyF') en.focus();
      else if (ev.code === 'Digit5') en.set({ ortho: !en.settings.ortho });
      else if (ev.code === 'Digit0') en.view('persp');
      else if (ev.code === 'Digit7') en.view('front');
      else if (ev.code === 'Digit8') en.view('right');
      else if (ev.code === 'Digit9') en.view('top');
      else if (ev.code === 'BracketLeft') en.set(en.mode === 'paint' && cur?.t === 'mesh' ? { brushSize: Math.max(0.5, en.settings.brushSize - 0.5) } : { voxRadius: Math.max(0, en.settings.voxRadius - 1) });
      else if (ev.code === 'BracketRight') en.set(en.mode === 'paint' && cur?.t === 'mesh' ? { brushSize: Math.min(40, en.settings.brushSize + 0.5) } : { voxRadius: Math.min(8, en.settings.voxRadius + 1) });
      else if (ev.code === 'Escape') {
        if (menu) setMenu(null);
        else if (en.verts.size || en.edges.size || en.faces.size) en.meshOp('none');
        else if (en.voxSel.size) en.voxOp('clearSel');
        else en.select(null);
      } else if (ev.code === 'Delete' || ev.code === 'Backspace') {
        if (cur?.t === 'vox' && en.voxSel.size) en.voxOp('delete');
        else if (cur?.t === 'mesh' && en.mode === 'editor' && en.settings.element !== 'object') en.meshOp('delete');
        else en.remove();
      } else if (ev.code.startsWith('Arrow') && cur?.t === 'vox' && en.voxSel.size) {
        ev.preventDefault();
        const d = ev.code === 'ArrowLeft' ? [-1, 0, 0] : ev.code === 'ArrowRight' ? [1, 0, 0] : ev.code === 'ArrowUp' ? (ev.altKey ? [0, 1, 0] : [0, 0, -1]) : ev.altKey ? [0, -1, 0] : [0, 0, 1];
        en.voxMove(d[0], d[1], d[2], ev.shiftKey);
      } else if (ev.key === '?' || ev.code === 'F1') {
        ev.preventDefault();
        setHelp(true);
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  if (!e || !a || !s) return <div className="me st" role="dialog" aria-label="Studio"><div className="me__view st__view" ref={host} /></div>;

  const mats = a.materials;
  const cur = mats[s.material];
  const stats = assetStats(a);
  const patch = (p: Record<string, unknown>) => e.patchNode(p);
  const vec = (k: 'p' | 'r' | 's', i: number, v: number) => n && patch({ [k]: n[k].map((x, j) => (j === i ? v : x)) });
  const editorVox = mode === 'editor' && n?.t === 'vox';
  const editorMesh = mode === 'editor' && n?.t === 'mesh';
  const paintMesh = mode === 'paint' && n?.t === 'mesh';
  const hint =
    mode === 'simple' ? 'Simple: add shapes on the left, click one to select it, drag the arrows to move it. V move · R rotate · S resize.'
    : editorVox ? 'Voxels: drag to use the tool on the left. Right-drag turns the view. Shift with Box removes. [ and ] change the brush. X mirrors.'
    : editorMesh ? '1 vertices · 2 edges · 3 faces · 4 object. Click to select (Shift adds), drag the gizmo to move. E extrude · I inset · B bevel · K loop cut.'
    : mode === 'editor' ? 'Select a voxel object or a mesh to edit it. Shapes can be turned into a mesh with Convert to mesh.'
    : paintMesh ? 'Paint: drag on the model. Right-drag turns the view. Pick a layer and a channel on the right. [ and ] change the brush.'
    : n?.t === 'vox' ? 'Paint: drag to recolour voxels with the chosen material.'
    : 'Paint works on meshes and voxel objects. Select one (or convert a shape to a mesh).';

  const rail: ReactNode =
    editorVox ? (
      ([['add', 'Add voxels'], ['remove', 'Remove voxels'], ['paint', 'Paint voxels'], ['box', 'Box: drag out a block (Shift removes)'], ['fill', 'Fill a connected area'], ['smooth', 'Smooth'], ['flatten', 'Flatten: cut down to this level'], ['select', 'Select connected (Ctrl-drag: box select)']] as [VoxTool, string][]).map(([t, label]) => (
        <Tool key={t} id={t} label={label} on={s.voxTool === t} onClick={() => e.set({ voxTool: t })} />
      ))
    ) : mode === 'paint' ? (
      ([['brush', 'Brush', 'brush'], ['erase', 'Eraser', 'erase'], ['fill', 'Fill a face (Shift: the whole layer)', 'fill'], ['face', 'Assign the material to faces', 'facepaint'], ['decal', 'Stamp a decal', 'decal']] as [PaintTool, string, string][]).map(([t, label, g]) => (
        <Tool key={t} id={g} label={label} on={s.paintTool === t} onClick={() => e.set({ paintTool: t })} />
      ))
    ) : (
      <>
        {(['translate', 'rotate', 'scale'] as Gizmo[]).map((g) => (
          <Tool key={g} id={g} label={g === 'translate' ? 'Move' : g === 'rotate' ? 'Rotate' : 'Scale'} k={g === 'translate' ? 'V' : g === 'rotate' ? 'R' : 'S'} on={s.gizmo === g} onClick={() => e.set({ gizmo: g })} />
        ))}
        {mode === 'editor' && (
          <>
            <i className="st__gap" />
            {(['vertex', 'edge', 'face', 'object'] as Element[]).map((el, i) => (
              <Tool key={el} id={el} label={`Select ${el === 'object' ? 'the whole object' : el === 'vertex' ? 'vertices' : `${el}s`}`} k={String(i + 1)} on={s.element === el} onClick={() => e.set({ element: el })} />
            ))}
          </>
        )}
      </>
    );

  const matPick = (
    <div className="st__swatches">
      {mats.map((m, i) => (
        <button key={i} className="st__swatch" data-on={i === s.material} title={m.name} aria-label={m.name} style={{ background: hex(m.color) }} onClick={() => e.set({ material: i })} />
      ))}
      <button className="st__swatch st__swatch--add" aria-label="New material" title="New material" onClick={() => e.addMaterial()}>
        <Icon.plus size={12} />
      </button>
    </div>
  );
  const setMat = (p: Partial<AssetMaterial>) => e.setMaterial(s.material, p);
  const library = publishedAssets('material');
  const runCommands = commands.filter((c) => c.label.toLowerCase().includes((search ?? '').toLowerCase())).slice(0, 12);
  const context: Command[] = n
    ? [
        ...(editorMesh && s.element !== 'object' ? commands.filter((c) => ['Extrude faces', 'Inset faces', 'Bevel edges', 'Loop cut', 'Merge vertices', 'Flip faces'].includes(c.label)) : []),
        ...commands.filter((c) => ['Duplicate', 'Focus selection', 'Convert to mesh', 'Delete'].includes(c.label) && (c.label !== 'Convert to mesh' || n.t === 'prim' || n.t === 'vox')),
      ]
    : commands.filter((c) => c.label.startsWith('Add '));

  return (
    <div className="me st" role="dialog" aria-label="Studio">
      <header className="me__bar st__bar">
        <button className="btn btn--ghost btn--sm" onClick={close}>
          <Icon.back size={16} /> Studio
        </button>
        <input className="input st__name" value={a.name} maxLength={28} aria-label="Asset name" onChange={(ev) => e.patchAsset({ name: ev.target.value })} />
        <div className="st__modes" role="tablist" aria-label="Mode">
          {(['simple', 'editor', 'paint'] as StudioMode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} data-on={mode === m} onClick={() => e.setMode(m)}>
              {m === 'simple' ? 'Simple' : m === 'editor' ? 'Editor' : 'Paint'}
            </button>
          ))}
        </div>
        <span className="me__tools" role="toolbar" aria-label="View and history">
          <button className="btn btn--sm" disabled={!e.canUndo} onClick={() => e.undo()} title="Undo (Ctrl+Z)">Undo</button>
          <button className="btn btn--sm" disabled={!e.canRedo} onClick={() => e.redo()} title="Redo (Ctrl+Y)">Redo</button>
          <select className="input st__select" aria-label="View" value="" onChange={(ev) => ev.target.value && e.view(ev.target.value as 'front')}>
            <option value="">View…</option>
            <option value="persp">Perspective (0)</option>
            <option value="front">Front (7)</option>
            <option value="back">Back</option>
            <option value="right">Side (8)</option>
            <option value="left">Other side</option>
            <option value="top">Top (9)</option>
          </select>
          <button className="btn btn--sm" data-on={s.ortho} aria-pressed={s.ortho} onClick={() => e.set({ ortho: !s.ortho })} title="Orthographic view (5)">Ortho</button>
          <button className="btn btn--sm" data-on={s.snap} aria-pressed={s.snap} onClick={() => e.set({ snap: !s.snap })} title="Snap to a grid">Snap</button>
          <button className="btn btn--sm" data-on={!s.local} aria-pressed={!s.local} onClick={() => e.set({ local: !s.local })} title="Gizmo follows the world instead of the object">Global</button>
          <button className="btn btn--sm" data-on={s.symmetry} aria-pressed={s.symmetry} onClick={() => e.set({ symmetry: !s.symmetry })} title="Mirror voxel edits left to right (X)">Symmetry</button>
          <button className="btn btn--sm" data-on={!s.helpers} aria-pressed={!s.helpers} onClick={() => e.set({ helpers: !s.helpers })} title="Hide the grid and outlines to see the model as it will look (H)">Preview</button>
          <button className="btn btn--sm" onClick={() => setSearch('')} title="Find a tool (Ctrl+K)"><Icon.search size={14} /> Tools</button>
          <button className="btn btn--sm" onClick={() => setHelp(true)} title="How the Studio works (?)">Help</button>
          <button className="btn btn--sm st__only-narrow" onClick={() => setPanels((p) => ({ ...p, left: !p.left }))}>Scene</button>
          <button className="btn btn--sm st__only-narrow" onClick={() => setPanels((p) => ({ ...p, right: !p.right }))}>Properties</button>
        </span>
        <button className="btn btn--sm" disabled={busy} onClick={() => void save()} title="Save as a draft (Ctrl+S)">{busy ? 'Saving…' : `Save draft${e.dirty ? ' •' : ''}`}</button>
        {isOwner() && (
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => void publish()}>Publish</button>
        )}
      </header>

      <div className="st__body" data-left={panels.left} data-right={panels.right}>
        <nav className="st__rail" aria-label="Tools">{rail}</nav>

        <aside className="me__side st__left">
          {mode === 'simple' && (
            <Sec title="Add">
              <div className="me__add">
                {PRIM_SHAPES.map((sh) => (
                  <button key={sh} className="btn btn--sm" onClick={() => e.addNode(sh)}>{SHAPE_LABEL[sh]}</button>
                ))}
                <button className="btn btn--sm" onClick={() => e.addNode('group')}>Group</button>
              </div>
            </Sec>
          )}
          {mode === 'editor' && (
            <Sec title="Add">
              <div className="me__add">
                <button className="btn btn--sm" onClick={() => e.addNode('vox')}>Voxel object</button>
                <button className="btn btn--sm" onClick={() => e.addNode('mesh')}>Mesh</button>
              </div>
            </Sec>
          )}
          <div className="me__head">Scene ({a.nodes.length})</div>
          <div className="me__list st__outline">
            {a.nodes.length === 0 && <p className="muted small" style={{ padding: 8 }}>Empty. Add a shape in Simple mode, or a voxel object or mesh in Editor mode.</p>}
            {a.nodes.map((x) => (
              <div key={x.id} className="st__row" data-on={x.id === e.sel} data-child={!!x.parent} data-hidden={!!x.hidden}>
                <button className="st__rowname" onClick={() => e.select(x.id)}>
                  <span>{x.name}</span>
                  <em>{NODE_KIND[x.t]}</em>
                </button>
                <button className="st__mini" aria-label={x.hidden ? 'Show' : 'Hide'} title={x.hidden ? 'Show' : 'Hide'} onClick={() => e.patchNode({ hidden: !x.hidden }, x.id)}>{x.hidden ? '○' : '●'}</button>
                <button className="st__mini" aria-label={x.locked ? 'Unlock' : 'Lock'} title={x.locked ? 'Unlock' : 'Lock'} data-on={!!x.locked} onClick={() => e.patchNode({ locked: !x.locked }, x.id)}>{x.locked ? '🔒' : '·'}</button>
                <button className="st__mini" aria-label="Move up" title="Move up" onClick={() => e.reorder(x.id, -1)}>↑</button>
                <button className="st__mini" aria-label="Move down" title="Move down" onClick={() => e.reorder(x.id, 1)}>↓</button>
              </div>
            ))}
          </div>
          <div className="me__add">
            <button className="btn btn--sm" disabled={!n} onClick={() => e.duplicate()}>Duplicate</button>
            <button className="btn btn--sm btn--danger" disabled={!n} onClick={() => e.remove()}>Delete</button>
          </div>

          <div className="me__head">Materials</div>
          <div className="st__sec">
            {matPick}
            {cur && (
              <>
                <label className="me-field">
                  <span>Name</span>
                  <input className="input" value={cur.name} maxLength={24} onChange={(ev) => setMat({ name: ev.target.value })} />
                </label>
                <div className="me__grid">
                  <label className="me-field">
                    <span>Colour</span>
                    <input type="color" className="st__color" value={hex(cur.color)} onChange={(ev) => setMat({ color: parseInt(ev.target.value.slice(1), 16) })} />
                  </label>
                  <label className="me-field">
                    <span>Surface</span>
                    <select className="input" value={cur.surface} onChange={(ev) => setMat({ surface: ev.target.value as SurfaceId })}>
                      {SURFACES_IDS.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </label>
                </div>
                <Slider label="Roughness" value={cur.rough} min={0} max={1} step={0.02} onChange={(v) => setMat({ rough: v })} />
                <Slider label="Metallic" value={cur.metal} min={0} max={1} step={0.02} onChange={(v) => setMat({ metal: v })} />
                <Slider label="Glow" value={cur.emissive} min={0} max={4} step={0.1} onChange={(v) => setMat({ emissive: v })} />
                <Slider label="Opacity" value={cur.opacity} min={0.05} max={1} step={0.05} onChange={(v) => setMat({ opacity: v })} />
                <label className="me-field">
                  <span>In the game this is</span>
                  <select className="input" value={cur.role} onChange={(ev) => setMat({ role: ev.target.value as MaterialRole })}>
                    {MATERIAL_ROLES.map((r) => (
                      <option key={r} value={r}>{r === 'none' ? 'just this material' : r === 'team' ? 'the team’s paint colour' : r === 'finish' ? 'the weapon finish / car paint' : r === 'accent' ? 'the car’s accent colour' : r === 'glass' ? 'glass' : 'a light'}</option>
                    ))}
                  </select>
                </label>
                {library.length > 0 && (
                  <label className="me-field">
                    <span>Use a published material</span>
                    <select className="input" value="" onChange={(ev) => {
                      const [id, i] = ev.target.value.split(':');
                      const m = library.find((x) => x.id === id)?.materials[Number(i)];
                      if (m) setMat({ ...m });
                    }}>
                      <option value="">Choose…</option>
                      {library.flatMap((lib) => lib.materials.map((m, i) => <option key={`${lib.id}:${i}`} value={`${lib.id}:${i}`}>{lib.name} · {m.name}</option>))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>
        </aside>

        <div
          className="me__view st__view"
          ref={host}
          onContextMenu={(ev) => {
            ev.preventDefault();
            setMenu({ x: ev.clientX, y: ev.clientY });
          }}
          onPointerDown={() => menu && setMenu(null)}
        />

        <aside className="me__side st__right">
          {!n && (
            <>
              <Sec title="Asset">
                <label className="me-field">
                  <span>Notes</span>
                  <textarea className="input" rows={2} maxLength={120} value={a.note} onChange={(ev) => e.patchAsset({ note: ev.target.value })} />
                </label>
                <p className="muted small" style={{ margin: 0 }}>
                  {a.kind} · {stats.nodes} parts · {stats.voxels} voxels · {stats.faces} faces
                </p>
              </Sec>
              {a.kind === 'weapon' && (
                <Sec title="Muzzle (where shots leave)">
                  <div className="me__grid me__grid--3">
                    {[0, 1, 2].map((i) => (
                      <Num key={i} label={['X', 'Y up', 'Z forward'][i]} value={a.points.muzzle?.[i] ?? 0} onChange={(v) => {
                        const m = [...(a.points.muzzle ?? [0, 0.12, -0.45])] as [number, number, number];
                        m[i] = v;
                        e.patchAsset({ points: { ...a.points, muzzle: m } });
                      }} />
                    ))}
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>Build with the grip at the centre of the grid and the barrel pointing along the blue axis, away from you in Front view.</p>
                </Sec>
              )}
              {a.kind === 'accessory' && (
                <Sec title="Fits on the car">
                  <select className="input" value={String(a.meta.slot ?? 'roof')} onChange={(ev) => e.patchAsset({ meta: { ...a.meta, slot: ev.target.value } })}>
                    <option value="roof">Roof</option>
                    <option value="hood">Bonnet</option>
                    <option value="spoiler">Boot (spoiler)</option>
                  </select>
                  <p className="muted small" style={{ margin: 0 }}>Build it sitting on the grid; the grid’s centre is where it meets the car.</p>
                </Sec>
              )}
            </>
          )}
          {n && (
            <>
              <Sec title={`${NODE_KIND[n.t]}`}>
                <label className="me-field">
                  <span>Name</span>
                  <input className="input" value={n.name} maxLength={28} onChange={(ev) => patch({ name: ev.target.value })} />
                </label>
                <label className="me-field">
                  <span>Inside group</span>
                  <select className="input" value={n.parent ?? ''} onChange={(ev) => patch({ parent: ev.target.value || null })}>
                    <option value="">None</option>
                    {a.nodes.filter((x) => x.t === 'group' && x.id !== n.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              </Sec>
              <Sec title="Transform">
                {(['p', 'r', 's'] as const).map((k) => (
                  <div key={k} className="me__grid me__grid--3">
                    {[0, 1, 2].map((i) => (
                      <Num key={i} label={`${k === 'p' ? 'Pos' : k === 'r' ? 'Rot' : 'Size'} ${'XYZ'[i]}`} step={k === 'r' ? 5 : 0.01} value={n[k][i]} onChange={(v) => vec(k, i, v)} />
                    ))}
                  </div>
                ))}
              </Sec>
              {n.t === 'prim' && (
                <Sec title="Shape">
                  <div className="me__grid">
                    <label className="me-field">
                      <span>Shape</span>
                      <select className="input" value={n.shape} onChange={(ev) => patch({ shape: ev.target.value })}>
                        {PRIM_SHAPES.map((sh) => <option key={sh} value={sh}>{SHAPE_LABEL[sh]}</option>)}
                      </select>
                    </label>
                    <label className="me-field">
                      <span>Material</span>
                      <select className="input" value={n.mat} onChange={(ev) => patch({ mat: Number(ev.target.value) })}>
                        {mats.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
                      </select>
                    </label>
                  </div>
                  {n.shape === 'box' && <Slider label="Chamfered edges" value={n.bevel ?? 0} min={0} max={0.45} step={0.01} onChange={(v) => patch({ bevel: v || undefined })} />}
                  <button className="btn btn--sm" onClick={() => e.toMesh()}>Convert to mesh</button>
                </Sec>
              )}
              {n.t === 'vox' && (
                <>
                  <Sec title="Voxel grid">
                    <div className="me__grid me__grid--3">
                      {[0, 1, 2].map((i) => (
                        <Num key={i} label={`${'XYZ'[i]} cells`} step={1} value={n.n[i]} onChange={(v) => e.voxResize(i === 0 ? v : n.n[0], i === 1 ? v : n.n[1], i === 2 ? v : n.n[2])} />
                      ))}
                    </div>
                    <div className="me__add" style={{ padding: 0 }}>
                      <button className="btn btn--sm" onClick={() => e.voxResize(n.n[0] * 2, n.n[1] * 2, n.n[2] * 2)}>Finer ×2</button>
                      <button className="btn btn--sm" onClick={() => e.voxResize(n.n[0] / 2, n.n[1] / 2, n.n[2] / 2)}>Coarser ÷2</button>
                      <button className="btn btn--sm" onClick={() => e.toMesh()}>Convert to mesh</button>
                    </div>
                    <p className="muted small" style={{ margin: 0 }}>{e.grid()?.count() ?? 0} voxels, each {Math.round(n.size * 1000) / 10} cm. Up to 96 cells a side.</p>
                  </Sec>
                  {(mode === 'editor' || mode === 'paint') && (
                    <Sec title="Brush">
                      <Slider label="Brush radius (voxels)" value={s.voxRadius} min={0} max={8} step={1} onChange={(v) => e.set({ voxRadius: v })} />
                      <span className="muted small">Material</span>
                      {matPick}
                    </Sec>
                  )}
                  {mode === 'editor' && (
                    <Sec title={`Selection (${e.voxSel.size})`}>
                      <div className="me__add" style={{ padding: 0 }}>
                        <button className="btn btn--sm" onClick={() => e.voxOp('all')}>All</button>
                        <button className="btn btn--sm" onClick={() => e.voxOp('byMaterial')}>By material</button>
                        <button className="btn btn--sm" disabled={!e.voxSel.size} onClick={() => e.voxOp('clearSel')}>None</button>
                        <button className="btn btn--sm" disabled={!e.voxSel.size} onClick={() => e.voxOp('fillSel')}>Paint</button>
                        <button className="btn btn--sm btn--danger" disabled={!e.voxSel.size} onClick={() => e.voxOp('delete')}>Delete</button>
                      </div>
                      <div className="st__nudge">
                        {([['−X', -1, 0, 0], ['+X', 1, 0, 0], ['−Y', 0, -1, 0], ['+Y', 0, 1, 0], ['−Z', 0, 0, -1], ['+Z', 0, 0, 1]] as [string, number, number, number][]).map(([l, x, y, z]) => (
                          <button key={l} className="btn btn--sm" disabled={!e.voxSel.size} title="Move the selection one voxel (Shift-click: leave a copy)" onClick={(ev) => e.voxMove(x, y, z, ev.shiftKey)}>{l}</button>
                        ))}
                      </div>
                      <div className="me__add" style={{ padding: 0 }}>
                        <button className="btn btn--sm" onClick={() => e.voxOp('mirror')}>Mirror left → right</button>
                        <button className="btn btn--sm" onClick={() => e.voxOp('smoothAll')}>Smooth all</button>
                      </div>
                    </Sec>
                  )}
                </>
              )}
              {n.t === 'mesh' && (
                <>
                  <Sec title="Mesh">
                    <Slider label="Smooth edges under (°)" value={n.smooth} min={0} max={180} step={5} onChange={(v) => patch({ smooth: v })} />
                    <p className="muted small" style={{ margin: 0 }}>{n.verts.length / 3} vertices · {n.faces.length} faces</p>
                  </Sec>
                  {mode === 'editor' && (
                    <Sec title={`Edit (${e.verts.size} v · ${e.edges.size} e · ${e.faces.size} f)`}>
                      <Slider label="Amount (cm at this scale)" value={s.amount * 100} min={0.5} max={30} step={0.5} onChange={(v) => e.set({ amount: v / 100 })} />
                      <div className="st__ops">
                        {([['extrude', 'Extrude', 'E'], ['inset', 'Inset', 'I'], ['bevel', 'Bevel', 'B'], ['loopcut', 'Loop cut', 'K'], ['subdivide', 'Subdivide', ''], ['smooth', 'Subdivide smooth', ''], ['merge', 'Merge', 'M'], ['face', 'New face', ''], ['flip', 'Flip', ''], ['mirror', 'Mirror X', ''], ['material', 'Assign material', ''], ['delete', 'Delete', 'Del'], ['all', 'Select all', 'A'], ['none', 'Select none', 'Esc']] as [Parameters<StudioEngine['meshOp']>[0], string, string][]).map(([op, label, k]) => (
                          <button key={op} className="btn btn--sm" title={k ? `${label} (${k})` : label} onClick={() => e.meshOp(op)}>{label}</button>
                        ))}
                      </div>
                      <span className="muted small">Material for new and assigned faces</span>
                      {matPick}
                    </Sec>
                  )}
                </>
              )}
              {paintMesh && paint && (
                <>
                  <Sec title="Brush">
                    <div className="me__grid">
                      <label className="me-field">
                        <span>Paints</span>
                        <select className="input" value={s.channel} onChange={(ev) => e.set({ channel: ev.target.value as PaintChannel })}>
                          <option value="color">Colour</option>
                          <option value="rough">Roughness</option>
                          <option value="metal">Metallic</option>
                          <option value="glow">Glow</option>
                        </select>
                      </label>
                      {s.channel === 'color' ? (
                        <label className="me-field">
                          <span>Colour</span>
                          <input type="color" className="st__color" value={s.color} onChange={(ev) => e.set({ color: ev.target.value })} />
                        </label>
                      ) : (
                        <Slider label={s.channel === 'rough' ? 'Rough' : s.channel === 'metal' ? 'Metal' : 'Bright'} value={s.value} min={0} max={1} step={0.05} onChange={(v) => e.set({ value: v })} />
                      )}
                    </div>
                    <Slider label="Size (cm)" value={s.brushSize} min={0.5} max={40} step={0.5} onChange={(v) => e.set({ brushSize: v })} />
                    <Slider label="Strength" value={s.brushOpacity} min={0.05} max={1} step={0.05} onChange={(v) => e.set({ brushOpacity: v })} />
                    <Slider label="Hardness" value={s.brushHardness} min={0} max={1} step={0.05} onChange={(v) => e.set({ brushHardness: v })} />
                    {s.paintTool === 'decal' && (
                      <>
                        <div className="me__grid">
                          <label className="me-field">
                            <span>Decal</span>
                            <select className="input" value={s.decal} onChange={(ev) => e.set({ decal: ev.target.value as DecalId })}>
                              {DECALS.map((d) => <option key={d}>{d}</option>)}
                            </select>
                          </label>
                          <label className="me-field">
                            <span>Text</span>
                            <input className="input" value={s.decalText} maxLength={2} onChange={(ev) => e.set({ decalText: ev.target.value })} />
                          </label>
                        </div>
                        <Slider label="Decal size (cm)" value={s.decalSize} min={1} max={80} step={1} onChange={(v) => e.set({ decalSize: v })} />
                        <Slider label="Decal turn (°)" value={s.decalAngle} min={-180} max={180} step={5} onChange={(v) => e.set({ decalAngle: v })} />
                      </>
                    )}
                    {s.paintTool === 'face' && (
                      <>
                        <span className="muted small">Material to assign</span>
                        {matPick}
                      </>
                    )}
                  </Sec>
                  <Sec title="Layers">
                    <div className="st__layers">
                      {paint.layers.map((l, i) => (
                        <div key={i} className="st__row" data-on={i === s.layer && s.channel === 'color'} data-hidden={l.hidden}>
                          <button className="st__rowname" onClick={() => e.set({ layer: i, channel: 'color' })}>
                            <span>{l.name}</span>
                          </button>
                          <button className="st__mini" aria-label={l.hidden ? 'Show layer' : 'Hide layer'} onClick={() => e.layerOp('hide', i)}>{l.hidden ? '○' : '●'}</button>
                          <button className="st__mini" aria-label="Layer up" onClick={() => e.layerOp('up', i)}>↑</button>
                          <button className="st__mini" aria-label="Layer down" onClick={() => e.layerOp('down', i)}>↓</button>
                        </div>
                      )).reverse()}
                    </div>
                    {paint.layers[s.layer] && (
                      <>
                        <label className="me-field">
                          <span>Layer name</span>
                          <input className="input" value={paint.layers[s.layer].name} maxLength={20} onChange={(ev) => e.layerOp('rename', s.layer, ev.target.value)} />
                        </label>
                        <Slider label="Layer opacity" value={paint.layers[s.layer].opacity} min={0} max={1} step={0.05} onChange={(v) => e.layerOp('opacity', s.layer, v)} />
                      </>
                    )}
                    <div className="me__add" style={{ padding: 0 }}>
                      <button className="btn btn--sm" onClick={() => e.layerOp('add')}>New layer</button>
                      <button className="btn btn--sm" onClick={() => e.layerOp('clear')}>Clear layer</button>
                      <button className="btn btn--sm btn--danger" disabled={paint.layers.length < 2} onClick={() => e.layerOp('delete')}>Delete layer</button>
                    </div>
                  </Sec>
                  <Sec title={`Texture (${paint.size} px)`}>
                    <div className="st__tex" ref={preview} />
                    <p className="muted small" style={{ margin: 0 }}>Each face has its own patch, laid out automatically at one scale. Changing the mesh’s shape afterwards moves the patches, so paint last.</p>
                  </Sec>
                </>
              )}
            </>
          )}
        </aside>
      </div>
      <div className="me__hint" role="status">{hint}</div>

      {menu && (
        <div className="st__menu" style={{ left: Math.min(menu.x, innerWidth - 200), top: Math.min(menu.y, innerHeight - 40 - context.length * 30) }} role="menu">
          {context.map((c) => (
            <button key={c.label} role="menuitem" onClick={() => (setMenu(null), c.run())}>
              <span>{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </button>
          ))}
        </div>
      )}
      {search !== null && (
        <div className="st__search" role="dialog" aria-label="Find a tool" onPointerDown={(ev) => ev.target === ev.currentTarget && setSearch(null)}>
          <div className="st__searchbox">
            <input
              className="input"
              autoFocus
              placeholder="Type a tool or action…"
              value={search}
              onChange={(ev) => setSearch(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && runCommands[0]) {
                  setSearch(null);
                  runCommands[0].run();
                }
              }}
            />
            {runCommands.map((c) => (
              <button key={c.label} onClick={() => (setSearch(null), c.run())}>
                <span>{c.label}</span>
                {c.keys && <kbd>{c.keys}</kbd>}
              </button>
            ))}
          </div>
        </div>
      )}
      {help && (
        <Help
          title="How the Studio works"
          steps={[
            <><b>Simple</b> places ready-made shapes: add one, drag its arrows, resize and turn it. Good for blocking a model out.</>,
            <><b>Editor</b> shapes real geometry. A <b>voxel object</b> is sculpted cube by cube with the tools on the left; a <b>mesh</b> is edited by its vertices, edges and faces (extrude, inset, bevel, loop cut). Any shape or sculpt can be turned into a mesh.</>,
            <><b>Paint</b> colours the model: recolour voxels, give faces materials, or paint textures in layers with a brush, fills and decals. Roughness, metal and glow can be painted too.</>,
            <>Materials are on the left. One marked as <b>team paint</b> or <b>finish</b> takes the player’s colours in the game.</>,
            <><b>Save draft</b> keeps your work private. <b>Publish</b> makes it official for everyone, and keeps the version it replaced as a draft in case you need it back.</>,
          ]}
          keys={[
            ['Tab', 'Next mode'], ['V / R / S', 'Move / rotate / scale'], ['1 2 3 4', 'Vertices / edges / faces / object'], ['E / I / B / K', 'Extrude / inset / bevel / loop cut'],
            ['M', 'Merge vertices'], ['A', 'Select all'], ['X', 'Symmetry'], ['[ ]', 'Brush size'], ['F', 'Focus'], ['0 7 8 9', 'Perspective / front / side / top'],
            ['5', 'Orthographic'], ['H', 'Hide grid'], ['Ctrl+K', 'Find a tool'], ['Ctrl+Z / Y', 'Undo / redo'], ['Ctrl+D', 'Duplicate'], ['Ctrl+S', 'Save draft'], ['Right-drag', 'Turn the view while a drawing tool is on'],
          ]}
          onClose={() => setHelp(false)}
        />
      )}
    </div>
  );
}
