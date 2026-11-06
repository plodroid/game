import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAdditionalUserInfo,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  linkWithPopup,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  unlink,
  updatePassword,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type Firestore,
} from 'firebase/firestore';
import { levelInfo, sanitizeCosmetics, STARTING_COINS, usernameKey, validateDisplayName, validateEmail, validatePassword, validateUsername, type Cosmetics } from '@chromashift/shared';
import { env } from '../env';
import { settingsSnapshot, useSettings, type Settings } from '../settings/settings';
import { newProfile, useProfile, type Profile, type Stats } from '../state/profile';
import { useAccount, type AccountUser } from './account';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let user: User | null = null;
/** A sign-up is creating the profile; the auth listener mustn't report it missing meanwhile. */
let claiming = false;

/** Private, owner-only document. Never contains the password or the email. */
interface UserDoc {
  username: string;
  usernameKey: string;
  displayName: string;
  createdAt: unknown;
  updatedAt: unknown;
  xp: number;
  stats: Stats;
  weapon: string;
  special: string;
  cosmetics: Cosmetics;
  coins?: number;
  owned?: string[];
  quests?: Profile['quests'];
  settings?: Partial<Settings>;
}

/**
 * Accounts sign in with a username and password. Firebase Authentication needs an email-shaped
 * identifier, so each username maps to an address on the project's own auth domain. Nothing is
 * ever sent there; a real email, if the player gives one, is kept separately and privately.
 */
const loginId = (name: string) => (name.includes('@') ? name.trim() : `${usernameKey(name)}@players.${env.firebase.authDomain ?? 'chromashift.firebaseapp.com'}`);

export async function start() {
  app = initializeApp({ ...env.firebase });
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  db = initializeFirestore(app, env.emulator ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (env.emulator) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }
  await getRedirectResult(auth).catch(() => null);
  onAuthStateChanged(auth, (u) => void onUser(u));
}

const providerOf = (u: User): AccountUser['provider'] =>
  u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : u.providerData.some((p) => p.providerId === 'password') ? 'password' : 'other';

async function onUser(u: User | null) {
  user = u;
  if (!u) {
    useAccount.setState({ status: 'signedOut', user: null, verified: null });
    // Back to a guest profile, but keep this device's settings.
    if (useProfile.getState().uid) useProfile.getState().reset();
    return;
  }
  useAccount.setState({
    user: { uid: u.uid, email: u.email, provider: providerOf(u), photoURL: u.photoURL, emailVerified: u.emailVerified, google: hasGoogle(u) },
    status: 'loading',
  });
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (!snap.exists()) {
      if (!claiming) useAccount.setState({ status: 'needsUsername' });
      return;
    }
    applyCloud(u.uid, snap.data() as UserDoc);
    useAccount.setState({ status: 'signedIn', sync: 'synced', error: null });
    void loadVerified(u.uid);
  } catch (e) {
    // Offline or quota exhausted: keep playing on the local copy, sync later.
    console.warn('Profile load failed', e);
    useAccount.setState({ status: 'signedIn', sync: 'pending' });
  }
}

function applyCloud(uid: string, d: UserDoc) {
  const local = useProfile.getState();
  const p: Profile = {
    ...newProfile(),
    uid,
    username: d.username,
    displayName: d.displayName || d.username,
    createdAt: tsToMs(d.createdAt) ?? local.createdAt,
    xp: Math.max(0, d.xp || 0),
    stats: { ...newProfile().stats, ...d.stats },
    weapon: (d.weapon as Profile['weapon']) ?? local.weapon,
    special: (d.special as Profile['special']) ?? local.special,
    cosmetics: sanitizeCosmetics(d.cosmetics),
    coins: typeof d.coins === 'number' ? Math.max(0, Math.floor(d.coins)) : local.uid === uid ? local.coins : STARTING_COINS,
    owned: Array.isArray(d.owned) ? d.owned.filter((k) => typeof k === 'string') : local.uid === uid ? local.owned : [],
    quests: d.quests && typeof d.quests === 'object' ? { ...newProfile().quests, ...d.quests } : local.uid === uid ? local.quests : newProfile().quests,
    dirty: false,
    updatedAt: Date.now(),
  };
  useProfile.getState().replace(p);
  if (d.settings) useSettings.getState().load(d.settings);
}

const tsToMs = (t: unknown) => (t && typeof (t as { toMillis?: () => number }).toMillis === 'function' ? (t as { toMillis(): number }).toMillis() : null);

async function loadVerified(uid: string) {
  try {
    const s = await getDoc(doc(db, 'stats', uid));
    if (s.exists()) useAccount.setState({ verified: s.data() as never });
  } catch {
    // Verified stats are optional (only servers with admin credentials write them).
  }
}

