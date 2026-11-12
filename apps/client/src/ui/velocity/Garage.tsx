import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BODIES, CAR_COLORS, CAR_FINISHES, CAR_ITEM, carItemsFor, cleanPlate, DEFAULT_CAR, RARITY_ORDER, SLOT_LABEL, WHEELS, levelInfo,
  type CarItem, type CarLoadout, type CarSlot,
} from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { engine } from '../../game/engine';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { paintTexture } from '../../velocity/finishes';
import { GarageView, SHOT_FOR, type GarageShot } from '../../velocity/garageView';
import { RaceAudio } from '../../velocity/raceAudio';
import { activeCar } from '../../velocity/racing';
import { Coin, Icon } from '../icons';
import { Button } from '../kit';
import { RARITY_LABEL } from '../screens/Locker';

const CATS: { id: string; label: string; slots: CarSlot[] }[] = [
  { id: 'body', label: 'Body', slots: ['body'] },
  { id: 'paint', label: 'Paint', slots: ['paint', 'accent', 'finish', 'livery'] },
  { id: 'wheels', label: 'Wheels', slots: ['wheel', 'rim', 'tire', 'wheelfx'] },
  { id: 'kit', label: 'Body kit', slots: ['frontBumper', 'rearBumper', 'diffuser', 'hood', 'spoiler', 'roof', 'mirrors'] },
  { id: 'lights', label: 'Lights & glass', slots: ['headlights', 'taillights', 'tint', 'underglow'] },
  { id: 'details', label: 'Details', slots: ['plate', 'badge', 'exhaust', 'accessory'] },
  { id: 'sound', label: 'Sound', slots: ['horn', 'engine'] },
  { id: 'fx', label: 'Effects', slots: ['trail', 'boostfx', 'driftfx', 'victory'] },
  { id: 'favs', label: 'Favourites', slots: [] },
];

const SHOTS: [GarageShot, string][] = [
  ['show', 'Showcase'], ['front', 'Front'], ['side', 'Side'], ['rear', 'Rear'], ['wheel', 'Wheels'], ['lights', 'Lights'], ['roof', 'Roof'],
];

const ICON: Partial<Record<CarSlot, string>> = {
  body: '🚗', tire: '⭕', frontBumper: '▭', rearBumper: '▭', diffuser: '☰', hood: '⏶', spoiler: '⌒', roof: '⌂', mirrors: '◐', tint: '▦',
  headlights: '💡', taillights: '🔴', livery: '🏁', plate: '🔤', underglow: '✨', exhaust: '◎', horn: '📯', engine: '🔊', wheelfx: '💫',
  trail: '〰', boostfx: '🔥', driftfx: '💨', accessory: '🎈', victory: '🏆', badge: '⭐',
};

const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Little pictures of finishes, drawn once with the player's colours. */
const thumbs = new Map<string, string>();
function finishThumb(id: string, l: CarLoadout) {
  const key = `${id}:${l.paint}:${l.accent}`;
  let url = thumbs.get(key);
  if (!url) {
    const p = paintTexture({ ...l, finish: id, livery: 'none' }, 0, 0, 128);
    url = p.canvas.toDataURL();
    p.texture.dispose();
    thumbs.set(key, url);
  }
  return url;
}

function WheelThumb({ id }: { id: string }) {
  const w = WHEELS[id];
  if (!w) return null;
  const n = Math.max(1, w.spokes);
  const lines = Array.from({ length: Math.min(n, 36) }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r1 = w.style === 'dish' ? 12 : 5, r2 = 17;
    const twist = w.style === 'twist' || w.style === 'fan' ? 0.4 : 0;
    return <line key={i} x1={20 + Math.cos(a) * r1} y1={20 + Math.sin(a) * r1} x2={20 + Math.cos(a + twist) * r2} y2={20 + Math.sin(a + twist) * r2} strokeWidth={w.style === 'wire' ? 0.7 : w.style === 'star' ? 2 : 2.6} />;
  });
  return (
    <svg viewBox="0 0 40 40" width="44" height="44" stroke="#d8dce4" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="19" stroke="#1b1c20" strokeWidth="2.5" fill="#24262c" />
      <circle cx="20" cy="20" r="17" strokeWidth="1.5" />
      {w.style === 'disc' ? <circle cx="20" cy="20" r="15" fill="#c8ccd4" /> : lines}
      <circle cx="20" cy="20" r="3.5" fill="#d8dce4" />
    </svg>
  );
}

