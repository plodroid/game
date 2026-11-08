import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/audio';
import { getMic } from '../audio/mic';
import { useAccount } from '../auth/account';
import { MAX_GROUP, type Convo, type Group, type Message } from '../auth/social';
import { callActions, useCall } from '../multiplayer/call';
import { useNet } from '../multiplayer/net';
import { convoKey, iAmTyping, isUnread, joinFromInvite, markConvoRead, social, useSocial } from '../state/social';
import { useUi } from '../state/ui';
import { Avatar } from './Avatar';
import { Icon } from './icons';

const MAX_VOICE = 30;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dayLabel = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
const short = (t: number) => {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Shrinks a picture to something small enough to keep inside a message (about 100 KB). */
async function compressImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  for (const [max, q] of [[960, 0.72], [800, 0.6], [640, 0.5]] as const) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < 380_000) return url;
  }
  throw new Error('That picture is too large.');
}

/** Records a short voice note as compressed audio (Opus), small enough to keep with the message. */
function useRecorder(onDone: (dataUrl: string, seconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; t0: number; timer: number } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const stop = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    if (r.mr.state !== 'inactive') r.mr.stop();
  };
  const start = async () => {
    try {
      const stream = await getMic();
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
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
        reader.onload = () => done.current(String(reader.result), Math.min(MAX_VOICE, seconds));
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
      useUi.getState().toast({ text: 'Allow the microphone to send voice messages.', kind: 'warn' });
    }
  };
  useEffect(() => () => stop(), []);
  return { recording, secs, start, stop };
}

/** A voice message: play/pause, a progress bar and "0:12 / 0:40" from the length it was recorded at. */
function VoiceNote({ src, duration }: { src: string; duration: number }) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = Math.max(1, duration || el.current?.duration || 1);
  return (
    <span className="vnote">
      <audio
        ref={el}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => setAt(Math.min(total, e.currentTarget.currentTime))}
        onEnded={() => (setPlaying(false), setAt(0))}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <button
        type="button"
        className="vnote__btn"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        onClick={() => {
          const a = el.current;
          if (!a) return;
          if (a.paused) void a.play().catch(() => undefined);
          else a.pause();
        }}
      >
        {playing ? <Icon.stop size={14} /> : <Icon.play size={14} />}
      </button>
      <span
        className="vnote__bar"
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(at)}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const a = el.current;
          if (a) a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
        }}
      >
        <span className="vnote__fill" style={{ width: `${(at / total) * 100}%` }} />
      </span>
      <span className="vnote__time num">
        {clock(at)} / {clock(total)}
      </span>
    </span>
  );
}

/** Who a conversation is with, for its title, avatar and header. */
function useConvoInfo(c: Convo | null) {
  const s = useSocial();
  const me = useAccount((a) => a.user?.uid);
  if (!c) return null;
  if (c.kind === 'dm') {
    const card = s.cards[c.other];
    return { title: card?.displayName ?? 'Friend', card, group: null as Group | null, online: !!card?.online, members: [c.other], me };
  }
  const g = s.groups.find((x) => x.id === c.id) ?? null;
  return { title: g?.name ?? 'Group', card: undefined, group: g, online: false, members: g?.members ?? [], me };
}

function GroupFace({ name }: { name: string }) {
  return <span className="avatar avatar--group">{name.slice(0, 2).toUpperCase()}</span>;
}

