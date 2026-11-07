import { useEffect, useRef, useState } from 'react';
import { audio } from '../audio/audio';
import { useAccount } from '../auth/account';
import { isOwner } from '../auth/admin';
import type { Note } from '../auth/social';
import { acceptInvite, social, useSocial } from '../state/social';
import { useUi } from '../state/ui';
import { AdminAccounts } from './AdminAccounts';
import { Avatar } from './Avatar';
import { Icon } from './icons';

const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

const left = (t: number) => {
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Party, friends and notifications, in the top corner of every menu. */
export function SocialBar() {
  const s = useSocial();
  const go = useUi((u) => u.go);
  const me = useAccount((a) => a.user?.uid);
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [, tick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  /** Notes that were new when the panel opened keep their highlight while it stays open. */
  const fresh = useRef(new Set<string>());
  const unreadIds = s.notes.filter((n) => !n.read).map((n) => n.id);
  const unreadKey = unreadIds.join(',');
  // Opening the bell reads everything in it, including what arrives while it's open.
  useEffect(() => {
    if (!open || !unreadKey) return;
    const ids = unreadKey.split(',');
    ids.forEach((id) => fresh.current.add(id));
    void social((x) => x.markAllRead(ids));
  }, [open, unreadKey]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener('pointerdown', close);
    return () => {
      clearInterval(t);
      removeEventListener('pointerdown', close);
    };
  }, [open]);
  if (!s.ready) return null;

  const unread = unreadIds.length;
  const online = s.friendships.filter((f) => f.status === 'accepted' && s.cards[f.other]?.online).length;
  // The friends button only pings for what needs you there: new requests and messages.
  const attention = s.notes.filter(
    (n) => !n.read && (n.type === 'friendRequest' || n.type === 'message'),
  ).length;
  const party = s.party;

  const act = (n: Note) => {
    void social((x) => x.markRead(n.id));
    setOpen(false);
    if (n.type === 'partyInvite') void acceptInvite(n);
    else if (n.type === 'message') {
      s.talk(n.from);
      go('social');
    } else if (n.type === 'friendRequest') go('social');
    else s.view(n.from);
  };

  return (
    <div className="social-bar" ref={ref}>
      {party && party.members.length > 1 && (
        <button className="party-chip" onClick={() => (audio.play('click'), go('social'))} aria-label={`Party of ${party.members.length}`}>
          {party.members.map((u) => (
            <Avatar key={u} cosmetics={s.cards[u]?.cosmetics} name={party.names[u] ?? '?'} />
          ))}
          <span className="small">{party.leader === me ? 'Your party' : `${party.names[party.leader] ?? 'Party'}’s party`}</span>
        </button>
      )}
      <button
        className="round-btn"
        onClick={() => (audio.play('click'), go('social'))}
        aria-label={`Friends, ${online} online${attention ? `, ${attention} new` : ''}`}
        title={online ? `${online} friend${online === 1 ? '' : 's'} online` : 'Friends'}
      >
        <Icon.users />
        {online > 0 && <span className="presence-dot" />}
        {attention > 0 && <span className="count">{attention > 9 ? '9+' : attention}</span>}
      </button>
      <button
        className="round-btn"
        aria-expanded={open}
        onClick={() => {
          audio.play('click');
          if (!open) fresh.current = new Set();
          setOpen(!open);
        }}
        aria-label={`Notifications, ${unread} unread`}
      >
        <Icon.bell />
        {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {me && isOwner() && (
        <button className="round-btn" onClick={() => (audio.play('click'), setAdmin(true))} aria-label="All accounts" title="All accounts (owner)">
          <Icon.crown />
        </button>
      )}
      {admin && <AdminAccounts onClose={() => setAdmin(false)} />}
      {open && (
        <div className="notes" role="dialog" aria-label="Notifications">
          <div className="notes__head">
            <span className="panel__title" style={{ margin: 0 }}>
              Notifications
            </span>
            {s.notes.length > 0 && (
              <button className="link" onClick={() => s.notes.forEach((n) => void social((x) => x.clearNote(n.id)))}>
                Clear all
              </button>
            )}
          </div>
          {s.notes.length === 0 && <p className="muted small" style={{ padding: '8px 4px' }}>Nothing yet. Friend requests, party invites and messages show up here.</p>}
          {s.notes.map((n) => {
            const expired = n.type === 'partyInvite' && (n.expiresAt ?? 0) < Date.now();
            return (
              <div
                key={n.id}
                className="note"
                data-read={n.read && !fresh.current.has(n.id)}
                data-type={n.type}
              >
                <Avatar cosmetics={s.cards[n.from]?.cosmetics} name={n.fromName} />
                <button className="note__body" onClick={() => !expired && act(n)} disabled={expired}>
                  <span>
                    <b>{n.fromName}</b>{' '}
                    {n.type === 'friendRequest'
                      ? 'wants to be friends'
                      : n.type === 'friendAccepted'
                        ? 'accepted your friend request'
                        : n.type === 'partyInvite'
                          ? expired
                            ? 'invited you to a party (expired)'
                            : 'invited you to their party'
                          : `: ${n.text ?? 'sent a message'}`}
                  </span>
                  <span className="muted small num">
                    {n.type === 'partyInvite' && !expired ? `Expires in ${left(n.expiresAt ?? 0)}` : ago(n.createdAt)}
                  </span>
                </button>
                <button className="note__x" aria-label="Dismiss" onClick={() => void social((x) => x.clearNote(n.id))}>
                  <Icon.close size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
