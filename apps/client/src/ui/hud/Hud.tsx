import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MODES, SPECIALS, WEAPONS } from '@chromashift/shared';
import { engine } from '../../game/engine';
import { touch } from '../../game/input';
import { leaveMatch } from '../../game/session';
import { useNet } from '../../multiplayer/net';
import { teamNames } from '../../rendering/palette';
import { useSettings } from '../../settings/settings';
import { useHud, useUi } from '../../state/ui';
import { TeamShape } from '../icons';
import { Button, keyLabel } from '../kit';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Hud() {
  const h = useHud();
  const g = useSettings((s) => s.gameplay);
  const showFps = useSettings((s) => s.graphics.showFps);
  const bindings = useSettings((s) => s.controls.bindings);
  const touchMode = useSettings((s) => s.controls.touchControls);
  const paused = useUi((s) => s.paused);
  const names = teamNames();
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setLocked(engine.input.locked || engine.input.engaged), 250);
    return () => clearInterval(t);
  }, []);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const showTouch = touchMode === 'on' || (touchMode === 'auto' && coarse);
  useEffect(() => {
    touch.active = showTouch;
  }, [showTouch]);

  const mode = MODES[h.mode as keyof typeof MODES];
  const pct = h.mode === 'turf' || h.mode === 'practice';
  const [a, b] = h.score;
  const scoreText = (v: number) => (pct ? `${v.toFixed(1)}%` : h.mode === 'zones' ? `${Math.ceil(v)}` : `${v}`);
  const total = Math.max(1e-6, a + b);
  const special = SPECIALS[h.special];
  const ready = h.charge >= 1;
  const C = 2 * Math.PI * 27;
  const playing = h.phase === 'playing';

  return (
    <div className={`hud ${showTouch ? 'hud--touch' : ''}`}>
      {/* Only the match readout hides behind the pause menu; the menu itself must stay reachable. */}
      <div className="hud__scale" style={{ ['--hud-scale' as string]: g.hudScale }} aria-hidden={paused}>
        <div className="hud-top">
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
        {pct && (
          <div className="meter" title={`${names[0]} ${a.toFixed(1)}% · ${names[1]} ${b.toFixed(1)}%`}>
            <div className="meter__a" style={{ width: `${a}%` }} />
            <div className="meter__b" style={{ width: `${b}%` }} />
          </div>
        )}
        {!pct && (
          <div className="meter">
            <div className="meter__a" style={{ width: `${(h.mode === 'zones' ? (b / total) : a / total) * 100}%` }} />
            <div className="meter__b" style={{ width: `${(h.mode === 'zones' ? a / total : b / total) * 100}%` }} />
          </div>
        )}
        {h.mode === 'zones' && (
          <div className="zones">
            {h.holders.map((t, i) => (
              <div key={i} className="zone-pip" style={{ background: t < 0 ? undefined : t === 0 ? 'var(--team-a)' : 'var(--team-b)' }} />
            ))}
          </div>
        )}

        <div className="feed">
          {h.feed.map((f) => (
            <div key={f.id} className="feed__row">
              {f.killer && <span style={{ color: f.killerTeam === 0 ? 'var(--team-a)' : 'var(--team-b)' }}>{f.killer}</span>}
              <span className="feed__cause">{f.cause || 'splatted'}</span>
              <span style={{ color: f.victimTeam === 0 ? 'var(--team-a)' : 'var(--team-b)' }}>{f.victim}</span>
            </div>
          ))}
        </div>

        <div className="status">
          {showFps && <span>{h.fps} FPS</span>}
          {h.net !== 'local' && (
            <span>
              <span className={`dot ${h.net === 'good' ? 'dot--ok' : h.net === 'poor' ? 'dot--warn' : 'dot--bad'}`} />
              {h.net === 'lost' ? 'Connection lost' : `${h.ping ?? '–'} ms`}
            </span>
          )}
        </div>

        {h.alive && <Crosshair hitAt={h.hitAt} koAt={h.koAt} ink={h.ink} hp={h.hp} />}
        {h.alive && h.ink < 12 && playing && <div className="lowink">{h.diving ? 'Refilling…' : `Low pigment — hold ${keyLabel(bindings.dive[0])} on your colour`}</div>}

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

        <div className="loadout">
          <div className={`special ${ready ? 'is-ready' : ''}`} title={special.description}>
            <svg viewBox="0 0 62 62">
              <circle cx="31" cy="31" r="27" fill="rgba(10,11,20,0.55)" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
              <circle
                cx="31"
                cy="31"
                r="27"
                fill="none"
                stroke={h.myTeam === 0 ? 'var(--team-a)' : 'var(--team-b)'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${C * Math.min(1, h.charge)} ${C}`}
                transform="rotate(-90 31 31)"
              />
            </svg>
            <span className="special__key">{ready ? keyLabel(bindings.special[0]) : `${Math.floor(h.charge * 100)}`}</span>
          </div>
          <div>
            <div className="loadout__name">{WEAPONS[h.weapon].name}</div>
            <div className="loadout__sub">
              {special.name}
              {ready ? ' — ready' : ''}
            </div>
            <div className="hpbar" aria-label="Health">
              <div className="hpbar__fill" style={{ transform: `scaleX(${Math.max(0, h.hp) / 100})` }} />
            </div>
          </div>
        </div>

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

        {h.caption && <div className="caption">{h.caption}</div>}
      </div>

      {h.showBoard && <Scoreboard />}
      {!locked && !paused && !showTouch && h.phase !== 'ending' && h.phase !== 'ended' && (
        <div className="prompt" onClick={() => engine.input.lock()}>
          Click to {h.phase === 'intro' ? 'take control' : 'resume'} · {keyLabel(bindings.pause[0])} to pause
        </div>
      )}
      {showTouch && !paused && <TouchControls charge={h.charge} team={h.myTeam} />}
      {paused && <PauseMenu />}
    </div>
  );
}

function Crosshair({ hitAt, koAt, ink, hp }: { hitAt: number; koAt: number; ink: number; hp: number }) {
  const style = useSettings((s) => s.gameplay.crosshair);
  const hits = useSettings((s) => s.gameplay.hitIndicators);
  const ref = useRef<SVGSVGElement>(null);
  const koRef = useRef<SVGSVGElement>(null);
  // Restart the flash on every hit without re-rendering React per frame.
  useEffect(() => {
    if (!hits || !hitAt || !ref.current) return;
    ref.current.classList.remove('is-on');
    void ref.current.getBoundingClientRect();
    ref.current.classList.add('is-on');
  }, [hitAt, hits]);
  useEffect(() => {
    if (!hits || !koAt || !koRef.current) return;
    koRef.current.classList.remove('is-ko');
    void koRef.current.getBoundingClientRect();
    koRef.current.classList.add('is-ko');
  }, [koAt, hits]);
  const C = 2 * Math.PI * 38;
  const inkShow = ink < 99 ? 1 : 0;
  return (
    <div className="crosshair">
      {style === 'dot' && <div className="crosshair__dot" />}
      {style === 'ring' && (
        <>
          <div className="crosshair__ring" />
          <div className="crosshair__dot" />
        </>
      )}
      {style === 'cross' &&
        [0, 90, 180, 270].map((r) => (
          <div key={r} className="crosshair__cross" style={{ width: 2, height: 9, left: -1, top: -18, transform: `rotate(${r}deg)`, transformOrigin: '1px 18px' }} />
        ))}
      <svg ref={ref} className="hitmark" viewBox="0 0 28 28">
        <path d="M4 4l6 6M24 4l-6 6M4 24l6-6M24 24l-6-6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <svg ref={koRef} className="hitmark" viewBox="0 0 28 28">
        <path d="M3 3l7 7M25 3l-7 7M3 25l7-7M25 25l-7-7" stroke="#ff4d57" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <svg className="gauge gauge--ink" viewBox="0 0 84 84" style={{ opacity: inkShow }}>
        {/* Pigment on the right arc, health on the left: readable without looking away. */}
        <circle cx="42" cy="42" r="38" stroke="rgba(255,255,255,0.16)" strokeDasharray={`${C * 0.22} ${C}`} transform="rotate(-40 42 42)" />
        <circle cx="42" cy="42" r="38" stroke={ink < 20 ? '#ff6b70' : '#ffffff'} strokeDasharray={`${C * 0.22 * (ink / 100)} ${C}`} transform="rotate(-40 42 42)" />
      </svg>
      <svg className="gauge gauge--ink" viewBox="0 0 84 84" style={{ opacity: hp < 100 ? 1 : 0 }}>
        <circle cx="42" cy="42" r="38" stroke="rgba(255,255,255,0.16)" strokeDasharray={`${C * 0.22} ${C}`} transform="rotate(140 42 42)" />
        <circle cx="42" cy="42" r="38" stroke={hp < 35 ? '#ff6b70' : '#ffffff'} strokeDasharray={`${C * 0.22 * (Math.max(0, hp) / 100)} ${C}`} transform="rotate(140 42 42)" />
      </svg>
    </div>
  );
}

function Scoreboard() {
  const board = useHud((s) => s.board);
  const names = teamNames();
  return (
    <div className="board">
      <table className="table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Weapon</th>
            <th>Paint</th>
            <th>KO</th>
            <th>Assist</th>
            <th>Splatted</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1].flatMap((t) =>
            board
              .filter((r) => r.team === t)
              .map((r) => (
                <tr key={r.id} className={r.you ? 'is-you' : ''} style={{ ['--row-team' as string]: t === 0 ? 'var(--team-a)' : 'var(--team-b)' }}>
                  <td>
                    {r.name}
                    {r.bot ? <span className="muted small"> · bot</span> : null}
                    {!r.alive ? <span className="muted small"> · respawning</span> : null}
                  </td>
                  <td>{WEAPONS[r.weapon].name}</td>
                  <td>{r.paint}</td>
                  <td>{r.kills}</td>
                  <td>{r.assists}</td>
                  <td>{r.deaths}</td>
                </tr>
              )),
          )}
        </tbody>
      </table>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        {names[0]} vs {names[1]}
      </p>
    </div>
  );
}

function PauseMenu() {
  const setPaused = useUi((s) => s.setPaused);
  const go = useUi((s) => s.go);
  const online = useHud((s) => s.net !== 'local');
  const hosting = useNet((s) => s.kind === 'host');
  const resume = () => {
    setPaused(false);
    engine.input.lock();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        resume();
      }
    };
    // Defer so the Escape that opened the menu doesn't close it.
    const t = setTimeout(() => addEventListener('keydown', k), 50);
    return () => {
      clearTimeout(t);
      removeEventListener('keydown', k);
    };
  });
  return (
    <div className="pause">
      <div className="pause__card">
        <h2 className="pause__title">{online ? 'Menu' : 'Paused'}</h2>
        {online && <p className="muted small">The match keeps running while this menu is open.</p>}
        <Button variant="primary" size="lg" block onClick={resume}>
          Resume
        </Button>
        <Button size="lg" block onClick={() => go('settings')}>
          Settings
        </Button>
        {hosting && <p className="muted small">You’re hosting: leaving ends the game for everyone.</p>}
        <Button size="lg" block variant="danger" onClick={() => leaveMatch()}>
          {hosting ? 'End game' : 'Leave match'}
        </Button>
      </div>
    </div>
  );
}

/** Virtual stick + buttons. Writes into the shared `touch` state read by the input layer. */
/** On touch the special's charge ring lives on its button, where the thumb already is. */
function TouchControls({ charge, team }: { charge: number; team: number }) {
  const knob = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(0);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const setPaused = useUi((s) => s.setPaused);

  const btn = (bit: number, cls: string, label: ReactNode) => (
    <div
      className={`tbtn ${cls} ${down & bit ? 'is-down' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        touch.buttons |= bit;
        setDown(touch.buttons);
      }}
      onPointerUp={() => {
        touch.buttons &= ~bit;
        setDown(touch.buttons);
      }}
      onPointerCancel={() => {
        touch.buttons &= ~bit;
        setDown(touch.buttons);
      }}
    >
      {label}
    </div>
  );

  return (
    <div
      className="touch"
      onPointerDown={(e) => {
        if (e.clientX < innerWidth * 0.4 && stickId.current === null) {
          stickId.current = e.pointerId;
          origin.current = { x: e.clientX, y: e.clientY };
        } else if (lookId.current === null) {
          lookId.current = e.pointerId;
          last.current = { x: e.clientX, y: e.clientY };
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerId === stickId.current) {
          const dx = e.clientX - origin.current.x, dy = e.clientY - origin.current.y;
          const l = Math.min(1, Math.hypot(dx, dy) / 56);
          const a = Math.atan2(dy, dx);
          touch.mx = Math.cos(a) * l;
          touch.mz = -Math.sin(a) * l;
          if (knob.current) knob.current.style.transform = `translate(${Math.cos(a) * l * 40}px, ${Math.sin(a) * l * 40}px)`;
        } else if (e.pointerId === lookId.current) {
          touch.lookX += e.clientX - last.current.x;
          touch.lookY += e.clientY - last.current.y;
          last.current = { x: e.clientX, y: e.clientY };
        }
      }}
      onPointerUp={(e) => {
        if (e.pointerId === stickId.current) {
          stickId.current = null;
          touch.mx = touch.mz = 0;
          if (knob.current) knob.current.style.transform = '';
        }
        if (e.pointerId === lookId.current) lookId.current = null;
      }}
    >
      <div className="stick">
        <div className="stick__knob" ref={knob} />
      </div>
      {btn(1, 'tbtn--fire', 'FIRE')}
      {btn(2, 'tbtn--jump', 'JUMP')}
      {btn(4, 'tbtn--dive', 'DIVE')}
      {btn(
        64,
        `tbtn--special ${charge >= 1 ? 'is-ready' : ''}`,
        <>
          <svg className="tbtn__ring" viewBox="0 0 64 64" aria-hidden>
            <circle cx="32" cy="32" r="30" pathLength={1} strokeDasharray={`${Math.min(1, charge)} 1`} stroke={team ? 'var(--team-b)' : 'var(--team-a)'} />
          </svg>
          SPCL
        </>,
      )}
      {btn(32, 'tbtn--dodge', 'DODGE')}
      <div className="tbtn tbtn--menu" onPointerDown={() => setPaused(true)}>
        ❚❚
      </div>
    </div>
  );
}
