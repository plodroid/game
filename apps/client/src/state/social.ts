import { create } from 'zustand';
import { accounts, describeAuthError, useAccount } from '../auth/account';
import type { Card, Friendship, Message, Note, Party } from '../auth/social';
import { joinGame, useNet } from '../multiplayer/net';
import { useUi } from './ui';

type Social = typeof import('../auth/social');

export interface Chat {
  id: string;
  other: string;
  last?: { text: string; from: string; at: number };
  updatedAt: number;
}

interface SocialStore {
  ready: boolean;
  friendships: Friendship[];
  /** Public cards of friends, requesters and party members, live. */
  cards: Record<string, Card>;
  notes: Note[];
  party: Party | null;
  chats: Chat[];
  /** A player whose card is open. */
  viewing: string | null;
  /** The friend whose conversation is open. */
  talking: string | null;
  messages: Message[];
  view(uid: string | null): void;
  talk(uid: string | null): void;
}

export const useSocial = create<SocialStore>()((set) => ({
  ready: false,
  friendships: [],
  cards: {},
  notes: [],
  party: null,
  chats: [],
  viewing: null,
  talking: null,
  messages: [],
  view: (viewing) => set({ viewing }),
  talk: (talking) => set({ talking, messages: [] }),
}));

let api: Social | null = null;
let offs: (() => void)[] = [];
let cardsOff: (() => void) | null = null;
let msgsOff: (() => void) | null = null;
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
  return [...new Set([...s.friendships.map((f) => f.other), ...(s.party?.members ?? []), ...s.chats.map((c) => c.other)])].sort();
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

/** Pops up new notifications in the game (not the system's notifications). */
function announce(notes: Note[]) {
  const ui = useUi.getState();
  for (const n of notes) {
    if (seenNotes.has(n.id)) continue;
    seenNotes.add(n.id);
    if (firstNotes || n.read) continue;
    if (n.type === 'friendRequest') {
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
      ui.toast({ text: `${n.fromName} accepted your friend request`, kind: 'success' });
    } else if (n.type === 'partyInvite' && (n.expiresAt ?? 0) > Date.now()) {
      ui.toast({
        text: `${n.fromName} invited you to their party`,
        ttl: 15000,
        action: { label: 'Join', run: () => void acceptInvite(n) },
      });
    } else if (n.type === 'message' && useSocial.getState().talking !== n.from) {
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
  );
  useSocial.setState({ ready: true });
  const pulse = () => void s.setPresence(true, activity()).catch(() => undefined);
  pulse();
  beat = window.setInterval(pulse, 60_000);
}

function stop() {
  for (const f of offs) f();
  offs = [];
  cardsOff?.();
  cardsOff = null;
  msgsOff?.();
  msgsOff = null;
  watchedKey = '';
  clearInterval(beat);
  useSocial.setState({ ready: false, friendships: [], cards: {}, notes: [], party: null, chats: [], messages: [], talking: null, viewing: null });
}

useAccount.subscribe((a, prev) => {
  if (a.status === prev.status) return;
  if (a.status === 'signedIn') void start().catch(() => undefined);
  else if (prev.status === 'signedIn') stop();
});

// The open conversation streams its messages.
useSocial.subscribe((s, prev) => {
  if (s.talking === prev.talking || !api) return;
  msgsOff?.();
  msgsOff = s.talking ? api.watchMessages(s.talking, (messages) => useSocial.setState({ messages })) : null;
});

// Presence follows what the player is doing; the leader shares their hosted game with the party.
useUi.subscribe((u, prev) => {
  if (u.screen !== prev.screen && api && useSocial.getState().ready) void api.setPresence(true, activity()).catch(() => undefined);
});
useNet.subscribe((n, prev) => {
  const me = useAccount.getState().user?.uid;
  const party = useSocial.getState().party;
  if (!api || !me || party?.leader !== me || n.lobby?.code === prev.lobby?.code) return;
  const hosting = n.lobby && n.lobby.players.find((p) => p.id === n.lobby!.hostId && p.id === n.you);
  void api.setPartyGame(hosting ? n.lobby!.code : null).catch(() => undefined);
});
addEventListener('pagehide', () => {
  if (api && useSocial.getState().ready) void api.setPresence(false, 'menu').catch(() => undefined);
});
