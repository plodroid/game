import { create } from 'zustand';
import { firebaseConfigured } from '../env';
import { netHooks } from '../multiplayer/net';

export type AuthStatus = 'disabled' | 'loading' | 'signedOut' | 'needsUsername' | 'signedIn' | 'unavailable';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'error';

export interface AccountUser {
  uid: string;
  email: string | null;
  provider: 'google' | 'password' | 'other';
  photoURL: string | null;
  emailVerified: boolean;
  /** A Google account is linked as a way back in. */
  google: boolean;
}

export interface VerifiedStats {
  games: number;
  wins: number;
  losses: number;
  kills: number;
  paint: number;
  xp: number;
}

interface AccountStore {
  status: AuthStatus;
  user: AccountUser | null;
  error: string | null;
  sync: SyncStatus;
  verified: VerifiedStats | null;
  busy: boolean;
}

export const useAccount = create<AccountStore>()(() => ({
  status: firebaseConfigured ? 'loading' : 'disabled',
  user: null,
  error: null,
  sync: 'idle',
  verified: null,
  busy: false,
}));

type Impl = typeof import('./firebase');
let impl: Promise<Impl> | null = null;

/** Loads Firebase only when accounts are configured, so offline play never waits on it. */
export function accounts(): Promise<Impl> | null {
  if (!firebaseConfigured) return null;
  impl ??= import('./firebase').then(async (m) => {
    await m.start();
    return m;
  });
  impl.catch(() => {
    impl = null;
    useAccount.setState({ status: 'unavailable', error: 'The account service can’t be reached. Check your connection and try again.' });
  });
  return impl;
}

/** Runs an account action with busy/error handling for the forms. */
export async function act<T>(fn: (m: Impl) => Promise<T>): Promise<T | undefined> {
  const p = accounts();
  if (!p) {
    useAccount.setState({ error: 'Accounts aren’t configured on this build. Guest play is fully available.' });
    return undefined;
  }
  useAccount.setState({ busy: true, error: null });
  try {
    return await fn(await p);
  } catch (e) {
    useAccount.setState({ error: describeAuthError(e) });
    return undefined;
  } finally {
    useAccount.setState({ busy: false });
  }
}

netHooks.idToken = async () => {
  if (useAccount.getState().status !== 'signedIn') return undefined;
  const m = await accounts();
  return m?.idToken();
};

export function describeAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? (e instanceof Error ? e.message : '');
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Username or password is incorrect.',
    'auth/wrong-password': 'Username or password is incorrect.',
    'auth/user-not-found': 'No account has that username.',
    'auth/email-already-in-use': 'That username is taken. Try another, or sign in.',
    'auth/credential-already-in-use': 'That Google account is already linked to another player.',
    'auth/provider-already-linked': 'A Google account is already linked.',
    'auth/no-such-provider': 'No Google account is linked.',
    NO_LINKED_ACCOUNT: 'That Google account isn’t linked to a CHROMASHIFT account. Sign in with your username, then link Google from your profile.',
    'auth/weak-password': 'Choose a stronger password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/popup-closed-by-user': 'Sign-in window closed before finishing.',
    'auth/cancelled-popup-request': 'Sign-in window closed before finishing.',
    'auth/network-request-failed': 'Network error — check your connection and try again.',
    'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
    'auth/unauthorized-domain': 'This website isn’t authorised for sign-in yet (Firebase authorised domains).',
    'auth/operation-not-allowed': 'This sign-in method isn’t enabled for this game yet.',
    'auth/requires-recent-login': 'Please sign in again to do that.',
    USERNAME_TAKEN: 'That username is taken. Try another.',
    'resource-exhausted': 'The account service is busy (daily free quota reached). Your progress is saved on this device.',
    unavailable: 'The account service is unreachable right now. Your progress is saved on this device.',
    'permission-denied': 'The account service refused that change.',
  };
  for (const [k, v] of Object.entries(map)) if (code.includes(k)) return v;
  // Validation errors from the forms are already written for players.
  if (e instanceof Error && !(e as { code?: string }).code && /[a-z]\.$/.test(e.message)) return e.message;
  return code ? `Something went wrong (${code}).` : 'Something went wrong.';
}
