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
  getDocs,
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
  type SetOptions,
} from 'firebase/firestore';
import { levelInfo, sanitizeCosmetics, STARTING_COINS, usernameKey, validateDisplayName, validateEmail, validatePassword, validateUsername, type Cosmetics } from '@chromashift/shared';
import { env } from '../env';
import { settingsSnapshot, useSettings, type Settings } from '../settings/settings';
import { mergeSynced, same, type Synced } from '../state/merge';
import { newProfile, useProfile, type Profile, type Stats } from '../state/profile';
import { setWeaponConfig } from '../weapons/custom';
import { useAccount, type AccountUser } from './account';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let user: User | null = null;
/** A sign-up is creating the profile; the auth listener mustn't report it missing meanwhile. */
let claiming = false;
/** What this device and the cloud last agreed on: the base for merging another device's saves. */
let base: Synced | null = null;
/** Set while cloud data is applied, so applying it doesn't queue a save of the same data. */
let applying = false;
let stopUserDoc: (() => void) | null = null;

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
  favs?: string[];
  quests?: Profile['quests'];
  banned?: boolean;
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
  // Phone networks and webviews often break Firestore's streaming channel ("unavailable"), so fall back to long polling.
  db = initializeFirestore(app, env.emulator ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), experimentalAutoDetectLongPolling: true });
  if (env.emulator) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }
  await getRedirectResult(auth).catch(() => null);
  await loadWeaponConfig();
  onAuthStateChanged(auth, (u) => void onUser(u));
}

const providerOf = (u: User): AccountUser['provider'] =>
  u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : u.providerData.some((p) => p.providerId === 'password') ? 'password' : 'other';

async function onUser(u: User | null) {
  user = u;
  stopUserDoc?.();
  stopUserDoc = null;
  base = null;
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
  // The account is watched live, so whatever another device saves (the app, the site, a phone)
  // shows up here straight away instead of at the next sign-in.
  let first = true;
  const settle = () => {
    first = false;
    clearTimeout(slow);
  };
  // Offline with nothing cached: keep playing on the local copy and sync later.
  const slow = setTimeout(
    () => first && useAccount.setState({ status: 'signedIn', sync: 'pending' }),
    10_000,
  );
  stopUserDoc = onSnapshot(
    doc(db, 'users', u.uid),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      if (!snap.exists()) {
        if (first && !claiming) useAccount.setState({ status: 'needsUsername' });
        settle();
        return;
      }
      const d = snap.data() as UserDoc;
      if (d.banned) {
        settle();
        useAccount.setState({ error: 'This account has been banned.' });
        void fbSignOut(auth);
        return;
      }
      if (first || !base) {
        settle();
        applyCloud(u.uid, d);
        useAccount.setState({ status: 'signedIn', sync: 'synced', error: null });
        void loadVerified(u.uid);
      } else receive(u.uid, d);
    },
    (e) => {
      console.warn('Profile load failed', e);
      settle();
      useAccount.setState({ status: 'signedIn', sync: 'pending' });
    },
  );
}

/** This device's synced data, in the same shape as the cloud copy. */
function localSynced(): Synced {
  const p = useProfile.getState();
  return {
    displayName: p.displayName,
    xp: p.xp,
    stats: p.stats,
    weapon: p.weapon,
    special: p.special,
    cosmetics: p.cosmetics,
    coins: p.coins,
    owned: p.owned,
    favs: p.favs,
    quests: p.quests,
    settings: settingsSnapshot(),
  };
}

function docToSynced(uid: string, d: UserDoc): Synced {
  const local = useProfile.getState();
  const mine = local.uid === uid;
  const strings = (x: unknown) =>
    Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string') : null;
  return {
    displayName: d.displayName || d.username,
    xp: Math.max(0, d.xp || 0),
    stats: { ...newProfile().stats, ...d.stats },
    weapon: d.weapon ?? local.weapon,
    special: d.special ?? local.special,
    cosmetics: sanitizeCosmetics(d.cosmetics),
    // Accounts from before the shop keep this device's copy.
    coins:
      typeof d.coins === 'number' ? Math.max(0, Math.floor(d.coins)) : mine ? local.coins : STARTING_COINS,
    owned: strings(d.owned) ?? (mine ? local.owned : []),
    favs: strings(d.favs) ?? (mine ? local.favs : []),
    quests:
      d.quests && typeof d.quests === 'object'
        ? { ...newProfile().quests, ...d.quests }
        : mine
          ? local.quests
          : newProfile().quests,
    settings: d.settings ?? {},
  };
}

