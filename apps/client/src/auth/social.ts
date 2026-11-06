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
}

export interface Friendship {
  id: string;
  other: string;
  requester: string;
  status: 'pending' | 'accepted';
}

export interface Note {
  id: string;
  type: 'friendRequest' | 'friendAccepted' | 'partyInvite' | 'message';
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

export interface Message {
  id: string;
  from: string;
  text?: string;
  voice?: string;
  duration?: number;
  createdAt: number;
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

/* ---------- Messages ---------- */

export function watchChats(on: (chats: { id: string; other: string; last?: { text: string; from: string; at: number }; updatedAt: number }[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'chats'), where('users', 'array-contains', uid)), (snap) =>
    on(
      snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            other: (x.users as string[]).find((u) => u !== uid) ?? '',
            last: x.last ? { text: String(x.last.text), from: String(x.last.from), at: ms(x.last.at) } : undefined,
            updatedAt: ms(x.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  );
}

export function watchMessages(other: string, on: (m: Message[]) => void): Unsubscribe {
  const { db, uid } = me();
  return onSnapshot(query(collection(db, 'chats', pairId(uid, other), 'messages'), orderBy('createdAt', 'desc'), limit(60)), (snap) =>
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

async function post(other: string, body: { text?: string; voice?: string; duration?: number }, preview: string) {
  const { db, uid } = me();
  const id = pairId(uid, other);
  await addDoc(collection(db, 'chats', id, 'messages'), { from: uid, ...body, createdAt: serverTimestamp() });
  await setDoc(doc(db, 'chats', id), { users: id.split('_'), last: { text: preview, from: uid, at: Timestamp.now() }, updatedAt: serverTimestamp() });
  await notify(other, { type: 'message', text: preview }).catch(() => undefined);
}

export const sendText = (other: string, text: string) => post(other, { text: text.trim().slice(0, 500) }, text.trim().slice(0, 80));
export const sendVoice = (other: string, voice: string, duration: number) => post(other, { voice, duration: Math.min(30, Math.round(duration * 10) / 10) }, `Voice message (${Math.round(duration)}s)`);
