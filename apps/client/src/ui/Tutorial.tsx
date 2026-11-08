import { useEffect, useState } from 'react';
import { offline } from '../auth/admin';
import { PAD_BUTTON, useButtonStyle, useDevice, type DeviceKind } from '../game/devices';
import { leaveMatch } from '../game/session';
import { useSettings, type Action } from '../settings/settings';
import { useTutorial } from '../state/tutorial';
import { keyLabel } from './kit';

/** The guided tutorial: an offline practice arena with steps that tick off as you do them. */

interface Snap {
  x: number;
  y: number;
  z: number;
  grounded: boolean;
  diving: boolean;
  climbing: boolean;
  swimming: boolean;
  dodging: boolean;
  paint: number;
  kills: number;
  vy: number;
}

interface Step {
  title: string;
  /** What to do, in words (the buttons for each device are listed under it). */
  text: string;
  actions: Action[] | 'move' | 'look';
  done(s: Snap, start: Snap, memo: Record<string, number>): boolean;
}

const STEPS: Step[] = [
  {
    title: 'Move around',
    text: 'Walk a few steps in any direction. The camera follows your look direction, so turn as you go.',
    actions: 'move',
    done: (s, a) => Math.hypot(s.x - a.x, s.z - a.z) > 6,
  },
  {
    title: 'Look around',
    text: 'Turn the camera to see where you are going. Aim with the crosshair in the middle of the screen.',
    actions: 'look',
    done: (_s, _a, m) => (m.looked ?? 0) > 0,
  },
  {
    title: 'Jump',
    text: 'Jump over things. Press jump again in mid-air for a second jump.',
    actions: ['jump'],
    done: (s) => !s.grounded,
  },
  {
    title: 'Paint the floor',
    text: 'Fire to paint. Your colour is your road, your health and your ink: shoot at the ground around you.',
    actions: ['fire'],
    done: (s, a) => s.paint > a.paint + 1.5,
  },
  {
    title: 'Dive into your paint',
    text: 'Stand on your own paint and hold dive. You sink into it, turn fast, refill your ink, and rivals can barely see you.',
    actions: ['dive'],
    done: (s) => s.diving,
  },
  {
    title: 'Climb a wall',
    text: 'Paint a wall, then hold dive against it and push forward: you swim up painted walls. Try it on the wall of a building.',
    actions: ['dive', 'fire'],
    done: (s) => s.climbing || (s.diving && s.vy > 2),
  },
  {
    title: 'Dodge',
    text: 'Dash sideways or forward to slip out of trouble. It recharges quickly.',
    actions: ['dodge'],
    done: (s) => s.dodging,
  },
  {
    title: 'Splat a target',
    text: 'The practice targets stand across the arena. Paint them and splat one to finish.',
    actions: ['fire'],
    done: (s, a) => s.kills > a.kills,
  },
];

const TOUCH: Partial<Record<Action, string>> = {
  fire: 'FIRE button',
  jump: 'JUMP button',
  dive: 'DIVE button',
  dodge: 'DODGE button',
  special: 'SPCL button',
};

const ACTION_NAME: Partial<Record<Action, string>> = { fire: 'Fire', jump: 'Jump', dive: 'Dive', dodge: 'Dodge', special: 'Special' };

function Keys({ step, kind }: { step: Step; kind: DeviceKind }) {
  const b = useSettings((s) => s.controls.bindings);
  const pads = useSettings((s) => s.controls.padBindings);
  const style = useButtonStyle();
  const label = (a: Action) => {
    if (kind === 'pad') {
      const i = pads[a];
      return i === null || i === undefined ? 'Not set' : (PAD_BUTTON[style][i] ?? `Button ${i}`);
    }
    if (kind === 'touch') return TOUCH[a] ?? a;
    return keyLabel(b[a]?.[0]);
  };
  if (step.actions === 'move')
    return <span>{kind === 'keyboard' ? ['forward', 'left', 'back', 'right'].map((a) => keyLabel(b[a as Action]?.[0])).join(' ') : kind === 'pad' ? 'Left stick' : 'Left stick on screen'}</span>;
  if (step.actions === 'look')
    return <span>{kind === 'keyboard' ? 'Move the mouse' : kind === 'pad' ? 'Right stick' : 'Drag on the right side of the screen'}</span>;
  return (
    <span>
      {step.actions.map((a) => `${ACTION_NAME[a] ?? a}: ${label(a)}`).join('   ·   ')}
    </span>
  );
}

