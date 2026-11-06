import { useEffect, useState } from 'react';
import { passwordStrength, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, validateEmail, validatePassword, validateUsername } from '@chromashift/shared';
import { act, useAccount } from '../../auth/account';
import { firebaseConfigured } from '../../env';
import { useUi } from '../../state/ui';
import { BrandMark, Icon } from '../icons';
import { Button, Field, Toggle } from '../kit';

type Mode = 'signIn' | 'register' | 'recover' | 'username';

const STRENGTH = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

/** The way in. Every player signs in with a username and a password before playing. */
export default function Auth() {
  const acc = useAccount();
  const go = useUi((s) => s.go);
  const [mode, setMode] = useState<Mode>(acc.status === 'needsUsername' ? 'username' : 'signIn');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [updates, setUpdates] = useState(false);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [taken, setTaken] = useState<boolean | null>(null);

  useEffect(() => {
    if (acc.status === 'needsUsername') setMode('username');
    if (acc.status === 'signedOut') setMode((m) => (m === 'username' ? 'signIn' : m));
    if (acc.status === 'signedIn') go('home');
  }, [acc.status, go]);
  useEffect(() => {
    useAccount.setState({ error: null });
  }, [mode]);

  // Live username availability (debounced) while registering or claiming.
  useEffect(() => {
    if ((mode !== 'register' && mode !== 'username') || validateUsername(username)) return setTaken(null);
    const t = setTimeout(() => void act(async (m) => setTaken(!(await m.isUsernameFree(username)))), 450);
    return () => clearTimeout(t);
  }, [username, mode]);

  if (!firebaseConfigured)
    return (
      <main className="screen gate" data-pig="magenta">
        <div className="col panel">
          <p style={{ marginTop: 0 }}>This build of CHROMASHIFT doesn’t have accounts configured.</p>
          <p className="muted small">The README explains how to connect a free Firebase project.</p>
        </div>
      </main>
    );

  const submit = async () => {
    const e: Record<string, string | null> = {};
    if (mode === 'signIn') {
      e.username = username.trim() ? null : 'Enter your username.';
      e.password = password ? null : 'Enter your password.';
    }
    if (mode === 'register' || mode === 'username') e.username = validateUsername(username) ?? (taken ? 'That username is taken.' : null);
    if (mode === 'register') {
      e.password = validatePassword(password, username);
      e.confirm = password !== confirm ? 'Passwords don’t match.' : null;
      e.email = email.trim() ? validateEmail(email) : null;
    }
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    if (mode === 'signIn') await act((m) => m.signIn(username, password));
    if (mode === 'register') await act((m) => m.register(username, password, email, updates));
    if (mode === 'username') await act((m) => m.claimUsername(undefined, username));
  };

  const strength = passwordStrength(password);
  const titles: Record<Mode, [string, string]> = {
    signIn: ['Sign in', 'Welcome back. Your look, coins and friends are waiting.'],
    register: ['Create account', 'Pick a username and a strong password. That’s all you need.'],
    recover: ['Locked out?', 'If you linked a Google account, use it to get back in and set a new password.'],
    username: ['Choose your username', 'This is your public name in CHROMASHIFT.'],
  };

  return (
    <main className="screen gate" data-pig="magenta">
      <div className="gate__brand">
        <BrandMark size={40} />
        <span className="brand__word">Chromashift</span>
      </div>
      {mode !== 'username' && (
        <div className="seg gate__switch" role="tablist">
          {(['signIn', 'register'] as const).map((m) => (
            <button key={m} type="button" role="tab" className="seg__opt" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'signIn' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
      )}
      <h1 className="header__title gate__title">{titles[mode][0]}</h1>
      <p className="header__sub">{titles[mode][1]}</p>

      {mode === 'recover' ? (
        <div className="col panel gate__form">
          <Button variant="primary" block size="lg" disabled={acc.busy} onClick={() => void act((m) => m.signInLinkedGoogle())}>
            <Icon.google /> Sign in with linked Google
          </Button>
          <p className="muted small">After you’re in, set a new password from your profile. Google can’t be used to make a new account.</p>
          <p className="muted small">No Google linked? Account passwords can’t be recovered any other way, so link one from your profile once you’re signed in.</p>
          {acc.error && <p className="field__error">{acc.error}</p>}
          <Button variant="ghost" onClick={() => setMode('signIn')}>
            <Icon.back /> Back to sign in
          </Button>
        </div>
      ) : (
        <form
          className="col panel gate__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Username"
            error={errors.username ?? ((mode === 'register' || mode === 'username') && taken ? 'That username is taken.' : null)}
            hint={mode === 'signIn' ? undefined : taken === false ? 'Available' : `${USERNAME_MIN} to ${USERNAME_MAX} letters, numbers, . _ -`}
          >
            <input className="input" value={username} maxLength={mode === 'signIn' ? 80 : USERNAME_MAX} autoComplete="username" autoFocus onChange={(e) => setUsername(e.target.value)} />
          </Field>
          {mode !== 'username' && (
            <Field label="Password" error={errors.password} hint={mode === 'register' ? `${PASSWORD_MIN}+ characters with upper and lower case, a number and a symbol.` : undefined}>
              <span className="pw">
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={password}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="pw__show" onClick={() => setShow(!show)} aria-pressed={show}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </span>
            </Field>
          )}
          {mode === 'register' && password && (
            <div className="strength" data-level={strength} aria-live="polite">
              <span className="strength__bar">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} data-on={i < strength} />
                ))}
              </span>
              <span className="small">{STRENGTH[strength]}</span>
            </div>
          )}
          {mode === 'register' && (
            <>
              <Field label="Confirm password" error={errors.confirm}>
                <input className="input" type={show ? 'text' : 'password'} value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              <Field label="Email (optional)" error={errors.email} hint="Only for game updates and security notices. Never shown to other players.">
                <input className="input" type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
              </Field>
              {email.trim() && (
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
                  <span className="small">Send me game updates</span>
                  <Toggle checked={updates} onChange={setUpdates} label="Send me game updates" />
                </div>
              )}
            </>
          )}
          {acc.error && <p className="field__error">{acc.error}</p>}
          <Button variant="primary" block size="lg" type="submit" disabled={acc.busy}>
            {acc.busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Save username'}
          </Button>
          <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            {mode === 'signIn' && (
              <Button variant="ghost" onClick={() => setMode('recover')}>
                Forgot password?
              </Button>
            )}
            {mode === 'username' && (
              <Button variant="ghost" onClick={() => void act((m) => m.signOut())}>
                Cancel and sign out
              </Button>
            )}
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Passwords are handled by Firebase Authentication. CHROMASHIFT never stores or sees them.
          </p>
        </form>
      )}
    </main>
  );
}