export async function idToken() {
  return user?.getIdToken();
}

const hasGoogle = (u: User) => u.providerData.some((p) => p.providerId === 'google.com');
const google = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

/** Signs in with a username (or, for older accounts, an email) and password. */
export async function signIn(name: string, password: string) {
  await signInWithEmailAndPassword(auth, loginId(name), password);
}

/**
 * Recovery: signs in with a Google account that was linked to a CHROMASHIFT account. Google can't
 * create accounts, so a Google account that isn't linked to one is turned away.
 */
export async function signInLinkedGoogle() {
  const res = await signInWithPopup(auth, google());
  if (getAdditionalUserInfo(res)?.isNewUser) {
    await res.user.delete().catch(() => fbSignOut(auth));
    throw Object.assign(new Error('NO_LINKED_ACCOUNT'), { code: 'NO_LINKED_ACCOUNT' });
  }
}

/** Links a Google account as a way back in, for a forgotten password. */
export async function linkGoogle() {
  if (!user) throw new Error('Not signed in');
  await linkWithPopup(user, google());
  await user.reload();
  useAccount.setState((s) => ({ user: s.user && { ...s.user, google: true } }));
}

export async function unlinkGoogle() {
  if (!user) throw new Error('Not signed in');
  await unlink(user, 'google.com');
  useAccount.setState((s) => ({ user: s.user && { ...s.user, google: false } }));
}

/**
 * Sets a new password. With the current one when known; right after a linked-Google sign-in the
 * session is fresh enough to set one without it.
 */
export async function changePassword(current: string | null, next: string) {
  if (!user) throw new Error('Not signed in');
  const err = validatePassword(next, useProfile.getState().username);
  if (err) throw new Error(err);
  if (current) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? loginId(useProfile.getState().username), current));
  await updatePassword(user, next);
}

/** The player's own email for updates and security notices, never shown to anyone. */
export interface PrivateInfo {
  email: string;
  updates: boolean;
}

export async function loadPrivate(): Promise<PrivateInfo | null> {
  if (!user) return null;
  const s = await getDoc(doc(db, 'private', user.uid));
  return s.exists() ? (s.data() as PrivateInfo) : null;
}

export async function savePrivate(info: PrivateInfo) {
  if (!user) throw new Error('Not signed in');
  const email = info.email.trim();
  const bad = email ? validateEmail(email) : null;
  if (bad) throw new Error(bad);
  await setDoc(doc(db, 'private', user.uid), { email, updates: !!info.updates && !!email, updatedAt: serverTimestamp() });
}

export async function isUsernameFree(name: string) {
  const s = await getDoc(doc(db, 'usernames', usernameKey(name)));
  return !s.exists();
}

/** Creates an account from a username and a strong password. The email is optional. */
export async function register(username: string, password: string, email = '', updates = false) {
  const err = validateUsername(username) ?? validatePassword(password, username) ?? (email.trim() ? validateEmail(email) : null);
  if (err) throw new Error(err);
  if (!(await isUsernameFree(username))) throw new Error('USERNAME_TAKEN');
  claiming = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, loginId(username), password);
    try {
      // Firestore can send the first write before it has the new account's token; try again briefly.
      for (let i = 0; ; i++) {
        try {
          await claimUsername(cred.user, username);
          break;
        } catch (e) {
          if ((e as { code?: string }).code !== 'permission-denied' || i >= 3) throw e;
          await cred.user.getIdToken(true);
          await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
      }
    } catch (e) {
      // Someone claimed the name in between: don't leave an account without a name behind.
      await cred.user.delete().catch(() => undefined);
      throw e;
    }
  } finally {
    claiming = false;
  }
  if (email.trim()) await savePrivate({ email, updates }).catch(() => undefined);
}

/** Reserves the name and creates the profile atomically. Guest progress carries over. */
export async function claimUsername(u: User | null = user, username: string) {
  if (!u) throw new Error('Not signed in');
  const err = validateUsername(username);
  if (err) throw new Error(err);
  const key = usernameKey(username);
  const local = useProfile.getState();
  const s = settingsSnapshot();
  const data: UserDoc = {
    username: username.trim(),
    usernameKey: key,
    displayName: username.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    xp: local.uid ? 0 : local.xp,
    stats: local.uid ? newProfile().stats : local.stats,
    weapon: local.weapon,
    special: local.special,
    cosmetics: local.cosmetics,
    coins: local.uid ? STARTING_COINS : local.coins,
    owned: local.uid ? [] : local.owned,
    quests: local.quests,
    settings: s,
  };
  await runTransaction(db, async (tx) => {
    const nameRef = doc(db, 'usernames', key);
    if ((await tx.get(nameRef)).exists()) throw new Error('USERNAME_TAKEN');
    tx.set(nameRef, { uid: u.uid, name: username.trim(), createdAt: serverTimestamp() });
    tx.set(doc(db, 'users', u.uid), data);
    tx.set(doc(db, 'profiles', u.uid), publicDoc(username.trim(), username.trim(), data.xp, data.cosmetics, data.stats));
  });
  applyCloud(u.uid, { ...data, createdAt: null, updatedAt: null });
  useAccount.setState({ status: 'signedIn', sync: 'synced', error: null });
}

