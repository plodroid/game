import { create } from 'zustand';
import { InputManager } from './input';

/*
 * Split screen: two controllers, two players, one device. Browsers hide a controller until a button
 * is pressed, so the second one shows up when its owner first touches it. Once two are connected a
 * prompt offers split screen; pressing Options (Menu on an Xbox pad) on either one starts it.
 * Player 1 is the lower-numbered controller, player 2 the next. Only meant for local play.
 */

export const OPTIONS_BUTTON = 9;

interface SplitStore {
  /** Controller slots (as the browser numbers them) that are connected right now, in order. */
  pads: number[];
  /** Split screen is running. */
  on: boolean;
  /** Controller slots of player 1 and player 2 while it runs. */
  a: number;
  b: number;
  /** The Gamepad.id of player 2's controller, to pick the button names. */
  ids: Record<number, string>;
  /** A match is running with two players on this screen. */
  seated: boolean;
  /** The player closed the prompt: Options keeps its usual job (pause) until the controllers change. */
  declined: boolean;
}

export const useSplit = create<SplitStore>()(() => ({ pads: [], on: false, a: -1, b: -1, ids: {}, seated: false, declined: false }));

/** Player 2's controls: only a controller (the keyboard and mouse stay with player 1). */
export const input2 = new InputManager();
input2.touchOK = false;

/** Set by the session: can split screen start right now? (Not in online matches.) */
let allowed: () => boolean = () => true;
export const setSplitAllowed = (f: () => boolean) => (allowed = f);

/** Called when split screen starts or stops. */
export const splitHooks: { start: (() => void) | null; stop: (() => void) | null } = { start: null, stop: null };

const connected = (): Gamepad[] => [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);

/** True when two controllers are connected and split screen could start. */
export const useSplitReady = () => useSplit((s) => s.pads.length >= 2 && !s.on && !s.declined && allowed());
export const declineSplit = () => useSplit.setState({ declined: true });

/** True while Options is held on a controller and that press would start split screen (so it must not also pause). */
export function optionsStartsSplit() {
  const s = useSplit.getState();
  if (s.on || s.declined || s.pads.length < 2 || !allowed()) return false;
  return connected().some((p) => !!p.buttons[OPTIONS_BUTTON]?.pressed);
}

export function startSplit() {
  const s = useSplit.getState();
  if (s.on || s.pads.length < 2) return;
  const [a, b] = s.pads;
  input2.padIndex = b;
  engineInputPad(a);
  splitAt.t = performance.now();
  useSplit.setState({ on: true, a, b });
  splitHooks.start?.();
}

export function stopSplit() {
  if (!useSplit.getState().on) return;
  input2.padIndex = -1;
  engineInputPad(-1);
  useSplit.setState({ on: false, a: -1, b: -1 });
  splitHooks.stop?.();
}

let primary: InputManager | null = null;
/** The main input manager registers itself so player 1 can be tied to its own controller. */
export function registerPrimary(m: InputManager) {
  primary = m;
}
const engineInputPad = (i: number) => {
  if (primary) primary.padIndex = i;
};

/** When split screen last started, so the same Options press doesn't also pause the match. */
export const splitAt = { t: 0 };

if (typeof window !== 'undefined') {
  let wasDown = false;
  setInterval(() => {
    const list = connected();
    const pads = list.map((p) => p.index);
    const cur = useSplit.getState();
    const same = pads.length === cur.pads.length && pads.every((p, i) => p === cur.pads[i]);
    if (!same) useSplit.setState({ pads, declined: false, ids: Object.fromEntries(list.map((p) => [p.index, p.id])) });
    // Losing either controller ends split screen.
    if (cur.on && (!pads.includes(cur.a) || !pads.includes(cur.b))) stopSplit();
    // A fresh Options press on either controller starts it.
    const down = list.some((p) => !!p.buttons[OPTIONS_BUTTON]?.pressed);
    if (down && !wasDown && pads.length >= 2 && !useSplit.getState().on && !useSplit.getState().declined && allowed()) {
      splitAt.t = performance.now();
      startSplit();
    }
    wasDown = down;
  }, 60);
}
