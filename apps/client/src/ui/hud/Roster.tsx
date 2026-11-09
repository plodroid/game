import { PAD_BUTTON, useButtonStyle, useDevice } from '../../game/devices';
import { useVoice } from '../../multiplayer/voice';
import { teamColors } from '../../rendering/palette';
import { useSettings } from '../../settings/settings';
import { useHud } from '../../state/ui';
import { Avatar } from '../Avatar';
import { Icon } from '../icons';
import { keyLabel } from '../kit';

/**
 * Who is in the match, in the corner like a lobby overlay: everyone on your team with their picture
 * and name, lit up while they talk. Rivals appear only while they're speaking.
 */
export function Roster() {
  const board = useHud((h) => h.board);
  const myTeam = useHud((h) => h.myTeam);
  const speaking = useVoice((v) => v.speaking);
  const muted = useVoice((v) => v.muted);
  const colors = teamColors().map((c) => `#${c.getHexString()}`);
  const peers = useVoice((v) => v.peers);
  const active = useVoice((v) => v.active);
  // Everyone in the server who can talk: real players on voice, never bots, whatever their team.
  const rows = board
    .filter((b) => !b.bot && (b.you ? active : peers.includes(b.id)))
    .sort((a, b) => Number(b.you) - Number(a.you) || Number(myTeam === b.team) - Number(myTeam === a.team) || a.team - b.team || a.id - b.id)
    .slice(0, 8);
  if (!rows.length) return null;
  return (
    <div className="roster" aria-label="Players">
      {rows.map((b) => (
        <div key={b.id} className="roster__row" data-talking={!!speaking[b.id] && !muted[b.id]} data-dead={!b.alive} style={{ ['--c' as string]: colors[b.team] }}>
          <Avatar cosmetics={b.cosmetics} team={b.team} name={b.name} bot={b.bot} />
          <span className="roster__name">{b.name}</span>
          {speaking[b.id] && !muted[b.id] && (
            <span className="roster__mic" aria-label="Talking">
              <Icon.mic size={14} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** While you're out: who you're watching and how to switch. */
export function Spectate() {
  const s = useHud((h) => h.spectating);
  const alive = useHud((h) => h.alive);
  const phase = useHud((h) => h.phase);
  const b = useSettings((x) => x.controls.bindings);
  const pads = useSettings((x) => x.controls.padBindings);
  const style = useButtonStyle();
  const device = useDevice((d) => d.last);
  if (alive || !s || phase !== 'playing') return null;
  const name = (code: string[] | undefined, pad: number | null | undefined, touch: string) =>
    device === 'pad' ? (pad === null || pad === undefined ? '?' : PAD_BUTTON[style][pad]) : device === 'touch' ? touch : keyLabel(code?.[0]);
  return (
    <div className="spectate" role="status" aria-live="polite">
      <span className="muted small">{s.killer ? 'Splatted by' : 'Watching'}</span>
      <b>{s.name}</b>
      <span className="spectate__keys">
        <span className="key-hint">{name(b.fire, pads.fire, 'FIRE')}</span> next
        <span className="key-hint">{name(b.jump, pads.jump, 'JUMP')}</span> previous
      </span>
    </div>
  );
}
