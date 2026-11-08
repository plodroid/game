import { useEffect, useState } from 'react';
import { titleName } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { useAccount } from '../../auth/account';
import type { Card } from '../../auth/social';
import { isUnread, joinFromInvite, social, useSocial } from '../../state/social';
import { Avatar } from '../Avatar';
import { Icon } from '../icons';
import { Button, Header } from '../kit';
import { Messenger } from '../Messenger';
import { seen } from '../PlayerCard';

type Tab = 'friends' | 'requests' | 'find' | 'messages';

function Row({ card, uid, children }: { card?: Card; uid: string; children?: React.ReactNode }) {
  const view = useSocial((s) => s.view);
  const name = card?.displayName ?? 'Player';
  const title = card ? titleName(card.cosmetics.title) : '';
  return (
    <div className="person">
      <button className="person__who" onClick={() => (audio.play('click'), view(uid))}>
        <span className="person__avatar" data-online={!!card?.online}>
          <Avatar cosmetics={card?.cosmetics} name={name} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="person__name">{name}</span>
          <span className="muted small person__meta">
            {title ? `${title} · ` : ''}Lv {card?.level ?? 1} · {seen(card)}
            {card?.createdAt ? ` · joined ${new Date(card.createdAt).toLocaleDateString()}` : ''}
          </span>
        </span>
      </button>
      <span className="person__actions">{children}</span>
    </div>
  );
}