const read = (): Snap | null => {
  const p = offline.sim?.byId(1);
  if (!p) return null;
  return {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z,
    grounded: p.grounded,
    diving: p.diving,
    climbing: p.climbing,
    swimming: p.swimming,
    dodging: p.dodgeT > 0,
    paint: p.stats.paint,
    kills: p.stats.kills,
    vy: p.vel.y,
  };
};

export function Tutorial() {
  const active = useTutorial((t) => t.active);
  const device = useDevice((d) => d.last);
  const [i, setI] = useState(0);
  const [ok, setOk] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!active) return;
    setI(0);
    setOk(false);
  }, [active]);

  useEffect(() => {
    if (!active || i >= STEPS.length) return;
    let start = read();
    const memo: Record<string, number> = {};
    // Looking is detected from the camera turning: the player's yaw follows the camera when they move, so watch the pointer and sticks too.
    const onMove = () => (memo.looked = (memo.looked ?? 0) + 1);
    addEventListener('mousemove', onMove);
    const pad = setInterval(() => {
      const p = [...(navigator.getGamepads?.() ?? [])].find((x) => x?.connected);
      if (p && (Math.abs(p.axes[2] ?? 0) > 0.4 || Math.abs(p.axes[3] ?? 0) > 0.4)) memo.looked = (memo.looked ?? 0) + 1;
    }, 100);
    const touchLook = () => (memo.looked = (memo.looked ?? 0) + 1);
    addEventListener('touchmove', touchLook);
    const t = setInterval(() => {
      const s = read();
      if (!s) return;
      start ??= s;
      if (!ok && STEPS[i].done(s, start, memo)) {
        setOk(true);
        setTimeout(() => {
          setOk(false);
          setI((n) => n + 1);
        }, 1100);
      }
    }, 120);
    return () => {
      clearInterval(t);
      clearInterval(pad);
      removeEventListener('mousemove', onMove);
      removeEventListener('touchmove', touchLook);
    };
  }, [active, i, ok]);

  if (!active) return null;
  const step = STEPS[i];
  const done = i >= STEPS.length;

  return (
    <div className="tutor" role="region" aria-label="Tutorial">
      <div className="tutor__step">
        <span>{done ? 'Tutorial complete' : `Step ${i + 1} of ${STEPS.length}`}</span>
        <span className="tutor__bar">
          <i style={{ width: `${(Math.min(i + (ok ? 1 : 0), STEPS.length) / STEPS.length) * 100}%` }} />
        </span>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && !done && (
        <>
          <h3>
            {step.title} {ok && <span className="tutor__ok">✓ Nice</span>}
          </h3>
          <p>{step.text}</p>
          <div className="tutor__keys small">
            {(['keyboard', 'pad', 'touch'] as DeviceKind[]).map((k) => (
              <span key={k} className="badge" style={{ opacity: k === device ? 1 : 0.6, fontWeight: k === device ? 800 : 500 }}>
                {k === 'keyboard' ? 'Keyboard' : k === 'pad' ? 'Controller' : 'Touch'}: <Keys step={step} kind={k} />
              </span>
            ))}
          </div>
        </>
      )}
      {open && done && (
        <>
          <h3>You’re ready.</h3>
          <p>Paint your colour, dive to travel and refill, and splat rivals. Jump into a game whenever you like. You can keep practising here as long as you want.</p>
        </>
      )}
      <div className="row" style={{ gap: 8 }}>
        {!done && (
          <button className="btn btn--ghost btn--sm" onClick={() => setI(i + 1)}>
            Skip step
          </button>
        )}
        <button className="btn btn--primary btn--sm" onClick={() => (useTutorial.setState({ active: false }), leaveMatch())}>
          {done ? 'Finish' : 'Leave tutorial'}
        </button>
      </div>
    </div>
  );
}