function apply(uid: string, d: UserDoc, s: Synced, dirty: boolean) {
  applying = true;
  try {
    const local = useProfile.getState();
    const { settings, ...rest } = s;
    const p: Profile = {
      ...newProfile(),
      ...rest,
      weapon: s.weapon as Profile['weapon'],
      special: s.special as Profile['special'],
      uid,
      username: d.username,
      createdAt: tsToMs(d.createdAt) ?? local.createdAt,
      dirty,
      updatedAt: Date.now(),
    };
    useProfile.getState().replace(p);
    if (Object.keys(settings).length) useSettings.getState().load(settings);
  } finally {
    applying = false;
  }
}

/** Takes the cloud copy as this device's state. */
function applyCloud(uid: string, d: UserDoc) {
  apply(uid, d, docToSynced(uid, d), false);
  base = localSynced();
}

/** Another device saved: take it as it is, or merge it with this device's unsaved changes. */
function receive(uid: string, d: UserDoc) {
  const remote = docToSynced(uid, d);
  // Our own save coming back, or nothing that matters changed.
  if (!base || same(remote, base)) return;
  if (same(localSynced(), base)) return applyCloud(uid, d);
  const merged = mergeSynced(base, localSynced(), remote);
  apply(uid, d, merged, true);
  base = remote;
  scheduleSync(1000);
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
    favs: local.uid ? [] : local.favs,
    quests: local.quests,
    settings: s,
  };
  await runTransaction(db, async (tx) => {
    const nameRef = doc(db, 'usernames', key);
    if ((await tx.get(nameRef)).exists()) throw new Error('USERNAME_TAKEN');
    tx.set(nameRef, { uid: u.uid, name: username.trim(), createdAt: serverTimestamp() });
    tx.set(doc(db, 'users', u.uid), data);
    tx.set(doc(db, 'profiles', u.uid), publicDoc(username.trim(), username.trim(), data.xp, data.cosmetics, data.stats, serverTimestamp()));
  });
  applyCloud(u.uid, { ...data, createdAt: null, updatedAt: null });
  useAccount.setState({ status: 'signedIn', sync: 'synced', error: null });
}

/** The public card other players see: no email, no settings, nothing private. */
const publicDoc = (username: string, displayName: string, xp: number, cosmetics: Cosmetics, stats: Stats, createdAt: unknown) => ({
  createdAt,
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
  const u = user;
  if (!u || !p.uid || p.uid !== u.uid || !p.username) return;
  useAccount.setState({ sync: 'syncing' });
  const ref = doc(db, 'users', u.uid);
  const sent = localSynced();
  // Each synced field is replaced whole (not deep-merged), so the cloud copy matches exactly.
  const opts = (data: Synced): SetOptions => ({ mergeFields: [...Object.keys(data), 'updatedAt'] });
  try {
    let result: { data: Synced; cloud: UserDoc | null };
    try {
      // A transaction, so two devices saving at the same moment can't overwrite each other:
      // anything another device saved since this one last synced is merged in before writing.
      result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cloud = snap.exists() ? (snap.data() as UserDoc) : null;
        const remote = cloud ? docToSynced(u.uid, cloud) : null;
        const data = remote && base && !same(remote, base) ? mergeSynced(base, sent, remote) : sent;
        tx.set(ref, { ...data, updatedAt: serverTimestamp() }, opts(data));
        return { data, cloud };
      });
    } catch (e) {
      // Offline: transactions need the server, so queue a plain write that goes out on reconnect.
      if ((e as { code?: string }).code !== 'unavailable') throw e;
      void setDoc(ref, { ...sent, updatedAt: serverTimestamp() }, opts(sent)).catch(() => undefined);
      result = { data: sent, cloud: null };
    }
    const { data, cloud } = result;
    const now = localSynced();
    if (same(now, sent)) {
      // Nothing changed here during the save: take the merged result.
      if (cloud && !same(data, sent)) apply(u.uid, cloud, data, false);
      base = localSynced();
      useProfile.setState({ dirty: false });
    } else {
      // Changes made during the save go on top of the merged result and save next.
      if (cloud) apply(u.uid, cloud, mergeSynced(sent, now, data), true);
      base = data;
      scheduleSync(1000);
    }
    const q = useProfile.getState();
    await setDoc(
      doc(db, 'profiles', u.uid),
      publicDoc(q.username, q.displayName, q.xp, q.cosmetics, q.stats, Timestamp.fromMillis(q.createdAt)),
      { merge: true },
    );
    useAccount.setState({ sync: useProfile.getState().dirty ? 'pending' : 'synced' });
    backoff = 4000;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    useAccount.setState({ sync: code === 'unavailable' || code === 'resource-exhausted' ? 'pending' : 'error' });
    backoff = Math.min(backoff * 2, 5 * 60_000);
    scheduleSync(backoff);
  }
}

