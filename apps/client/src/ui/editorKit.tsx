import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

/** Small pieces both 3D editors share: undo / redo, and a plain-language help panel. */

/**
 * Remembers earlier versions of `value` so the editor can step back. Changes made in quick
 * succession (a drag) count as one step. Call `apply` with the older value to restore it.
 */
export function useUndo<T>(value: T, apply: (v: T) => void) {
  const key = JSON.stringify(value);
  const past = useRef<{ k: string; v: T }[]>([]);
  const future = useRef<{ k: string; v: T }[]>([]);
  const last = useRef({ k: key, v: value });
  const at = useRef(0);
  const restoring = useRef(false);
  const [, bump] = useState(0);

  useEffect(() => {
    if (key === last.current.k) return;
    if (restoring.current) restoring.current = false;
    else {
      if (Date.now() - at.current > 600) {
        past.current.push(last.current);
        if (past.current.length > 100) past.current.shift();
      }
      at.current = Date.now();
      future.current = [];
    }
    last.current = { k: key, v: value };
    bump((n) => n + 1);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (from: typeof past, to: typeof future) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(last.current);
    restoring.current = true;
    at.current = 0;
    apply(prev.v);
  };
  return {
    undo: () => step(past, future),
    redo: () => step(future, past),
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

/** Which tool a shortcut key picks, using Blockbench's keys: V move, S resize, R rotate. */
export function toolForKey(e: KeyboardEvent): 'translate' | 'scale' | 'rotate' | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return e.code === 'KeyV' ? 'translate' : e.code === 'KeyS' ? 'scale' : e.code === 'KeyR' ? 'rotate' : null;
}

/** True when typing in a field, so shortcut keys must not fire. */
export const typing = (e: KeyboardEvent) => ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);

export function Help({ title, steps, keys, onClose }: { title: string; steps: ReactNode[]; keys: [string, string][]; onClose: () => void }) {
  return (
    <div className="me-help" role="dialog" aria-label={title} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="me-help__card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <strong>{title}</strong>
          <button className="note__x" aria-label="Close help" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>
        <ol className="me-help__steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <div className="me__head" style={{ padding: '10px 0 4px' }}>
          Keyboard shortcuts
        </div>
        <dl className="me-help__keys">
          {keys.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          On a phone or tablet: tap an item to select it, drag the coloured arrows to move it, drag empty space to turn the view, pinch to zoom, and use the tool buttons at the top instead of keys.
        </p>
      </div>
    </div>
  );
}
