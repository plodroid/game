import { useMemo } from 'react';
import type { Cosmetics } from '@chromashift/shared';
import { portrait } from '../characters/portrait';
import { Icon } from './icons';

/** Circular character portrait with a team-coloured ring. Falls back to an initial or bot icon. */
export function Avatar({ cosmetics, team = 0, name, bot, large }: { cosmetics?: Cosmetics; team?: number; name: string; bot?: boolean; large?: boolean }) {
  const t = (team ? 1 : 0) as 0 | 1;
  const url = useMemo(() => (cosmetics && !bot ? portrait(cosmetics, t) : null), [cosmetics, t, bot]);
  return (
    <span className={`avatar ${large ? 'avatar--lg' : ''}`} style={{ ['--ring' as string]: t ? 'var(--team-b)' : 'var(--team-a)' }}>
      {url ? <img src={url} alt="" draggable={false} /> : bot ? <Icon.bot /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}