// Any local change while signed in is queued for sync (but not cloud data being applied).
useProfile.subscribe((s, prev) => {
  if (applying) return;
  if (user && s.uid && s.dirty && (s.updatedAt !== prev.updatedAt || !prev.dirty)) {
    useAccount.setState({ sync: 'pending' });
    scheduleSync(4000);
  }
});
let settingsRef = useSettings.getState();
useSettings.subscribe((s) => {
  if (s === settingsRef) return;
  settingsRef = s;
  if (applying || !user || !useProfile.getState().uid) return;
  if (base && same(settingsSnapshot(), base.settings)) return;
  useAccount.setState({ sync: 'pending' });
  scheduleSync(3000);
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
  /** A skill-matched random server (found with the Random server button). */
  random?: boolean;
  /** The host's skill rating, used to match players of a similar level. */
  skill?: number;
  /** Rough region of the host (from their time zone), so random servers are close. */
  region?: string;
  /** Server time of the last refresh, in ms; listings that stop refreshing are ignored. */
  updatedAt: number;
}

/** Lists (or refreshes) the signed-in host's game. One listing per account. */
export async function publishGame(g: Omit<PublicGame, 'uid' | 'updatedAt'>) {
  if (!user) throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
  await setDoc(doc(db, 'rooms', user.uid), { ...g, updatedAt: serverTimestamp() });
}

/** Open random servers in a region (one look, not live). */
export async function listRandomGames(freshMs: number, region: string): Promise<PublicGame[]> {
  const q = query(collection(db, 'rooms'), where('updatedAt', '>', Timestamp.fromMillis(Date.now() - freshMs)), orderBy('updatedAt', 'desc'), limit(60));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const x = d.data();
      return { ...(x as Omit<PublicGame, 'uid' | 'updatedAt'>), uid: d.id, updatedAt: tsToMs(x.updatedAt) ?? Date.now() };
    })
    .filter((g) => g.random === true && g.region === region);
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

/* ---------- The owner's weapon config ---------- */

/** Reads the weapon config everyone shares; a slow or missing one never holds the game up. */
async function loadWeaponConfig() {
  try {
    const s = await Promise.race([getDoc(doc(db, 'config', 'weapons')), new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), 3000))]);
    if (s.exists()) setWeaponConfig(String(s.data().json));
  } catch {
    /* offline: the built-in weapons */
  }
}

/** Owner only (the rules refuse anyone else). */
export async function saveWeaponConfig(json: string) {
  await setDoc(doc(db, 'config', 'weapons'), { json, updatedAt: serverTimestamp() });
  setWeaponConfig(json);
}

/* ---------- The owner joining a game ---------- */

/** The owner leaves a short note that they are about to join this game, so its host lets them in (full or not). */
export async function markAdminJoin(code: string) {
  await setDoc(doc(db, 'adminJoin', code), { at: serverTimestamp() });
}

/** True when the owner left that note in the last minute. */
export async function checkAdminJoin(code: string) {
  if (!user) return false;
  const d = (await getDoc(doc(db, 'adminJoin', code))).data();
  return !!d?.at && Date.now() - (d.at as Timestamp).toMillis() < 60_000;
}
