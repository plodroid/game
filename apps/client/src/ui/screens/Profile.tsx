import { useState } from 'react';
import { ACCENTS, EMOTES, HAIR, HEADGEAR, levelInfo, OUTFITS, validateDisplayName, WEAPONS } from '@chromashift/shared';
import { act, useAccount } from '../../auth/account';
import { firebaseConfigured } from '../../env';
import { favouriteWeapon, publicName, useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { Avatar } from '../Avatar';
import { Button, Field, Header } from '../kit';

const nameOf = (list: { id: string; name: string }[], id: string) => list.find((o) => o.id === id)?.name ?? id;

export default function Profile() {
  const p = useProfile();
  const acc = useAccount();
  const go = useUi((s) => s.go);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.displayName);
  const [err, setErr] = useState<string | null>(null);
  const l = levelInfo(p.xp);
  const st = p.stats;
  const fav = favouriteWeapon(st);
  const signedIn = acc.status === 'signedIn' && !!p.uid;
  const winRate = st.games ? Math.round((st.wins / st.games) * 100) : 0;

  const save = async () => {
    const e = validateDisplayName(name);
    if (e) return setErr(e);
    if (signedIn) await act((m) => m.updateDisplayName(name));
    else p.patch({ displayName: name.trim() });
    setErr(null);
    setEditing(false);
  };

  return (
    <main className="screen" data-pig="gold">
      <Header title="Profile" />
      <div className="col stagger">
        <section className="panel">
          <div className="row" style={{ gap: 16 }}>
            <Avatar cosmetics={p.cosmetics} name={publicName(p)} large />
            <div style={{ minWidth: 0 }}>
              <div className="header__title" style={{ fontSize: '1.6rem' }}>
                {publicName(p)}
              </div>
              <div className="muted small">
                {signedIn ? `@${p.username}` : 'Guest'} · Level {l.level} · joined {new Date(p.createdAt).toLocaleDateString()}
              </div>
              <div className="xpbar" style={{ marginTop: 10, width: 220 }}>
                <div className="xpbar__fill" style={{ transform: `scaleX(${l.progress})` }} />
              </div>
            </div>
          </div>
          {editing ? (
            <div style={{ marginTop: 16 }}>
              <Field label="Display name" error={err} hint="Shown to other players. Your username stays the same.">
                <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoFocus />
              </Field>
              <div className="row">
                <Button variant="primary" onClick={() => void save()}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 16 }}>
              <Button onClick={() => (setName(p.displayName), setEditing(true))}>Edit display name</Button>
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">Offline &amp; casual record</h2>
          <div className="stats">
            {[
              ['Matches', st.games],
              ['Wins', st.wins],
              ['Losses', st.losses],
              ['Win rate', `${winRate}%`],
              ['KOs', st.kills],
              ['Assists', st.assists],
              ['Paint (m²)', Math.round(st.paint).toLocaleString()],
              ['Best paint', st.bestPaint],
            ].map(([k, v]) => (
              <div key={k} className="stat">
                <div className="stat__v">{v}</div>
                <div className="stat__k">{k}</div>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: '12px 0 0' }}>
            Favourite weapon: {fav ? WEAPONS[fav].name : '—'}. Offline results are tracked on your device{signedIn ? ' and synced to your account' : ''}.
          </p>
        </section>

        {signedIn && (
          <section className="panel">
            <h2 className="panel__title">Verified online record</h2>
            {acc.verified ? (
              <div className="stats">
                {[
                  ['Online matches', acc.verified.games],
                  ['Online wins', acc.verified.wins],
                  ['Online KOs', acc.verified.kills],
                  ['Online paint', Math.round(acc.verified.paint)],
                ].map(([k, v]) => (
                  <div key={k} className="stat">
                    <div className="stat__v">{v}</div>
                    <div className="stat__k">{k}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Recorded by game servers configured with verified results. Play online on such a server to build this record.
              </p>
            )}
          </section>
        )}

        <section className="panel">
          <h2 className="panel__title">Equipped</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {WEAPONS[p.weapon].name} · {nameOf(HAIR, p.cosmetics.hair)} · {nameOf(HEADGEAR, p.cosmetics.headgear)} · {nameOf(OUTFITS, p.cosmetics.outfit)} ·{' '}
            {nameOf(ACCENTS, p.cosmetics.accent)} · {nameOf(EMOTES, p.cosmetics.emote)}
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <Button onClick={() => go('locker')}>Open locker</Button>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">Account</h2>
          {!firebaseConfigured ? (
            <p className="muted small" style={{ margin: 0 }}>
              Accounts aren’t configured on this build, so everything is saved on this device. See the README to enable Firebase sign-in.
            </p>
          ) : signedIn ? (
            <>
              <p className="muted small" style={{ margin: '0 0 12px' }}>
                Signed in{acc.user?.email ? ` as ${maskEmail(acc.user.email)}` : ''} with {acc.user?.provider === 'google' ? 'Google' : 'email'}. Sync:{' '}
                {acc.sync === 'synced' ? 'up to date' : acc.sync === 'syncing' ? 'saving…' : acc.sync === 'pending' ? 'saved on this device, will sync when possible' : acc.sync === 'error' ? 'failed, retrying' : 'idle'}
              </p>
              <Button variant="danger" disabled={acc.busy} onClick={() => void act((m) => m.signOut())}>
                Sign out
              </Button>
            </>
          ) : acc.status === 'needsUsername' ? (
            <Button variant="primary" onClick={() => go('auth')}>
              Choose your username
            </Button>
          ) : (
            <>
              <p className="muted small" style={{ margin: '0 0 12px' }}>
                Sign in to sync your level, unlocks and settings across browsers and the installed app. Your guest progress is kept when you create an account.
              </p>
              <Button variant="primary" onClick={() => go('auth')}>
                Sign in or create account
              </Button>
              {acc.status === 'unavailable' && <p className="field__error">{acc.error}</p>}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}
