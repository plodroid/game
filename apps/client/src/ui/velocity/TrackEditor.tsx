import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { createPortal } from 'react-dom';
import { buildPath, registerTrack, sanitizeTrackDef, SURFACES, TRACK_THEMES, validateTrack, type ControlPoint, type RoadSurface, type TrackDef, type TrackTheme } from '@chromashift/shared';
import { isOwner } from '../../auth/admin';
import { useUi } from '../../state/ui';
import { deleteTrackPreset, MAX_TRACK_PRESETS, newTrackId, publishTrack, saveTrackPreset, unpublishTrack, useTracks } from '../../velocity/tracksState';
import { Button, Segmented, Setting, Slider, Toggle } from '../kit';

/*
 * The VELOCITY track editor. Seen from above: drag the points to shape the road, pick a point to
 * set its height, width, banking and surface, and mark tunnels, pickup rows and obstacles. The
 * track is checked as you go (closed loop, room for six, no road running into itself unless one
 * part passes over the other as a bridge), and Test drive takes it straight onto the road.
 */

const THEME_LABEL: Record<TrackTheme, string> = {
  coast: 'Coast', neon: 'Neon dusk', canyon: 'Canyon', city: 'City', docks: 'Docks', garden: 'Gardens', core: 'Core', arcade: 'Arcade', snow: 'Snow', sunset: 'Sunset',
};
const SURF_LABEL: Record<RoadSurface, string> = { asphalt: 'Asphalt', dirt: 'Dirt', grass: 'Grass', sand: 'Sand', ice: 'Ice', snow: 'Snow', metal: 'Metal' };

function template(): TrackDef {
  const pts: ControlPoint[] = [];
  const W = 150, H = 90;
  const corners: [number, number][] = [[-W, -H], [0, -H - 10], [W, -H], [W + 20, 0], [W, H], [0, H + 10], [-W, H], [-W - 20, 0]];
  for (const [x, z] of corners) pts.push({ x, y: 0, z, w: 7.5, bank: 0, surf: 'asphalt' });
  return { id: newTrackId(), name: 'My Track', description: 'A player-made track.', theme: 'coast', laps: 3, width: 7.5, verge: 'grass', shoulder: 3, wall: 1.2, ground: 0, sea: null, points: pts, custom: true };
}

