import { useState } from 'react';
import { createPortal } from 'react-dom';
import { blankMap, newMapId, registerCustomMap, type CustomMap } from '@chromashift/shared';
import { useAccount } from '../auth/account';
import { isOwner } from '../auth/admin';
import { startOffline } from '../game/session';
import { deletePreset, deletePublic, MAX_PRESETS, parseSharedMap, savePreset, savePublic, useMaps } from '../state/maps';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { MapEditor } from './MapEditor';

/**
 * Maps. Everyone can build maps and keep up to three presets; the owner can also publish maps for
 * everyone. Public maps can be played by anyone, and copied into the editor to remix.
 */
export function MyMaps({ onClose }: { onClose: () => void }) {
  const { presets, publics } = useMaps();
  useAccount((a) => a.user?.uid);
  const owner = isOwner();
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<CustomMap | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');

  const play = (m: CustomMap) => {
    registerCustomMap(m);
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
    const r = savePreset({ ...m, id: newMapId() });
    if (typeof r === 'string') return toast({ text: r, kind: 'warn' });
    setText('');
    setImporting(false);
    toast({ text: `${m.name} added to your presets.`, kind: 'success' });
  };
  const remove = async (m: CustomMap, isPublic: boolean) => {
    if (!window.confirm(`${isPublic ? 'Remove the public map' : 'Delete'} “${m.name}”? This can’t be undone.`)) return;
    if (isPublic) {
      const why = await deletePublic(m.id);
      if (why) toast({ text: why, kind: 'error' });
    } else deletePreset(m.id);
  };

  const row = (m: CustomMap, isPublic: boolean) => (
    <div key={`${isPublic}${m.id}`} className="admin-row">
      <span style={{ minWidth: 0 }}>
        <strong>{m.name}</strong>
        <span className="muted small" style={{ display: 'block' }}>
          {m.blocks.length} blocks · {m.description || 'No description'}
        </span>
      </span>
      <span className="row" style={{ gap: 6, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button className="btn btn--sm btn--primary" onClick={() => play(m)}>
          Play
        </button>
        {(!isPublic || owner) && (
          <button className="btn btn--sm" onClick={() => setEditing(m)}>
            Edit
          </button>
        )}
        {isPublic && !owner && (
          <button className="btn btn--sm" title="Open a copy in the editor" onClick={() => setEditing({ ...m, id: newMapId(), name: `${m.name} copy`.slice(0, 28) })}>
            Remix
          </button>
        )}
        <button className="btn btn--sm" onClick={() => void share(m)}>
          Copy
        </button>
        {(!isPublic || owner) && (
          <button className="btn btn--sm btn--danger" onClick={() => void remove(m, isPublic)}>
            {isPublic ? 'Remove' : 'Delete'}
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal admin-weapons" role="dialog" aria-label="Maps">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            Maps
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
              Add as a preset
            </button>
          </div>
        )}

        <h3 className="admin-weapons__h">
          My presets ({presets.length}/{MAX_PRESETS})
        </h3>
        <div className="list">
          {presets.length === 0 && <p className="muted small">None yet. Build a map, then press Save preset to keep it here and play it again any time.</p>}
          {presets.map((m) => row(m, false))}
        </div>

        <h3 className="admin-weapons__h">Public maps</h3>
        <div className="list">
          {publics.length === 0 && <p className="muted small">No public maps yet.</p>}
          {publics.map((m) => row(m, true))}
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Presets follow your account when you’re signed in. When a friend joins a match on a map, it is sent to them automatically.
        </p>
      </div>
      {editing &&
        createPortal(
          <MapEditor
            map={editing}
            presets={{ used: presets.length, max: MAX_PRESETS }}
            onSavePreset={savePreset}
            onPublish={owner ? savePublic : undefined}
            onPlay={play}
            onClose={() => setEditing(null)}
          />,
          document.body,
        )}
    </div>
  );
}
