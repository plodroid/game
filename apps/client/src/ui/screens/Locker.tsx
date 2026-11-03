import { useState } from 'react';
import {
  ACCENT_COLORS,
  ACCENTS,
  EMOTES,
  HAIR,
  HEADGEAR,
  isUnlocked,
  levelInfo,
  OUTFITS,
  SKIN_TONES,
  SPECIAL_IDS,
  SPECIALS,
  WEAPON_IDS,
  WEAPONS,
  type CosmeticOption,
  type Cosmetics,
} from '@chromashift/shared';
import { menu } from '../../game/session';
import { useProfile } from '../../state/profile';
import { Button, Header } from '../kit';

type Cat = 'weapon' | 'special' | 'hair' | 'headgear' | 'outfit' | 'accent' | 'skin' | 'emote';
const CATS: { id: Cat; label: string }[] = [
  { id: 'weapon', label: 'Weapon' },
  { id: 'special', label: 'Special' },
  { id: 'hair', label: 'Hair' },
  { id: 'headgear', label: 'Headgear' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'accent', label: 'Colour' },
  { id: 'skin', label: 'Skin' },
  { id: 'emote', label: 'Emote' },
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export default function Locker() {
  const [cat, setCat] = useState<Cat>('weapon');
  const p = useProfile();
  const level = levelInfo(p.xp).level;
  const setCos = (patch: Partial<Cosmetics>) => p.patch({ cosmetics: { ...p.cosmetics, ...patch } });

  const list = (opts: CosmeticOption[], key: keyof Cosmetics, color?: (id: string) => string) => (
    <div className="swatches">
      {opts.map((o) => {
        const open = isUnlocked(o, level);
        return (
          <button
            key={o.id}
            className="swatch"
            aria-pressed={p.cosmetics[key] === o.id}
            disabled={!open}
            title={open ? o.name : `Unlocks at level ${o.level}`}
            onClick={() => {
              setCos({ [key]: o.id });
              if (key === 'emote') setTimeout(() => menu()?.react('emote'), 50);
            }}
          >
            {color && <span className="swatch__color" style={{ background: color(o.id) }} />}
            {o.name}
            {!open && <span className="muted small">Lv {o.level}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <main className="screen">
      <Header title="Locker" sub="Changes show on your character and save automatically." />
      <div className="col">
        <div className="tabs" role="tablist">
          {CATS.map((c) => (
            <button key={c.id} role="tab" className="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <section className="panel" key={cat}>
          {cat === 'weapon' && (
            <div className="options">
              {WEAPON_IDS.map((id) => {
                const w = WEAPONS[id];
                return (
                  <button key={id} className="option" style={{ gridTemplateColumns: '1fr auto' }} aria-pressed={p.weapon === id} onClick={() => p.patch({ weapon: id })}>
                    <span>
                      <span className="option__title" style={{ display: 'block' }}>
                        {w.name} {p.weapon === id && <span className="badge badge--ok">Equipped</span>}
                      </span>
                      <span className="option__desc" style={{ display: 'block' }}>
                        {w.tagline}
                      </span>
                      <span className="stat-bars">
                        {(['range', 'damage', 'paint', 'mobility'] as const).map((k) => (
                          <span key={k} className="stat-bar">
                            <span style={{ textTransform: 'capitalize' }}>{k}</span>
                            <span className="stat-bar__track">
                              <span className="stat-bar__fill" style={{ display: 'block', transform: `scaleX(${w.ratings[k] / 5})` }} />
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {cat === 'special' && (
            <div className="options">
              {SPECIAL_IDS.map((id) => (
                <button key={id} className="option" style={{ gridTemplateColumns: '1fr' }} onClick={() => p.patch({ special: id })}>
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
          {cat === 'hair' && list(HAIR, 'hair')}
          {cat === 'headgear' && list(HEADGEAR, 'headgear')}
          {cat === 'outfit' && list(OUTFITS, 'outfit')}
          {cat === 'accent' && list(ACCENTS, 'accent', (id) => hex(ACCENT_COLORS[id]))}
          {cat === 'emote' && (
            <>
              {list(EMOTES, 'emote')}
              <div style={{ marginTop: 14 }}>
                <Button onClick={() => menu()?.react('emote')}>Preview emote</Button>
              </div>
            </>
          )}
          {cat === 'skin' && (
            <div className="swatches">
              {SKIN_TONES.map((c, i) => (
                <button key={c} className="swatch" aria-pressed={p.cosmetics.skin === i} aria-label={`Skin tone ${i + 1}`} onClick={() => setCos({ skin: i })}>
                  <span className="swatch__color" style={{ background: hex(c), width: 24, height: 24 }} />
                </button>
              ))}
            </div>
          )}
        </section>
        <p className="muted small" style={{ marginTop: 12 }}>
          Your team colour is set by the match. Locked items unlock as you level up — see Progression.
        </p>
      </div>
    </main>
  );
}
