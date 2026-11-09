import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import { sanitizeCosmetics, type Cosmetics } from '@chromashift/shared';
import { env, firebaseConfigured } from '../env';
import { loginId } from './firebase';

/*
 * Player 2 can sign in to their own account on the same device. It is a second, separate Firebase
 * session (kept in memory only), so player 1 stays signed in as they were. It only reads the
 * account's name and loadout; progress from split-screen matches is not saved to it.
 */

export interface P2Account {
  uid: string;
  name: string;
  weapon: string;
  special: string;
  cosmetics: Cosmetics;
}

export async function signInP2(name: string, password: string): Promise<P2Account> {
  if (!firebaseConfigured) throw new Error('Accounts are not available in this build.');
  const fresh = !getApps().some((a) => a.name === 'p2');
  const app = fresh ? initializeApp({ ...env.firebase }, 'p2') : getApp('p2');
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const db = getFirestore(app);
  if (fresh && env.emulator) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }
  const cred = await signInWithEmailAndPassword(auth, loginId(name), password);
  const snap = await getDoc(doc(db, 'users', cred.user.uid));
  const d = (snap.data() ?? {}) as { displayName?: string; username?: string; weapon?: string; special?: string; cosmetics?: Partial<Cosmetics> };
  return {
    uid: cred.user.uid,
    name: d.displayName || d.username || name,
    weapon: d.weapon ?? 'pulse',
    special: d.special ?? 'surge',
    cosmetics: sanitizeCosmetics(d.cosmetics),
  };
}
