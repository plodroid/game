import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { sanitizeCosmetics, usernameKey, type Cosmetics } from '@chromashift/shared';
import { publicName, useProfile } from '../state/profile';
import { session } from './firebase';

/*
 * Friends, presence, notifications, parties and messages, all in Firestore under rules that only
 * let each player touch their own side (see firestore.rules).
 */

export const INVITE_MS = 5 * 60_000;
/** A player counts as online while their card was refreshed this recently. */
export const ONLINE_MS = 150_000;

export interface Card {
  uid: string;
  username: string;
  displayName: string;
  level: number;
  cosmetics: Cosmetics;
  stats?: { games: number; wins: number; kills: number; paint: number };
  online?: boolean;
  seenAt?: number;
  activity?: 'menu' | 'lobby' | 'match';
  /** When the account was made (older accounts fill this in the next time they sign in). */
  createdAt?: number;
}

export interface Friendship {
  id: string;
  other: string;
  requester: string;
  status: 'pending' | 'accepted';
}

export interface Note {
  id: string;
  type: 'friendRequest' | 'friendAccepted' | 'partyInvite' | 'message' | 'groupMessage' | 'gameInvite' | 'call';
  from: string;
  fromName: string;
  party?: string;
  text?: string;
  createdAt: number;
  expiresAt?: number;
  read: boolean;
}

export interface Party {
  leader: string;
  members: string[];
  names: Record<string, string>;
  /** Invited account id → when the invite runs out (ms). */
  invites: Record<string, number>;
  game: { code: string; at: number } | null;
}

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : typeof t === 'number' ? t : Date.now());
const me = () => {
  const { db, user } = session();
  if (!user) throw new Error('Not signed in');
  return { db, uid: user.uid };
};
export const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const myName = () => publicName(useProfile.getState());

const toCard = (uid: string, d: Record<string, unknown>): Card => ({
  uid,
  username: String(d.username ?? ''),
  displayName: String(d.displayName ?? d.username ?? 'Player'),
  level: Number(d.level ?? 1),
  cosmetics: sanitizeCosmetics(d.cosmetics as Partial<Cosmetics>),
  stats: d.stats as Card['stats'],
  online: d.online === true && Date.now() - ms(d.seenAt) < ONLINE_MS,
  seenAt: d.seenAt ? ms(d.seenAt) : undefined,
  activity: d.activity as Card['activity'],
  createdAt: d.createdAt ? ms(d.createdAt) : undefined,
});

/* ---------- Players ---------- */

/** Players whose username starts with `prefix`, ignoring case. */
export async function searchPlayers(prefix: string): Promise<Card[]> {
  const { db, uid } = me();
  const k = usernameKey(prefix);
  if (k.length < 2) return [];
  const q = query(collection(db, 'profiles'), where('usernameKey', '>=', k), where('usernameKey', '<=', `${k}`), limit(12));
  const snap = await getDocs(q);
  return snap.docs.filter((d) => d.id !== uid).map((d) => toCard(d.id, d.data()));
}

export async function getCard(uid: string): Promise<Card | null> {
  const { db } = me();
  const s = await getDoc(doc(db, 'profiles', uid));
  return s.exists() ? toCard(uid, s.data()) : null;
}

export function watchCards(uids: string[], on: (cards: Record<string, Card>) => void): Unsubscribe {
  const { db } = me();
  const cards: Record<string, Card> = {};
  const offs = uids.map((u) =>
    onSnapshot(doc(db, 'profiles', u), (s) => {
      if (s.exists()) cards[u] = toCard(u, s.data());
      on({ ...cards });
    }),
  );
  return () => offs.forEach((f) => f());
}

/** Keeps this player's card marked online with what they're doing. */
export async function setPresence(online: boolean, activity: Card['activity'] = 'menu') {
  const { db, uid } = me();
  await setDoc(doc(db, 'profiles', uid), { online, activity, seenAt: serverTimestamp() }, { merge: true });
}

