import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE, type ReactElement } from 'react';
import { damageLevel, ITEM_INFO, PART_INDEX, PART_LABEL, PARTS, RACE_IDENTITIES, type Part } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { PAD_BUTTON, raceTouch } from '../../game/input';
import { useButtonStyle, useDevice } from '../../game/devices';
import { leaveMatch } from '../../game/session';
import { useSettings, type RaceAction } from '../../settings/settings';
import { useUi } from '../../state/ui';
import { raceControl, useRaceHud, useRaceMap, type RaceHudState } from '../../velocity/state';
import { Button, keyLabel } from '../kit';

const fmt = (s: number) => {
  if (!s || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const LEVEL_COLOR = ['rgba(255,255,255,0.16)', '#f2e27a', '#ffbe55', '#ff7a3a', '#ff3b3b'];

/** The button or key that does a racing action on the device in use. */
export function useRacePrompt() {
  const style = useButtonStyle();
  const last = useDevice((d) => d.last);
  const c = useSettings((s) => s.controls);
  return (a: RaceAction) => {
    if (last === 'pad') {
      const i = c.racePadBindings[a];
      return i === null ? '' : (PAD_BUTTON[style][i] ?? '');
    }
    if (last === 'touch') return '';
    const k = c.raceBindings[a]?.[0];
    return k ? keyLabel(k) : '';
  };
}

/** Car seen from above, each part coloured by how damaged it is. */
export function DamageSchematic({ damage, hit, small }: { damage: number[]; hit: { part: number; at: number } | null; small?: boolean }) {
  const lv = (p: Part) => damageLevel(damage[PART_INDEX[p]] ?? 0);
  const fill = (p: Part) => LEVEL_COLOR[lv(p)];
  const flash = (p: Part) => (hit && hit.part === PART_INDEX[p] ? 'dmg-flash' : '');
  const total = damage.length ? damage.reduce((a, b) => a + b, 0) / damage.length : 0;
  const part = (p: Part, el: ReactElement) => (
    <g key={p} className={flash(p)} style={{ fill: fill(p) }}>
      <title>{`${PART_LABEL[p]}: ${Math.round((1 - (damage[PART_INDEX[p]] ?? 0)) * 100)}%`}</title>
      {el}
    </g>
  );
  const chip = (p: Part, label: string) => (
    <span className="dmg-chip" style={{ ['--c' as string]: LEVEL_COLOR[lv(p)] }}>
      {label}
    </span>
  );
  return (
    <div className={`dmg ${small ? 'dmg--small' : ''}`} aria-label={`Car condition ${Math.round((1 - total) * 100)}%`}>
      <svg viewBox="0 0 120 210" className="dmg-car">
        {part('frontBumper', <rect x="24" y="4" width="72" height="12" rx="6" />)}
        {part('headlightL', <rect x="14" y="14" width="22" height="9" rx="3" />)}
        {part('headlightR', <rect x="84" y="14" width="22" height="9" rx="3" />)}
        {part('hood', <path d="M28 24 h64 l4 40 h-72 z" />)}
        {part('frontBody', <path d="M14 26 l10 0 -4 40 -10 0 z M106 26 l-10 0 4 40 10 0 z" />)}
        {part('engine', <rect x="48" y="34" width="24" height="18" rx="3" />)}
        {part('leftBody', <rect x="8" y="70" width="14" height="74" rx="5" />)}
        {part('rightBody', <rect x="98" y="70" width="14" height="74" rx="5" />)}
        {part('steering', <circle cx="60" cy="88" r="9" />)}
        {part('suspension', <rect x="34" y="112" width="52" height="10" rx="5" />)}
        {part('rearBody', <path d="M24 150 h72 l-4 34 h-64 z" />)}
        {part('taillightL', <rect x="14" y="186" width="22" height="9" rx="3" />)}
        {part('taillightR', <rect x="84" y="186" width="22" height="9" rx="3" />)}
        {part('rearBumper', <rect x="24" y="194" width="72" height="12" rx="6" />)}
        {part('wheelFL', <rect x="0" y="38" width="10" height="26" rx="4" />)}
        {part('wheelFR', <rect x="110" y="38" width="10" height="26" rx="4" />)}
        {part('wheelRL', <rect x="0" y="150" width="10" height="26" rx="4" />)}
        {part('wheelRR', <rect x="110" y="150" width="10" height="26" rx="4" />)}
        <path d="M30 70 h60 l-4 34 h-52 z" className="dmg-glass" />
      </svg>
      {!small && (
        <div className="dmg-side">
          <strong className="num">{Math.round((1 - total) * 100)}%</strong>
          {chip('engine', 'Engine')}
          {chip('steering', 'Steering')}
          {chip('suspension', 'Suspension')}
        </div>
      )}
    </div>
  );
}

function Speedo({ h }: { h: RaceHudState }) {
  const kmh = Math.round(h.speed);
  const frac = Math.min(1, h.speed / 200);
  const r = 46, c = Math.PI * r * 1.5;
  return (
    <div className="speedo">
      <svg viewBox="0 0 120 120" className="speedo-dial">
        <circle cx="60" cy="60" r={r} className="speedo-track" strokeDasharray={`${c} ${Math.PI * r * 2}`} transform="rotate(135 60 60)" />
        <circle cx="60" cy="60" r={r} className="speedo-fill" strokeDasharray={`${c * frac} ${Math.PI * r * 2}`} transform="rotate(135 60 60)" />
        <circle cx="60" cy="60" r={r - 9} className="speedo-rpm" strokeDasharray={`${Math.PI * (r - 9) * 1.5 * h.rpm} ${Math.PI * (r - 9) * 2}`} transform="rotate(135 60 60)" style={{ stroke: h.rpm > 0.9 ? 'var(--danger)' : undefined }} />
      </svg>
      <div className="speedo-read">
        <span className="speedo-kmh num">{kmh}</span>
        <span className="speedo-unit">km/h</span>
        <span className="speedo-gear num">{h.gear === 0 ? 'R' : h.gear}</span>
      </div>
      <div className="boost" aria-label={`Boost ${Math.round(h.boostMeter * 100)}%`}>
        <span style={{ width: `${h.boostMeter * 100}%` }} data-on={h.boosting} />
      </div>
    </div>
  );
}

function Minimap({ h }: { h: RaceHudState }) {
  const { path, viewBox } = useRaceMap();
  return (
    <svg className="race-map" viewBox={viewBox} aria-hidden>
      <path d={path} className="race-map__road" />
      {h.dots.map((d) => (
        <circle key={d.id} cx={d.x} cy={d.z} r={d.me ? 4.2 : 3} fill={hex(RACE_IDENTITIES[d.identity % 6].color)} stroke={d.me ? '#fff' : 'rgba(0,0,0,0.5)'} strokeWidth={d.me ? 1.6 : 0.8} />
      ))}
    </svg>
  );
}

/** On-screen driving controls for touch screens. */
function RaceTouch() {
  const scale = useSettings((s) => s.controls.touchScale);
  const opacity = useSettings((s) => s.controls.touchOpacity);
  const haptics = useSettings((s) => s.controls.touchHaptics);
  const wheel = useRef<HTMLDivElement>(null);
  const steerId = useRef<number | null>(null);
  const [steer, setSteer] = useState(0);
  useEffect(() => {
    raceTouch.active = true;
    return () => {
      raceTouch.active = false;
      raceTouch.steer = raceTouch.throttle = raceTouch.brake = 0;
      raceTouch.held.clear();
    };
  }, []);
  const buzz = () => haptics && navigator.vibrate?.(8);
  const steerAt = (e: RPE) => {
    const r = wheel.current!.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.15));
    raceTouch.steer = -v;
    setSteer(v);
  };
  const hold = (a: RaceAction, pedal?: 'throttle' | 'brake') => ({
    onPointerDown: (e: RPE) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      raceTouch.held.add(a);
      raceTouch.pressed.add(a);
      if (pedal) raceTouch[pedal] = 1;
      buzz();
    },
    onPointerUp: () => {
      raceTouch.held.delete(a);
      if (pedal) raceTouch[pedal] = 0;
    },
    onPointerCancel: () => {
      raceTouch.held.delete(a);
      if (pedal) raceTouch[pedal] = 0;
    },
  });
  return (
    <div className="race-touch" style={{ ['--ts' as string]: scale, opacity } as CSSProperties}>
      <div
        ref={wheel}
        className="race-touch__steer"
        onPointerDown={(e) => {
          steerId.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          steerAt(e);
        }}
        onPointerMove={(e) => steerId.current === e.pointerId && steerAt(e)}
        onPointerUp={() => {
          steerId.current = null;
          raceTouch.steer = 0;
          setSteer(0);
        }}
        aria-label="Steering: drag left or right"
      >
        <span className="race-touch__knob" style={{ transform: `translateX(${steer * 70}%)` }} />
      </div>
      <div className="race-touch__right">
        <button className="race-touch__b race-touch__b--small" {...hold('camera')}>CAM</button>
        <button className="race-touch__b race-touch__b--small" {...hold('reset')}>RESET</button>
        <button className="race-touch__b race-touch__b--item" {...hold('item')}>ITEM</button>
        <button className="race-touch__b race-touch__b--boost" {...hold('boost')}>BOOST</button>
        <button className="race-touch__b race-touch__b--drift" {...hold('handbrake')}>DRIFT</button>
        <button className="race-touch__b race-touch__b--brake" {...hold('brake', 'brake')}>BRAKE</button>
        <button className="race-touch__b race-touch__b--gas" {...hold('accelerate', 'throttle')}>GAS</button>
      </div>
    </div>
  );
}