/** The whole chat app: conversations on the left, the open one on the right. */
export function Messenger() {
  const s = useSocial();
  const me = useAccount((a) => a.user?.uid);
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState<'chat' | 'group' | null>(null);

  const rows = useMemo(() => {
    const dm = s.chats.map((c) => ({
      key: `dm:${c.other}`,
      convo: { kind: 'dm', other: c.other } as Convo,
      title: s.cards[c.other]?.displayName ?? 'Friend',
      card: s.cards[c.other],
      group: null as Group | null,
      last: c.last,
      at: c.updatedAt,
    }));
    const gr = s.groups.map((g) => ({ key: `group:${g.id}`, convo: { kind: 'group', id: g.id } as Convo, title: g.name, card: undefined, group: g, last: g.last, at: g.updatedAt }));
    return [...dm, ...gr].sort((a, b) => b.at - a.at).filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase()));
  }, [s.chats, s.groups, s.cards, q]);

  return (
    <div className="msgr" data-open={!!s.convo}>
      <aside className="msgr__side">
        <div className="msgr__bar">
          <label className="search msgr__search">
            <Icon.search />
            <input className="input" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
          </label>
          <button className="round-btn round-btn--sm" aria-label="New chat" title="New chat" onClick={() => setPicker('chat')}>
            <Icon.chat size={18} />
          </button>
          <button className="round-btn round-btn--sm" aria-label="New group" title="New group" onClick={() => setPicker('group')}>
            <Icon.users size={18} />
          </button>
        </div>
        <div className="msgr__list">
          {rows.length === 0 && (
            <p className="empty">{q ? 'No chats match.' : 'No conversations yet. Start a chat with a friend, or make a group.'}</p>
          )}
          {rows.map((r) => {
            const unread = isUnread(r.key, r.last);
            const active = s.convo && convoKey(s.convo) === r.key;
            return (
              <button
                key={r.key}
                className="chatrow"
                data-active={!!active}
                data-unread={unread}
                onClick={() => {
                  audio.play('click');
                  if (r.convo.kind === 'dm') s.talk(r.convo.other);
                  else s.openGroup(r.convo.id);
                }}
              >
                <span className="person__avatar" data-online={!!r.card?.online}>
                  {r.group ? <GroupFace name={r.title} /> : <Avatar cosmetics={r.card?.cosmetics} name={r.title} />}
                </span>
                <span className="chatrow__main">
                  <span className="chatrow__top">
                    <span className="chatrow__name">{r.title}</span>
                    <span className="chatrow__time muted small num">{r.at ? short(r.at) : ''}</span>
                  </span>
                  <span className="chatrow__last small">{r.last ? `${r.last.from === me && !r.group ? 'You: ' : ''}${r.last.text}` : r.group ? `${r.group.members.length} members` : 'Say hi'}</span>
                </span>
                {unread && <span className="chatrow__dot" aria-label="Unread" />}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="msgr__main">{s.convo ? <Thread key={convoKey(s.convo)} convo={s.convo} /> : <EmptyThread />}</section>
      {picker && <Picker mode={picker} onClose={() => setPicker(null)} />}
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="msgr__empty">
      <Icon.chat size={42} />
      <h3>Your messages</h3>
      <p className="muted">Pick a conversation, or start a new chat or group. You can send pictures and voice messages, invite friends to a game and call them.</p>
    </div>
  );
}

/** Choose a friend to chat with, or friends and a name for a new group. */
function Picker({ mode, onClose }: { mode: 'chat' | 'group'; onClose: () => void }) {
  const s = useSocial();
  const friends = s.friendships.filter((f) => f.status === 'accepted');
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const toggle = (u: string) => setChosen((c) => (c.includes(u) ? c.filter((x) => x !== u) : c.length < MAX_GROUP - 1 ? [...c, u] : c));
  const nameOf = (u: string) => s.cards[u]?.displayName ?? 'Player';
  const create = async () => {
    if (!chosen.length) return;
    const id = await social((x) => x.createGroup(name, chosen, Object.fromEntries(chosen.map((u) => [u, nameOf(u)]))));
    if (id) s.openGroup(id);
    onClose();
  };
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal picker" role="dialog" aria-label={mode === 'chat' ? 'New chat' : 'New group'}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            {mode === 'chat' ? 'New chat' : 'New group'}
          </h2>
          <button className="note__x" aria-label="Close" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>
        {mode === 'group' && (
          <label className="field" style={{ marginTop: 12 }}>
            <span className="field__label">Group name</span>
            <input className="input" value={name} maxLength={24} placeholder="Weekend squad" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <div className="list picker__list">
          {friends.length === 0 && <p className="empty">Add some friends first, then you can chat and make groups.</p>}
          {friends.map((f) => {
            const card = s.cards[f.other];
            const on = chosen.includes(f.other);
            return (
              <button
                key={f.id}
                className="chatrow"
                data-active={mode === 'group' && on}
                onClick={() => {
                  if (mode === 'chat') {
                    s.talk(f.other);
                    onClose();
                  } else toggle(f.other);
                }}
              >
                <span className="person__avatar" data-online={!!card?.online}>
                  <Avatar cosmetics={card?.cosmetics} name={nameOf(f.other)} />
                </span>
                <span className="chatrow__main">
                  <span className="chatrow__name">{nameOf(f.other)}</span>
                  <span className="chatrow__last small">{card?.online ? 'Online' : 'Offline'}</span>
                </span>
                {mode === 'group' && <span className="picker__tick">{on && <Icon.check />}</span>}
              </button>
            );
          })}
        </div>
        {mode === 'group' && (
          <button className="btn btn--primary" disabled={!chosen.length} onClick={() => void create()}>
            Create group ({chosen.length + 1}/{MAX_GROUP})
          </button>
        )}
      </div>
    </div>
  );
}

function Thread({ convo }: { convo: Convo }) {
  const s = useSocial();
  const me = useAccount((a) => a.user?.uid) ?? '';
  const info = useConvoInfo(convo)!;
  const call = useCall();
  const net = useNet();
  const [text, setText] = useState('');
  const [info2, setInfo] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const file = useRef<HTMLInputElement>(null);
  const toast = useUi((u) => u.toast);
  const isFriend = convo.kind === 'group' || s.friendships.some((f) => f.other === convo.other && f.status === 'accepted');

  const voice = useRecorder((url, secs) => void social((x) => x.sendVoice(convo, url, secs)));

  const nameOf = (u: string) => (u === me ? 'You' : (s.cards[u]?.displayName ?? info.group?.names[u] ?? 'Someone'));

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
    if (useUi.getState().screen === 'social') markConvoRead(convo);
  }, [s.messages.length, s.typing.length, convo]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    void social((x) => x.sendText(convo, t));
    setText('');
    stick.current = true;
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast({ text: 'Pick a picture.', kind: 'warn' });
    setSending(true);
    try {
      const url = await compressImage(f);
      await social((x) => x.sendImage(convo, url));
      stick.current = true;
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : 'Couldn’t send that picture.', kind: 'error' });
    }
    setSending(false);
  };

  // Messages with the sender's name and the gaps that make a conversation readable.
  const items: ({ sep: string } | { m: Message; first: boolean; last: boolean })[] = [];
  let day = '';
  s.messages.forEach((m, i) => {
    const d = dayLabel(m.createdAt);
    if (d !== day) items.push({ sep: (day = d) });
    const prev = s.messages[i - 1];
    const next = s.messages[i + 1];
    const near = (a?: Message) => !!a && a.from === m.from && Math.abs(a.createdAt - m.createdAt) < 180_000 && dayLabel(a.createdAt) === d;
    items.push({ m, first: !near(prev), last: !near(next) });
  });

  const typers = s.typing.map((u) => (s.cards[u]?.displayName ?? info.group?.names[u] ?? 'Someone').split(' ')[0]);
  const activeCall = call.calls.find((c) => c.chat === (convo.kind === 'dm' ? [me, convo.other].sort().join('_') : convo.id) && c.status === 'active');
  const inThisCall = call.call && activeCall && call.call.id === activeCall.id;
  const code = net.lobby?.code;

  const startCall = () => {
    const others = convo.kind === 'dm' ? [convo.other] : info.members.filter((u) => u !== me);
    void callActions.start(convo, others, Object.fromEntries(others.map((u) => [u, nameOf(u)])), info.title);
  };

  return (
    <div className="thread2">
      <header className="thread2__head">
        <button className="round-btn round-btn--sm thread2__back" aria-label="All chats" onClick={() => s.closeConvo()}>
          <Icon.back size={18} />
        </button>
        <button className="thread2__who" onClick={() => (convo.kind === 'group' ? setInfo(!info2) : s.view(convo.other))}>
          <span className="person__avatar" data-online={info.online}>
            {convo.kind === 'group' ? <GroupFace name={info.title} /> : <Avatar cosmetics={info.card?.cosmetics} name={info.title} />}
          </span>
          <span style={{ minWidth: 0, textAlign: 'left' }}>
            <span className="chatrow__name" style={{ display: 'block' }}>
              {info.title}
            </span>
            <span className="muted small" style={{ display: 'block' }}>
              {typers.length ? 'typing…' : convo.kind === 'group' ? `${info.members.length} members · tap for info` : info.online ? 'Online' : 'Offline'}
            </span>
          </span>
        </button>
        <span className="thread2__actions">
          {code && isFriend && (
            <button className="round-btn round-btn--sm" title="Invite to your game" aria-label="Invite to your game" onClick={() => void social((x) => x.sendInvite(convo, code), 'Invite sent')}>
              <Icon.play size={16} />
            </button>
          )}
          {activeCall && !inThisCall ? (
            <button className="btn btn--primary btn--sm" disabled={!!call.call} onClick={() => void callActions.join(activeCall)}>
              <Icon.phone size={16} /> Join call
            </button>
          ) : (
            <button className="round-btn round-btn--sm" title="Call" aria-label="Call" disabled={!!call.call} onClick={startCall}>
              <Icon.phone size={17} />
            </button>
          )}
        </span>
      </header>

      {info2 && info.group && <GroupInfo group={info.group} onClose={() => setInfo(false)} />}

      <div
        className="thread2__list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {s.messages.length === 0 && <p className="empty">No messages yet. Say hi.</p>}
        {items.map((it, i) =>
          'sep' in it ? (
            <div key={`s${i}`} className="thread2__day">
              <span>{it.sep}</span>
            </div>
          ) : (
            <Bubble key={it.m.id} m={it.m} mine={it.m.from === me} first={it.first} last={it.last} group={convo.kind === 'group'} name={nameOf(it.m.from)} onZoom={setZoom} />
          ),
        )}
      </div>

      <div className="thread2__typing" aria-live="polite">
        {typers.length > 0 && (
          <>
            <span className="dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {typers.length === 1 ? `${typers[0]} is typing…` : typers.length === 2 ? `${typers[0]} and ${typers[1]} are typing…` : 'Several people are typing…'}
          </>
        )}
      </div>

      {isFriend ? (
        <form
          className="thread2__composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ''))} />
          {voice.recording ? (
            <>
              <span className="rec2">
                <i /> Recording {clock(voice.secs)} / {clock(MAX_VOICE)}
              </span>
              <button type="button" className="round-btn round-btn--sm" aria-label="Send voice message" onClick={() => voice.stop()}>
                <Icon.send size={17} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="round-btn round-btn--sm" aria-label="Send a picture" disabled={sending} onClick={() => file.current?.click()}>
                <Icon.image size={18} />
              </button>
              <input
                className="input"
                value={text}
                maxLength={500}
                placeholder="Message"
                onChange={(e) => {
                  setText(e.target.value);
                  if (e.target.value) iAmTyping();
                }}
                aria-label="Message"
              />
              {text.trim() ? (
                <button type="submit" className="round-btn round-btn--sm round-btn--go" aria-label="Send">
                  <Icon.send size={17} />
                </button>
              ) : (
                <button type="button" className="round-btn round-btn--sm" aria-label="Record a voice message" onClick={() => void voice.start()}>
                  <Icon.mic size={18} />
                </button>
              )}
            </>
          )}
        </form>
      ) : (
        <p className="muted small thread2__note">You can message players once you’re friends.</p>
      )}

      {zoom && (
        <div className="overlay" onPointerDown={() => setZoom(null)} style={{ zIndex: 80 }}>
          <img src={zoom} alt="Picture" className="zoomed" />
        </div>
      )}
    </div>
  );
}

