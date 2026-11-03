import { useEffect, useState } from 'react';
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, validateEmail, validatePassword, validateUsername } from '@chromashift/shared';
import { act, useAccount } from '../../auth/account';
import { firebaseConfigured } from '../../env';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';
import { Button, Field, Header } from '../kit';

type Mode = 'signIn' | 'register' | 'reset' | 'username';

export default function Auth() {
  const acc = useAccount();
  const go = useUi((s) => s.go);
  const toast = useUi((s) => s.toast);
  const [mode, setMode] = useState<Mode>(acc.status === 'needsUsername' ? 'username' : 'signIn');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [taken, setTaken] = useState<boolean | null>(null);

  useEffect(() => {
    if (acc.status === 'needsUsername') setMode('username');
    if (acc.status === 'signedIn') go('profile');
  }, [acc.status, go]);

  // Live username availability (debounced) while registering or claiming.
  useEffect(() => {
    if ((mode !== 'register' && mode !== 'username') || validateUsername(username)) return setTaken(null);
    const t = setTimeout(() => void act(async (m) => setTaken(!(await m.isUsernameFree(username)))), 450);
    return () => clearTimeout(t);
  }, [username, mode]);

  if (!firebaseConfigured)
    return (
      <main className="screen">
        <Header title="Accounts" />
        <div className="col panel">
          <p style={{ marginTop: 0 }}>This build of CHROMASHIFT doesn’t have accounts configured.</p>
          <p className="muted small">Everything works as a guest: offline matches, settings and progression are saved on this device. The README explains how to connect a free Firebase project.</p>
        </div>
      </main>
    );

  const submit = async () => {
    const e: Record<string, string | null> = {};
    if (mode === 'register' || mode === 'username') e.username = validateUsername(username) ?? (taken ? 'That username is taken.' : null);
    if (mode !== 'username') e.email = validateEmail(email);
    if (mode === 'register') {
      e.password = validatePassword(password);
      e.confirm = password !== confirm ? 'Passwords don’t match.' : null;
    }
    if (mode === 'signIn') e.password = password ? null : 'Enter your password.';
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    if (mode === 'signIn') await act((m) => m.signInEmail(email, password));
    if (mode === 'register') await act((m) => m.register(username, email, password));
    if (mode === 'username') await act((m) => m.claimUsername(undefined, username));
    if (mode === 'reset') {
      const ok = await act(async (m) => (await m.resetPassword(email), true));
      if (ok) {
        toast({ text: 'If an account uses that email, a reset link is on its way.', kind: 'success' });
        setMode('signIn');
      }
    }
  };

  const titles: Record<Mode, [string, string]> = {
    signIn: ['Sign in', 'Sync your level, unlocks and settings everywhere you play.'],
    register: ['Create account', 'Your guest progress comes with you.'],
    reset: ['Reset password', 'We’ll email you a link to choose a new password.'],
    username: ['Choose your username', 'This is your public name in CHROMASHIFT.'],
  };

  return (
    <main className="screen">
      <Header title={titles[mode][0]} sub={titles[mode][1]} />
      <form
        className="col panel"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {(mode === 'signIn' || mode === 'register') && (
          <>
            <Button block size="lg" disabled={acc.busy} onClick={() => void act((m) => m.signInGoogle())}>
              <Icon.google /> Continue with Google
            </Button>
            <div className="row" style={{ margin: '16px 0', color: 'var(--faint)', fontSize: '0.8rem' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> or with email <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
          </>
        )}
        {(mode === 'register' || mode === 'username') && (
          <Field
            label="Username"
            error={errors.username ?? (taken ? 'That username is taken.' : null)}
            hint={taken === false ? 'Available' : `${USERNAME_MIN}–${USERNAME_MAX} letters, numbers, . _ -`}
          >
            <input className="input" value={username} maxLength={USERNAME_MAX} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
          </Field>
        )}
        {mode !== 'username' && (
          <Field label="Email" error={errors.email}>
            <input className="input" type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        {(mode === 'signIn' || mode === 'register') && (
          <Field label="Password" error={errors.password} hint={mode === 'register' ? `At least ${PASSWORD_MIN} characters with letters and numbers.` : undefined}>
            <input className="input" type="password" value={password} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {mode === 'register' && (
          <Field label="Confirm password" error={errors.confirm}>
            <input className="input" type="password" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        {acc.error && <p className="field__error">{acc.error}</p>}
        <Button variant="primary" block size="lg" type="submit" disabled={acc.busy}>
          {acc.busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Save username'}
        </Button>
        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          {mode === 'signIn' && (
            <>
              <Button variant="ghost" onClick={() => setMode('register')}>
                Create an account
              </Button>
              <Button variant="ghost" onClick={() => setMode('reset')}>
                Forgot password?
              </Button>
            </>
          )}
          {(mode === 'register' || mode === 'reset') && (
            <Button variant="ghost" onClick={() => setMode('signIn')}>
              I already have an account
            </Button>
          )}
          {mode === 'username' && (
            <Button variant="ghost" onClick={() => void act((m) => m.signOut())}>
              Cancel and sign out
            </Button>
          )}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Passwords are handled by Firebase Authentication — CHROMASHIFT never stores them. Your email stays private.
        </p>
      </form>
    </main>
  );
}
