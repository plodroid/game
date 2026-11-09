import { useEffect, useRef, useState } from 'react';
import { kindOf, MODES, publicWeapons, SPECIALS, SPECIAL_IDS, WEAPONS } from '@chromashift/shared';
import { firebaseConfigured } from '../env';
import { padStyle, PAD_BUTTON } from '../game/devices';
import { declineSplit, OPTIONS_BUTTON, startSplit, stopSplit, useSplit, useSplitReady } from '../game/split';
import { p2Name, shufflePlayer2Look, useP2 } from '../state/p2';
import { useSettings } from '../settings/settings';
import { useHud, useHud2 } from '../state/ui';
import { Crosshair } from './hud/Hud';
import { Minimap } from './hud/Minimap';
import { TeamShape } from './icons';
import { Avatar } from './Avatar';
import { Button } from './kit';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** In a corner: two controllers are connected, press Options to share the screen. */
export function SplitPrompt() {
  const ready = useSplitReady();
  const first = useSplit((s) => s.pads[0]);
  const id = useSplit((s) => s.ids[first] ?? '');
  if (!ready) return null;
  const name = PAD_BUTTON[padStyle({ id } as Gamepad)][OPTIONS_BUTTON];
  return (
    <div className="splitprompt" role="status" aria-live="polite">
      <button className="splitprompt__go" onClick={() => startSplit()}>
        <span className="splitprompt__pads" aria-hidden>
          <i />
          <i />
        </span>
        <span>
          <b>Press {name} to play split screen</b>
          <small>Two controllers found</small>
        </span>
      </button>
      <button className="splitprompt__x" aria-label="Dismiss" onClick={declineSplit}>
        ×
      </button>
    </div>
  );
}

/** What each player sees of the match in split screen: the shared score on top, then each half's own readout. */
export function SplitHud() {
  const h = useHud();
  const kind = kindOf(h.mode);
  const pct = kind === 'turf' || kind === 'practice';
  const [a, b] = h.score;
  const scoreText = (v: number) => (pct ? `${v.toFixed(1)}%` : kind === 'zones' ? `${Math.ceil(v)}` : `${v}`);
  const total = Math.max(1e-6, a + b);
  const playing = h.phase === 'playing';
  const wa = pct ? a : ((kind === 'zones' ? b : a) / total) * 100;
  const wb = pct ? b : ((kind === 'zones' ? a : b) / total) * 100;
  return (
    <div className="split">
      <SeatHud store={useHud} side={0} label="P1" />
      <SeatHud store={useHud2} side={1} label={p2Name()} />
      <div className="split__line" />
      <div className="hud-top split__top">
        <div className="score">
          <TeamShape team={0} />
          <span>{scoreText(a)}</span>
        </div>
        <div className={`timer ${h.timeLeft <= 10 && !h.untimed && playing ? 'timer--hot' : ''}`}>{h.untimed ? '∞' : fmt(h.timeLeft)}</div>
        <div className="score score--b">
          <span>{scoreText(b)}</span>
          <TeamShape team={1} />
        </div>
      </div>
      <div className="meter split__meter">
        <div className="meter__a" style={{ width: `${wa}%` }} />
        <div className="meter__b" style={{ width: `${wb}%` }} />
      </div>
    </div>
  );
}

