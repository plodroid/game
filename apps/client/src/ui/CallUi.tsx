import { useEffect, useState } from 'react';
import { useAccount } from '../auth/account';
import { callActions, useCall } from '../multiplayer/call';
import { useSocial } from '../state/social';
import { useUi } from '../state/ui';
import { Avatar } from './Avatar';
import { Icon } from './icons';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Incoming-call pop-up and the call bar that follows you across every screen until you hang up. */
export function CallUi() {
  const c = useCall();
  const me = useAccount((a) => a.user?.uid);
  const cards = useSocial((s) => s.cards);
  const inMatch = useUi((u) => u.screen === 'match');
  const [, tick] = useState(0);
  useEffect(() => {
    if (!c.call) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [c.call]);

  const inc = c.incoming;
  const call = c.call;
  return (
    <>
      {inc && !call && (
        <div className="callpop" role="alertdialog" aria-label={`${inc.callerName} is calling`}>
          <span className="callpop__ring">
            <Avatar cosmetics={cards[inc.caller]?.cosmetics} name={inc.callerName} large />
          </span>
          <div className="callpop__text">
            <b>{inc.callerName}</b>
            <span className="muted small">{inc.kind === 'group' ? `Group call · ${inc.title}` : 'Incoming call…'}</span>
          </div>
          <button className="callbtn callbtn--no" aria-label="Decline" onClick={() => void callActions.decline()}>
            <Icon.hangup size={22} />
          </button>
          <button className="callbtn callbtn--yes" aria-label="Answer" onClick={() => void callActions.answer()}>
            <Icon.phone size={22} />
          </button>
        </div>
      )}
      {call && (
        <div className="calldock" data-match={inMatch} role="region" aria-label="Call">
          <div className="calldock__who">
            {call.members
              .filter((u) => call.joined.includes(u) || u === me)
              .map((u) => (
                <span key={u} className="calldock__face" data-talking={!!c.speaking[u]} title={call.names[u] ?? 'Player'}>
                  <Avatar cosmetics={cards[u]?.cosmetics} name={call.names[u] ?? '?'} />
                </span>
              ))}
          </div>
          <div className="calldock__text">
            <b>{call.kind === 'group' ? call.title : (call.members.map((u) => (u === me ? '' : call.names[u])).find(Boolean) ?? call.title)}</b>
            <span className="muted small num">{call.status === 'ringing' ? 'Calling…' : clock((Date.now() - c.startedAt) / 1000)}</span>
          </div>
          <button className="callbtn callbtn--sm" aria-pressed={c.micMuted} aria-label={c.micMuted ? 'Unmute' : 'Mute'} onClick={() => callActions.setMicMuted(!c.micMuted)}>
            {c.micMuted ? <Icon.micOff size={18} /> : <Icon.mic size={18} />}
          </button>
          <button className="callbtn callbtn--sm" aria-pressed={c.deafened} aria-label={c.deafened ? 'Undeafen' : 'Deafen'} title={c.deafened ? 'Undeafen' : 'Deafen'} onClick={() => callActions.setDeafened(!c.deafened)}>
            <span aria-hidden style={{ fontSize: 15 }}>{c.deafened ? '🔇' : '🔊'}</span>
          </button>
          <button className="callbtn callbtn--no callbtn--sm" aria-label="Hang up" onClick={() => void callActions.hangUp()}>
            <Icon.hangup size={20} />
          </button>
          {c.error && <span className="calldock__err small">{c.error}</span>}
        </div>
      )}
    </>
  );
}