function PauseMenu({ offline }: { offline: boolean }) {
  const setPaused = useUi((s) => s.setPaused);
  const go = useUi((s) => s.go);
  return (
    <div className="pause" role="dialog" aria-label="Paused">
      <div className="pause__card">
        <h2 className="pause__title">Paused</h2>
        <Button variant="primary" block onClick={() => setPaused(false)}>
          Resume
        </Button>
        {offline && (
          <Button block onClick={() => raceControl.replay?.()}>
            Restart race
          </Button>
        )}
        <Button block onClick={() => go('settings')}>
          Settings
        </Button>
        <Button
          variant="danger"
          block
          onClick={() => {
            raceControl.leave?.();
            leaveMatch();
            go('play');
          }}
        >
          Leave race
        </Button>
      </div>
    </div>
  );
}

export function RaceHud({ store = useRaceHud, side }: { store?: typeof useRaceHud; side?: 'left' | 'right' }) {
  const h = store();
  const paused = useUi((s) => s.paused);
  const prompt = useRacePrompt();
  const coarse = useSettings((s) => s.controls.touchControls);
  const last = useDevice((d) => d.last);
  const a11y = useSettings((s) => s.accessibility);
  const showTouch = !side && (coarse === 'on' || (coarse === 'auto' && last === 'touch') || (coarse === 'auto' && last !== 'pad' && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches));
  if (!h.active) return null;
  const ident = RACE_IDENTITIES[h.identity % 6];
  const offline = !h.online;
  const style: CSSProperties = side ? { position: 'absolute', inset: side === 'left' ? '0 50% 0 0' : '0 0 0 50%' } : {};
  return (
    <div className={`hud race-hud ${a11y.highContrast ? 'race-hud--contrast' : ''}`} style={style}>
      <div className="race-tl">
        <div className="race-pos" style={{ ['--id' as string]: hex(ident.color) }}>
          <span className="race-pos__n num">{h.position}</span>
          <span className="race-pos__of">/{h.field}</span>
        </div>
        <div className="race-laps">
          <span className="race-label">Lap</span>
          <span className="num">
            {h.lap}/{h.laps}
          </span>
        </div>
        <div className="race-times">
          <span>
            <span className="race-label">Time</span> <span className="num">{fmt(h.time)}</span>
          </span>
          <span>
            <span className="race-label">Lap</span> <span className="num">{fmt(h.lapTime)}</span>
          </span>
          <span>
            <span className="race-label">Best</span> <span className="num">{fmt(h.best)}</span>
          </span>
          <span className="race-cp" aria-label={`Checkpoint ${h.cp} of ${h.cps - 1}`}>
            {Array.from({ length: Math.max(1, h.cps - 1) }, (_, i) => (
              <i key={i} data-on={i < h.cp} />
            ))}
          </span>
        </div>
      </div>
      <div className="race-tr">
        <Minimap h={h} />
        <ol className="race-board">
          {h.board.map((r) => (
            <li key={r.id} data-me={r.me}>
              <span className="num">{r.position}</span>
              <i style={{ background: hex(RACE_IDENTITIES[r.identity % 6].color) }} />
              <span className="race-board__name">{r.name}</span>
              <span className="race-board__gap num">{r.finished ? '🏁' : r.gap}</span>
            </li>
          ))}
        </ol>
      </div>
      {h.phase === 'countdown' && h.count > 0 && (
        <div className="race-count" key={h.count}>
          {h.count}
        </div>
      )}
      {h.phase === 'grid' && <div className="race-banner">Get ready</div>}
      {h.notice && (
        <div key={h.notice.id} className={`race-notice race-notice--${h.notice.tone}`}>
          {h.notice.text}
        </div>
      )}
      {h.wrong && !h.finished && <div className="race-wrong">WRONG WAY</div>}
      {h.lookBack && <div className="race-lookback">Looking back</div>}
      {h.finished && (
        <div className="race-finished">
          <span>Finished</span>
          <strong>{ordinal(h.finishPos)}</strong>
          {offline && !side && (
            <Button size="lg" variant="primary" onClick={() => raceControl.finishNow?.()}>
              See results
            </Button>
          )}
        </div>
      )}
      <div className="race-bottom">
        {h.arcade && (
          <div className="race-item" data-full={!!h.item}>
            <span className="race-label">Item</span>
            <strong>{h.item ? ITEM_INFO[h.item].name : 'Empty'}</strong>
            {h.item && prompt('item') && <kbd>{prompt('item')}</kbd>}
          </div>
        )}
        <DamageSchematic damage={h.damage.length ? h.damage : new Array(PARTS.length).fill(0)} hit={h.hit} />
        <div className="race-right">
          {h.driftTier > 0 && <div className={`race-drift race-drift--${h.driftTier}`}>{['', 'Drift', 'Drift ×2', 'Drift ×3'][h.driftTier]}</div>}
          <Speedo h={h} />
        </div>
      </div>
      {h.phase !== 'ended' && !paused && h.phase !== 'racing' && (
        <div className="race-help">
          {[
            ['accelerate', 'Go'],
            ['brake', 'Brake'],
            ['handbrake', 'Drift'],
            ['boost', 'Boost'],
          ].map(([a, label]) => prompt(a as RaceAction) && (
            <span key={a}>
              <kbd>{prompt(a as RaceAction)}</kbd> {label}
            </span>
          ))}
        </div>
      )}
      {h.online && h.ping !== null && <div className="race-ping num">{h.ping} ms</div>}
      {showTouch && !paused && <RaceTouch />}
      {paused && !side && <PauseMenu offline={offline} />}
    </div>
  );
}

export function useRaceSounds() {
  useEffect(() => () => audio.stopMusic(), []);
}
