import { BTN } from '@chromashift/shared';
import { useSettings, type Action } from '../settings/settings';

/** Written by the on-screen touch controls. */
export const touch = { active: false, mx: 0, mz: 0, lookX: 0, lookY: 0, buttons: 0 };

const ACTION_BTN: Partial<Record<Action, number>> = {
  fire: BTN.FIRE,
  jump: BTN.JUMP,
  dive: BTN.DIVE,
  sprint: BTN.SPRINT,
  slide: BTN.SLIDE,
  dodge: BTN.DODGE,
  special: BTN.SPECIAL,
  emote: BTN.EMOTE,
};

// Standard-mapping gamepad buttons.
const PAD: Partial<Record<Action, number>> = {
  fire: 7, dive: 6, jump: 0, slide: 1, dodge: 2, special: 5, sprint: 10, emote: 3, scoreboard: 8, pause: 9,
};

const DEAD = 0.18;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/**
 * Keyboard, mouse, gamepad and touch merged into one action state. Presses are latched until a
 * fixed simulation tick consumes them, so a tap shorter than a tick is never lost.
 */
export class InputManager {
  private down = new Set<string>();
  private latched = new Set<string>();
  private padDown = new Set<number>();
  private padLatched = new Set<number>();
  private lookX = 0;
  private lookY = 0;
  locked = false;
  /** Set during matches: a click on the canvas captures the mouse. */
  wantsLock = false;
  /** Keyboard play without pointer lock (embedded browsers that refuse it). */
  engaged = false;
  onPause: (() => void) | null = null;
  onScoreboard: ((open: boolean) => void) | null = null;
  private el: HTMLElement | null = null;

