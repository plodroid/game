import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX } from '@chromashift/shared';
import { useNet } from '../../multiplayer/net';
import { useVoice } from '../../multiplayer/voice';
import { teamColors } from '../../rendering/palette';
import { useSettings } from '../../settings/settings';
import { say, useChat } from '../../state/chat';
import { useHud } from '../../state/ui';
import { Icon } from '../icons';
import { keyLabel } from '../kit';

const SHOW_MS = 9000;

/** Match chat: recent lines fade out; the chat key opens a box (Tab switches all and team). */
export function Chat({ me }: { me: { id: number; name: string; team: number } | null }) {
  const { lines, open, team, setOpen, setTeam } = useChat();
  const room = useNet((n) => n.room);
  const bindings = useSettings((s) => s.controls.bindings);
  const myTeam = useHud((h) => h.myTeam);
  const [text, setText] = useState('');
  const [, tick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    // Re-render as lines age out of view.
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines.length, open]);

  const colors = teamColors().map((c) => `#${c.getHexString()}`);
  const now = Date.now();
  const shown = open ? lines.slice(-12) : lines.filter((l) => now - l.at < SHOW_MS).slice(-6);

  return (
    <div className="chat" data-open={open}>
      {room && <VoicePanel colors={colors} />}
      <div className="chat__log" ref={log} aria-live="polite">
        {shown.map((l) => (
          <div key={l.key} className="chat__line" style={{ opacity: open ? 1 : Math.min(1, (SHOW_MS - (now - l.at)) / 1500) }}>
            {l.toTeam && <span className="chat__tag">Team</span>}
            <b style={{ color: colors[l.team] }}>{l.name}</b> {l.text}
          </div>
        ))}
      </div>
      {open ? (
        <form
          className="chat__box"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && me) say(text, room, me);
            setText('');
            setOpen(false);
            input.current?.blur();
          }}
        >
          <button type="button" className="chat__to" onClick={() => setTeam(!team)} style={{ color: team ? colors[myTeam] : undefined }}>
            {team ? 'Team' : 'All'}
          </button>
          <input
            ref={input}
            className="input"
            value={text}
            maxLength={CHAT_MAX}
            placeholder={`Say something to ${team ? 'your team' : 'everyone'}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                input.current?.blur();
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                setTeam(!team);
              }
            }}
            onBlur={() => setOpen(false)}
          />
        </form>
      ) : (
        <div className="chat__hint">
          <span className="key-hint">{keyLabel(bindings.chat?.[0])}</span> chat
        </div>
      )}
    </div>
  );
}

/**
 * Voice in the corner: who is talking right now, and your own mic, which only lights up while
 * your voice is actually going out (not merely because the mic is open).
 */
function VoicePanel({ colors }: { colors: string[] }) {
  const v = useVoice();
  const mode = useSettings((s) => s.audio.voiceMode);
  const talkKey = useSettings((s) => s.controls.bindings.talk?.[0]);
  const board = useHud((h) => h.board);
  if (mode === 'off') return null;
  const you = board.find((b) => b.you)?.id;
  const talking = you != null && !!v.speaking[you];
  const state = v.micMuted ? 'muted' : talking ? 'talking' : v.live ? 'live' : 'idle';
  const label =
    state === 'muted' ? (
      'Mic muted'
    ) : state === 'talking' ? (
      'Talking'
    ) : state === 'live' ? (
      mode === 'open' ? (
        'Open mic'
      ) : (
        'Mic on'
      )
    ) : (
      <>
        Hold <span className="key-hint">{keyLabel(talkKey)}</span> to talk
      </>
    );
  const others = board.filter((b) => !b.you && v.speaking[b.id]);
  return (
    <div className="vc">
      {others.map((b) => (
        <div
          key={b.id}
          className="vc__talker"
          style={{ ['--c' as string]: colors[b.team] }}
          data-muted={!!v.muted[b.id]}
        >
          {v.muted[b.id] ? <Icon.micOff size={13} /> : <Icon.mic size={13} />}
          {b.name}
        </div>
      ))}
      <div
        className="vc__me"
        data-state={state}
        aria-label={`Voice: ${state === 'idle' ? 'not talking' : state}`}
      >
        {state === 'muted' ? <Icon.micOff size={14} /> : <Icon.mic size={14} />}
        <span>{label}</span>
        {v.deafened && <span className="vc__note">deafened</span>}
        {!v.active && <span className="vc__note">connecting</span>}
      </div>
      {v.error && <div className="vc__err">{v.error}</div>}
    </div>
  );
}
