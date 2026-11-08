import { create } from 'zustand';
import { accounts, describeAuthError, useAccount } from '../auth/account';
import type { Card, Chat, Convo, Friendship, Group, Message, Note, Party } from '../auth/social';
import { audio } from '../audio/audio';
import { useWorld } from '../game/world';
import { onCalls, resetCalls } from '../multiplayer/call';
import { joinGame, useNet } from '../multiplayer/net';
import { useSettings } from '../settings/settings';
import { useUi } from './ui';

type Social = typeof import('../auth/social');

export type { Chat };

/** A stable key for a conversation, used for read marks and lookups. */
export const convoKey = (c: Convo) => (c.kind === 'dm' ? `dm:${c.other}` : `group:${c.id}`);

interface SocialStore {
  ready: boolean;
  friendships: Friendship[];
  /** Public cards of friends, requesters and party members, live. */
  cards: Record<string, Card>;
  notes: Note[];
  party: Party | null;
  chats: Chat[];
  groups: Group[];
  /** Friends' offline worlds you can step into (account id → code). */
  joinable: Record<string, string>;
  /** A player whose card is open. */
  viewing: string | null;
  /** The conversation that is open (a friend or a group). */
  convo: Convo | null;
  /** The friend whose conversation is open (direct messages only). */
  talking: string | null;
  messages: Message[];
  /** Account ids typing in the open conversation. */
  typing: string[];
  /** When each conversation was last read here (ms). */
  readAt: Record<string, number>;
  view(uid: string | null): void;
  talk(uid: string | null): void;
  openGroup(id: string): void;
  closeConvo(): void;
}

const READ_KEY = 'chromashift.readAt';
const loadRead = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
  } catch {
    return {};
  }
};

export const useSocial = create<SocialStore>()((set) => ({
  ready: false,
  friendships: [],
  cards: {},
  notes: [],
  party: null,
  chats: [],
  groups: [],
  joinable: {},
  viewing: null,
  convo: null,
  talking: null,
  messages: [],
  typing: [],
  readAt: loadRead(),
  view: (viewing) => set({ viewing }),
  talk: (uid) => set({ convo: uid ? { kind: 'dm', other: uid } : null, talking: uid, messages: [], typing: [] }),
  openGroup: (id) => set({ convo: { kind: 'group', id }, talking: null, messages: [], typing: [] }),
  closeConvo: () => set({ convo: null, talking: null, messages: [], typing: [] }),
}));

/** Marks a conversation read up to now. */
export function markConvoRead(c: Convo) {
  const readAt = { ...useSocial.getState().readAt, [convoKey(c)]: Date.now() };
  useSocial.setState({ readAt });
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(readAt));
  } catch {
    /* storage unavailable */
  }
}

/** True when the latest message in a conversation arrived after you last looked. */
export const isUnread = (key: string, last?: { from: string; at: number }) => {
  const me = useAccount.getState().user?.uid;
  return !!last && last.from !== me && last.at > (useSocial.getState().readAt[key] ?? 0);
};

let api: Social | null = null;
let offs: (() => void)[] = [];
let cardsOff: (() => void) | null = null;
let joinOff: (() => void) | null = null;
let msgsOff: (() => void) | null = null;
let typingOff: (() => void) | null = null;
let beat = 0;
let seenNotes = new Set<string>();
let firstNotes = true;
let followed = 0;

/** Runs a social action; failures become a toast instead of an exception. */
export async function social<T>(fn: (s: Social) => Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const s = api ?? (await load());
    const out = await fn(s);
    if (ok) useUi.getState().toast({ text: ok, kind: 'success' });
    return out;
  } catch (e) {
    useUi.getState().toast({ text: describeAuthError(e), kind: 'error' });
    return undefined;
  }
}

async function load() {
  await accounts();
  api = await import('../auth/social');
  return api;
}

const activity = () => {
  const s = useUi.getState().screen;
  return s === 'match' ? 'match' : s === 'lobby' ? 'lobby' : 'menu';
};

/** Every account id the store should keep a live card for. */
function watched() {
  const s = useSocial.getState();
  return [
    ...new Set([
      ...s.friendships.map((f) => f.other),
      ...(s.party?.members ?? []),
      ...s.chats.map((c) => c.other),
      ...s.groups.flatMap((g) => g.members),
    ]),
  ].sort();
}

let watchedKey = '';
function refreshCards() {
  const ids = watched().filter(Boolean);
  const key = ids.join(',');
  if (key === watchedKey || !api) return;
  watchedKey = key;
  cardsOff?.();
  cardsOff = api.watchCards(ids, (cards) => useSocial.setState({ cards }));
}

