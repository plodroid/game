import { create } from 'zustand';
import { BTN, WHEEL } from '@chromashift/shared';
import { useSettings, type Action } from '../settings/settings';

/** The emote wheel: open while the emote button is held; `pick` is the highlighted slot or -1. */
export const useWheel = create<{ open: boolean; pick: number }>()(() => ({ open: false, pick: -1 }));

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
};

// Standard-mapping gamepad buttons.
/** Standard gamepad layout (Xbox, PlayStation and most others): button index per action. */
const PAD: Partial<Record<Action, number>> = {
  fire: 7,
  dive: 6,
  jump: 0,
  slide: 1,
  dodge: 2,
  special: 5,
  sprint: 10,
  emote: 3,
  scoreboard: 8,
  pause: 9,
  talk: 12,
  map: 15,
};

export type PadStyle = 'xbox' | 'playstation';
/** Sony controllers (DualShock 4, DualSense) get PlayStation button names. */
export const padStyle = (p: Gamepad | null | undefined): PadStyle =>
  /054c|dualshock|dualsense|playstation|wireless controller/i.test(p?.id ?? '') ? 'playstation' : 'xbox';

/** What each action's controller button is called on that kind of controller. */
export const PAD_LABEL: Record<PadStyle, Partial<Record<Action, string>>> = {
  xbox: {
    fire: 'RT',
    dive: 'LT',
    jump: 'A',
    slide: 'B',
    dodge: 'X',
    special: 'RB',
    sprint: 'L3',
    emote: 'Y',
    scoreboard: 'View',
    pause: 'Menu',
    talk: 'D-pad up',
    map: 'D-pad right',
  },
  playstation: {
    fire: 'R2',
    dive: 'L2',
    jump: '✕',
    slide: '○',
    dodge: '□',
    special: 'R1',
    sprint: 'L3',
    emote: '△',
    scoreboard: 'Share',
    pause: 'Options',
    talk: 'D-pad up',
    map: 'D-pad right',
  },
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
  /** Chat key: opens the chat box (the key itself never reaches the game). */
  onChat: (() => void) | null = null;
  /** Push-to-talk held or released. */
  onTalk: ((down: boolean) => void) | null = null;
  /** Minimap size key. */
  onMap: (() => void) | null = null;
  /** First / third person key. */
  onView: (() => void) | null = null;
  private el: HTMLElement | null = null;
  /** Pointer or stick travel while the wheel is open, and when it opened. */
  private wx = 0;
  private wy = 0;
  private wheelAt = 0;
  /** A slot chosen on the wheel, sent with the next tick. */
  private emoteSlot = -1;
  private lastSlot = 0;

  /** Opens the emote wheel (mouse and right stick pick a slot instead of turning the camera). */
  openWheel() {
    if (useWheel.getState().open) return;
    this.wx = this.wy = 0;
    this.wheelAt = performance.now();
    useWheel.setState({ open: true, pick: -1 });
  }
  /** Closes the wheel and plays the picked slot. A quick tap replays the last emote. */
  closeWheel(play = true) {
    const w = useWheel.getState();
    if (!w.open) return;
    useWheel.setState({ open: false, pick: -1 });
    if (!play) return;
    if (w.pick >= 0) this.playEmote(w.pick);
    else if (performance.now() - this.wheelAt < 220) this.playEmote(this.lastSlot);
  }
  playEmote(slot: number) {
    this.emoteSlot = this.lastSlot = slot;
  }
  /** Highlights a slot directly (hovering or tapping the wheel). */
  hoverWheel(slot: number) {
    if (useWheel.getState().pick !== slot) useWheel.setState({ pick: slot });
  }
  /** The wheel slot to send with this tick's input. */
  emote() {
    return Math.max(0, this.emoteSlot);
  }
  private steerWheel() {
    const l = Math.hypot(this.wx, this.wy);
    if (l > 120) {
      this.wx *= 120 / l;
      this.wy *= 120 / l;
    }
    if (l < 28) return;
    const a = Math.atan2(this.wx, -this.wy);
    this.hoverWheel((Math.round(a / ((Math.PI * 2) / WHEEL)) + WHEEL) % WHEEL);
  }

  private key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const code = e.code;
    if (this.isBound('talk', code)) {
      if (!e.repeat) this.onTalk?.(e.type === 'keydown');
      return;
    }
    if (e.type === 'keydown' && this.onChat && this.isBound('chat', code)) {
      e.preventDefault();
      this.down.clear();
      this.onChat();
      return;
    }
    if (e.type === 'keydown' && this.onMap && this.isBound('map', code) && !e.repeat) this.onMap();
    if (e.type === 'keydown' && this.onView && this.isBound('view', code) && !e.repeat) this.onView();
    if (this.wantsLock && this.isBound('emote', code)) {
      if (e.type === 'keydown' && !e.repeat) this.openWheel();
      else if (e.type === 'keyup') this.closeWheel();
    }
    if (e.type === 'keydown') {
      // In a match, any key takes control: keys work at once and the mouse is captured (a key press counts as a gesture).
      if (this.wantsLock && !this.locked && !this.isBound('pause', code)) {
        this.engaged = true;
        this.lock();
      }
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
    if (this.wantsLock && this.isBound('emote', code)) {
      if (e.type === 'mousedown') this.openWheel();
      else this.closeWheel();
      return;
    }
    if (e.type === 'mousedown') {
      if (!this.locked && !(this.engaged && e.target === this.el)) return;
      if (!this.down.has(code)) this.latched.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  };
  private move = (e: MouseEvent) => {
    if (!this.locked) return;
    if (useWheel.getState().open) {
      this.wx += e.movementX;
      this.wy += e.movementY;
      this.steerWheel();
      return;
    }
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };
  private blur = () => {
    this.closeWheel(false);
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
    // A window without focus refuses both; the next click or key locks instead.
    r?.catch?.(() =>
      (this.el?.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => undefined),
    );
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
        if (i === PAD.map) this.onMap?.();
        if (i === PAD.talk) this.onTalk?.(true);
        if (i === PAD.emote && this.wantsLock) this.openWheel();
      }
      if (!on && this.padDown.has(i) && i === PAD.talk) this.onTalk?.(false);
      if (!on && this.padDown.has(i) && i === PAD.emote) this.closeWheel();
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
    if (p && useWheel.getState().open) {
      // The right stick points at a slot; it doesn't turn the camera while the wheel is up.
      const rx = dz(p.axes[2] ?? 0), ry = dz(p.axes[3] ?? 0);
      if (Math.hypot(rx, ry) > 0.5) {
        this.wx = rx * 100;
        this.wy = ry * 100;
        this.steerWheel();
      }
    } else if (p) {
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
    if (this.emoteSlot >= 0) b |= BTN.EMOTE;
    return b;
  }

  /** Called after a simulation tick has seen the latched presses. */
  consume() {
    this.emoteSlot = -1;
    this.latched.clear();
    this.padLatched.clear();
  }

  rumble(strength: number, ms: number) {
    if (!useSettings.getState().controls.vibration) return;
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect(t: string, o: object): Promise<unknown> } }) | null;
    p?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  }
}
