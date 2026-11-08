import { useEffect, useMemo, useState } from 'react';
import { previewWeapon, WEAPON_IDS, WEAPONS, type WeaponPart } from '@chromashift/shared';
import { saveWeaponConfig } from '../auth/firebase';
import { dropWeaponPortraits, weaponPortrait } from '../characters/portrait';
import { useProfile } from '../state/profile';
import { useUi } from '../state/ui';
import { configList, useWeapons } from '../weapons/custom';
import { Icon } from './icons';

type Draft = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const NUMBERS: [string, string, number][] = [
  ['price', 'Price', 1],
  ['damage', 'Damage', 1],
  ['fireInterval', 'Seconds per shot', 0.01],
  ['range', 'Range', 0.5],
  ['spread', 'Spread °', 0.5],
  ['projectileSpeed', 'Shot speed', 1],
  ['paintRadius', 'Paint size', 0.05],
  ['inkPerShot', 'Ink per shot', 0.05],
  ['moveWhileFiring', 'Speed while firing', 0.05],
  ['splashRadius', 'Splash size', 0.1],
  ['splashDamage', 'Splash damage', 1],
  ['dodgeCooldown', 'Dash cooldown', 0.05],
];
const LOOK_NUMBERS: [string, string][] = [
  ['len', 'Length ×'],
  ['bulk', 'Thickness ×'],
];
const PART_KEYS: [keyof WeaponPart, string][] = [
  ['x', 'Side'],
  ['y', 'Up'],
  ['z', 'Forward'],
  ['w', 'Width'],
  ['h', 'Height'],
  ['d', 'Length'],
];

/** A little starter model so a new gun isn't an empty screen: grip, body, barrel and sight. */
const STARTER: WeaponPart[] = [
  { s: 'box', x: 0, y: 0.01, z: 0.03, w: 0.05, h: 0.12, d: 0.06, c: 'dark' },
  { s: 'box', x: 0, y: 0.11, z: -0.06, w: 0.1, h: 0.1, d: 0.34, c: 'shell' },
  { s: 'cyl', x: 0, y: 0.12, z: -0.32, w: 0.05, h: 0.05, d: 0.22, c: 'dark' },
  { s: 'torus', x: 0, y: 0.12, z: -0.42, w: 0.07, h: 0.07, d: 0.07, c: 'team' },
  { s: 'box', x: 0, y: 0.19, z: -0.05, w: 0.04, h: 0.04, d: 0.14, c: 'team' },
];

const fromDef = (id: string): Draft => JSON.parse(JSON.stringify(WEAPONS[id]));
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

