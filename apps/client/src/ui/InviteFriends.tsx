import { useState } from 'react';
import { social, useSocial } from '../state/social';
import { Avatar } from './Avatar';
import { Icon } from './icons';

/** Invite friends and groups to the game you're in: they get a chat message with a Join button. */
export function InviteFriends({ code, onClose }: { code: string; onClose: () => void }) {
  const s = useSocial();
  const [sent, setSent] = useState<string[]>([]);
  const friends = s.friendships
    .filter((f) => f.status === 'accepted')
    .sort((a, b) => Number(!!s.cards[b.other]?.online) - Number(!!s.cards[a.other]?.online));
  const invite = async (key: string, c: { kind: 'dm'; other: string } | { kind: 'group'; id: string }) => {
    setSent((x) => [...x, key]);
    await social((x) => x.sendInvite(c, code));
  };
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal invite-friends" role="dialog" aria-label="Invite friends">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            Invite friends
          </h2>
          <button className="note__x" aria-label="Close" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          They get a message with a Join button for code <b className="num">{code}</b>.
        </p>
        <div className="list picker__list">
          {friends.length === 0 && s.groups.length === 0 && <p className="empty">Add friends first, then invite them here.</p>}
          {s.groups.map((g) => (
            <div key={g.id} className="chatrow">
              <span className="avatar avatar--group">{g.name.slice(0, 2).toUpperCase()}</span>
              <span className="chatrow__main">
                <span className="chatrow__name">{g.name}</span>
                <span className="chatrow__last small">Group · {g.members.length} members</span>
              </span>
              <button className="btn btn--sm btn--primary" disabled={sent.includes(g.id)} onClick={() => void invite(g.id, { kind: 'group', id: g.id })}>
                {sent.includes(g.id) ? 'Sent' : 'Invite'}
              </button>
            </div>
          ))}
          {friends.map((f) => {
            const card = s.cards[f.other];
            return (
              <div key={f.id} className="chatrow">
                <span className="person__avatar" data-online={!!card?.online}>
                  <Avatar cosmetics={card?.cosmetics} name={card?.displayName ?? '?'} />
                </span>
                <span className="chatrow__main">
                  <span className="chatrow__name">{card?.displayName ?? 'Friend'}</span>
                  <span className="chatrow__last small">{card?.online ? 'Online' : 'Offline'}</span>
                </span>
                <button className="btn btn--sm btn--primary" disabled={sent.includes(f.other)} onClick={() => void invite(f.other, { kind: 'dm', other: f.other })}>
                  {sent.includes(f.other) ? 'Sent' : 'Invite'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