/** The public card other players see: no email, no settings, nothing private. */
const publicDoc = (username: string, displayName: string, xp: number, cosmetics: Cosmetics, stats: Stats) => ({
  username,
  usernameKey: usernameKey(username),
  displayName,
  level: levelInfo(xp).level,
  cosmetics,
  stats: { games: stats.games, wins: stats.wins, kills: stats.kills, paint: stats.paint },
  updatedAt: serverTimestamp(),
});

export async function signOut() {
  await flush();
  await fbSignOut(auth);
}

export async function updateDisplayName(name: string) {
  const err = validateDisplayName(name);
  if (err) throw new Error(err);
  useProfile.getState().patch({ displayName: name.trim() });
  await flush();
}

let timer = 0;
let backoff = 4000;

/** Debounced cloud save of profile + settings; failures back off instead of hammering. */
export function scheduleSync(delay = backoff) {
  clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), delay);
}

export async function flush() {
  const p = useProfile.getState();
  if (!user || !p.uid || p.uid !== user.uid || !p.username) return;
  useAccount.setState({ sync: 'syncing' });
  try {
    const s = settingsSnapshot();
    await setDoc(
      doc(db, 'users', user.uid),
      {
        displayName: p.displayName,
        xp: p.xp,
        stats: p.stats,
        weapon: p.weapon,
        special: p.special,
        cosmetics: p.cosmetics,
        coins: p.coins,
        owned: p.owned,
        quests: p.quests,
        settings: s,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await setDoc(doc(db, 'profiles', user.uid), publicDoc(p.username, p.displayName, p.xp, p.cosmetics, p.stats), { merge: true });
    useProfile.setState({ dirty: false });
    useAccount.setState({ sync: 'synced' });
    backoff = 4000;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    useAccount.setState({ sync: code === 'unavailable' || code === 'resource-exhausted' ? 'pending' : 'error' });
    backoff = Math.min(backoff * 2, 5 * 60_000);
    scheduleSync(backoff);
  }
}

// Any local change while signed in is queued for sync.
useProfile.subscribe((s, prev) => {
  if (user && s.uid && s.dirty && (s.updatedAt !== prev.updatedAt || !prev.dirty)) {
    useAccount.setState({ sync: 'pending' });
    scheduleSync(4000);
  }
});
let settingsRef = useSettings.getState();
useSettings.subscribe((s) => {
  if (s === settingsRef) return;
  settingsRef = s;
  if (user && useProfile.getState().uid) scheduleSync(6000);
});
addEventListener('online', () => scheduleSync(1000));

/* ---------- Public games ---------- */

/** A browser-hosted game its host chose to list. The document id is the host's account id. */
export interface PublicGame {
  uid: string;
  code: string;
  name: string;
  map: string;
  mode: string;
  players: number;
  phase: string;
  protocol: number;
  /** Server time of the last refresh, in ms; listings that stop refreshing are ignored. */
  updatedAt: number;
}

/** Lists (or refreshes) the signed-in host's game. One listing per account. */
export async function publishGame(g: Omit<PublicGame, 'uid' | 'updatedAt'>) {
  if (!user) throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
  await setDoc(doc(db, 'rooms', user.uid), { ...g, updatedAt: serverTimestamp() });
}

export async function unpublishGame() {
  if (user) await deleteDoc(doc(db, 'rooms', user.uid));
}

export const myUid = () => user?.uid ?? null;
/** The database and the signed-in account, for the social layer. */
export const session = () => ({ db, user });

/** Live list of games refreshed within `freshMs`, newest first. Returns the unsubscribe. */
export function watchGames(freshMs: number, onGames: (games: PublicGame[]) => void, onError: (e: unknown) => void) {
  const q = query(collection(db, 'rooms'), where('updatedAt', '>', Timestamp.fromMillis(Date.now() - freshMs)), orderBy('updatedAt', 'desc'), limit(40));
  return onSnapshot(
    q,
    (snap) =>
      onGames(
        snap.docs.map((d) => {
          const x = d.data();
          return { ...(x as Omit<PublicGame, 'uid' | 'updatedAt'>), uid: d.id, updatedAt: tsToMs(x.updatedAt) ?? Date.now() };
        }),
      ),
    onError,
  );
}