/** Owner only: add, tune and model weapons, and set limited sales. Saved for every player. */
export function AdminWeapons({ onClose }: { onClose: () => void }) {
  useWeapons((s) => s.v);
  const toast = useUi((s) => s.toast);
  const [q, setQ] = useState('');
  const [d, setD] = useState<Draft | null>(null);
  const [hours, setHours] = useState('0');
  const [busy, setBusy] = useState(false);
  const [pic, setPic] = useState<string | null>(null);

  // The live picture: drawn from the draft as you edit it.
  useEffect(() => {
    if (!d) return;
    previewWeapon(d);
    dropWeaponPortraits();
    setPic(weaponPortrait('preview-draft', 'factory'));
  }, [d]);

  const shown = useMemo(() => WEAPON_IDS.filter((id) => `${WEAPONS[id].name} ${id}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80), [q]);
  const set = (k: string, v: unknown) => setD((x) => x && { ...x, [k]: v });
  const setLook = (k: string, v: unknown) => setD((x) => x && { ...x, look: { ...x.look, [k]: v } });
  const parts: WeaponPart[] = d?.look?.parts ?? [];
  const setParts = (p: WeaponPart[]) => setLook('parts', p.length ? p : undefined);
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const pick = (id: string) => {
    setD(fromDef(id));
    setHours('0');
  };
  const fresh = () => {
    setD({ ...fromDef('pulse'), id: '', name: 'New weapon', tagline: 'Describe it.', price: 800, look: { len: 1, bulk: 1, extra: 'none', parts: STARTER } });
    setHours('0');
  };

  const save = async (patch: Draft = {}) => {
    if (!d) return;
    const out: Draft = { ...d, ...patch };
    out.id = out.id || slug(out.name) || 'weapon';
    if (!out.id || (!WEAPONS[out.id] && out.id.length < 2)) return toast({ text: 'Give it a name first.', kind: 'warn' });
    const h = num(hours);
    if (h > 0) out.limitedUntil = Date.now() + h * 3_600_000;
    else if (h < 0) delete out.limitedUntil;
    setBusy(true);
    try {
      await saveWeaponConfig(JSON.stringify([...configList().filter((w) => w.id !== out.id), out]));
      setD(fromDef(out.id));
      setHours('0');
      toast({ text: `${out.name} saved for everyone.`, kind: 'success' });
    } catch (e) {
      toast({ text: `Couldn’t save: ${(e as { code?: string }).code ?? (e as Error).message}`, kind: 'error' });
    }
    setBusy(false);
  };
  const toLocker = () => {
    if (!d?.id || !WEAPONS[d.id]) return toast({ text: 'Save it first.', kind: 'warn' });
    const p = useProfile.getState();
    useProfile.setState({ owned: [...new Set([...p.owned, `weapon:${d.id}`])], dirty: true, updatedAt: Date.now() });
    toast({ text: `${d.name} is in your locker.`, kind: 'success' });
  };
  const expires = d?.limitedUntil ? new Date(d.limitedUntil).toLocaleString() : null;

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal admin-weapons" role="dialog" aria-label="Admin weapons">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            {d ? (
              <button className="link" onClick={() => setD(null)}>
                <Icon.back size={16} /> Weapons
              </button>
            ) : (
              'Admin weapons'
            )}
          </h2>
          <button className="note__x" aria-label="Close" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>

        {!d && (
          <>
            <div className="row admin-tools__row">
              <label className="search" style={{ flex: 1 }}>
                <Icon.search />
                <input className="input" placeholder="Search weapons" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search weapons" />
              </label>
              <button className="btn btn--primary" onClick={fresh}>
                New weapon
              </button>
            </div>
            <div className="list">
              {shown.map((id) => (
                <button key={id} className="admin-row admin-row--btn" onClick={() => pick(id)}>
                  <span>{WEAPONS[id].name}</span>
                  <span className="muted small">
                    {WEAPONS[id].admin ? 'admin' : WEAPONS[id].limitedUntil ? 'limited' : `${WEAPONS[id].price} coins`}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {d && (
          <div className="admin-weapons__edit">
            <div className="admin-weapons__pic">{pic ? <img src={pic} alt="Preview" /> : <span className="muted small">Preview appears in the Locker’s 3D view.</span>}</div>
            <label className="admin-field">
              <span className="muted small">Name</span>
              <input className="input" value={d.name} maxLength={28} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="muted small">Description</span>
              <input className="input" value={d.tagline} maxLength={90} onChange={(e) => set('tagline', e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="muted small">Based on (plays like)</span>
              <select className="input" value={d.base} disabled={!!d.id && !!WEAPONS[d.id]} onChange={(e) => set('base', e.target.value)}>
                {['pulse', 'roller', 'arc', 'lobber', 'dual'].map((b) => (
                  <option key={b} value={b}>
                    {WEAPONS[b].name}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-tools__grid">
              {NUMBERS.map(([k, label, step]) => (
                <label key={k} className="admin-field">
                  <span className="muted small">{label}</span>
                  <input className="input" type="number" step={step} value={d[k]} onChange={(e) => set(k, num(e.target.value))} />
                </label>
              ))}
            </div>

            <h3 className="admin-weapons__h">Limited &amp; visibility</h3>
            <div className="admin-tools__grid">
              <label className="admin-field">
                <span className="muted small">Sell for (hours; 0 keeps, -1 = always)</span>
                <input className="input" type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
              </label>
              <label className="admin-field admin-check">
                <input type="checkbox" checked={!!d.admin} onChange={(e) => set('admin', e.target.checked || undefined)} />
                <span>Admin only</span>
              </label>
            </div>
            {expires && <p className="muted small">Sale {d.limitedUntil > Date.now() ? 'ends' : 'ended'} {expires}. Owners keep it.</p>}

            <h3 className="admin-weapons__h">Model</h3>
            <div className="admin-tools__grid">
              {LOOK_NUMBERS.map(([k, label]) => (
                <label key={k} className="admin-field">
                  <span className="muted small">{label}</span>
                  <input className="input" type="number" step={0.05} value={d.look[k]} onChange={(e) => setLook(k, num(e.target.value))} />
                </label>
              ))}
              {!parts.length && (
                <label className="admin-field">
                  <span className="muted small">Attachment</span>
                  <select className="input" value={d.look.extra} onChange={(e) => setLook('extra', e.target.value)}>
                    {['none', 'scope', 'drum', 'fins', 'tank', 'spikes', 'rings', 'grip'].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="row admin-tools__row">
              <button className="btn" onClick={() => setParts([...parts, { s: 'box', x: 0, y: 0.1, z: -0.1, w: 0.08, h: 0.08, d: 0.08, c: 'shell' }])}>
                Add part
              </button>
              <button className="btn btn--ghost" onClick={() => setParts(parts.length ? [] : STARTER)}>
                {parts.length ? 'Use the base model' : 'Model it by hand'}
              </button>
            </div>
            {parts.map((p, i) => {
              const edit = (patch: Partial<WeaponPart>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div className="admin-part" key={i}>
                  <div className="row admin-tools__row">
                    <select className="input" value={p.s} onChange={(e) => edit({ s: e.target.value as WeaponPart['s'] })} aria-label="Shape">
                      {['box', 'cyl', 'sphere', 'cone', 'torus'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <select className="input" value={p.c} onChange={(e) => edit({ c: e.target.value as WeaponPart['c'] })} aria-label="Colour">
                      {['team', 'dark', 'light', 'shell'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <button className="btn btn--ghost" onClick={() => setParts([...parts, { ...p, x: -p.x }])} aria-label="Mirror copy">
                      Mirror
                    </button>
                    <button className="btn btn--danger" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="Remove part">
                      ✕
                    </button>
                  </div>
                  <div className="admin-tools__grid admin-tools__grid--6">
                    {PART_KEYS.map(([k, label]) => (
                      <label key={k} className="admin-field">
                        <span className="muted small">{label}</span>
                        <input className="input" type="number" step={0.01} value={p[k] as number} onChange={(e) => edit({ [k]: num(e.target.value) })} />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {!!parts.length && (
              <div className="admin-tools__grid">
                <label className="admin-field">
                  <span className="muted small">Muzzle up</span>
                  <input className="input" type="number" step={0.01} value={d.look.muzzle?.[0] ?? 0.12} onChange={(e) => setLook('muzzle', [num(e.target.value), d.look.muzzle?.[1] ?? -0.45])} />
                </label>
                <label className="admin-field">
                  <span className="muted small">Muzzle forward</span>
                  <input className="input" type="number" step={0.01} value={d.look.muzzle?.[1] ?? -0.45} onChange={(e) => setLook('muzzle', [d.look.muzzle?.[0] ?? 0.12, num(e.target.value)])} />
                </label>
              </div>
            )}

            <div className="row admin-tools__row admin-weapons__save">
              <button className="btn btn--primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save for everyone'}
              </button>
              <button className="btn" onClick={toLocker}>
                Add to my locker
              </button>
              {d.id && WEAPONS[d.id] && (
                <button className="btn btn--danger" disabled={busy} onClick={() => window.confirm('Stop selling this weapon? Players who own it keep it.') && void save({ limitedUntil: 1 })}>
                  Retire
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
