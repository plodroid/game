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
  const live = useVoice((v) => v.live);
  const active = useVoice((v) => v.active);
  const voiceErr = useVoice((v) => v.error);
  const bindings = useSettings((s) => s.controls.bindings);
  const mode = useSettings((s) => s.audio.voiceMode);
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
          {room && mode !== 'off' && (
            <span className="voice-hint" data-live={live} title={voiceErr ?? undefined}>
              {live ? <Icon.mic size={14} /> : <Icon.micOff size={14} />}
              {mode === 'ptt' ? (
                <>
                  hold <span className="key-hint">{keyLabel(bindings.talk?.[0])}</span> to talk
                </>
              ) : (
                'open mic'
              )}
              {!active && ' (connecting)'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
