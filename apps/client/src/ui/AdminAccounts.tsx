import { useEffect, useState } from 'react';
import { titleName } from '@chromashift/shared';
import { audio } from '../audio/audio';
import type { AccountDetails, Card } from '../auth/social';
import { social } from '../state/social';
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
      </div>
    </div>
  );
}
