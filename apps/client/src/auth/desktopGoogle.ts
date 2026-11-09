import { GoogleAuthProvider, type OAuthCredential } from 'firebase/auth';

/*
 * Google sign-in in the Windows app. Google refuses embedded windows, so the app opens the player's
 * normal browser on this site's sign-in page (?desktopAuth), and that page hands the Google
 * credential back to the app over a loopback port the app listens on (apps/desktop bridge.rs).
 */

const BASE = 'http://127.0.0.1:47831';

export const isDesktopApp = () => typeof window !== 'undefined' && !!(window as unknown as { __CHROMASHIFT_DESKTOP__?: boolean }).__CHROMASHIFT_DESKTOP__;

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

/** App side: opens the browser, then waits (up to three minutes) for the credential to come back. */
export async function desktopGoogleCredential(): Promise<OAuthCredential> {
  try {
    await fetch(`${BASE}/start`, { method: 'POST' });
  } catch {
    throw fail('DESKTOP_BRIDGE', 'Couldn’t open the browser for Google sign-in.');
  }
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${BASE}/wait`);
      if (r.status === 200) {
        const j = (await r.json()) as { idToken?: string; accessToken?: string };
        if (j.idToken || j.accessToken) return GoogleAuthProvider.credential(j.idToken, j.accessToken);
      }
    } catch {
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
  throw fail('auth/popup-closed-by-user', 'Google sign-in timed out.');
}

/** Browser side: the page the app opens. Signs in with Google and passes the credential to the app. */
export async function runDesktopAuthPage() {
  const [{ initializeApp }, auth, { env }] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('../env')]);
  const root = document.getElementById('root')!;
  document.title = 'CHROMASHIFT sign-in';
  root.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;background:#120f17;color:#f3eef7;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px"><main style="max-width:380px">
    <h1 style="margin:0 0 8px;letter-spacing:.04em">CHROMASHIFT</h1>
    <p id="m" style="color:#b8adc4;margin:0 0 18px">Sign in with Google to continue in the desktop app.</p>
    <button id="b" style="padding:12px 22px;font:inherit;font-weight:700;border:0;background:#ff4f9a;color:#120f17;cursor:pointer">Continue with Google</button></main></div>`;
  const msg = document.getElementById('m')!;
  const btn = document.getElementById('b') as HTMLButtonElement;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const a = auth.initializeAuth(initializeApp({ ...env.firebase }, 'bridge'), { persistence: auth.inMemoryPersistence, popupRedirectResolver: auth.browserPopupRedirectResolver });
      const p = new auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      const res = await auth.signInWithPopup(a, p);
      const cred = auth.GoogleAuthProvider.credentialFromResult(res);
      if (!cred) throw new Error('No credential');
      // This page must not leave an account behind: the app signs in (or turns the account away) itself.
      if (auth.getAdditionalUserInfo(res)?.isNewUser) await res.user.delete().catch(() => undefined);
      await auth.signOut(a);
      await fetch(`${BASE}/done`, { method: 'POST', body: JSON.stringify({ idToken: cred.idToken, accessToken: cred.accessToken }) });
      btn.remove();
      msg.textContent = 'Done. You can close this tab and go back to CHROMASHIFT.';
    } catch (e) {
      btn.disabled = false;
      msg.textContent = `That didn’t work (${(e as { code?: string }).code ?? (e as Error).message}). Try again, and keep the CHROMASHIFT app open.`;
    }
  };
}
