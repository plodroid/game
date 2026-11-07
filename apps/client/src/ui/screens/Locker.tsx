import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ACCENT_COLORS,
  COSMETIC_ITEMS,
  itemsFor,
  SKIN_TONES,
  SPECIAL_IDS,
  SPECIALS,
  WEAPON_IDS,
  WEAPONS,
  WHEEL,
  type Cosmetics,
  type Item,
  type Rarity,
  type Slot,
  type WeaponId,
} from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { menu } from '../../game/session';
import { peek, portrait, portraitKey, weaponKey, weaponPortrait, type Frame } from '../../characters/portrait';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { bannerCss } from '../banner';
import { Coin, Icon } from '../icons';
import { EmoteRing, emoteIcon, emoteName } from '../EmoteWheel';
import { Button, Header, Segmented } from '../kit';

type Tab = Exclude<Slot, 'weapon'> | 'weapon' | 'special' | 'skin' | 'favs';

const TABS: { id: Tab; label: string; group: 'Starred' | 'Loadout' | 'Look' | 'Show' }[] = [
  { id: 'favs', label: 'Favourites', group: 'Starred' },
  { id: 'weapon', label: 'Weapons', group: 'Loadout' },
  { id: 'finish', label: 'Finishes', group: 'Loadout' },
  { id: 'special', label: 'Specials', group: 'Loadout' },
  { id: 'hair', label: 'Hair', group: 'Look' },
  { id: 'hairColor', label: 'Hair colour', group: 'Look' },
  { id: 'headgear', label: 'Headgear', group: 'Look' },
  { id: 'face', label: 'Face', group: 'Look' },
  { id: 'outfit', label: 'Outfits', group: 'Look' },
  { id: 'back', label: 'Back', group: 'Look' },
  { id: 'accent', label: 'Colour', group: 'Look' },
  { id: 'skin', label: 'Body', group: 'Look' },
  { id: 'emote', label: 'Emotes', group: 'Show' },
  { id: 'title', label: 'Titles', group: 'Show' },
  { id: 'banner', label: 'Banners', group: 'Show' },
];

const FRAME: Partial<Record<Tab, Frame>> = { hair: 'side', headgear: 'hat', outfit: 'bust', accent: 'bust', back: 'back' };
export const RARITY_LABEL: Record<Rarity, string> = { starter: 'Starter', common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

/** Everything the gallery can show, weapons included, as catalogue items. */
const WEAPON_ITEMS: Item[] = WEAPON_IDS.map((id) => {
  const w = WEAPONS[id];
  const rarity: Rarity = w.price === 0 ? 'starter' : w.price < 1000 ? 'rare' : w.price < 1300 ? 'epic' : 'legendary';
  return { key: `weapon:${id}`, slot: 'weapon', id, name: w.name, rarity, price: w.price };
});
export const CATALOGUE_SIZE = COSMETIC_ITEMS.length + WEAPON_ITEMS.length;
const BY_KEY = new Map([...WEAPON_ITEMS, ...COSMETIC_ITEMS].map((it) => [it.key, it]));

/* Portraits are drawn a few per frame as tiles scroll into view, so a full shelf never stalls. */
const queue: (() => void)[] = [];
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 10) queue.shift()!();
    if (queue.length) requestAnimationFrame(step);
    else pumping = false;
  };
  requestAnimationFrame(step);
}