let joinKey = '';
function refreshJoinable() {
  const ids = useSocial
    .getState()
    .friendships.filter((f) => f.status === 'accepted')
    .map((f) => f.other)
    .sort();
  const key = ids.join(',');
  if (key === joinKey || !api) return;
  joinKey = key;
  joinOff?.();
  joinOff = api.watchJoinable(ids, (joinable) => useSocial.setState({ joinable }));
}

/** Joins a game from an invite or a friend's open world, then goes to wherever it lands. */
export async function joinFromInvite(code: string) {
  const ui = useUi.getState();
  if (useNet.getState().lobby?.code === code) return ui.go(ui.screen === 'match' ? 'match' : 'lobby');
  ui.setLoading('Joining…');
  try {
    await joinGame(code);
    ui.go('lobby');
  } catch (e) {
    ui.toast({ text: e instanceof Error ? e.message : 'Couldn’t join that game.', kind: 'error' });
  } finally {
    ui.setLoading(null);
  }
}

const notifySound = () => useSettings.getState().audio.notifySounds && audio.play('notify');

/** Pops up new notifications in the game (not the system's notifications), with a sound. */
function announce(notes: Note[]) {
  const ui = useUi.getState();
  const open = useSocial.getState().convo;
  for (const n of notes) {
    if (seenNotes.has(n.id)) continue;
    seenNotes.add(n.id);
    if (firstNotes || n.read) continue;
    if (n.type === 'friendRequest') {
      notifySound();
      ui.toast({
        text: `${n.fromName} sent you a friend request`,
        ttl: 9000,
        action: {
          label: 'Accept',
          run: () => {
            const f = useSocial.getState().friendships.find((x) => x.other === n.from && x.status === 'pending');
            if (f) void social((s) => s.acceptFriend(f), `You and ${n.fromName} are friends now`);
            void social((s) => s.markRead(n.id));
          },
        },
      });
    } else if (n.type === 'friendAccepted') {
      notifySound();
      ui.toast({ text: `${n.fromName} accepted your friend request`, kind: 'success' });
    } else if (n.type === 'partyInvite' && (n.expiresAt ?? 0) > Date.now()) {
      notifySound();
      ui.toast({
        text: `${n.fromName} invited you to their party`,
        ttl: 15000,
        action: { label: 'Join', run: () => void acceptInvite(n) },
      });
    } else if (n.type === 'gameInvite' && n.text) {
      notifySound();
      const code = n.text;
      ui.toast({
        text: `${n.fromName} invited you to a game`,
        ttl: 20000,
        action: {
          label: 'Join',
          run: () => {
            void social((s) => s.markRead(n.id));
            void joinFromInvite(code);
          },
        },
      });
    } else if (n.type === 'message' && !(open?.kind === 'dm' && open.other === n.from && ui.screen === 'social')) {
      notifySound();
      ui.toast({
        text: `${n.fromName}: ${n.text ?? 'sent you a message'}`,
        ttl: 7000,
        action: {
          label: 'Reply',
          run: () => {
            useSocial.getState().talk(n.from);
            ui.go('social');
          },
        },
      });
    } else if (n.type === 'groupMessage' && !(open?.kind === 'group' && open.id === n.party && ui.screen === 'social')) {
      notifySound();
      ui.toast({
        text: `${n.fromName} · ${n.text ?? 'new message'}`,
        ttl: 7000,
        action: {
          label: 'Open',
          run: () => {
            if (n.party) useSocial.getState().openGroup(n.party);
            ui.go('social');
          },
        },
      });
    }
  }
  firstNotes = false;
}

export async function acceptInvite(n: Note) {
  if ((n.expiresAt ?? 0) < Date.now()) {
    useUi.getState().toast({ text: 'That party invite has expired.', kind: 'warn' });
    return;
  }
  const party = useSocial.getState().party;
  if (party && party.leader !== n.party) await social((s) => s.leaveParty(party));
  await social((s) => s.joinParty(n.party!), `You joined ${n.fromName}’s party`);
  void social((s) => s.clearNote(n.id));
}

/** Party members follow the leader into whatever game they host. */
function follow(p: Party | null) {
  const me = api ? useAccount.getState().user?.uid : null;
  if (!p?.game || !me || p.leader === me || p.game.at <= followed) return;
  followed = p.game.at;
  const net = useNet.getState();
  if (net.lobby?.code === p.game.code) return;
  const ui = useUi.getState();
  ui.toast({ text: `Joining ${p.names[p.leader] ?? 'your party leader'}’s game…` });
  void joinGame(p.game.code)
    .then(() => ui.go('lobby'))
    .catch(() => ui.toast({ text: 'Couldn’t join your party leader’s game.', kind: 'error' }));
}