function SeatHud({ store, side, label }: { store: typeof useHud; side: 0 | 1; label: string }) {
  const h = store();
  const g = useSettings((s) => s.gameplay);
  const special = SPECIALS[h.special];
  const ready = h.charge >= 1;
  const playing = h.phase === 'playing';
  const C = 2 * Math.PI * 27;
  const mode = MODES[h.mode as keyof typeof MODES];
  return (
    <div className={`seat seat--${side}`}>
      <div className="hud__scale" style={{ ['--hud-scale' as string]: g.hudScale }}>
        <div className="seat__tag" >
          {label}
        </div>
        {h.alive && <Crosshair hitAt={h.hitAt} koAt={h.koAt} ink={h.ink} hp={h.hp} />}
        {g.damageIndicators &&
          h.hurt.map((d) => (
            <div key={d.id} className="hurt" style={{ transform: `rotate(${-d.angle}rad)` }}>
              <svg className="hurt__arc" viewBox="0 0 220 220">
                <path d="M80 18 A95 95 0 0 1 140 18" stroke="#ff4d57" strokeWidth="7" fill="none" strokeLinecap="round" />
              </svg>
            </div>
          ))}
        {h.cues.map((c) => (
          <div key={c.id} className="cue" style={{ transform: `rotate(${-c.angle}rad)` }}>
            <div className="cue__mark" />
          </div>
        ))}
        {h.alive && h.ink < 12 && playing && <div className="lowink">Low pigment</div>}
        <div className="loadout loadout--seat">
          <div className={`special ${ready ? 'is-ready' : ''}`} title={special.description}>
            <svg viewBox="0 0 62 62">
              <circle cx="31" cy="31" r="27" fill="rgba(10,11,20,0.55)" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
              <circle
                cx="31"
                cy="31"
                r="27"
                fill="none"
                stroke="var(--team-a)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${C * Math.min(1, h.charge)} ${C}`}
                transform="rotate(-90 31 31)"
              />
            </svg>
            <span className="special__key">{ready ? 'GO' : `${Math.floor(h.charge * 100)}`}</span>
          </div>
          <div>
            <div className="loadout__name">{WEAPONS[h.weapon].name}</div>
            <div className="loadout__sub">
              {special.name}
              {ready ? ', ready' : ''}
            </div>
            <div className="hpbar" aria-label="Health">
              <div className="hpbar__fill" style={{ transform: `scaleX(${Math.max(0, h.hp) / 100})` }} />
            </div>
          </div>
        </div>
        <Minimap seat={side} />
        <div className="center-text">
          {h.phase === 'intro' && h.countdown > 0 && (
            <div key={h.countdown} className="countdown">
              {h.countdown}
            </div>
          )}
          {h.phase === 'intro' && h.countdown <= 0 && <div className="notice">{mode?.name}</div>}
          {h.notice && (
            <div key={h.notice.id} className={`notice notice--${h.notice.tone}`}>
              {h.notice.text}
            </div>
          )}
          {!h.alive && playing && <div className="respawn num">Respawning in {Math.ceil(h.respawnIn)}…</div>}
        </div>
        {!h.alive && h.spectating && playing && (
          <div className="spectate" role="status">
            <span className="muted small">{h.spectating.killer ? 'Splatted by' : 'Watching'}</span> <b>{h.spectating.name}</b>
          </div>
        )}
        {h.caption && <div className="caption">{h.caption}</div>}
      </div>
    </div>
  );
}

