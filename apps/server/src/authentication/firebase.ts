import { readFileSync } from 'node:fs';
import { cert, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { MatchResult } from '@chromashift/shared';
import { config } from '../config';

let app: App | null = null;
let canWrite = false;

/**
 * Optional trusted backend. With only a project id the server can verify sign-ins;
 * with a service account it can also read usernames and write verified results.
 */
export function initFirebase() {
  if (!config.firebaseProjectId && !config.serviceAccount) {
    console.log('[auth] Firebase not configured — players join as guests.');
    return;
  }
  try {
    if (config.serviceAccount) {
      const raw = config.serviceAccount.trim().startsWith('{') ? config.serviceAccount : readFileSync(config.serviceAccount, 'utf8');
      const sa = JSON.parse(raw) as ServiceAccount & { project_id?: string };
      app = initializeApp({ credential: cert(sa), projectId: config.firebaseProjectId || sa.project_id });
      canWrite = true;
      console.log('[auth] Firebase Admin ready: verified sign-ins and results enabled.');
    } else {
      app = initializeApp({ projectId: config.firebaseProjectId });
      console.log('[auth] Firebase token verification enabled (no service account: results are not recorded).');
    }
  } catch (e) {
    console.error('[auth] Firebase Admin failed to start; continuing with guests only.', e);
    app = null;
  }
}

export interface Verified {
  uid: string;
  /** Username from the player's profile, when the server can read it. */
  username: string | null;
}

export async function verifyToken(token: unknown): Promise<Verified | null> {
  if (!app || typeof token !== 'string' || token.length > 4096) return null;
  try {
    const decoded = await getAuth(app).verifyIdToken(token);
    let username: string | null = null;
    if (canWrite) {
      const snap = await getFirestore(app).doc(`profiles/${decoded.uid}`).get();
      const u = snap.get('username');
      if (typeof u === 'string') username = u;
    }
    return { uid: decoded.uid, username };
  } catch {
    return null;
  }
}

/** Writes server-validated results. Clients can't write `stats/*` (see firestore.rules). */
export async function recordResults(result: MatchResult, xp: Record<number, number>): Promise<boolean> {
  if (!app || !canWrite) return false;
  const db = getFirestore(app);
  const batch = db.batch();
  let n = 0;
  for (const p of result.players) {
    if (!p.uid || p.bot) continue;
    const win = result.winner === p.team, draw = result.winner === -1;
    batch.set(
      db.doc(`stats/${p.uid}`),
      {
        games: FieldValue.increment(1),
        wins: FieldValue.increment(win ? 1 : 0),
        losses: FieldValue.increment(!win && !draw ? 1 : 0),
        kills: FieldValue.increment(p.kills),
        paint: FieldValue.increment(p.paint),
        xp: FieldValue.increment(xp[p.id] ?? 0),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    n++;
  }
  if (!n) return false;
  try {
    await batch.commit();
    return true;
  } catch (e) {
    console.error('[auth] Failed to record results', e);
    return false;
  }
}
