import { create } from 'zustand';
import { useSettings } from '../settings/settings';
import { useUi } from '../state/ui';

/*
 * Which kind of device the player is using right now, and which controller it is. Browsers only
 * reveal a controller once a button is pressed (on a PC and on a phone alike), so the first press
 * announces it and the on-screen prompts switch to controller buttons.
 */

export type PadStyle = 'xbox' | 'playstation';
export type DeviceKind = 'keyboard' | 'touch' | 'pad';

/** Xbox-family controllers say so; anything else (including a pad we can't identify) shows PlayStation buttons. */
export function padStyle(p: Gamepad | null | undefined): PadStyle {
  const id = p?.id ?? '';
  if (/xbox|xinput|microsoft|045e|x-box/i.test(id)) return 'xbox';
  return 'playstation';
}

/** What each standard-layout button is called on each kind of controller. */
export const PAD_BUTTON: Record<PadStyle, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'PS'],
};

interface DeviceStore {
  last: DeviceKind;
  /** The connected controller's kind, or null when none is connected. */
  pad: PadStyle | null;
  padName: string;
}

const connected = () => [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected) ?? null;

export const useDevice = create<DeviceStore>()(() => {
  const p = typeof navigator === 'undefined' ? null : connected();
  return { last: 'keyboard', pad: p ? padStyle(p) : null, padName: p?.id ?? '' };
});

/** The button names to show: the player's choice, else the connected controller's kind (PlayStation by default). */
export function useButtonStyle(): PadStyle {
  const pick = useSettings((s) => s.controls.padStyle);
  const pad = useDevice((d) => d.pad);
  return pick !== 'auto' ? pick : (pad ?? 'playstation');
}

const set = (last: DeviceKind) => useDevice.getState().last !== last && useDevice.setState({ last });

if (typeof window !== 'undefined') {
  addEventListener('keydown', () => set('keyboard'), true);
  addEventListener('mousedown', (e) => (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents || set('keyboard'), true);
  addEventListener('pointerdown', (e) => set(e.pointerType === 'touch' ? 'touch' : 'keyboard'), true);
  addEventListener('gamepadconnected', (e) => {
    const style = padStyle(e.gamepad);
    useDevice.setState({ pad: style, padName: e.gamepad.id, last: 'pad' });
    useUi.getState().toast({ text: `${style === 'playstation' ? 'PlayStation-style controller' : 'Xbox controller'} detected. Buttons are shown for it.`, kind: 'success' });
  });
  addEventListener('gamepaddisconnected', () => {
    const p = connected();
    useDevice.setState({ pad: p ? padStyle(p) : null, padName: p?.id ?? '', ...(p ? {} : { last: 'keyboard' as DeviceKind }) });
  });
  // A button press on a controller marks it as the device in use (the pad may already be known).
  let seen = 0;
  setInterval(() => {
    const p = connected();
    if (!p) return;
    const sum = p.buttons.reduce((n, b) => n + (b.pressed ? 1 : 0), 0) + (p.axes.some((a) => Math.abs(a) > 0.5) ? 1 : 0);
    if (sum > 0 && sum !== seen) {
      if (useDevice.getState().pad === null) useDevice.setState({ pad: padStyle(p), padName: p.id });
      set('pad');
    }
    seen = sum;
  }, 120);
}