/** Tells the owner which game this player is in (the owner can read it; nobody else can). */
export async function setRoom(code: string | null) {
  const { db, uid } = me();
  await setDoc(doc(db, 'presence', uid), { code, updatedAt: serverTimestamp() });
}

/* ---------- Notifications ---------- */

async function notify(to: string, n: Omit<Note, 'id' | 'from' | 'fromName' | 'createdAt' | 'read' | 'expiresAt'> & { expiresAt?: number }) {
  const { db, uid } = me();
  const data: Record<string, unknown> = { type: n.type, from: uid, fromName: myName(), createdAt: serverTimestamp(), read: false };
  if (n.party) data.party = n.party;
  if (n.text) data.text = n.text.slice(0, 140);
  if (n.expiresAt) data.expiresAt = Timestamp.fromMillis(n.expiresAt);
  await addDoc(collection(db, 'notifications', to, 'items'), data);
}

export function watchNotes(on: (notes: Note[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'notifications', uid, 'items'), orderBy('createdAt', 'desc'), limit(40)), (snap) =>
    on(
      snap.docs.map((d) => {
        const x = d.data();
        return { ...(x as Note), id: d.id, createdAt: ms(x.createdAt), expiresAt: x.expiresAt ? ms(x.expiresAt) : undefined };
      }),
    ),
  );
}

export async function markRead(id: string) {
  const { db, uid } = me();
  await updateDoc(doc(db, 'notifications', uid, 'items', id), { read: true });
}

/** Marks several notifications read in one write. */
export async function markAllRead(ids: string[]) {
  const { db, uid } = me();
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    for (const id of ids.slice(i, i + 400))
      b.update(doc(db, 'notifications', uid, 'items', id), { read: true });
    await b.commit();
  }
}

export async function clearNote(id: string) {
  const { db, uid } = me();
  await deleteDoc(doc(db, 'notifications', uid, 'items', id));
}

/* ---------- Friends ---------- */

export function watchFriendships(on: (f: Friendship[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'friendships'), where('users', 'array-contains', uid)), (snap) =>
    on(
      snap.docs.map((d) => {
        const x = d.data() as { users: string[]; requester: string; status: Friendship['status'] };
        return { id: d.id, other: x.users.find((u) => u !== uid) ?? '', requester: x.requester, status: x.status };
      }),
    ),
  );
}

export async function addFriend(other: string) {
  const { db, uid } = me();
  const id = pairId(uid, other);
  await setDoc(doc(db, 'friendships', id), { users: id.split('_'), requester: uid, status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await notify(other, { type: 'friendRequest' }).catch(() => undefined);
}

export async function acceptFriend(f: Friendship) {
  const { db } = me();
  await updateDoc(doc(db, 'friendships', f.id), { status: 'accepted', updatedAt: serverTimestamp() });
  await notify(f.other, { type: 'friendAccepted' }).catch(() => undefined);
}

/** Declines, cancels or ends a friendship. */
export async function removeFriend(f: Friendship) {
  const { db } = me();
  await deleteDoc(doc(db, 'friendships', f.id));
}

/* ---------- Parties ---------- */

const toParty = (d: Record<string, unknown>): Party => ({
  leader: String(d.leader),
  members: (d.members as string[]) ?? [],
  names: (d.names as Record<string, string>) ?? {},
  invites: Object.fromEntries(Object.entries((d.invites as Record<string, unknown>) ?? {}).map(([k, v]) => [k, ms(v)])),
  game: d.game ? { code: String((d.game as { code: string }).code), at: ms((d.game as { at: unknown }).at) } : null,
});

/** The party this player is in, if any (as leader or member). */
export function watchMyParty(on: (p: Party | null) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'parties'), where('members', 'array-contains', uid), limit(1)), (snap) =>
    on(snap.empty ? null : toParty(snap.docs[0].data())),
  );
}