/** Player 2's side of the menu: their name, loadout and (optional) own account, driven by their controller. */
export function Player2Panel() {
  const p2 = useP2();
  const b = useSplit((s) => s.b);
  const style = padStyle({ id: useSplit.getState().ids[b] ?? '' } as Gamepad);
  const weapons = publicWeapons();
  const [row, setRow] = useState(0);
  const [login, setLogin] = useState(false);
  const rows = ['weapon', 'special', 'look', 'account', 'stop'] as const;
  const state = useRef({ row, login, p2 });
  state.current = { row, login, p2 };

  const cycle = (list: readonly string[], cur: string, dir: number) => list[(list.indexOf(cur) + dir + list.length) % list.length];
  const change = (dir: number) => {
    const r = rows[state.current.row];
    if (r === 'weapon') useP2.setState({ weapon: cycle(weapons, state.current.p2.weapon, dir) as typeof p2.weapon });
    if (r === 'special') useP2.setState({ special: cycle(SPECIAL_IDS, state.current.p2.special, dir) as typeof p2.special });
    if (r === 'look') shufflePlayer2Look();
  };
  const activate = () => {
    const r = rows[state.current.row];
    if (r === 'look') shufflePlayer2Look();
    else if (r === 'account') setLogin((v) => !v);
    else if (r === 'stop') stopSplit();
    else change(1);
  };

  // Player 2's controller moves through the panel: up and down pick a row, left and right change it, the bottom button selects.
  useEffect(() => {
    let raf = 0;
    const prev = new Set<number>();
    let repeatAt = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const pad = navigator.getGamepads?.()[b];
      if (!pad || !pad.connected || state.current.login) return;
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0,
        ay = pad.axes[1] ?? 0;
      const dir = (pressed(13) || ay > 0.6 ? 'down' : pressed(12) || ay < -0.6 ? 'up' : pressed(15) || ax > 0.6 ? 'right' : pressed(14) || ax < -0.6 ? 'left' : '') as string;
      if (dir && t > repeatAt) {
        if (dir === 'down') setRow((r) => (r + 1) % rows.length);
        if (dir === 'up') setRow((r) => (r + rows.length - 1) % rows.length);
        if (dir === 'right') change(1);
        if (dir === 'left') change(-1);
        repeatAt = t + 220;
      }
      if (!dir) repeatAt = 0;
      if (pressed(0) && !prev.has(0)) activate();
      prev.clear();
      pad.buttons.forEach((x, i) => x.pressed && prev.add(i));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b]);

  const act = PAD_BUTTON[style][0];
  return (
    <aside className="p2" aria-label="Player 2">
      <div className="p2__head">
        <Avatar cosmetics={p2.cosmetics} team={0} name={p2Name()} bot={false} />
        <div>
          <small>PLAYER 2</small>
          <h2>{p2Name()}</h2>
          <small>{p2.account ? 'Signed in' : 'Playing as a guest of player 1'}</small>
        </div>
      </div>

      <Row on={row === 0} onPick={() => setRow(0)} label="Weapon" value={WEAPONS[p2.weapon]?.name ?? p2.weapon} onLeft={() => (setRow(0), useP2.setState({ weapon: cycle(weapons, p2.weapon, -1) as typeof p2.weapon }))} onRight={() => (setRow(0), useP2.setState({ weapon: cycle(weapons, p2.weapon, 1) as typeof p2.weapon }))} />
      <Row on={row === 1} onPick={() => setRow(1)} label="Special" value={SPECIALS[p2.special].name} onLeft={() => (setRow(1), useP2.setState({ special: cycle(SPECIAL_IDS, p2.special, -1) as typeof p2.special }))} onRight={() => (setRow(1), useP2.setState({ special: cycle(SPECIAL_IDS, p2.special, 1) as typeof p2.special }))} />
      <Row on={row === 2} onPick={() => setRow(2)} label="Look" value="Shuffle" onLeft={shufflePlayer2Look} onRight={shufflePlayer2Look} />

      {firebaseConfigured && (
        <div className="p2__row p2__row--plain" data-on={row === 3} onPointerDown={() => setRow(3)}>
          <span>Account</span>
          {p2.account ? (
            <Button size="md" onClick={() => useP2.setState({ account: null })}>
              Sign out
            </Button>
          ) : (
            <Button size="md" onClick={() => setLogin((v) => !v)}>
              {login ? 'Cancel' : 'Sign in'}
            </Button>
          )}
        </div>
      )}
      {login && !p2.account && <P2Login onDone={() => setLogin(false)} />}

      <div className="p2__row p2__row--plain" data-on={row === 4} onPointerDown={() => setRow(4)}>
        <span>Split screen</span>
        <Button size="md" onClick={() => stopSplit()}>
          Turn off
        </Button>
      </div>

      <p className="p2__hint">
        D-pad up and down to choose · left and right to change · {act} to select.
        <br />
        Player 1 starts the match. Player 2 joins their team automatically.
      </p>
    </aside>
  );
}

function Row({ on, label, value, onLeft, onRight, onPick }: { on: boolean; label: string; value: string; onLeft: () => void; onRight: () => void; onPick: () => void }) {
  return (
    <div className="p2__row" data-on={on} onPointerDown={onPick}>
      <span>{label}</span>
      <span className="p2__val">
        <button aria-label={`Previous ${label}`} onClick={onLeft}>
          ‹
        </button>
        <b>{value}</b>
        <button aria-label={`Next ${label}`} onClick={onRight}>
          ›
        </button>
      </span>
    </div>
  );
}

/** Optional: player 2 signs in with their own account (a separate session; player 1 stays signed in). */
function P2Login({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const { signInP2 } = await import('../auth/p2auth');
      const a = await signInP2(name, pw);
      useP2.setState({ account: { uid: a.uid, name: a.name }, weapon: a.weapon as never, special: a.special as never, cosmetics: a.cosmetics });
      onDone();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(/invalid|wrong|user-not-found|credential/.test(code) ? 'That username or password isn’t right.' : ((e as Error).message || 'Couldn’t sign in.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="p2__login"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input className="input" placeholder="Username" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" type="password" placeholder="Password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <small className="p2__err">{err}</small>}
      <Button variant="primary" size="md" type="submit" disabled={busy || !name || !pw}>
        {busy ? 'Signing in…' : 'Sign in as player 2'}
      </Button>
    </form>
  );
}
