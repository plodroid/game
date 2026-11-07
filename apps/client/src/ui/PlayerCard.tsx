import { useEffect, useState } from 'react';
import { itemsFor, titleName, type Slot } from '@chromashift/shared';
import { useAccount } from '../auth/account';
import type { Card } from '../auth/social';
import { portrait } from '../characters/portrait';
import { social, useSocial } from '../state/social';
import { useUi } from '../state/ui';
import { bannerCss } from './banner';
import { Icon } from './icons';
import { Button } from './kit';

const nameOf = (slot: Exclude<Slot, 'weapon'>, id: string) => itemsFor(slot).find((o) => o.id === id)?.name ?? id;

export const seen = (c?: Card) =>
  !c ? '' : c.online ? (c.activity === 'match' ? 'In a match' : c.activity === 'lobby' ? 'In a lobby' : 'Online') : c.seenAt ? `Last seen ${new Date(c.seenAt).toLocaleDateString()}` : 'Offline';

/** Another player's public card: their look, title, level and record, and what you can do. */
export default function PlayerCard({ uid }: { uid: string }) {
  const s = useSocial();
  const me = useAccount((a) => a.user?.uid);
  const go = useUi((u) => u.go);
  const [card, setCard] = useState<Card | null>(s.cards[uid] ?? null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (s.cards[uid]) return setCard(s.cards[uid]);
    void social((x) => x.getCard(uid)).then((c) => (c ? setCard(c) : setMissing(true)));
  }, [uid, s.cards]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && s.view(null);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [s]);

  const f = s.friendships.find((x) => x.other === uid);
  const inParty = s.party?.members.includes(uid);
  const invited = (s.party?.invites[uid] ?? 0) > Date.now();
  const title = card ? titleName(card.cosmetics.title) : '';
  const img = card ? portrait(card.cosmetics, 0, 'bust') : null;

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && s.view(null)}>
      <div className="modal player-card" role="dialog" aria-label={card ? `${card.displayName}’s card` : 'Player card'}>
        <button className="note__x player-card__x" aria-label="Close" onClick={() => s.view(null)}>
          <Icon.close />
        </button>
        {missing && <p className="muted">This player’s card isn’t available.</p>}
        {card && (
          <>
            <div className="player-card__banner" style={{ background: bannerCss(card.cosmetics.banner) }}>
              {img && <img src={img} alt="" draggable={false} />}
            </div>
            <div className="player-card__who">
              <h2 className="header__title" style={{ fontSize: '2rem' }}>
                {card.displayName}
              </h2>
              {title && <span className="player-card__title">{title}</span>}
              <span className="muted small">
                @{card.username} · Level {card.level} · <span className={`dot ${card.online ? 'dot--ok' : ''}`} />
                {seen(card)}
              </span>
              {card.createdAt && <span className="muted small">Account made {new Date(card.createdAt).toLocaleDateString([], { dateStyle: 'long' })}</span>}
            </div>
            {card.stats && (
              <div className="stats" style={{ margin: '14px 0' }}>
                {(
                  [
                    ['Games', card.stats.games],
                    ['Wins', card.stats.wins],
                    ['Splats', card.stats.kills],
                    ['Turf painted', Math.round(card.stats.paint)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="stat">
                    <div className="stat__v">{v.toLocaleString()}</div>
                    <div className="stat__k">{k}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small">
              Wearing {nameOf('hair', card.cosmetics.hair)}, {nameOf('headgear', card.cosmetics.headgear)}, {nameOf('outfit', card.cosmetics.outfit)} and {nameOf('back', card.cosmetics.back)}.
            </p>
            {uid !== me && (
              <div className="row" style={{ marginTop: 14 }}>
                {!f && (
                  <Button variant="primary" onClick={() => void social((x) => x.addFriend(uid), `Friend request sent to ${card.displayName}`)}>
                    <Icon.plus /> Add friend
                  </Button>
                )}
                {f?.status === 'pending' && f.requester === me && <Button disabled>Request sent</Button>}
                {f?.status === 'pending' && f.requester !== me && (
                  <Button variant="primary" onClick={() => void social((x) => x.acceptFriend(f), `You and ${card.displayName} are friends now`)}>
                    <Icon.check /> Accept request
                  </Button>
                )}
                {f?.status === 'accepted' && (
                  <Button
                    onClick={() => {
                      s.view(null);
                      s.talk(uid);
                      go('social');
                    }}
                  >
                    <Icon.chat /> Message
                  </Button>
                )}
                {!inParty && (
                  <Button disabled={invited} onClick={() => void social((x) => x.inviteToParty(uid), `Party invite sent. It lasts 5 minutes.`)}>
                    <Icon.party /> {invited ? 'Invite sent' : 'Invite to party'}
                  </Button>
                )}
                {f?.status === 'accepted' && (
                  <Button variant="ghost" onClick={() => void social((x) => x.removeFriend(f), `Removed ${card.displayName} from friends`)}>
                    Remove friend
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