export function TrackEditor({ onClose, onPlay }: { onClose: () => void; onPlay: (id: string) => void }) {
  const toast = useUi((s) => s.toast);
  const presets = useTracks((t) => t.presets);
  const publics = useTracks((t) => t.publics);
  const owner = isOwner();
  const [def, setDef] = useState<TrackDef>(() => presets[0] ?? template());
  const [sel, setSel] = useState(0);
  const [past, setPast] = useState<TrackDef[]>([]);
  const [future, setFuture] = useState<TrackDef[]>([]);
  const [help, setHelp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; start: TrackDef } | null>(null);

  const change = (next: TrackDef, record = true) => {
    if (record) {
      setPast((p) => [...p.slice(-60), def]);
      setFuture([]);
    }
    setDef(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [def, ...f]);
    setDef(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, def]);
    setDef(future[0]);
    setFuture((f) => f.slice(1));
  };
  const pts = def.points!;
  const point = pts[Math.min(sel, pts.length - 1)];
  const setPoint = (patch: Partial<ControlPoint>, record = true) => change({ ...def, points: pts.map((p, i) => (i === sel ? { ...p, ...patch } : p)) }, record);
  const addPoint = () => {
    const a = pts[sel], b = pts[(sel + 1) % pts.length];
    const mid: ControlPoint = { ...a, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: (a.y + b.y) / 2, items: false, obstacles: false };
    const next = [...pts.slice(0, sel + 1), mid, ...pts.slice(sel + 1)];
    change({ ...def, points: next });
    setSel(sel + 1);
  };
  const removePoint = () => {
    if (pts.length <= 4) return toast({ text: 'A track needs at least four points.', kind: 'warn' });
    change({ ...def, points: pts.filter((_, i) => i !== sel) });
    setSel(Math.max(0, sel - 1));
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      } else if (e.code === 'Delete' || e.code === 'Backspace') removePoint();
      else if (e.code === 'KeyN') addPoint();
      else if (e.code === 'Escape') onClose();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // The road as it'll be built, and what's wrong with it.
  const built = useMemo(() => {
    try {
      return buildPath(def);
    } catch {
      return null;
    }
  }, [def]);
  const [problems, setProblems] = useState<ReturnType<typeof validateTrack>>([]);
  useEffect(() => {
    const t = setTimeout(() => setProblems(validateTrack(def)), 180);
    return () => clearTimeout(t);
  }, [def]);

  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 60;
    return { x: minX - pad, z: minZ - pad, w: maxX - minX + pad * 2, h: maxZ - minZ + pad * 2 };
  }, [pts]);
  const road = useMemo(() => {
    if (!built) return '';
    const s: string[] = [];
    for (let i = 0; i < built.n; i += 2) s.push(`${built.px[i].toFixed(1)},${built.pz[i].toFixed(1)}`);
    return `M${s.join('L')}Z`;
  }, [built]);
  const toWorld = (e: RPE) => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, z: p.y };
  };

  const save = () => {
    const why = saveTrackPreset(def);
    toast({ text: why ?? `${def.name} saved.`, kind: why ? 'warn' : 'success' });
  };
  const test = () => {
    const clean = sanitizeTrackDef({ ...def, kind: 'track' });
    if (!clean) return;
    registerTrack(clean);
    onClose();
    onPlay(clean.id);
  };
  const ok = problems.length === 0;

  return createPortal(
    <div className="overlay" style={{ zIndex: 80, alignItems: 'stretch', padding: 0 }} role="dialog" aria-label="Track editor">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(280px, 360px)', width: '100%', height: '100%', background: 'var(--bg)' }} className="track-editor">
        <div style={{ position: 'relative', minHeight: 0 }}>
          <svg
            ref={svg}
            viewBox={`${bounds.x} ${bounds.z} ${bounds.w} ${bounds.h}`}
            style={{ width: '100%', height: '100%', touchAction: 'none', background: 'radial-gradient(circle at 50% 40%, #2a2436, #120f17)' }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const w = toWorld(e);
              const i = drag.current.i;
              setDef({ ...def, points: pts.map((p, k) => (k === i ? { ...p, x: Math.round(w.x), z: Math.round(w.z) } : p)) });
            }}
            onPointerUp={() => {
              if (drag.current) {
                setPast((p) => [...p.slice(-60), drag.current!.start]);
                setFuture([]);
              }
              drag.current = null;
            }}
          >
            <defs>
              <pattern id="te-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" />
              </pattern>
            </defs>
            <rect x={bounds.x} y={bounds.z} width={bounds.w} height={bounds.h} fill="url(#te-grid)" />
            <path d={road} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={(def.points?.[0]?.w ?? 7) * 2 + def.shoulder * 2} strokeLinejoin="round" />
            <path d={road} fill="none" stroke="#3b3d44" strokeWidth={(def.points?.[0]?.w ?? 7) * 2} strokeLinejoin="round" />
            <path d={road} fill="none" stroke="#f2f2ee" strokeWidth={0.8} strokeDasharray="6 6" />
            {built && (
              <line x1={built.px[0] + built.lx[0] * built.w[0]} y1={built.pz[0] + built.lz[0] * built.w[0]} x2={built.px[0] - built.lx[0] * built.w[0]} y2={built.pz[0] - built.lz[0] * built.w[0]} stroke="#ff3f8e" strokeWidth={2.5} />
            )}
            {pts.map((p, i) => (
              <g key={i} onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setSel(i);
                drag.current = { i, start: def };
              }} style={{ cursor: 'grab' }}>
                <circle cx={p.x} cy={p.z} r={i === sel ? 6.5 : 5} fill={i === sel ? '#ff3f8e' : p.tunnel ? '#8b72ff' : p.y > 3 ? '#ffc532' : '#2fd3d0'} stroke="#120f17" strokeWidth={1.4} />
                <text x={p.x} y={p.z - 8} fontSize={7} fill="#c4bacb" textAnchor="middle">
                  {i + 1}
                  {p.y ? ` ↑${Math.round(p.y)}` : ''}
                </text>
              </g>
            ))}
            {problems.map((pr, i) => pr.at && <circle key={i} cx={pr.at.x} cy={pr.at.z} r={9} fill="none" stroke="#ff5a5f" strokeWidth={2.5} />)}
          </svg>
          <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={undo} disabled={!past.length}>Undo</Button>
            <Button onClick={redo} disabled={!future.length}>Redo</Button>
            <Button onClick={addPoint}>Add point</Button>
            <Button onClick={removePoint}>Delete point</Button>
            <Button onClick={() => setHelp(!help)}>Help</Button>
          </div>
          {help && (
            <div className="panel" style={{ position: 'absolute', left: 12, top: 60, maxWidth: 380, fontSize: '0.85rem' }}>
              <p style={{ marginTop: 0 }}>
                <strong>Drag</strong> the dots to shape the road. The pink line is the start. <strong>Add point</strong> (N) puts a new one after the selected point; <strong>Delete</strong> removes it. Ctrl+Z undoes, Ctrl+Y redoes.
              </p>
              <p>Pick a point to set its height, width, banking and surface. Raise one part 7 m above another to make a bridge where they cross.</p>
              <p style={{ marginBottom: 0 }}>Red circles show what needs fixing. Test drive puts you straight on it.</p>
            </div>
          )}
          <svg viewBox={`0 -2 ${Math.max(1, pts.length)} 44`} preserveAspectRatio="none" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, height: 60, width: 'calc(100% - 24px)', background: 'rgba(18,15,23,0.7)', borderRadius: 12 }} aria-label="Height along the track">
            <polyline points={[...pts, pts[0]].map((p, i) => `${i},${40 - p.y}`).join(' ')} fill="none" stroke="#ffc532" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            <line x1={sel} x2={sel} y1={-2} y2={42} stroke="#ff3f8e" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <aside className="panel" style={{ margin: 0, borderRadius: 0, overflow: 'auto' }}>
          <h2 className="panel__title" style={{ marginTop: 0 }}>Track editor</h2>
          <Setting name="Name">
            <input className="input" value={def.name} maxLength={28} onChange={(e) => change({ ...def, name: e.target.value }, false)} />
          </Setting>
          <Setting name="Scenery">
            <select className="input" value={def.theme} onChange={(e) => change({ ...def, theme: e.target.value as TrackTheme })}>
              {TRACK_THEMES.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABEL[t]}
                </option>
              ))}
            </select>
          </Setting>
          <Setting name="Verges">
            <select className="input" value={def.verge} onChange={(e) => change({ ...def, verge: e.target.value as RoadSurface })}>
              {SURFACES.map((s) => (
                <option key={s} value={s}>
                  {SURF_LABEL[s]}
                </option>
              ))}
            </select>
          </Setting>
          <Setting name="Sea around it">
            <Toggle label="Sea" checked={def.sea !== null} onChange={(v) => change({ ...def, sea: v ? -1.2 : null })} />
          </Setting>
          <Setting name="Suggested laps">
            <Segmented value={def.laps} onChange={(laps) => change({ ...def, laps })} label="Laps" options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
          </Setting>
          <h3 className="panel__title">Point {Math.min(sel, pts.length - 1) + 1}</h3>
          <Setting name="Height" hint={`${Math.round(point.y)} m`}>
            <Slider label="Height" value={point.y} min={-10} max={40} step={1} onChange={(y) => setPoint({ y }, false)} />
          </Setting>
          <Setting name="Road width" hint={`${Math.round(point.w * 2)} m`}>
            <Slider label="Width" value={point.w} min={4.5} max={12} step={0.5} onChange={(w) => setPoint({ w }, false)} />
          </Setting>
          <Setting name="Banking" hint={`${Math.round(point.bank)}°`}>
            <Slider label="Banking" value={point.bank} min={-15} max={15} step={1} onChange={(bank) => setPoint({ bank }, false)} />
          </Setting>
          <Setting name="Surface">
            <select className="input" value={point.surf} onChange={(e) => setPoint({ surf: e.target.value as RoadSurface })}>
              {SURFACES.map((s) => (
                <option key={s} value={s}>
                  {SURF_LABEL[s]}
                </option>
              ))}
            </select>
          </Setting>
          <Setting name="Tunnel">
            <Toggle label="Tunnel" checked={!!point.tunnel} onChange={(tunnel) => setPoint({ tunnel })} />
          </Setting>
          <Setting name="Pickup row" hint="Arcade races only.">
            <Toggle label="Pickups" checked={!!point.items} onChange={(items) => setPoint({ items })} />
          </Setting>
          <Setting name="Obstacles" hint="Tyre stacks and crates on the verges.">
            <Toggle label="Obstacles" checked={!!point.obstacles} onChange={(obstacles) => setPoint({ obstacles })} />
          </Setting>
          <div style={{ margin: '12px 0', padding: 10, borderRadius: 12, background: ok ? 'rgba(95,214,138,0.12)' : 'rgba(255,90,95,0.12)' }}>
            {ok ? (
              <span>Ready to race. {built ? `${(built.length / 1000).toFixed(2)} km a lap.` : ''}</span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {problems.map((p, i) => (
                  <li key={i}>{p.text}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Button variant="primary" disabled={!ok} onClick={test}>
              Test drive
            </Button>
            <Button disabled={!ok} onClick={save}>
              Save
            </Button>
            {owner && (
              <Button
                disabled={!ok}
                onClick={async () => {
                  const why = await publishTrack(sanitizeTrackDef({ ...def, kind: 'track' })!);
                  toast({ text: why ?? `${def.name} is public now.`, kind: why ? 'error' : 'success' });
                }}
              >
                Publish
              </Button>
            )}
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify({ ...def, kind: 'track' }));
                  toast({ text: 'Track copied. Send it to a friend to paste under Import.', kind: 'success' });
                } catch {
                  toast({ text: 'Couldn’t copy. Your browser blocked the clipboard.', kind: 'error' });
                }
              }}
            >
              Copy
            </Button>
            <Button onClick={() => setImporting(!importing)}>Import</Button>
            <Button
              onClick={() => {
                change(template());
                setSel(0);
              }}
            >
              New
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
          {importing && (
            <div style={{ marginTop: 10 }}>
              <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a track here" style={{ width: '100%' }} />
              <Button
                onClick={() => {
                  try {
                    const t = sanitizeTrackDef({ ...JSON.parse(text), id: newTrackId(), kind: 'track' });
                    if (!t) throw new Error('bad');
                    change(t);
                    setSel(0);
                    setImporting(false);
                    setText('');
                  } catch {
                    toast({ text: 'That isn’t a track. Paste what Copy gave you.', kind: 'warn' });
                  }
                }}
              >
                Load it
              </Button>
            </div>
          )}
          <h3 className="panel__title" style={{ marginTop: 18 }}>
            My tracks ({presets.length}/{MAX_TRACK_PRESETS})
          </h3>
          {presets.map((t) => (
            <div key={t.id} className="admin-row">
              <span>{t.name}</span>
              <span className="row" style={{ gap: 6 }}>
                <Button size="md" onClick={() => change(t)}>
                  Edit
                </Button>
                <Button
                  size="md"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(`Delete “${t.name}”? This can’t be undone.`)) deleteTrackPreset(t.id);
                  }}
                >
                  Delete
                </Button>
              </span>
            </div>
          ))}
          {owner && publics.length > 0 && (
            <>
              <h3 className="panel__title" style={{ marginTop: 14 }}>
                Published tracks
              </h3>
              {publics.map((t) => (
                <div key={t.id} className="admin-row">
                  <span>{t.name}</span>
                  <Button
                    size="md"
                    variant="danger"
                    onClick={async () => {
                      if (!window.confirm(`Remove the public track “${t.name}”?`)) return;
                      const why = await unpublishTrack(t.id);
                      if (why) toast({ text: why, kind: 'error' });
                    }}
                  >
                    Unpublish
                  </Button>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