function Bubble({ m, mine, first, last, group, name, onZoom }: { m: Message; mine: boolean; first: boolean; last: boolean; group: boolean; name: string; onZoom: (u: string) => void }) {
  const joined = useNet((n) => n.lobby?.code);
  return (
    <div className="msg" data-mine={mine} data-first={first} data-last={last}>
      {group && !mine && first && <span className="msg__name small">{name}</span>}
      <div className="bubble2" data-kind={m.invite ? 'invite' : m.image ? 'image' : m.voice ? 'voice' : 'text'}>
        {m.image && (
          <button className="bubble2__img" onClick={() => onZoom(m.image!)} aria-label="Open picture">
            <img src={m.image} alt="Sent picture" loading="lazy" />
          </button>
        )}
        {m.voice && <VoiceNote src={m.voice} duration={m.duration ?? 0} />}
        {m.invite && (
          <span className="invite">
            <span className="invite__icon">
              <Icon.play size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{mine ? 'You invited them to a game' : 'Game invite'}</b>
              <span className="small muted" style={{ display: 'block' }}>
                Code {m.invite}
              </span>
            </span>
            {!mine && (
              <button className="btn btn--primary btn--sm" disabled={joined === m.invite} onClick={() => void joinFromInvite(m.invite!)}>
                {joined === m.invite ? 'Joined' : 'Join'}
              </button>
            )}
          </span>
        )}
        {m.text && <span className="bubble2__text">{m.text}</span>}
      </div>
      {last && <span className="msg__time muted small num">{new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
    </div>
  );
}

function GroupInfo({ group, onClose }: { group: Group; onClose: () => void }) {
  const s = useSocial();
  const me = useAccount((a) => a.user?.uid);
  const owner = group.owner === me;
  const [name, setName] = useState(group.name);
  const addable = s.friendships.filter((f) => f.status === 'accepted' && !group.members.includes(f.other));
  return (
    <div className="ginfo">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Group info</strong>
        <button className="note__x" aria-label="Close" onClick={onClose}>
          <Icon.close size={14} />
        </button>
      </div>
      {owner && (
        <form
          className="row"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void social((x) => x.renameGroup(group, name), 'Renamed');
          }}
        >
          <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          <button className="btn" type="submit" disabled={!name.trim() || name === group.name}>
            Rename
          </button>
        </form>
      )}
      <div className="ginfo__members">
        {group.members.map((u) => (
          <span key={u} className="party__member">
            <Avatar cosmetics={s.cards[u]?.cosmetics} name={s.cards[u]?.displayName ?? group.names[u] ?? '?'} />
            <span className="small">
              {u === me ? 'You' : (s.cards[u]?.displayName ?? group.names[u] ?? 'Player')}
              {u === group.owner && <Icon.crown />}
            </span>
          </span>
        ))}
      </div>
      {owner && group.members.length < MAX_GROUP && addable.length > 0 && (
        <select
          className="select"
          value=""
          aria-label="Add a friend"
          onChange={(e) => {
            const u = e.target.value;
            if (u) void social((x) => x.addToGroup(group, u, s.cards[u]?.displayName ?? 'Player'), 'Added');
          }}
        >
          <option value="">Add a friend…</option>
          {addable.map((f) => (
            <option key={f.other} value={f.other}>
              {s.cards[f.other]?.displayName ?? 'Friend'}
            </option>
          ))}
        </select>
      )}
      <button
        className="btn btn--danger"
        style={{ marginTop: 10 }}
        onClick={() => {
          if (!window.confirm(`Leave ${group.name}?`)) return;
          void social((x) => x.leaveGroup(group), 'You left the group');
          s.closeConvo();
        }}
      >
        Leave group
      </button>
    </div>
  );
}
