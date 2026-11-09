import { useEffect } from 'react';
import { audio } from '../audio/audio';
import '../game/devices';
import { useUi } from '../state/ui';
import { useSplit } from '../game/split';

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** D-pad / stick moves focus through the menus, A activates, B goes back. */
export function useMenuGamepad(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const prev = new Set<number>();
    let repeatAt = 0;
    const move = (dir: 1 | -1) => {
      const els = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null);
      if (!els.length) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      const next = els[(i + dir + els.length) % els.length] ?? els[0];
      next.focus();
      audio.play('hover');
    };
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // In split screen this menu belongs to player 1's controller; player 2 has their own panel.
      const sp = useSplit.getState();
      const all = navigator.getGamepads?.() ?? [];
      const pad = sp.on ? all[sp.a] : [...all].find((p) => p?.connected);
      if (!pad || !pad.connected) return;
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => pressed(i) && !prev.has(i);
      const ax = pad.axes[0] ?? 0,
        ay = pad.axes[1] ?? 0;
      // Down/right step forward through the menu, up/left back (grids like the locker read in rows).
      const down = pressed(13) || ay > 0.6,
        up = pressed(12) || ay < -0.6;
      const right = pressed(15) || ax > 0.6,
        left = pressed(14) || ax < -0.6;
      const fwd = down || right,
        bwd = up || left;
      if ((fwd || bwd) && t > repeatAt) {
        move(fwd ? 1 : -1);
        repeatAt = t + (prev.has(fwd ? 13 : 12) ? 140 : 260);
      }
      if (!fwd && !bwd) repeatAt = 0;
      if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
      if (edge(1) && useUi.getState().screen !== 'home') useUi.getState().back();
      prev.clear();
      pad.buttons.forEach((b, i) => b.pressed && prev.add(i));
      if (fwd) prev.add(13);
      if (bwd) prev.add(12);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
