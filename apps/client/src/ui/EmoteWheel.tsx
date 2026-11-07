import { useRef, type ReactNode } from 'react';
import { itemsFor, splitEmote, WHEEL } from '@chromashift/shared';
import { engine } from '../game/engine';
import { useWheel } from '../game/input';
import { useProfile } from '../state/profile';

const ICON: Record<string, string> = {
  wave: '👋', spin: '🌀', flex: '💪', clap: '👏', bow: '🙇', jump: '🐇', point: '👉', dance: '🕺', salute: '🫡', cheer: '🙌',
  think: '🤔', sway: '🎶', robot: '🤖', laugh: '😂', sit: '🪑', backflip: '🤸', shrug: '🤷', facepalm: '🤦', kick: '🦵',
  stretch: '🧘', yawn: '🥱', kneel: '🧎', heart: '🫶', boxing: '🥊', guitar: '🎸', drums: '🥁', conduct: '🎼', chicken: '🐔',
  disco: '🪩', twist: '🌪️',
};
const NAME = new Map(itemsFor('emote').map((i) => [i.id, i.name]));

export const emoteIcon = (id: string) => ICON[splitEmote(id)[0]] ?? '✨';
export const emoteName = (id: string) => NAME.get(id) ?? '';

/** A donut slice of 1/WHEEL of the ring, centred on the top. */
const R1 = 64, R2 = 170, HALF = Math.PI / WHEEL;
const arc = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
const SLICE = `M${arc(R1, -HALF)} L${arc(R2, -HALF)} A${R2} ${R2} 0 0 1 ${arc(R2, HALF)} L${arc(R1, HALF)} A${R1} ${R1} 0 0 0 ${arc(R1, -HALF)}Z`;

/**
 * Eight emotes on a ring. The highlight is one slice that swings round to the picked slot.
 * Used in matches (hold to open, point, release) and in the locker (pick a slot to fill).
 */
export function EmoteRing({
  emotes,
  pick,
  onHover,
  onPick,
  hub,
  edit,
}: {
  emotes: string[];
  pick: number;
  onHover?: (i: number) => void;
  onPick?: (i: number) => void;
  hub: ReactNode;
  edit?: boolean;
}) {
  // Swing the highlight the short way round (7 to 0 is one step, not seven back).
  const turn = useRef(0);
  if (pick >= 0) turn.current += ((((pick * 360) / WHEEL - turn.current) % 360) + 540) % 360 - 180;
  return (
    <div className="wheel" data-edit={!!edit} data-picked={pick >= 0}>
      <svg className="wheel__disc" viewBox="-180 -180 360 360" aria-hidden>
        <circle r={(R1 + R2) / 2} fill="none" stroke="currentColor" strokeWidth={R2 - R1} />
        {Array.from({ length: WHEEL }, (_, i) => (
          <line key={i} x1="0" y1={-R1} x2="0" y2={-R2} transform={`rotate(${(i + 0.5) * (360 / WHEEL)})`} />
        ))}
        <path className="wheel__hl" d={SLICE} style={{ transform: `rotate(${turn.current}deg)` }} />
      </svg>
      {Array.from({ length: WHEEL }, (_, i) => {
        const id = emotes[i] ?? '';
        const a = (i / WHEEL) * Math.PI * 2;
        return (
          <button
            key={i}
            type="button"
            className="wheel__slot"
            data-on={i === pick}
            data-empty={!id}
            aria-label={id ? `Slot ${i + 1}: ${emoteName(id)}` : `Slot ${i + 1}: empty`}
            aria-pressed={i === pick}
            style={{ left: `${50 + Math.sin(a) * 32.5}%`, top: `${50 - Math.cos(a) * 32.5}%`, animationDelay: `${i * 18}ms` }}
            onPointerEnter={() => onHover?.(i)}
            onClick={() => onPick?.(i)}
          >
            <span className="wheel__icon">{id ? emoteIcon(id) : edit ? '+' : ''}</span>
            {edit && id && <span className="wheel__label">{emoteName(id)}</span>}
          </button>
        );
      })}
      <div className="wheel__hub">{hub}</div>
    </div>
  );
}

/** The in-match wheel: open while the emote button is held. */
export function GameEmoteWheel() {
  const { open, pick } = useWheel();
  const emotes = useProfile((p) => p.cosmetics.emotes ?? [p.cosmetics.emote]);
  if (!open) return null;
  const id = pick >= 0 ? emotes[pick] : '';
  return (
    <div className="wheel-layer" onPointerDown={(e) => e.target === e.currentTarget && engine.input.closeWheel(false)}>
      <EmoteRing
        emotes={emotes}
        pick={pick}
        onHover={(i) => engine.input.hoverWheel(i)}
        onPick={(i) => {
          engine.input.playEmote(i);
          engine.input.closeWheel(false);
        }}
        hub={
          id ? (
            <>
              <span className="wheel__big">{emoteIcon(id)}</span>
              <b>{emoteName(id)}</b>
            </>
          ) : (
            <span className="wheel__hint">{pick >= 0 ? 'Empty slot' : 'Point at an emote'}</span>
          )
        }
      />
    </div>
  );
}
