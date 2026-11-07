import { useEffect, useRef, useState } from 'react';
import { titleName } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { useAccount } from '../../auth/account';
import type { Card } from '../../auth/social';
import { social, useSocial } from '../../state/social';
import { Avatar } from '../Avatar';
import { Icon } from '../icons';
import { Button, Header } from '../kit';
import { seen } from '../PlayerCard';

type Tab = 'friends' | 'requests' | 'find' | 'messages';

const MAX_VOICE = 30;

/** Records a short voice note as compressed audio (Opus), small enough to keep with the message. */
function useRecorder(onDone: (dataUrl: string, seconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; t0: number; timer: number } | null>(null);
  const stop = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    if (r.mr.state !== 'inactive') r.mr.stop();
  };
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 20000 });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const seconds = (performance.now() - (rec.current?.t0 ?? 0)) / 1000;
        rec.current = null;
        setRecording(false);
        if (seconds < 0.6) return;
        const reader = new FileReader();
        reader.onload = () => onDone(String(reader.result), Math.min(MAX_VOICE, seconds));
        reader.readAsDataURL(new Blob(chunks, { type: mr.mimeType }));
      };
      const t0 = performance.now();
      const timer = window.setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        setSecs(s);
        if (s >= MAX_VOICE) stop();
      }, 100);
      rec.current = { mr, stream, t0, timer };
      mr.start(250);
      setSecs(0);
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };
  useEffect(() => () => stop(), []);
  return { recording, secs, start, stop };
}

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
  const [tab, setTab] = useState<Tab>(s.talking ? 'messages' : 'friends');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Card[] | null>(null);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const voice = useRecorder((url, secs) => s.talking && void social((x) => x.sendVoice(s.talking!, url, secs)));

  useEffect(() => {
    if (tab !== 'find') return;
    const t = setTimeout(() => {
      if (q.trim().length < 2) return setFound(null);
      void social((x) => x.searchPlayers(q)).then((r) => setFound(r ?? []));
    }, 300);
    return () => clearTimeout(t);
  }, [q, tab]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [s.messages.length]);
  useEffect(() => {
    if (s.talking) setTab('messages');
  }, [s.talking]);
  // Being here reads the friend requests and messages, so their badges clear.
  const toRead = s.notes
    .filter((n) => !n.read && (n.type === 'friendRequest' || n.type === 'message'))
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

  const tabs: [Tab, string, number][] = [
    ['friends', 'Friends', friends.length],
    ['requests', 'Requests', incoming.length],
    ['find', 'Find players', 0],
    ['messages', 'Messages', 0],
  ];

  return (
    <main className="screen" data-pig="teal">
      <Header title="Friends" sub="Find players, build a party of up to four, and talk between games." />
      <div className="col stagger">
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

        {tab === 'messages' && !s.talking && (
          <div className="list">
            {s.chats.length === 0 && <p className="empty">No conversations yet. Message a friend from their row.</p>}
            {s.chats.map((c) => (
              <Row key={c.id} uid={c.other} card={s.cards[c.other]}>
                <span className="muted small chat-preview">{c.last ? `${c.last.from === me ? 'You: ' : ''}${c.last.text}` : ''}</span>
                <Button onClick={() => s.talk(c.other)}>Open</Button>
              </Row>
            ))}
          </div>
        )}

        {tab === 'messages' && s.talking && (
          <section className="panel thread">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <Button variant="ghost" onClick={() => s.talk(null)}>
                <Icon.back /> All messages
              </Button>
              <span className="person__name">{s.cards[s.talking]?.displayName ?? 'Friend'}</span>
            </div>
            <div className="thread__list">
              {s.messages.length === 0 && <p className="empty">Say hi.</p>}
              {s.messages.map((m) => (
                <div key={m.id} className="bubble" data-mine={m.from === me}>
                  {m.voice ? (
                    <span className="voice">
                      <Icon.mic />
                      <audio src={m.voice} controls preload="none" />
                      <span className="small num">{Math.round(m.duration ?? 0)}s</span>
                    </span>
                  ) : (
                    m.text
                  )}
                </div>
              ))}
              <div ref={end} />
            </div>
            {s.friendships.some((f) => f.other === s.talking && f.status === 'accepted') ? (
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim() || !s.talking) return;
                  void social((x) => x.sendText(s.talking!, text));
                  setText('');
                }}
              >
                <input className="input" value={text} maxLength={500} placeholder="Message" onChange={(e) => setText(e.target.value)} aria-label="Message" />
                <Button
                  icon
                  variant={voice.recording ? 'danger' : 'default'}
                  aria-label={voice.recording ? 'Stop and send voice message' : 'Record a voice message'}
                  onClick={() => (voice.recording ? voice.stop() : void voice.start())}
                >
                  {voice.recording ? <Icon.stop /> : <Icon.mic size={18} />}
                </Button>
                {voice.recording && <span className="small num rec">{voice.secs.toFixed(0)}s / {MAX_VOICE}s</span>}
                <Button variant="primary" type="submit" icon aria-label="Send" disabled={!text.trim()}>
                  <Icon.send />
                </Button>
              </form>
            ) : (
              <p className="muted small">You can message players once you’re friends.</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