function Preview({ cacheKey, draw, fallback }: { cacheKey: string; draw: () => string | null; fallback?: string }) {
  const [src, setSrc] = useState(() => peek(cacheKey));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const hit = peek(cacheKey);
    setSrc(hit);
    if (hit || !ref.current) return;
    let live = true;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        queue.push(() => live && setSrc(draw()));
        pump();
      },
      { rootMargin: '200px' },
    );
    io.observe(ref.current);
    return () => {
      live = false;
      io.disconnect();
    };
    // draw changes identity every render; the key says when the picture changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
  return src ? <img src={src} alt="" draggable={false} /> : <span ref={ref} className="item__blank" style={fallback ? { background: fallback } : undefined} />;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export default function Locker() {
  const [tab, setTab] = useState<Tab>('weapon');
  const [show, setShow] = useState<'all' | 'owned' | 'shop'>('all');
  const [rarity, setRarity] = useState<Rarity | 'any'>('any');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Item | null>(null);
  const p = useProfile();
  const wheel = p.cosmetics.emotes ?? [p.cosmetics.emote];
  const [slot, setSlot] = useState(() => Math.max(0, wheel.indexOf('')));
  const toast = useUi((s) => s.toast);
  const setTryOn = useUi((s) => s.setTryOn);
  useEffect(() => () => setTryOn(null), [setTryOn]);
  // Drag on empty space to turn the character and see every side of it (the locker only).
  useEffect(() => {
    let last: number | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, a, [role=button], .items, .shelf, .header')) return;
      last = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (last === null) return;
      menu()?.spin(e.clientX - last);
      last = e.clientX;
    };
    const up = () => (last = null);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const equippedId = (s: Slot) => (s === 'weapon' ? p.weapon : p.cosmetics[s]);
  const isOn = (it: Item) => (it.slot === 'emote' ? wheel.includes(it.id) : equippedId(it.slot) === it.id);
  /** Puts an emote in the chosen wheel slot (moving it if it's already elsewhere), then moves on to the next empty slot. */
  const setWheel = (at: number, id: string) => {
    const next = Array.from({ length: WHEEL }, (_, i) => wheel[i] ?? '');
    const was = next.indexOf(id);
    if (id && was >= 0) next[was] = next[at];
    next[at] = id;
    p.patch({ cosmetics: { ...p.cosmetics, emotes: next, emote: next.find(Boolean) ?? 'wave' } });
    const free = next.indexOf('', at + 1);
    if (id) setSlot(free >= 0 ? free : at);
  };
  // Favourites across every category, newest first.
  const favItems = useMemo(
    () =>
      p.favs
        .map((k) => BY_KEY.get(k))
        .filter((it): it is Item => !!it)
        .reverse(),
    [p.favs],
  );
  const shelfItems = (t: Tab) =>
    t === 'special' || t === 'skin'
      ? []
      : t === 'favs'
        ? favItems
        : t === 'weapon'
          ? WEAPON_ITEMS
          : itemsFor(t);
  const list = useMemo(() => {
    if (tab === 'special' || tab === 'skin') return [];
    const all = tab === 'favs' ? favItems : tab === 'weapon' ? WEAPON_ITEMS : itemsFor(tab);
    const needle = q.trim().toLowerCase();
    return all.filter(
      (it) =>
        (show === 'all' || (show === 'owned') === p.owns(it.key)) &&
        (rarity === 'any' || it.rarity === rarity) &&
        (!needle || it.name.toLowerCase().includes(needle)),
    );
  }, [tab, show, rarity, q, p, favItems]);

  const owned = shelfItems(tab).filter((it) => p.owns(it.key)).length;
  const total = shelfItems(tab).length;
  const allOwned = [...COSMETIC_ITEMS, ...WEAPON_ITEMS].filter((it) => p.owns(it.key)).length;

  const tryOn = (it: Item) => {
    if (it.slot === 'weapon') setTryOn({ weapon: it.id as WeaponId });
    else if (it.slot === 'emote') setTryOn({ emote: it.id });
    else if (it.slot === 'title' || it.slot === 'banner') setTryOn(null);
    else setTryOn({ cosmetics: { [it.slot]: it.id } as Partial<Cosmetics> });
  };
  const equip = (it: Item) => {
    if (it.slot === 'weapon') p.patch({ weapon: it.id as WeaponId });
    else if (it.slot === 'emote') setWheel(slot, it.id);
    else p.patch({ cosmetics: { ...p.cosmetics, [it.slot]: it.id } });
    setTryOn(it.slot === 'emote' ? { emote: it.id } : null);
  };
  const choose = (it: Item) => {
    audio.play('click');
    setPicked(it);
    if (p.owns(it.key)) equip(it);
    else tryOn(it);
  };
  const buy = (it: Item) => {
    if (!p.buy(it.key, it.price)) return;
    audio.play('confirm');
    equip(it);
    toast({ text: `${it.name} is yours. Equipped.`, kind: 'success' });
  };

  const preview = (it: Item): ReactNode => {
    const c = p.cosmetics;
    switch (it.slot) {
      case 'weapon':
        return <Preview cacheKey={weaponKey(it.id as WeaponId, c.finish)} draw={() => weaponPortrait(it.id as WeaponId, c.finish)} />;
      case 'finish':
        return <Preview cacheKey={weaponKey(p.weapon, it.id)} draw={() => weaponPortrait(p.weapon, it.id)} />;
      case 'title':
        return <span className="item__blank item__title">{it.id === 'none' ? 'No title' : it.name}</span>;
      case 'banner':
        return <span className="item__blank" style={{ background: bannerCss(it.id) }} />;
      case 'emote':
        return <span className="item__blank item__emote">{emoteIcon(it.id)}</span>;
      default: {
        const look = { ...c, [it.slot]: it.id } as Cosmetics;
        const frame = FRAME[it.slot] ?? 'head';
        return <Preview cacheKey={portraitKey(look, 0, frame)} draw={() => portrait(look, 0, frame)} fallback={it.slot === 'accent' ? hex(ACCENT_COLORS[it.id]) : undefined} />;
      }
    }
  };

  const fav = (it: Item) => {
    p.toggleFav(it.key);
    audio.play('click');
  };
  const star = (it: Item, cls = 'fav') => {
    const on = p.favs.includes(it.key);
    return (
      <button
        className={cls}
        aria-pressed={on}
        aria-label={on ? `Remove ${it.name} from favourites` : `Add ${it.name} to favourites`}
        title={on ? 'Favourite' : 'Add to favourites'}
        onClick={() => fav(it)}
      >
        <Icon.star filled={on} size={cls === 'fav' ? 15 : 20} />
      </button>
    );
  };

  const tile = (it: Item) => {
    const own = p.owns(it.key);
    const on = isOn(it);
    return (
      <div key={it.key} className="item-cell">
        <button
          className="item"
          data-rarity={it.rarity}
          aria-pressed={on}
          data-picked={picked?.key === it.key}
          onMouseEnter={() => audio.play('hover')}
          onClick={() => choose(it)}
          aria-label={`${it.name}, ${RARITY_LABEL[it.rarity]}${on ? ', equipped' : own ? ', owned' : `, ${it.price} coins`}`}
        >
          {preview(it)}
          <span className="item__name">
            {it.name}
            <span className="item__lock">
              {on ? (
                <>
                  <Icon.check size={13} /> {it.slot === 'emote' ? 'On wheel' : 'Equipped'}
                </>
              ) : own ? (
                'Owned'
              ) : (
                <>
                  <Coin size={13} /> <span className="num">{it.price.toLocaleString()}</span>
                </>
              )}
            </span>
          </span>
        </button>
        {star(it)}
      </div>
    );
  };

  const groups = ['Starred', 'Loadout', 'Look', 'Show'] as const;
  const pickedOwned = picked ? p.owns(picked.key) : false;
  const short = picked && !pickedOwned ? picked.price - p.coins : 0;
  const w = picked?.slot === 'weapon' ? WEAPONS[picked.id as WeaponId] : null;

  return (
    <main className="screen locker" data-pig="cobalt">
      <Header
        title="Locker"
        sub={`${allOwned} of ${CATALOGUE_SIZE} items collected. Pick anything to try it on, and drag the empty space to turn the character.`}
        end={
          <span className="coins" aria-label={`${p.coins} coins`}>
            <Coin size={20} />
            <span className="num">{p.coins.toLocaleString()}</span>
          </span>
        }
      />
      <div className="col--wide locker__body">
        <nav className="shelf" aria-label="Categories">
          {groups.map((g) => (
            <div key={g} className="shelf__group">
              <span className="shelf__label">{g}</span>
              {TABS.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id}
                  className="tab"
                  aria-selected={tab === t.id}
                  onClick={() => {
                    audio.play('click');
                    setTab(t.id);
                    setPicked(null);
                    setTryOn(null);
                  }}
                >
                  {t.id === 'favs' && <Icon.star size={14} filled={p.favs.length > 0} />}
                  {t.label}
                  {t.id === 'favs' && p.favs.length > 0 && (
                    <span className="num tab__count">{p.favs.length}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {tab !== 'special' && tab !== 'skin' && (
          <div className="filters">
            <Segmented
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'All' },
                { value: 'owned', label: 'Owned' },
                { value: 'shop', label: 'Shop' },
              ]}
            />
            <Segmented
              label="Rarity"
              value={rarity}
              onChange={setRarity}
              options={[{ value: 'any' as const, label: 'Any' }, ...(['common', 'rare', 'epic', 'legendary'] as const).map((r) => ({ value: r, label: RARITY_LABEL[r] }))]}
            />
            <label className="search">
              <Icon.search />
              <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
            </label>
            <span className="muted small num">
              {owned}/{total} owned
            </span>
          </div>
        )}

        {tab === 'special' && (
          <div className="options">
            {SPECIAL_IDS.map((id) => (
              <button key={id} className="option" style={{ gridTemplateColumns: '1fr' }} aria-pressed={p.special === id} onClick={() => (audio.play('click'), p.patch({ special: id }))}>
                <span>
                  <span className="option__title" style={{ display: 'block' }}>
                    {SPECIALS[id].name} {p.special === id && <span className="badge badge--ok">Equipped</span>}
                  </span>
                  <span className="option__desc" style={{ display: 'block' }}>
                    {SPECIALS[id].description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === 'skin' && (
          <div className="items">
            {SKIN_TONES.map((c, i) => {
              const look = { ...p.cosmetics, skin: i };
              return (
                <button key={c} className="item" aria-pressed={p.cosmetics.skin === i} aria-label={`Skin tone ${i + 1}`} onClick={() => (audio.play('click'), p.patch({ cosmetics: look }))}>
                  <Preview cacheKey={portraitKey(look, 0, 'head')} draw={() => portrait(look, 0)} fallback={hex(c)} />
                  <span className="item__name">Tone {i + 1}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'emote' && (
          <section className="locker-wheel" aria-label="Emote wheel">
            <EmoteRing
              edit
              emotes={wheel}
              pick={slot}
              onPick={(i) => {
                audio.play('click');
                setSlot(i);
                if (wheel[i]) setTryOn({ emote: wheel[i] });
              }}
              hub={
                <>
                  <span className="wheel__hint">Slot {slot + 1}</span>
                  <b>{wheel[slot] ? emoteName(wheel[slot]) : 'Empty'}</b>
                </>
              }
            />
            <div className="locker-wheel__text">
              <h2 className="panel__title">Your emote wheel</h2>
              <p className="muted">Pick a slot, then an emote you own to put it there. In a match, hold the emote button, point at one and let go. A quick tap plays the last one again.</p>
              {wheel[slot] && (
                <Button onClick={() => setWheel(slot, '')}>
                  <Icon.close size={14} /> Clear slot {slot + 1}
                </Button>
              )}
            </div>
          </section>
        )}
        {list.length > 0 && <div className="items items--gallery">{list.map(tile)}</div>}
        {tab !== 'special' && tab !== 'skin' && list.length === 0 && (
          <p className="empty">
            {tab === 'favs' && p.favs.length === 0
              ? 'No favourites yet. Tap the star on any item to keep it here.'
              : show === 'owned'
                ? 'Nothing here yet. Visit the shop filter to see what you can buy.'
                : 'Nothing matches those filters.'}
          </p>
        )}
      </div>

      {picked && (
        <div className="dock" data-rarity={picked.rarity} key={picked.key}>
          <div className="dock__info">
            <span className="dock__rarity">{RARITY_LABEL[picked.rarity]}</span>
            <span className="dock__name">{picked.name}</span>
            {w && <span className="dock__desc">{w.tagline}</span>}
            {w && (
              <span className="stat-bars dock__stats">
                {(['range', 'damage', 'paint', 'mobility'] as const).map((k) => (
                  <span key={k} className="stat-bar">
                    <span style={{ textTransform: 'capitalize' }}>{k}</span>
                    <span className="stat-bar__track">
                      <span className="stat-bar__fill" style={{ display: 'block', transform: `scaleX(${w.ratings[k] / 5})` }} />
                    </span>
                  </span>
                ))}
              </span>
            )}
          </div>
          {star(picked, 'btn btn--ghost btn--icon dock__fav')}
          {pickedOwned ? (
            <Button variant="ghost" disabled>
              <Icon.check /> {isOn(picked) ? (picked.slot === 'emote' ? 'On wheel' : 'Equipped') : picked.slot === 'emote' ? `Owned · tap to put in slot ${slot + 1}` : 'Owned'}
            </Button>
          ) : short > 0 ? (
            <Button disabled>
              <Coin /> {short.toLocaleString()} more needed
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => buy(picked)}>
              <Coin size={20} /> Buy · {picked.price.toLocaleString()}
            </Button>
          )}
        </div>
      )}
    </main>
  );
}

