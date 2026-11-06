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
  type Cosmetics,
  type Item,
  type Rarity,
  type Slot,
  type WeaponId,
} from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { peek, portrait, portraitKey, weaponKey, weaponPortrait, type Frame } from '../../characters/portrait';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { bannerCss } from '../banner';
import { Coin, Icon } from '../icons';
import { Button, Header, Segmented } from '../kit';

type Tab = Exclude<Slot, 'weapon'> | 'weapon' | 'special' | 'skin';

const TABS: { id: Tab; label: string; group: 'Loadout' | 'Look' | 'Show' }[] = [
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
  { id: 'skin', label: 'Skin', group: 'Look' },
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
  const toast = useUi((s) => s.toast);
  const setTryOn = useUi((s) => s.setTryOn);
  useEffect(() => () => setTryOn(null), [setTryOn]);

  const equippedId = (slot: Slot) => (slot === 'weapon' ? p.weapon : p.cosmetics[slot]);
  const list = useMemo(() => {
    if (tab === 'special' || tab === 'skin') return [];
    const all = tab === 'weapon' ? WEAPON_ITEMS : itemsFor(tab);
    const needle = q.trim().toLowerCase();
    return all.filter(
      (it) =>
        (show === 'all' || (show === 'owned') === p.owns(it.key)) &&
        (rarity === 'any' || it.rarity === rarity) &&
        (!needle || it.name.toLowerCase().includes(needle)),
    );
  }, [tab, show, rarity, q, p]);

  const owned = (tab === 'special' || tab === 'skin' ? [] : tab === 'weapon' ? WEAPON_ITEMS : itemsFor(tab)).filter((it) => p.owns(it.key)).length;
  const total = tab === 'special' || tab === 'skin' ? 0 : tab === 'weapon' ? WEAPON_ITEMS.length : itemsFor(tab).length;
  const allOwned = [...COSMETIC_ITEMS, ...WEAPON_ITEMS].filter((it) => p.owns(it.key)).length;

  const tryOn = (it: Item) => {
    if (it.slot === 'weapon') setTryOn({ weapon: it.id as WeaponId });
    else if (it.slot === 'emote') setTryOn({ emote: it.id });
    else if (it.slot === 'title' || it.slot === 'banner') setTryOn(null);
    else setTryOn({ cosmetics: { [it.slot]: it.id } as Partial<Cosmetics> });
  };
  const equip = (it: Item) => {
    if (it.slot === 'weapon') p.patch({ weapon: it.id as WeaponId });
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
        return (
          <span className="item__blank item__emote">
            <Icon.play size={26} />
          </span>
        );
      default: {
        const look = { ...c, [it.slot]: it.id } as Cosmetics;
        const frame = FRAME[it.slot] ?? 'head';
        return <Preview cacheKey={portraitKey(look, 0, frame)} draw={() => portrait(look, 0, frame)} fallback={it.slot === 'accent' ? hex(ACCENT_COLORS[it.id]) : undefined} />;
      }
    }
  };

  const tile = (it: Item) => {
    const own = p.owns(it.key);
    const on = equippedId(it.slot) === it.id;
    return (
      <button
        key={it.key}
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
                <Icon.check size={13} /> Equipped
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
    );
  };

  const groups = ['Loadout', 'Look', 'Show'] as const;
  const pickedOwned = picked ? p.owns(picked.key) : false;
  const short = picked && !pickedOwned ? picked.price - p.coins : 0;
  const w = picked?.slot === 'weapon' ? WEAPONS[picked.id as WeaponId] : null;

  return (
    <main className="screen locker" data-pig="cobalt">
      <Header
        title="Locker"
        sub={`${allOwned} of ${CATALOGUE_SIZE} items collected. Pick anything to try it on.`}
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
                  {t.label}
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

        {list.length > 0 && <div className="items items--gallery">{list.map(tile)}</div>}
        {tab !== 'special' && tab !== 'skin' && list.length === 0 && (
          <p className="empty">{show === 'owned' ? 'Nothing here yet. Visit the shop filter to see what you can buy.' : 'Nothing matches those filters.'}</p>
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
          {pickedOwned ? (
            <Button variant="ghost" disabled>
              <Icon.check /> {equippedId(picked.slot) === picked.id ? 'Equipped' : 'Owned'}
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