async function start() {
  const s = await load();
  stop();
  seenNotes = new Set();
  firstNotes = true;
  offs.push(
    s.watchFriendships((friendships) => {
      useSocial.setState({ friendships });
      refreshCards();
      refreshJoinable();
    }),
    s.watchNotes((notes) => {
      useSocial.setState({ notes });
      announce(notes);
    }),
    s.watchMyParty((party) => {
      useSocial.setState({ party });
      refreshCards();
      follow(party);
    }),
    s.watchChats((chats) => {
      useSocial.setState({ chats });
      refreshCards();
    }),
    s.watchGroups((groups) => {
      useSocial.setState({ groups });
      refreshCards();
    }),
    s.watchCalls(onCalls),
  );
  useSocial.setState({ ready: true });
  const pulse = () => {
    void s.setPresence(true, activity()).catch(() => undefined);
    shareRoom();
  };
  pulse();
  beat = window.setInterval(pulse, 60_000);
}

let sharedRoom: string | null = null;
/** Lets the owner see which game this player is in (and nobody else). */
function shareRoom(force = false) {
  const code = useNet.getState().lobby?.code ?? useWorld.getState().code ?? null;
  if (!api || !useSocial.getState().ready || (!code && sharedRoom === null && !force)) return;
  sharedRoom = code;
  void api.setRoom(code).catch(() => undefined);
}

function stop() {
  for (const f of offs) f();
  offs = [];
  cardsOff?.();
  cardsOff = null;
  joinOff?.();
  joinOff = null;
  msgsOff?.();
  msgsOff = null;
  typingOff?.();
  typingOff = null;
  watchedKey = '';
  joinKey = '';
  clearInterval(beat);
  resetCalls();
  useSocial.setState({ ready: false, friendships: [], cards: {}, notes: [], party: null, chats: [], groups: [], joinable: {}, messages: [], typing: [], convo: null, talking: null, viewing: null });
}

useAccount.subscribe((a, prev) => {
  if (a.status === prev.status) return;
  if (a.status === 'signedIn') void start().catch(() => undefined);
  else if (prev.status === 'signedIn') stop();
});

// The open conversation streams its messages and who is typing.
useSocial.subscribe((s, prev) => {
  if (!api) return;
  const a = s.convo ? convoKey(s.convo) : '';
  const b = prev.convo ? convoKey(prev.convo) : '';
  if (a === b) return;
  msgsOff?.();
  typingOff?.();
  msgsOff = typingOff = null;
  if (s.convo) {
    const c = s.convo;
    msgsOff = api.watchMessages(c, (messages) => {
      useSocial.setState({ messages });
      if (useUi.getState().screen === 'social') markConvoRead(c);
    });
    typingOff = api.watchTyping(c, (typing) => useSocial.setState({ typing }));
    markConvoRead(c);
  }
});

let typedAt = 0;
/** You're typing in the open conversation; tells the others (at most every 2.5 seconds). */
export function iAmTyping() {
  const c = useSocial.getState().convo;
  if (!c || !api || Date.now() - typedAt < 2500) return;
  typedAt = Date.now();
  void api.setTyping(c).catch(() => undefined);
}

// Presence follows what the player is doing; the leader shares their hosted game with the party.
useUi.subscribe((u, prev) => {
  if (u.screen !== prev.screen && api && useSocial.getState().ready) void api.setPresence(true, activity()).catch(() => undefined);
});
useWorld.subscribe((w, prev) => {
  if (w.code !== prev.code) shareRoom(true);
});
useNet.subscribe((n, prev) => {
  if (n.lobby?.code !== prev.lobby?.code) shareRoom();
  const me = useAccount.getState().user?.uid;
  const party = useSocial.getState().party;
  if (!api || !me || party?.leader !== me || n.lobby?.code === prev.lobby?.code) return;
  const hosting = n.lobby && n.lobby.players.find((p) => p.id === n.lobby!.hostId && p.id === n.you);
  void api.setPartyGame(hosting ? n.lobby!.code : null).catch(() => undefined);
});
addEventListener('pagehide', () => {
  if (api && useSocial.getState().ready) {
    void api.setPresence(false, 'menu').catch(() => undefined);
    if (useWorld.getState().code) void api.setJoinable(null).catch(() => undefined);
  }
});
