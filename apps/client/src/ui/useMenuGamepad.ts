import { useEffect } from 'react';
import { audio } from '../audio/audio';
import { useUi } from '../state/ui';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

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
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
      if (!pad) return;
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => pressed(i) && !prev.has(i);
      const ay = pad.axes[1] ?? 0;
      const down = pressed(13) || ay > 0.6, up = pressed(12) || ay < -0.6;
      if ((down || up) && t > repeatAt) {
        move(down ? 1 : -1);
        repeatAt = t + (prev.has(down ? 13 : 12) ? 140 : 260);
      }
      if (!down && !up) repeatAt = 0;
      if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
      if (edge(1) && useUi.getState().screen !== 'home') useUi.getState().back();
      prev.clear();
      pad.buttons.forEach((b, i) => b.pressed && prev.add(i));
      if (down) prev.add(13);
      if (up) prev.add(12);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