export default function Social() {
  const s = useSocial();
  const me = useAccount((a) => a.user?.uid);
  const [tab, setTab] = useState<Tab>(s.convo ? 'messages' : 'friends');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Card[] | null>(null);

  useEffect(() => {
    if (tab !== 'find') return;
    const t = setTimeout(() => {
      if (q.trim().length < 2) return setFound(null);
      void social((x) => x.searchPlayers(q)).then((r) => setFound(r ?? []));
    }, 300);
    return () => clearTimeout(t);
  }, [q, tab]);
  useEffect(() => {
    if (s.convo) setTab('messages');
  }, [s.convo]);
  // Being here reads the friend requests, so their badge clears. (Messages are read per conversation.)
  const toRead = s.notes
    .filter((n) => !n.read && (n.type === 'friendRequest' || (tab === 'messages' && (n.type === 'message' || n.type === 'groupMessage'))))
    .map((n) => n.id)
    .join(',');
  useEffect(() => {
    if (toRead) void social((x) => x.markAllRead(toRead.split(',')));
  }, [toRead]);

  const friends = s.friendships.filter((f) => f.status === 'accepted').sort((a, b) => Number(!!s.cards[b.other]?.online) - Number(!!s.cards[a.other]?.online));
  const incoming = s.friendships.filter((f) => f.status === 'pending' && f.requester !== me);
  const outgoing = s.friendships.filter((f) => f.status === 'pending' && f.requester === me);
  const party = s.party;
  const isLeader = party?.leader === me;
  const invite = (uid: string) => void social((x) => x.inviteToParty(uid), 'Party invite sent. It lasts 5 minutes.');
  const canInvite = (uid: string) => !party?.members.includes(uid) && (party?.invites[uid] ?? 0) < Date.now() && (!party || isLeader);
  const unreadChats =
    s.chats.filter((c) => isUnread(`dm:${c.other}`, c.last)).length + s.groups.filter((g) => isUnread(`group:${g.id}`, g.last)).length;

  const tabs: [Tab, string, number][] = [
    ['friends', 'Friends', friends.length],
    ['requests', 'Requests', incoming.length],
    ['find', 'Find players', 0],
    ['messages', 'Chats', unreadChats],
  ];
  const chat = tab === 'messages';

  return (
    <main className={`screen ${chat ? 'screen--chat' : ''}`} data-pig="teal" data-convo={!!s.convo}>
      <Header title={chat ? 'Chats' : 'Friends'} sub={chat ? undefined : 'Find players, build a party of up to four, and talk between games.'} />
      <div className={chat ? 'chatwrap' : 'col stagger'}>
        {!chat && (
          <section className="panel party">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 className="panel__title" style={{ margin: 0 }}>
                <Icon.party /> {party ? (isLeader ? 'Your party' : `${party.names[party.leader] ?? 'A'}’s party`) : 'Party'}
              </h2>
              {party && (
                <Button variant="ghost" onClick={() => void social((x) => x.leaveParty(party), isLeader ? 'Party closed' : 'You left the party')}>
                  {isLeader ? 'Close party' : 'Leave'}
                </Button>
              )}
            </div>
            {!party ? (
              <p className="muted small" style={{ margin: '10px 0 0' }}>
                Invite a friend to start one. When the leader hosts a game, the whole party joins it.
              </p>
            ) : (
              <div className="party__members">
                {party.members.map((u) => (
                  <span key={u} className="party__member">
                    <Avatar cosmetics={s.cards[u]?.cosmetics} name={party.names[u] ?? '?'} />
                    <span className="small">
                      {party.names[u] ?? 'Player'}
                      {u === party.leader && <Icon.crown />}
                    </span>
                    {isLeader && u !== me && (
                      <button className="note__x" aria-label={`Remove ${party.names[u]}`} onClick={() => void social((x) => x.kickFromParty(u))}>
                        <Icon.close size={12} />
                      </button>
                    )}
                  </span>
                ))}
                {Object.entries(party.invites)
                  .filter(([, t]) => t > Date.now())
                  .map(([u]) => (
                    <span key={u} className="party__member party__member--invited">
                      <Avatar cosmetics={s.cards[u]?.cosmetics} name="?" />
                      <span className="small muted">Invited</span>
                    </span>
                  ))}
              </div>
            )}
          </section>
        )}

        <div className="tabs" role="tablist">
          {tabs.map(([id, label, n]) => (
            <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => (audio.play('click'), setTab(id))}>
              {label}
              {n > 0 && <span className="count count--inline">{n}</span>}
            </button>
          ))}
        </div>

        {tab === 'friends' && (
          <div className="list">
            {friends.length === 0 && <p className="empty">No friends yet. Find players by username to add them.</p>}
            {friends.map((f) => (
              <Row key={f.id} uid={f.other} card={s.cards[f.other]}>
                {s.joinable[f.other] && (
                  <Button variant="primary" aria-label={`Join ${s.cards[f.other]?.displayName ?? 'their'} game`} onClick={() => void joinFromInvite(s.joinable[f.other])}>
                    <Icon.play size={14} /> Join
                  </Button>
                )}
                <Button icon aria-label="Message" onClick={() => s.talk(f.other)}>
                  <Icon.chat />
                </Button>
                {canInvite(f.other) && (
                  <Button icon aria-label="Invite to party" onClick={() => invite(f.other)}>
                    <Icon.party />
                  </Button>
                )}
              </Row>
            ))}
          </div>
        )}

        {tab === 'requests' && (
          <div className="list">
            {incoming.length + outgoing.length === 0 && <p className="empty">No requests waiting.</p>}
            {incoming.map((f) => (
              <Row key={f.id} uid={f.other} card={s.cards[f.other]}>
                <Button variant="primary" onClick={() => void social((x) => x.acceptFriend(f), 'Friend added')}>
                  Accept
                </Button>
                <Button variant="ghost" onClick={() => void social((x) => x.removeFriend(f))}>
                  Decline
                </Button>
              </Row>
            ))}
            {outgoing.map((f) => (
              <Row key={f.id} uid={f.other} card={s.cards[f.other]}>
                <span className="muted small">Sent</span>
                <Button variant="ghost" onClick={() => void social((x) => x.removeFriend(f))}>
                  Cancel
                </Button>
              </Row>
            ))}
          </div>
        )}

        {tab === 'find' && (
          <>
            <label className="search" style={{ marginBottom: 12 }}>
              <Icon.search />
              <input className="input" placeholder="Search by username" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search players by username" />
            </label>
            <div className="list">
              {found === null && <p className="empty">Type at least two letters of a username.</p>}
              {found?.length === 0 && <p className="empty">No players found.</p>}
              {found?.map((c) => {
                const f = s.friendships.find((x) => x.other === c.uid);
                return (
                  <Row key={c.uid} uid={c.uid} card={s.cards[c.uid] ?? c}>
                    {!f ? (
                      <Button variant="primary" onClick={() => void social((x) => x.addFriend(c.uid), `Friend request sent to ${c.displayName}`)}>
                        <Icon.plus /> Add
                      </Button>
                    ) : (
                      <span className="muted small">{f.status === 'accepted' ? 'Friends' : 'Pending'}</span>
                    )}
                    {canInvite(c.uid) && (
                      <Button icon aria-label="Invite to party" onClick={() => invite(c.uid)}>
                        <Icon.party />
                      </Button>
                    )}
                  </Row>
                );
              })}
            </div>
          </>
        )}

        {chat && <Messenger />}
      </div>
    </main>
  );
}
