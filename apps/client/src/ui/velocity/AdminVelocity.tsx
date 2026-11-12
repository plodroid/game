import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_HANDLING, HANDLING_LIMITS, sanitizeHandling, type Handling } from '@chromashift/shared';
import { act } from '../../auth/account';
import { useUi } from '../../state/ui';
import { tuning } from '../../velocity/tuning';
import { Icon } from '../icons';
import { Button, Setting, Slider } from '../kit';

const LABEL: Record<keyof Handling, string> = {
  mass: 'Mass (kg)', engine: 'Engine force (N)', topSpeed: 'Top speed (m/s)', reverseSpeed: 'Reverse speed (m/s)', brake: 'Brakes (N)',
  steerLow: 'Steering lock, slow', steerHigh: 'Steering lock, fast', steerRate: 'Steering speed', grip: 'Tyre grip', driftGrip: 'Rear grip while drifting',
  driftYaw: 'Drift swing', spring: 'Spring stiffness', damper: 'Damping', rest: 'Suspension length', air: 'Air control', downforce: 'Downforce', drag: 'Drag', boost: 'Boost force',
};

/**
 * Owner only: VELOCITY's handling for everyone (config/velocity). Every car shares it, so this is
 * balance, never a paid advantage; weapons and other shooter settings are untouched.
 */
export function AdminVelocity({ onClose }: { onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const [h, setH] = useState<Handling>(() => sanitizeHandling({ ...DEFAULT_HANDLING, ...tuning.handling }));
  const save = async () => {
    const clean = sanitizeHandling(h);
    const ok = await act(async (m) => {
      await m.saveVelocityConfig(JSON.stringify(clean));
      return true;
    });
    if (ok) {
      tuning.handling = clean;
      toast({ text: 'Handling saved. New races use it everywhere.', kind: 'success' });
    }
  };
  return createPortal(
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal admin-weapons" role="dialog" aria-label="Vehicle tuning">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            Vehicle tuning (owner)
          </h2>
          <button className="note__x" aria-label="Close" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>
        <p className="muted small">Every car shares these numbers. Cosmetics never change them.</p>
        {(Object.keys(LABEL) as (keyof Handling)[]).map((k) => {
          const [lo, hi] = HANDLING_LIMITS[k];
          const step = hi - lo > 100 ? Math.round((hi - lo) / 200) : (hi - lo) / 200;
          return (
            <Setting key={k} name={LABEL[k]} hint={`Default ${DEFAULT_HANDLING[k]}`}>
              <Slider label={LABEL[k]} value={h[k]} min={lo} max={hi} step={step} format={(v) => (v >= 100 ? Math.round(v).toString() : v.toFixed(2))} onChange={(v) => setH({ ...h, [k]: v })} />
            </Setting>
          );
        })}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <Button variant="primary" onClick={() => void save()}>
            Save for everyone
          </Button>
          <Button onClick={() => setH({ ...DEFAULT_HANDLING })}>Back to defaults</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