async function ensureParty() {
  const { db, uid } = me();
  const ref = doc(db, 'parties', uid);
  if (!(await getDoc(ref)).exists())
    await setDoc(ref, { leader: uid, members: [uid], names: { [uid]: myName() }, invites: {}, game: null, updatedAt: serverTimestamp() });
  return ref;
}

/** Invites a friend to this player's party; the invite runs out after five minutes. */
export async function inviteToParty(other: string) {
  const ref = await ensureParty();
  const expiresAt = Date.now() + INVITE_MS;
  await updateDoc(ref, { [`invites.${other}`]: Timestamp.fromMillis(expiresAt), updatedAt: serverTimestamp() });
  await notify(other, { type: 'partyInvite', party: me().uid, expiresAt });
}

export async function joinParty(leader: string) {
  const { db, uid } = me();
  await updateDoc(doc(db, 'parties', leader), { members: arrayUnion(uid), [`names.${uid}`]: myName(), [`invites.${uid}`]: deleteField(), updatedAt: serverTimestamp() });
}

export async function leaveParty(p: Party) {
  const { db, uid } = me();
  if (p.leader === uid) await deleteDoc(doc(db, 'parties', uid));
  else await updateDoc(doc(db, 'parties', p.leader), { members: arrayRemove(uid), [`names.${uid}`]: deleteField(), updatedAt: serverTimestamp() });
}

export async function kickFromParty(other: string) {
  const { db, uid } = me();
  await updateDoc(doc(db, 'parties', uid), { members: arrayRemove(other), [`names.${other}`]: deleteField(), updatedAt: serverTimestamp() });
}

/** The leader shares the game they're hosting; members' games follow it. */
export async function setPartyGame(code: string | null) {
  const { db, uid } = me();
  await updateDoc(doc(db, 'parties', uid), { game: code ? { code, at: serverTimestamp() } : null, updatedAt: serverTimestamp() });
}

/* ---------- Conversations: direct messages and group chats ---------- */

export type Convo = { kind: 'dm'; other: string } | { kind: 'group'; id: string };

export interface Chat {
  id: string;
  other: string;
  last?: { text: string; from: string; at: number };
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  owner: string;
  members: string[];
  names: Record<string, string>;
  last?: { text: string; from: string; at: number };
  updatedAt: number;
}

const lastOf = (x: Record<string, unknown>) =>
  x.last ? { text: String((x.last as { text: unknown }).text), from: String((x.last as { from: unknown }).from), at: ms((x.last as { at: unknown }).at) } : undefined;

