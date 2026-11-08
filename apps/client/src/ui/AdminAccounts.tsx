import { useEffect, useState } from 'react';
import { titleName, WEAPON_IDS, WEAPONS } from '@chromashift/shared';
import { audio } from '../audio/audio';
import type { AccountDetails, Card } from '../auth/social';
import { joinGame } from '../multiplayer/net';
import { social } from '../state/social';
import { useUi } from '../state/ui';
import { Avatar } from './Avatar';
import { Icon } from './icons';
import { seen } from './PlayerCard';

const day = (t?: number) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown (not synced yet)');

/** Owner only: everyone who has made an account, and each account's private details. */
export function AdminAccounts({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Card[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Card | null>(null);
  const [info, setInfo] = useState<AccountDetails | null>(null);
  useEffect(() => void social((x) => x.listAccounts()).then((l) => setList(l ?? [])), []);
  useEffect(() => {
    setInfo(null);
    if (open) void social((x) => x.accountDetails(open.uid)).then((d) => setInfo(d ?? null));
  }, [open]);

  const shown = (list ?? []).filter((c) => `${c.username} ${c.displayName}`.toLowerCase().includes(q.trim().toLowerCase()));
  const rows: [string, string][] = open
    ? [
        ['Username', `@${open.username}`],
        ['Account made', day(info?.createdAt ?? open.createdAt)],
        ['Email', info ? info.email || 'None given' : '…'],
        ['Wants update emails', info ? (info.wantsUpdates ? 'Yes' : 'No') : '…'],
        ['Level', String(open.level)],
        ['XP', info ? info.xp.toLocaleString() : '…'],
        ['Coins', info ? info.coins.toLocaleString() : '…'],
        ['Items owned', info ? String(info.owned) : '…'],
        ['Games / wins', info ? `${info.games} / ${info.wins}` : '…'],
        ['Status', seen(open)],
        ['Account id', open.uid],
      ]
    : [];

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="All accounts" style={{ width: 'min(560px, 94vw)', maxHeight: '86vh', overflow: 'auto' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="panel__title" style={{ margin: 0 }}>
            {open ? (
              <button className="link" onClick={() => setOpen(null)}>
                <Icon.back size={16} /> All accounts
              </button>
            ) : (
              `Accounts${list ? ` · ${list.length}` : ''}`
            )}
          </h2>
          <button className="note__x" aria-label="Close" onClick={onClose}>
            <Icon.close size={14} />
          </button>
        </div>
        {!open && (
          <>
            <label className="search" style={{ marginBottom: 10 }}>
              <Icon.search />
              <input className="input" placeholder="Search by username" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
            </label>
            <div className="list">
              {!list && <p className="empty">Loading…</p>}
              {list && shown.length === 0 && <p className="empty">No accounts found.</p>}
              {shown.map((c) => (
                <div className="person" key={c.uid}>
                  <button className="person__who" onClick={() => (audio.play('click'), setOpen(c))}>
                    <span className="person__avatar" data-online={!!c.online}>
                      <Avatar cosmetics={c.cosmetics} name={c.displayName} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="person__name">{c.displayName}</span>
                      <span className="muted small person__meta">
                        {titleName(c.cosmetics.title) ? `${titleName(c.cosmetics.title)} · ` : ''}Lv {c.level} · {c.createdAt ? `joined ${new Date(c.createdAt).toLocaleDateString()}` : seen(c)}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {open && (
          <dl style={{ margin: 0 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <Avatar cosmetics={open.cosmetics} name={open.displayName} />
              <b>{open.displayName}</b>
            </div>
            {rows.map(([k, v]) => (
              <div key={k} className="admin-row">
                <dt className="muted small">{k}</dt>
                <dd className="num" style={{ margin: 0, wordBreak: 'break-all' }}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {open && info && <AccountTools card={open} info={info} reload={() => setOpen({ ...open })} onClose={onClose} />}
      </div>
    </div>
  );
}

/** Owner actions on one account: join their game, edit their numbers, give a weapon, ban. */
function AccountTools({ card, info, reload, onClose }: { card: Card; info: AccountDetails; reload: () => void; onClose: () => void }) {
  const [coins, setCoins] = useState(String(info.coins));
  const [xp, setXp] = useState(String(info.xp));
  const [games, setGames] = useState(String(info.games));
  const [wins, setWins] = useState(String(info.wins));
  const [give, setGive] = useState('');
  const n = (v: string) => Math.max(0, Math.min(99_999_999, Math.floor(Number(v) || 0)));
  const edit = async (f: Parameters<typeof import('../auth/social').adminEdit>[1], ok: string) => {
    try {
      const x = await import('../auth/social');
      await x.adminEdit(card.uid, f);
      useUi.getState().toast({ text: ok, kind: 'success' });
      reload();
    } catch (e) {
      useUi.getState().toast({ text: `Couldn’t save: ${(e as { code?: string }).code ?? (e as Error).message}`, kind: 'error' });
    }
  };
  const teleport = async () => {
    const code = await social((x) => x.roomOf(card.uid));
    const ui = useUi.getState();
    if (!code) return ui.toast({ text: `${card.displayName} isn’t in a hosted game I can see (they need to be online on the newest version; offline games can’t be joined).`, kind: 'warn' });
    ui.toast({ text: `Joining ${card.displayName}’s game…` });
    try {
      await joinGame(code);
      onClose();
      ui.go('lobby');
    } catch {
      ui.toast({ text: 'Couldn’t join that game.', kind: 'error' });
    }
  };
  return (
    <div className="admin-tools">
      <div className="row admin-tools__row">
        <button className="btn" onClick={() => void teleport()}>
          Join their game
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => window.confirm(info.banned ? `Unban ${card.displayName}?` : `Ban ${card.displayName}? They are signed out and can’t sign in.`) && void edit({ banned: !info.banned }, info.banned ? 'Unbanned' : 'Banned')}
        >
          {info.banned ? 'Unban' : 'Ban'}
        </button>
      </div>
      <div className="admin-tools__grid">
        {(
          [
            ['Coins', coins, setCoins],
            ['XP', xp, setXp],
            ['Games', games, setGames],
            ['Wins', wins, setWins],
          ] as const
        ).map(([label, v, set]) => (
          <label key={label} className="admin-field">
            <span className="muted small">{label}</span>
            <input className="input" inputMode="numeric" value={v} onChange={(e) => set(e.target.value.replace(/D/g, ''))} />
          </label>
        ))}
      </div>
      <button
        className="btn"
        onClick={() => void edit({ coins: n(coins), xp: n(xp), stats: { ...info.stats, games: n(games), wins: Math.min(n(wins), n(games)) } }, 'Stats saved')}
      >
        Save stats
      </button>
      <div className="row admin-tools__row">
        <select className="input" value={give} onChange={(e) => setGive(e.target.value)} aria-label="Weapon to give">
          <option value="">Give a weapon…</option>
          {WEAPON_IDS.map((w) => (
            <option key={w} value={w}>
              {WEAPONS[w].name}
            </option>
          ))}
        </select>
        <button className="btn" disabled={!give} onClick={() => void edit({ owned: [...new Set([...info.ownedList, `weapon:${give}`])] }, 'Weapon given')}>
          Give
        </button>
      </div>
    </div>
  );
}
