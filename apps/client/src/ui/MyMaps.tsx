import { useState } from 'react';
import { createPortal } from 'react-dom';
import { blankMap, newMapId, type CustomMap } from '@chromashift/shared';
import { startOffline } from '../game/session';
import { deleteMap, parseSharedMap, saveMap, useMaps } from '../state/maps';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { MapEditor } from './MapEditor';

/** Your own maps: make a new one, edit, play, share as text, or delete. Kept on this device. */
export function MyMaps({ onClose }: { onClose: () => void }) {
  const maps = useMaps((s) => s.maps);
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<CustomMap | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');

  const play = (m: CustomMap) => {
    setEditing(null);
    onClose();
    void startOffline({ map: m.id, mode: 'turf', duration: 180, difficulty: 'normal', allies: 3, rivals: 4 });
  };
  const share = async (m: CustomMap) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(m));
      toast({ text: 'Map copied. Send it to a friend to paste under Import.', kind: 'success' });
    } catch {
      toast({ text: 'Couldn’t copy. Your browser blocked the clipboard.', kind: 'error' });
    }
  };
  const doImport = () => {
    const m = parseSharedMap(text.trim());
    if (!m) return toast({ text: 'That isn’t a map. Paste what “Copy” gave you.', kind: 'warn' });
    saveMap({ ...m, id: newMapId() });
    setText('');
    setImporting(false);
    toast({ text: `${m.name} added.`, kind: 'success' });
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal admin-weapons" role="dialog" aria-label="My maps">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            My maps
          </h2>
          <button className="note__x" aria-label="Close" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>
        <div className="row admin-tools__row">
          <button className="btn btn--primary" onClick={() => setEditing(blankMap())}>
            <Icon.plus size={14} /> New map
          </button>
          <button className="btn" onClick={() => setImporting(!importing)}>
            Import
          </button>
        </div>
        {importing && (
          <div style={{ margin: '8px 0' }}>
            <textarea className="input" rows={3} placeholder="Paste a map here" value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} />
            <button className="btn btn--primary btn--sm" style={{ marginTop: 6 }} onClick={doImport}>
              Add map
            </button>
          </div>
        )}
        <div className="list">
          {maps.length === 0 && <p className="muted small">No maps yet. Make one: add blocks, ramps, spawns and jump pads in 3D, then play it against bots.</p>}
          {maps.map((m) => (
            <div key={m.id} className="admin-row">
              <span style={{ minWidth: 0 }}>
                <strong>{m.name}</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  {m.blocks.length} blocks · {m.description}
                </span>
              </span>
              <span className="row" style={{ gap: 6, flex: 'none' }}>
                <button className="btn btn--sm btn--primary" onClick={() => play(m)}>
                  Play
                </button>
                <button className="btn btn--sm" onClick={() => setEditing(m)}>
                  Edit
                </button>
                <button className="btn btn--sm" onClick={() => void share(m)}>
                  Copy
                </button>
                <button className="btn btn--sm btn--danger" onClick={() => window.confirm(`Delete “${m.name}”? This can’t be undone.`) && deleteMap(m.id)}>
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Maps live on this device. When a friend joins a match on your map, it is sent to them automatically.
        </p>
      </div>
      {editing &&
        createPortal(
          <MapEditor map={editing} onSave={saveMap} onPlay={play} onClose={() => setEditing(null)} />,
          document.body,
        )}
    </div>
  );
}