export default function Garage() {
  const go = useUi((s) => s.go);
  const back = useUi((s) => s.back);
  const toast = useUi((s) => s.toast);
  const p = useProfile();
  const view = useRef<GarageView | null>(null);
  const sound = useRef<RaceAudio | null>(null);
  const [build, setBuild] = useState(p.racing.active);
  const saved = p.racing.builds[build] ?? activeCar(p.racing);
  const [draft, setDraft] = useState<CarLoadout>(saved);
  const [cat, setCat] = useState('paint');
  const [slot, setSlot] = useState<CarSlot>('paint');
  const [picked, setPicked] = useState<string | null>(null);
  const [driver, setDriver] = useState(false);

  // The showroom replaces the menu backdrop while the garage is open.
  useEffect(() => {
    const v = new GarageView(saved);
    view.current = v;
    engine.setView(v);
    sound.current = new RaceAudio();
    // A controller's right stick orbits the car; triggers zoom.
    let raf = 0, last = performance.now();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const pad = [...(navigator.getGamepads?.() ?? [])].find((x) => x?.connected);
      if (pad) {
        const dz = (x: number) => (Math.abs(x) < 0.2 ? 0 : x);
        v.pad(dz(pad.axes[2] ?? 0), dz(pad.axes[3] ?? 0), (pad.buttons[6]?.value ?? 0) - (pad.buttons[7]?.value ?? 0), dt);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      sound.current?.dispose();
      void import('../../game/session').then((m) => {
        if (engine.view === v) m.showMenu();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => view.current?.setLoadout(draft), [draft]);
  useEffect(() => view.current?.setDriver(driver ? p.cosmetics : null), [driver, p.cosmetics]);

  const slots = CATS.find((c) => c.id === cat)?.slots ?? [];
  const items: CarItem[] = useMemo(() => {
    const list = cat === 'favs' ? p.favs.filter((k) => k.startsWith('car:')).map((k) => CAR_ITEM[k]).filter(Boolean) : carItemsFor(slot);
    return [...list].sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.price - b.price);
  }, [cat, slot, p.favs]);
  const item = picked ? CAR_ITEM[picked] : null;
  const st = p.racing.stats;
  const progressOf = (it: CarItem) => {
    if (!it.unlock) return null;
    const have = it.unlock.kind === 'wins' ? st.wins : it.unlock.kind === 'podiums' ? st.wins + st.seconds + st.thirds : it.unlock.kind === 'races' ? st.races : levelInfo(p.xp).level;
    return { have: Math.min(have, it.unlock.n), need: it.unlock.n };
  };
  const owned = (it: CarItem) => p.owns(it.key);
  const equipped = (it: CarItem) => saved[it.slot] === it.id;

  const preview = (it: CarItem) => {
    audio.play('click');
    setPicked(it.key);
    setDraft({ ...draft, [it.slot]: it.id });
    const shot = SHOT_FOR[it.slot];
    if (shot) view.current?.look(shot);
    if (it.slot === 'horn') sound.current?.horn(it.id, 1);
  };
  const saveBuild = (next: CarLoadout) => {
    const builds = p.racing.builds.map((b, i) => (i === build ? next : b));
    p.setRacing({ builds, active: build });
  };
  const equip = (it: CarItem) => {
    if (!owned(it)) return;
    const next = { ...saved, [it.slot]: it.id };
    saveBuild(next);
    setDraft(next);
    audio.play('confirm');
  };
  const buy = (it: CarItem) => {
    const prog = progressOf(it);
    if (prog && prog.have < prog.need) return;
    if (!prog && !window.confirm(`Buy ${it.name} for ${it.price.toLocaleString()} coins?`)) return;
    if (p.buy(it.key, it.price)) {
      toast({ text: prog ? `${it.name} unlocked!` : `${it.name} is yours.`, kind: 'success' });
      equip(it);
    } else toast({ text: 'Not enough coins yet. Race and play to earn more.', kind: 'warn' });
  };
  const revert = () => {
    setDraft(saved);
    setPicked(null);
    view.current?.look('show');
  };
  const pickBuild = (i: number) => {
    audio.play('click');
    setBuild(i);
    setDraft(p.racing.builds[i]);
    setPicked(null);
    p.setRacing({ active: i });
  };

  const swatch = (it: CarItem) => {
    if (it.slot === 'paint' || it.slot === 'accent') return <span style={{ width: 30, height: 30, borderRadius: '50%', background: hexCss(CAR_COLORS[it.id]?.hex ?? 0), boxShadow: 'inset 0 -4px 8px rgba(0,0,0,0.3)' }} />;
    if (it.slot === 'finish') return <img src={finishThumb(it.id, draft)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />;
    if (it.slot === 'wheel') return <WheelThumb id={it.id} />;
    return <span aria-hidden>{ICON[it.slot] ?? '•'}</span>;
  };

  const status = (it: CarItem) => {
    if (owned(it)) return equipped(it) ? 'Equipped' : 'Owned';
    const prog = progressOf(it);
    if (prog) return `Earn: ${prog.have}/${prog.need}`;
    return `${it.price.toLocaleString()} coins`;
  };

  return (
    <div className="garage">
      <section className="garage__panel" aria-label="Customise your car">
        <div className="garage__head">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h1 className="garage__title">Garage</h1>
            <span className="row" style={{ gap: 6 }}>
              <Coin size={16} /> <span className="num">{p.coins.toLocaleString()}</span>
            </span>
          </div>
        </div>
        <div className="garage__cats" role="tablist">
          {CATS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-pressed={cat === c.id}
              onClick={() => {
                audio.play('click');
                setCat(c.id);
                if (c.slots[0]) setSlot(c.slots[0]);
                setPicked(null);
                const shot = c.slots[0] ? SHOT_FOR[c.slots[0]] : 'show';
                if (shot) view.current?.look(shot);
              }}
            >
              {c.id === 'favs' && <Icon.star size={12} filled />} {c.label}
            </button>
          ))}
        </div>
        {slots.length > 1 && (
          <div className="garage__cats" role="tablist" style={{ paddingTop: 0 }}>
            {slots.map((s) => (
              <button
                key={s}
                aria-pressed={slot === s}
                onClick={() => {
                  setSlot(s);
                  setPicked(null);
                  const shot = SHOT_FOR[s];
                  if (shot) view.current?.look(shot);
                }}
                style={{ background: slot === s ? 'var(--s5)' : undefined, color: slot === s ? 'var(--tx)' : undefined }}
              >
                {SLOT_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <div className="garage__items" role="listbox" aria-label={SLOT_LABEL[slot]}>
          {cat === 'details' && slot === 'plate' && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 6, marginBottom: 6 }}>
              <label className="muted small">
                Plate text
                <input
                  className="input"
                  defaultValue={saved.plateText}
                  maxLength={7}
                  onBlur={(e) => {
                    const next = { ...saved, plateText: cleanPlate(e.target.value) };
                    saveBuild(next);
                    setDraft(next);
                  }}
                />
              </label>
              <label className="muted small">
                Race number (0–99)
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={saved.number}
                  onBlur={(e) => {
                    const n = Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)));
                    const next = { ...saved, number: n };
                    saveBuild(next);
                    setDraft(next);
                  }}
                />
              </label>
            </div>
          )}
          {items.length === 0 && <p className="muted small" style={{ gridColumn: '1 / -1' }}>Star items to keep them here.</p>}
          {items.map((it) => (
            <button
              key={it.key}
              className="g-item"
              role="option"
              aria-pressed={picked === it.key}
              aria-selected={picked === it.key}
              data-equipped={equipped(it)}
              data-rarity={it.rarity}
              data-locked={!owned(it)}
              onClick={() => preview(it)}
              title={it.desc}
            >
              <span className="g-item__swatch">{swatch(it)}</span>
              <span className="g-item__name">{it.name}</span>
              <span className="g-item__meta">
                {RARITY_LABEL[it.rarity]} · {status(it)}
              </span>
            </button>
          ))}
        </div>
        {item && (
          <div className="garage__detail">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{item.name}</strong>
              <button className="link" onClick={() => p.toggleFav(item.key)} aria-label={p.favs.includes(item.key) ? 'Unstar' : 'Star'}>
                <Icon.star size={16} filled={p.favs.includes(item.key)} />
              </button>
            </div>
            <p>
              {SLOT_LABEL[item.slot]} · {RARITY_LABEL[item.rarity]}. {item.desc}
            </p>
            {item.slot !== 'body' && CAR_FINISHES[saved.finish] && (
              <p className="muted small">Equipped now: {CAR_ITEM[`car:${item.slot}:${saved[item.slot]}`]?.name ?? '—'}</p>
            )}
            <div className="garage__actions">
              {owned(item) ? (
                <Button variant="primary" disabled={equipped(item)} onClick={() => equip(item)}>
                  {equipped(item) ? 'Equipped' : 'Equip'}
                </Button>
              ) : item.unlock ? (
                <Button variant="primary" disabled={(progressOf(item)?.have ?? 0) < (progressOf(item)?.need ?? 1)} onClick={() => buy(item)}>
                  {(progressOf(item)?.have ?? 0) >= (progressOf(item)?.need ?? 1) ? 'Unlock' : `${item.unlock.kind === 'wins' ? 'Win' : item.unlock.kind === 'podiums' ? 'Get' : 'Finish'} ${item.unlock.n} ${item.unlock.kind === 'level' ? 'levels' : item.unlock.kind}`}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => buy(item)}>
                  Buy · {item.price.toLocaleString()}
                </Button>
              )}
              <Button onClick={revert}>Revert</Button>
            </div>
          </div>
        )}
      </section>
      <div className="garage__top">
        <div className="row" style={{ gap: 8 }}>
          <Button
            onClick={() => {
              revert();
              back();
            }}
          >
            <Icon.back size={16} /> Back
          </Button>
          <Button variant="primary" onClick={() => go('play')}>
            Race
          </Button>
        </div>
        <div className="garage__name">
          <span className="muted small">Build {build + 1}</span>
          <strong>{BODIES[draft.body]?.name ?? 'Car'}</strong>
          <span className="muted small">
            {CAR_COLORS[draft.paint]?.name} · {CAR_FINISHES[draft.finish]?.name} · #{draft.number}
          </span>
        </div>
        <div className="garage__builds" role="group" aria-label="Saved builds">
          {p.racing.builds.map((_, i) => (
            <button key={i} aria-pressed={build === i} onClick={() => pickBuild(i)}>
              Build {i + 1}
            </button>
          ))}
          <button
            onClick={() => {
              if (!window.confirm(`Reset build ${build + 1} to the starter car?`)) return;
              saveBuild({ ...DEFAULT_CAR });
              setDraft({ ...DEFAULT_CAR });
            }}
          >
            Reset
          </button>
        </div>
        <div className="garage__views" role="group" aria-label="Camera">
          {SHOTS.map(([s, label]) => (
            <button key={s} onClick={() => view.current?.look(s)}>
              {label}
            </button>
          ))}
          <button aria-pressed={driver} onClick={() => setDriver(!driver)} style={{ background: driver ? 'var(--teal)' : undefined, color: driver ? 'var(--on-paint)' : undefined }}>
            Driver
          </button>
        </div>
      </div>
      <div className="garage__hint">Drag to turn the car · scroll or pinch to zoom · pick a part to look at it</div>
    </div>
  );
}
