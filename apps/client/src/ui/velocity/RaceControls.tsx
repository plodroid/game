import { useEffect, useState } from 'react';
import { PAD_BUTTON, useButtonStyle, useDevice } from '../../game/devices';
import { DEFAULT_RACE_BINDINGS, DEFAULT_RACE_PAD, RACE_ACTIONS, useSettings, type RaceAction } from '../../settings/settings';
import { Button, KeyCapture, keyLabel, Segmented, Setting, Slider } from '../kit';

/*
 * VELOCITY's controls, in the same Controls tab as CHROMASHIFT's (behind the car icon). They're a
 * separate set: changing a driving key never changes a shooter key, and the other way round.
 */

export const RACE_LABEL: Record<RaceAction, string> = {
  accelerate: 'Accelerate',
  brake: 'Brake (reverse when stopped)',
  reverse: 'Reverse',
  steerLeft: 'Steer left',
  steerRight: 'Steer right',
  handbrake: 'Handbrake / drift',
  boost: 'Boost',
  item: 'Use item',
  camera: 'Change camera',
  lookBack: 'Look behind (hold)',
  reset: 'Reset car',
  horn: 'Horn',
  pause: 'Pause',
};

/** Which other racing action already uses a key (shown so a clash is clear before it's moved). */
function clashFor(code: string, action: RaceAction, bindings: Record<RaceAction, string[]>) {
  return RACE_ACTIONS.find((a) => a !== action && bindings[a]?.includes(code));
}

function RaceKeys() {
  const c = useSettings((s) => s.controls);
  const bindRace = useSettings((s) => s.bindRace);
  const set = useSettings((s) => s.set);
  const [moved, setMoved] = useState<string | null>(null);
  const bind = (a: RaceAction, slot: number, code: string) => {
    const other = clashFor(code, a, c.raceBindings);
    bindRace(a, slot, code);
    setMoved(other ? `${keyLabel(code)} moved from “${RACE_LABEL[other]}” to “${RACE_LABEL[a]}”.` : null);
  };
  return (
    <>
      <p className="muted small" style={{ margin: '0 0 6px' }}>
        Click a slot, then press a key. Esc cancels. A key used by another driving action moves to the new one.
      </p>
      {moved && (
        <p className="small" role="status" style={{ margin: '0 0 8px', color: 'var(--warn)' }}>
          {moved}
        </p>
      )}
      {RACE_ACTIONS.map((a) => (
        <Setting key={a} name={RACE_LABEL[a]}>
          <KeyCapture code={c.raceBindings[a]?.[0]} onSet={(code) => bind(a, 0, code)} />
          <KeyCapture code={c.raceBindings[a]?.[1]} onSet={(code) => bind(a, 1, code)} />
          <Button
            variant="ghost"
            onClick={() => set('controls', { raceBindings: { ...c.raceBindings, [a]: DEFAULT_RACE_BINDINGS[a] } })}
            title="Reset this action"
          >
            ↺
          </Button>
        </Setting>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <Button onClick={() => set('controls', { raceBindings: DEFAULT_RACE_BINDINGS })}>Reset all driving keys</Button>
      </div>
    </>
  );
}

function RacePadSlot({ action }: { action: RaceAction }) {
  const value = useSettings((s) => s.controls.racePadBindings[action]);
  const bindRacePad = useSettings((s) => s.bindRacePad);
  const style = useButtonStyle();
  const connected = useDevice((d) => d.pad !== null);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    let raf = 0;
    const t0 = performance.now();
    const base = new Set<number>();
    const tick = () => {
      const p = [...(navigator.getGamepads?.() ?? [])].find((x) => x?.connected);
      if (p)
        p.buttons.forEach((b, i) => {
          if (performance.now() - t0 < 250) return void (b.pressed && base.add(i));
          if (b.pressed && !base.has(i)) {
            bindRacePad(action, i);
            setListening(false);
          }
          if (!b.pressed) base.delete(i);
        });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const esc = (e: KeyboardEvent) => e.code === 'Escape' && setListening(false);
    addEventListener('keydown', esc);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', esc);
    };
  }, [listening, action, bindRacePad]);
  return (
    <>
      <select className="select select--pad" value={value ?? ''} onChange={(e) => bindRacePad(action, e.target.value === '' ? null : Number(e.target.value))} aria-label={`Controller button for ${RACE_LABEL[action]}`}>
        <option value="">Not set</option>
        {PAD_BUTTON[style].slice(0, 16).map((n, i) => (
          <option key={n} value={i}>
            {n}
          </option>
        ))}
      </select>
      {connected && (
        <button type="button" className="key" data-listening={listening} onClick={() => setListening(!listening)}>
          {listening ? 'Press a button…' : 'Press'}
        </button>
      )}
    </>
  );
}

function RacePad() {
  const set = useSettings((s) => s.set);
  const pad = useDevice();
  const style = useButtonStyle();
  return (
    <>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        {pad.pad ? `Detected: ${pad.pad === 'playstation' ? 'PlayStation-style' : 'Xbox'} controller. ` : 'No controller yet: connect one and press a button. '}
        The left stick steers (analog). Triggers are analog too: the harder you press, the more throttle or brake.
      </p>
      <h3 className="panel__title">Driving buttons ({style === 'playstation' ? 'PlayStation' : 'Xbox'})</h3>
      {RACE_ACTIONS.map((a) => (
        <Setting key={a} name={RACE_LABEL[a]}>
          <RacePadSlot action={a} />
        </Setting>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <Button onClick={() => set('controls', { racePadBindings: DEFAULT_RACE_PAD })}>Reset driving buttons</Button>
      </div>
    </>
  );
}

/** The car icon's half of the Controls tab. */
export function RaceControls({ kind }: { kind: 'keyboard' | 'pad' | 'touch' }) {
  const c = useSettings((s) => s.controls);
  const set = useSettings((s) => s.set);
  return (
    <>
      <Setting name="Camera" hint="Change it in a race with the camera button.">
        <Segmented value={c.raceCamera} onChange={(raceCamera) => set('controls', { raceCamera })} label="Camera" options={[{ value: 'near', label: 'Chase' }, { value: 'far', label: 'Far chase' }, { value: 'hood', label: 'Bonnet' }]} />
      </Setting>
      <Setting name="Steering sensitivity">
        <Slider label="Steering sensitivity" value={c.raceSteer} min={0.5} max={1} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(raceSteer) => set('controls', { raceSteer })} />
      </Setting>
      {kind === 'keyboard' && <RaceKeys />}
      {kind === 'pad' && <RacePad />}
      {kind === 'touch' && (
        <p className="muted small">
          On a touch screen, drag the pad on the left to steer; GAS, BRAKE, DRIFT, BOOST, ITEM, CAM and RESET are on the right. Size and see-through are shared with the CHROMASHIFT touch controls, under the gun icon.
        </p>
      )}
    </>
  );
}