  private key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const code = e.code;
    if (e.type === 'keydown') {
      if (code === 'Tab' || code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(code)) this.latched.add(code);
      this.down.add(code);
      if (this.isBound('scoreboard', code)) this.onScoreboard?.(true);
      if (this.isBound('pause', code) && !this.locked) this.onPause?.();
    } else {
      this.down.delete(code);
      if (this.isBound('scoreboard', code)) this.onScoreboard?.(false);
    }
  };
  private mouse = (e: MouseEvent) => {
    const code = `Mouse${e.button}`;
    if (e.type === 'mousedown') {
      if (!this.locked && !(this.engaged && e.target === this.el)) return;
      if (!this.down.has(code)) this.latched.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  };
  private move = (e: MouseEvent) => {
    if (!this.locked) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };
  private blur = () => {
    this.down.clear();
    this.engaged = false;
    this.onScoreboard?.(false);
  };
  private lockChange = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.el;
    if (was && !this.locked) {
      this.down.clear();
      this.onPause?.();
    }
  };
  private ctx = (e: Event) => e.preventDefault();
  private click = () => {
    if (!this.wantsLock) return;
    this.engaged = true;
    this.lock();
  };

  attach(el: HTMLElement) {
    this.el = el;
    addEventListener('keydown', this.key);
    addEventListener('keyup', this.key);
    addEventListener('mousedown', this.mouse);
    addEventListener('mouseup', this.mouse);
    addEventListener('mousemove', this.move);
    addEventListener('blur', this.blur);
    document.addEventListener('pointerlockchange', this.lockChange);
    el.addEventListener('contextmenu', this.ctx);
    el.addEventListener('click', this.click);
  }

  detach() {
    removeEventListener('keydown', this.key);
    removeEventListener('keyup', this.key);
    removeEventListener('mousedown', this.mouse);
    removeEventListener('mouseup', this.mouse);
    removeEventListener('mousemove', this.move);
    removeEventListener('blur', this.blur);
    document.removeEventListener('pointerlockchange', this.lockChange);
    this.el?.removeEventListener('contextmenu', this.ctx);
    this.el?.removeEventListener('click', this.click);
    this.unlock();
  }

  lock() {
    if (!this.el || this.locked || touch.active) return;
    const r = this.el.requestPointerLock?.({ unadjustedMovement: true }) as Promise<void> | undefined;
    // Some browsers reject unadjustedMovement; fall back to the plain request.
    r?.catch?.(() => this.el?.requestPointerLock?.());
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private isBound(a: Action, code: string) {
    return useSettings.getState().controls.bindings[a]?.includes(code) ?? false;
  }

  private pad(): Gamepad | null {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
    return null;
  }

  /** Polls the gamepad once per frame (edge detection for its buttons). */
  pollPad() {
    const p = this.pad();
    if (!p) return;
    p.buttons.forEach((b, i) => {
      const on = b.pressed || b.value > 0.4;
      if (on && !this.padDown.has(i)) {
        this.padLatched.add(i);
        if (i === PAD.pause) this.onPause?.();
      }
      if (on) this.padDown.add(i);
      else this.padDown.delete(i);
    });
    if (PAD.scoreboard !== undefined) this.onScoreboard?.(this.padDown.has(PAD.scoreboard));
  }

  held(a: Action) {
    const codes = useSettings.getState().controls.bindings[a] ?? [];
    if (codes.some((c) => this.down.has(c))) return true;
    const pi = PAD[a];
    return pi !== undefined && this.padDown.has(pi);
  }

  private pressed(a: Action) {
    const codes = useSettings.getState().controls.bindings[a] ?? [];
    if (codes.some((c) => this.latched.has(c))) return true;
    const pi = PAD[a];
    return pi !== undefined && this.padLatched.has(pi);
  }

  /** Camera-relative stick in -1..1. */
  stick(): { x: number; z: number } {
    let x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let z = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    const p = this.pad();
    if (p) {
      const px = dz(p.axes[0] ?? 0), pz = -dz(p.axes[1] ?? 0);
      if (Math.abs(px) + Math.abs(pz) > 0) {
        x = px;
        z = pz;
      }
    }
    if (touch.active && (touch.mx || touch.mz)) {
      x = touch.mx;
      z = touch.mz;
    }
    const l = Math.hypot(x, z);
    return l > 1 ? { x: x / l, z: z / l } : { x, z };
  }

  /** Look delta in radians for this frame. */
  look(dt: number): { yaw: number; pitch: number } {
    const s = useSettings.getState();
    const cam = s.gameplay.cameraSensitivity;
    const aim = this.held('fire') ? s.controls.aimSensitivity : 1;
    let yaw = -this.lookX * 0.0022 * s.controls.mouseSensitivity * cam * aim;
    let pitch = -this.lookY * 0.0022 * s.controls.mouseSensitivity * cam * aim;
    this.lookX = this.lookY = 0;
    const p = this.pad();
    if (p) {
      const rx = dz(p.axes[2] ?? 0), ry = dz(p.axes[3] ?? 0);
      const g = 3.2 * s.controls.gamepadSensitivity * cam * aim * dt;
      yaw -= rx * Math.abs(rx) * g;
      pitch -= ry * Math.abs(ry) * g * 0.75;
    }
    if (touch.active) {
      yaw -= touch.lookX * 0.005 * cam;
      pitch -= touch.lookY * 0.005 * cam;
      touch.lookX = touch.lookY = 0;
    }
    if (s.controls.invertY) pitch = -pitch;
    return { yaw, pitch };
  }

  /** Held buttons plus latched presses as a BTN bitmask. */
  buttons(): number {
    let b = 0;
    for (const [a, bit] of Object.entries(ACTION_BTN) as [Action, number][]) if (this.held(a) || this.pressed(a)) b |= bit;
    if (touch.active) b |= touch.buttons;
    return b;
  }

  /** Called after a simulation tick has seen the latched presses. */
  consume() {
    this.latched.clear();
    this.padLatched.clear();
  }

  rumble(strength: number, ms: number) {
    if (!useSettings.getState().controls.vibration) return;
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect(t: string, o: object): Promise<unknown> } }) | null;
    p?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  }
}
