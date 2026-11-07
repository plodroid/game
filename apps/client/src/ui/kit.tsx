import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { audio } from '../audio/audio';
import { useUi } from '../state/ui';
import { Icon } from './icons';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'md' | 'lg';
  block?: boolean;
  icon?: boolean;
};

export function Button({ variant = 'default', size = 'md', block, icon, className = '', onClick, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && `btn--${variant}`, size === 'lg' && 'btn--lg', block && 'btn--block', icon && 'btn--icon', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => {
        audio.unlock();
        audio.play(variant === 'primary' ? 'confirm' : 'click');
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

export function Header({ title, sub, end, onBack }: { title: string; sub?: string; end?: ReactNode; onBack?: () => void }) {
  const back = useUi((s) => s.back);
  return (
    <header className="header">
      <Button icon variant="ghost" aria-label="Back" onClick={() => (audio.play('back'), onBack ? onBack() : back())}>
        <Icon.back />
      </Button>
      <div>
        <h1 className="header__title">{title}</h1>
        {sub && <p className="header__sub">{sub}</p>}
      </div>
      {end && <div className="header__end">{end}</div>}
    </header>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="seg__opt"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          onClick={() => {
            audio.play('click');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      className="toggle"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        audio.play('click');
        onChange(!checked);
      }}
    />
  );
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => `${Math.round(v * 100)}%`,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label: string;
}) {
  return (
    <div className="range">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="range__val num">{format(value)}</span>
    </div>
  );
}

/**
 * Match length: one rail from 1 to 10 minutes with "no limit" at the far end. Drag the thumb (it
 * ticks as it crosses each stop), tap anywhere on the rail, or use the arrow keys.
 */
export function LengthDial({ value, options, onChange, disabled }: { value: number; options: number[]; onChange: (v: number) => void; disabled?: boolean }) {
  const last = options.length - 1;
  const at = Math.max(0, options.indexOf(value));
  const [drag, setDrag] = useState<number | null>(null);
  const pos = drag ?? at;
  const pick = (k: number) => {
    const v = options[Math.max(0, Math.min(last, Math.round(k)))];
    if (v !== value) {
      audio.play('hover');
      onChange(v);
    }
  };
  const from = (e: PointerEvent<HTMLDivElement>) => {
    const lane = e.currentTarget.firstElementChild!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - lane.left) / lane.width)) * last;
  };
  const label = (v: number) => (v ? `${v / 60} min` : 'No limit');
  return (
    <div className="dial" data-dragging={drag != null} data-inf={value === 0} aria-disabled={disabled}>
      <div
        className="dial__rail"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Match length"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={at}
        aria-valuetext={label(value)}
        style={{ '--p': pos / last } as CSSProperties}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const k = from(e);
          setDrag(k);
          pick(k);
        }}
        onPointerMove={(e) => {
          if (drag == null) return;
          const k = from(e);
          setDrag(k);
          pick(k);
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (disabled) return;
          const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, Home: -99, End: 99 }[e.key];
          if (d == null) return;
          e.preventDefault();
          pick(at + d);
        }}
      >
        <div className="dial__lane">
          <span className="dial__fill" />
          {options.map((v, i) => (
            <span key={v} className="dial__stop" data-on={i <= at} style={{ left: `${(i / last) * 100}%` }}>
              {v === 0 && '∞'}
            </span>
          ))}
          <span className="dial__thumb">
            <b className="num" key={value}>{value ? value / 60 : '∞'}</b>
          </span>
        </div>
      </div>
      <span className="dial__val num">{label(value)}</span>
    </div>
  );
}

export function Setting({ name, hint, children }: { name: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div>
        <div className="setting__name">{name}</div>
        {hint && <div className="setting__hint">{hint}</div>}
      </div>
      <div className="setting__ctl">{children}</div>
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

/** Captures the next key or mouse button for rebinding. Escape cancels. */
export function KeyCapture({ code, onSet }: { code?: string; onSet: (code: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') onSet(e.code);
      setListening(false);
    };
    const mouse = (e: MouseEvent) => {
      e.preventDefault();
      onSet(`Mouse${e.button}`);
      setListening(false);
    };
    addEventListener('keydown', key, { capture: true });
    const t = setTimeout(() => addEventListener('mousedown', mouse, { capture: true }), 0);
    return () => {
      clearTimeout(t);
      removeEventListener('keydown', key, { capture: true });
      removeEventListener('mousedown', mouse, { capture: true });
    };
  }, [listening, onSet]);
  return (
    <button type="button" className="key" data-listening={listening} onClick={() => setListening(true)}>
      {listening ? 'Press…' : keyLabel(code)}
    </button>
  );
}

export function keyLabel(code?: string) {
  if (!code) return '—';
  const m: Record<string, string> = {
    Mouse0: 'Left click',
    Mouse1: 'Middle click',
    Mouse2: 'Right click',
    Mouse3: 'Mouse 4',
    Mouse4: 'Mouse 5',
    Space: 'Space',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    AltLeft: 'L Alt',
    Escape: 'Esc',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return m[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');
}

export function useCopy(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false);
  return [
    done,
    (text) => {
      void navigator.clipboard?.writeText(text).then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      });
    },
  ];
}