export function watchChats(on: (chats: Chat[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'chats'), where('users', 'array-contains', uid)), (snap) =>
    on(
      snap.docs
        .map((d) => {
          const x = d.data();
          return { id: d.id, other: (x.users as string[]).find((u) => u !== uid) ?? '', last: lastOf(x), updatedAt: ms(x.updatedAt) };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  );
}

export function watchGroups(on: (groups: Group[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'groups'), where('members', 'array-contains', uid)), (snap) =>
    on(
      snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            name: String(x.name ?? 'Group'),
            owner: String(x.owner ?? ''),
            members: (x.members as string[]) ?? [],
            names: (x.names as Record<string, string>) ?? {},
            last: lastOf(x),
            updatedAt: ms(x.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  );
}

export const MAX_GROUP = 8;

export async function createGroup(name: string, members: string[], names: Record<string, string>) {
  const { db, uid } = me();
  const all = [...new Set([uid, ...members])].slice(0, MAX_GROUP);
  const ref = doc(collection(db, 'groups'));
  const title = name.trim().slice(0, 24) || 'Group chat';
  await setDoc(ref, {
    name: title,
    owner: uid,
    members: all,
    names: Object.fromEntries(all.map((u) => [u, (u === uid ? myName() : (names[u] ?? 'Player')).slice(0, 24)])),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  for (const u of all) if (u !== uid) await notify(u, { type: 'groupMessage', party: ref.id, text: `added you to ${title}` }).catch(() => undefined);
  return ref.id;
}

export async function addToGroup(g: Group, other: string, name: string) {
  const { db } = me();
  if (g.members.length >= MAX_GROUP) throw new Error('A group holds up to 8 people.');
  await updateDoc(doc(db, 'groups', g.id), { members: arrayUnion(other), [`names.${other}`]: name.slice(0, 24), updatedAt: serverTimestamp() });
  await notify(other, { type: 'groupMessage', party: g.id, text: `added you to ${g.name}` }).catch(() => undefined);
}

export async function renameGroup(g: Group, name: string) {
  const { db } = me();
  await updateDoc(doc(db, 'groups', g.id), { name: name.trim().slice(0, 24) || g.name, updatedAt: serverTimestamp() });
}

export async function leaveGroup(g: Group) {
  const { db, uid } = me();
  if (g.members.length <= 1) return void (await deleteDoc(doc(db, 'groups', g.id)));
  await updateDoc(doc(db, 'groups', g.id), {
    members: arrayRemove(uid),
    [`names.${uid}`]: deleteField(),
    // The group never loses its owner: the next member takes over.
    ...(g.owner === uid ? { owner: g.members.find((u) => u !== uid) } : {}),
    updatedAt: serverTimestamp(),
  });
}

const msgsOf = (c: Convo) => {
  const { db, uid } = me();
  return collection(db, c.kind === 'dm' ? 'chats' : 'groups', c.kind === 'dm' ? pairId(uid, c.other) : c.id, 'messages');
};

export interface Message {
  id: string;
  from: string;
  fromName?: string;
  text?: string;
  voice?: string;
  duration?: number;
  /** A picture, as a small compressed data URL. */
  image?: string;
  /** A short clip, as an MP4 (or WebM where the browser can't make MP4) data URL. */
  video?: string;
  /** A game code: the message is an invitation with a Join button. */
  invite?: string;
  createdAt: number;
}

export function watchMessages(c: Convo, on: (m: Message[]) => void): Unsubscribe {
  return onSnapshot(query(msgsOf(c), orderBy('createdAt', 'desc'), limit(80)), (snap) =>
    on(
      snap.docs
        .map((d) => {
          const x = d.data();
          return { ...(x as Message), id: d.id, createdAt: ms(x.createdAt) };
        })
        .reverse(),
    ),
  );
}

async function post(c: Convo, body: { text?: string; voice?: string; duration?: number; image?: string; video?: string; invite?: string }, preview: string) {
  const { db, uid } = me();
  const stamp = { text: preview, from: uid, at: Timestamp.now() };
  if (c.kind === 'dm') {
    const id = pairId(uid, c.other);
    await addDoc(msgsOf(c), { from: uid, ...body, createdAt: serverTimestamp() });
    await setDoc(doc(db, 'chats', id), { users: id.split('_'), last: stamp, updatedAt: serverTimestamp() });
    await notify(c.other, { type: body.invite ? 'gameInvite' : 'message', text: body.invite ?? preview }).catch(() => undefined);
    return;
  }
  await addDoc(msgsOf(c), { from: uid, fromName: myName(), ...body, createdAt: serverTimestamp() });
  const g = await getDoc(doc(db, 'groups', c.id));
  await updateDoc(doc(db, 'groups', c.id), { last: { ...stamp, text: `${myName()}: ${preview}`.slice(0, 90) }, updatedAt: serverTimestamp() });
  const x = g.data();
  for (const u of ((x?.members as string[]) ?? []).filter((m) => m !== uid))
    await notify(u, { type: body.invite ? 'gameInvite' : 'groupMessage', party: body.invite ? undefined : c.id, text: body.invite ?? `${String(x?.name ?? 'Group')}: ${preview}`.slice(0, 120) }).catch(() => undefined);
}

export const sendText = (c: Convo, text: string) => post(c, { text: text.trim().slice(0, 500) }, text.trim().slice(0, 80));
export const sendVoice = (c: Convo, voice: string, duration: number) =>
  post(c, { voice, duration: Math.min(90, Math.round(duration * 10) / 10) }, `Voice message (${Math.round(duration)}s)`);
export const sendImage = (c: Convo, image: string) => post(c, { image }, 'Sent a picture');
export const sendVideo = (c: Convo, video: string) => post(c, { video }, 'Sent a video');
/** An invitation to the game this player is in or hosting: a card with a Join button. */
export const sendInvite = (c: Convo, code: string) => post(c, { invite: code }, 'Invited you to a game');

/* ---------- Typing indicators ---------- */

const typingCol = (c: Convo) => {
  const { db, uid } = me();
  return collection(db, c.kind === 'dm' ? 'chats' : 'groups', c.kind === 'dm' ? pairId(uid, c.other) : c.id, 'typing');
};

export async function setTyping(c: Convo) {
  const { uid } = me();
  await setDoc(doc(typingCol(c), uid), { at: serverTimestamp() });
}

/** Account ids typing in this conversation right now (not you), live. */
export function watchTyping(c: Convo, on: (uids: string[]) => void): Unsubscribe {
  const { uid } = me();
  return onSnapshot(
    typingCol(c),
    (snap) => on(snap.docs.filter((d) => d.id !== uid && Date.now() - ms(d.data().at) < 5000).map((d) => d.id)),
    () => undefined,
  );
}

/* ---------- Calls ---------- */

export interface CallDoc {
  id: string;
  caller: string;
  callerName: string;
  members: string[];
  names: Record<string, string>;
  joined: string[];
  declined: string[];
  status: 'ringing' | 'active';
  title: string;
  /** The conversation it was started from: a pair id or a group id. */
  chat: string;
  kind: 'dm' | 'group';
  createdAt: number;
}

const toCall = (id: string, x: Record<string, unknown>): CallDoc => ({
  id,
  caller: String(x.caller),
  callerName: String(x.callerName ?? 'Someone'),
  members: (x.members as string[]) ?? [],
  names: (x.names as Record<string, string>) ?? {},
  joined: (x.joined as string[]) ?? [],
  declined: (x.declined as string[]) ?? [],
  status: x.status === 'active' ? 'active' : 'ringing',
  title: String(x.title ?? 'Call'),
  chat: String(x.chat ?? ''),
  kind: x.kind === 'group' ? 'group' : 'dm',
  createdAt: ms(x.createdAt),
});

/** Calls this player is part of, live. */
export function watchCalls(on: (calls: CallDoc[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(
    query(collection(db, 'calls'), where('members', 'array-contains', uid)),
    (snap) => on(snap.docs.map((d) => toCall(d.id, d.data()))),
    () => undefined,
  );
}

export async function startCall(c: Convo, members: string[], names: Record<string, string>, title: string): Promise<CallDoc> {
  const { db, uid } = me();
  const all = [...new Set([uid, ...members])].slice(0, MAX_GROUP);
  const ref = doc(collection(db, 'calls'));
  const data = {
    caller: uid,
    callerName: myName(),
    members: all,
    names: Object.fromEntries(all.map((u) => [u, (u === uid ? myName() : (names[u] ?? 'Player')).slice(0, 24)])),
    joined: [uid],
    declined: [] as string[],
    status: 'ringing',
    title: title.slice(0, 24),
    chat: c.kind === 'dm' ? pairId(uid, c.other) : c.id,
    kind: c.kind,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  for (const u of all.filter((m) => m !== uid)) await notify(u, { type: 'call', party: ref.id, text: 'is calling you' }).catch(() => undefined);
  return toCall(ref.id, { ...data, createdAt: Date.now() });
}

export async function answerCall(id: string) {
  const { db, uid } = me();
  await updateDoc(doc(db, 'calls', id), { joined: arrayUnion(uid), status: 'active', updatedAt: serverTimestamp() });
}

export async function declineCall(id: string) {
  const { db, uid } = me();
  await updateDoc(doc(db, 'calls', id), { declined: arrayUnion(uid), updatedAt: serverTimestamp() });
}

/** Leaves the call; the last one out closes it. */
export async function hangUp(c: CallDoc) {
  const { db, uid } = me();
  const rest = c.joined.filter((u) => u !== uid);
  if (!rest.length) return void (await deleteDoc(doc(db, 'calls', c.id)));
  await updateDoc(doc(db, 'calls', c.id), { joined: arrayRemove(uid), updatedAt: serverTimestamp() });
}

export async function deleteCall(id: string) {
  const { db } = me();
  await deleteDoc(doc(db, 'calls', id));
}

/* ---------- Worlds friends can join ---------- */

/** Tells friends (and the owner) which code your offline world can be joined on; null closes it. */
export async function setJoinable(code: string | null) {
  const { db, uid } = me();
  await setDoc(doc(db, 'joinable', uid), { code, updatedAt: serverTimestamp() });
}

/** Friends' open worlds, live (account id → code). */
export function watchJoinable(uids: string[], on: (codes: Record<string, string>) => void): Unsubscribe {
  const { db } = me();
  const codes: Record<string, string> = {};
  const offs = uids.slice(0, 40).map((u) =>
    onSnapshot(
      doc(db, 'joinable', u),
      (s) => {
        const d = s.data();
        if (d?.code && Date.now() - ms(d.updatedAt) < ONLINE_MS + 60_000) codes[u] = String(d.code);
        else delete codes[u];
        on({ ...codes });
      },
      () => undefined,
    ),
  );
  return () => offs.forEach((f) => f());
}

/* ---------- Owner tools (the rules only let the owner account read these) ---------- */

export interface AccountDetails {
  createdAt?: number;
  email: string;
  wantsUpdates: boolean;
  xp: number;
  coins: number;
  owned: number;
  games: number;
  wins: number;
  banned: boolean;
  stats: Record<string, unknown>;
  ownedList: string[];
}

/** Every player card, newest account first. */
export async function listAccounts(): Promise<Card[]> {
  const { db } = me();
  const snap = await getDocs(query(collection(db, 'profiles'), limit(1000)));
  return snap.docs.map((d) => toCard(d.id, d.data())).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** One account's private details: contact email, join date and progress. */
export async function accountDetails(uid: string): Promise<AccountDetails> {
  const { db } = me();
  const [u, p] = await Promise.all([getDoc(doc(db, 'users', uid)), getDoc(doc(db, 'private', uid))]);
  const d = u.data() ?? {};
  return {
    createdAt: d.createdAt ? ms(d.createdAt) : undefined,
    email: String(p.data()?.email ?? ''),
    wantsUpdates: p.data()?.updates === true,
    xp: Number(d.xp ?? 0),
    coins: Number(d.coins ?? 0),
    owned: Array.isArray(d.owned) ? d.owned.length : 0,
    games: Number(d.stats?.games ?? 0),
    wins: Number(d.stats?.wins ?? 0),
    banned: d.banned === true,
    stats: (d.stats as Record<string, unknown>) ?? {},
    ownedList: Array.isArray(d.owned) ? d.owned.filter((k): k is string => typeof k === 'string') : [],
  };
}

/** The game code this player is in right now, if they were seen in one lately. */
export async function roomOf(uid: string): Promise<string | null> {
  const { db } = me();
  const d = (await getDoc(doc(db, 'presence', uid))).data();
  return d?.code && Date.now() - ms(d.updatedAt) < ONLINE_MS + 60_000 ? String(d.code) : null;
}

/** Owner only: changes an account's progress or bans it (the rules refuse anyone else). */
export async function adminEdit(uid: string, f: { xp?: number; coins?: number; stats?: Record<string, unknown>; owned?: string[]; banned?: boolean }) {
  const { db } = me();
  await setDoc(doc(db, 'users', uid), { ...f, updatedAt: serverTimestamp() }, { merge: true });
}
