import { useEffect, useState } from 'react';
import { passwordStrength, validateEmail, validatePassword } from '@chromashift/shared';
import { act, useAccount } from '../auth/account';
import { useProfile } from '../state/profile';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { Button, Field, Toggle } from './kit';

/** Sign-in safety: a linked Google account to get back in, the password, and an optional email. */
export function AccountPanel() {
  const acc = useAccount();
  const username = useProfile((s) => s.username);
  const toast = useUi((s) => s.toast);
  const [email, setEmail] = useState('');
  const [updates, setUpdates] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pw, setPw] = useState<{ open: boolean; current: string; next: string; err: string | null }>({ open: false, current: '', next: '', err: null });

  useEffect(() => {
    void act(async (m) => {
      const info = await m.loadPrivate();
      setEmail(info?.email ?? '');
      setUpdates(!!info?.updates);
      setLoaded(true);
    });
  }, []);

  const saveEmail = async () => {
    const bad = email.trim() ? validateEmail(email) : null;
    if (bad) return toast({ text: bad, kind: 'error' });
    const ok = await act(async (m) => (await m.savePrivate({ email, updates }), true));
    if (ok) toast({ text: email.trim() ? 'Email saved. Only you can see it.' : 'Email removed.', kind: 'success' });
  };

  const changePw = async () => {
    const err = validatePassword(pw.next, username);
    if (err) return setPw({ ...pw, err });
    const ok = await act(async (m) => (await m.changePassword(pw.current || null, pw.next), true));
    if (ok) {
      toast({ text: 'Password changed.', kind: 'success' });
      setPw({ open: false, current: '', next: '', err: null });
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Account &amp; security</h2>
      <p className="muted small" style={{ margin: '0 0 14px' }}>
        Signed in as <b>@{username}</b>. Sync:{' '}
        {acc.sync === 'synced' ? 'up to date' : acc.sync === 'syncing' ? 'saving…' : acc.sync === 'pending' ? 'saved here, syncing when possible' : acc.sync === 'error' ? 'failed, retrying' : 'idle'}
      </p>

      <div className="setting">
        <div>
          <div className="setting__name">Google account</div>
          <div className="setting__hint">{acc.user?.google ? 'Linked. Use it to get back in if you forget your password.' : 'Link one as a way back in if you forget your password.'}</div>
        </div>
        <div className="setting__ctl">
          {acc.user?.google ? (
            <Button variant="ghost" disabled={acc.busy} onClick={() => void act((m) => m.unlinkGoogle())}>
              Unlink
            </Button>
          ) : (
            <Button disabled={acc.busy} onClick={() => void act(async (m) => (await m.linkGoogle(), toast({ text: 'Google linked.', kind: 'success' })))}>
              <Icon.google /> Link Google
            </Button>
          )}
        </div>
      </div>

      <div className="setting">
        <div>
          <div className="setting__name">Password</div>
          <div className="setting__hint">Handled by Firebase Authentication; CHROMASHIFT never sees it.</div>
        </div>
        <div className="setting__ctl">
          <Button onClick={() => setPw({ ...pw, open: !pw.open })}>{pw.open ? 'Cancel' : 'Change'}</Button>
        </div>
      </div>
      {pw.open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void changePw();
          }}
          style={{ margin: '4px 0 12px' }}
        >
          <Field label="Current password" hint="Leave empty right after signing in with your linked Google account.">
            <input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" error={pw.err}>
            <input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value, err: null })} />
          </Field>
          {pw.next && (
            <div className="strength" data-level={passwordStrength(pw.next)}>
              <span className="strength__bar">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} data-on={i < passwordStrength(pw.next)} />
                ))}
              </span>
            </div>
          )}
          <Button variant="primary" type="submit" disabled={acc.busy}>
            Set new password
          </Button>
        </form>
      )}

      <div className="setting">
        <div>
          <div className="setting__name">Email (optional)</div>
          <div className="setting__hint">For game updates and security notices. Private: never on your public card.</div>
        </div>
        <div className="setting__ctl" style={{ flexWrap: 'wrap' }}>
          <input className="input" type="email" placeholder="you@email" value={email} disabled={!loaded} onChange={(e) => setEmail(e.target.value)} aria-label="Email" style={{ flex: 1, minWidth: 180 }} />
        </div>
      </div>
      {email.trim() && (
        <div className="setting">
          <div className="setting__name">Send me game updates</div>
          <div className="setting__ctl">
            <Toggle checked={updates} onChange={setUpdates} label="Send me game updates" />
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <Button disabled={!loaded || acc.busy} onClick={() => void saveEmail()}>
          Save email
        </Button>
        <span className="spacer" />
        <Button variant="danger" disabled={acc.busy} onClick={() => void act((m) => m.signOut())}>
          Sign out
        </Button>
      </div>
      {acc.error && <p className="field__error">{acc.error}</p>}
    </section>
  );
}
