import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
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
import { levelInfo, sanitizeCosmetics, usernameKey, validateDisplayName, validateUsername, type Cosmetics } from '@chromashift/shared';
import { env } from '../env';
import { settingsSnapshot, useSettings, type Settings } from '../settings/settings';
import { newProfile, useProfile, type Profile, type Stats } from '../state/profile';
import { useAccount, type AccountUser } from './account';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let user: User | null = null;

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
  settings?: Partial<Settings>;
}

export async function start() {
  app = initializeApp({ ...env.firebase });
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
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
    user: { uid: u.uid, email: u.email, provider: providerOf(u), photoURL: u.photoURL, emailVerified: u.emailVerified },
    status: 'loading',
  });
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (!snap.exists()) {
      useAccount.setState({ status: 'needsUsername' });
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

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Popups are blocked in some installed-app contexts; fall back to a full redirect.
    if ((e as { code?: string }).code === 'auth/popup-blocked') await signInWithRedirect(auth, provider);
    else throw e;
  }
}

export async function signInEmail(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function isUsernameFree(name: string) {
  const s = await getDoc(doc(db, 'usernames', usernameKey(name)));
  return !s.exists();
}

export async function register(username: string, email: string, password: string) {
  const err = validateUsername(username);
  if (err) throw new Error(err);
  if (!(await isUsernameFree(username))) throw new Error('USERNAME_TAKEN');
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await claimUsername(cred.user, username);
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
    settings: s,
  };
  await runTransaction(db, async (tx) => {
    const nameRef = doc(db, 'usernames', key);
    if ((await tx.get(nameRef)).exists()) throw new Error('USERNAME_TAKEN');
    tx.set(nameRef, { uid: u.uid, name: username.trim(), createdAt: serverTimestamp() });
    tx.set(doc(db, 'users', u.uid), data);
    tx.set(doc(db, 'profiles', u.uid), publicDoc(username.trim(), username.trim(), data.xp, data.cosmetics));
  });
  applyCloud(u.uid, { ...data, createdAt: null, updatedAt: null });
  useAccount.setState({ status: 'signedIn', sync: 'synced', error: null });
}

const publicDoc = (username: string, displayName: string, xp: number, cosmetics: Cosmetics) => ({
  username,
  displayName,
  level: levelInfo(xp).level,
  cosmetics,
  updatedAt: serverTimestamp(),
});

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email.trim());
}

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
        settings: s,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await setDoc(doc(db, 'profiles', user.uid), publicDoc(p.username, p.displayName, p.xp, p.cosmetics), { merge: true });
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
