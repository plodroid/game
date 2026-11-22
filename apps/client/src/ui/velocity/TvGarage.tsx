import { useEffect, useMemo, useRef, useState } from 'react';
import { BODIES, CAR_COLORS, CAR_FINISHES, carItemsFor, RARITY_ORDER, SLOT_LABEL, type CarItem, type CarLoadout, type CarSlot } from '@chromashift/shared';
import { audio } from '../../audio/audio';
import { engine } from '../../game/engine';
import { useProfile } from '../../state/profile';
import { useUi } from '../../state/ui';
import { GarageView, SHOT_FOR } from '../../velocity/garageView';
import { activeCar } from '../../velocity/racing';
import { Coin } from '../icons';
import { RARITY_LABEL } from '../screens/Locker';
import { finishThumb, hexCss, TYPE_ICON, WheelThumb } from './Garage';

/*
 * The garage on a TV: its own screen, built for a remote. The car fills the screen; a row of
 * categories and a strip of big cards sit along the bottom. Left and Right move along the strip,
 * Up and Down move between the strip and the categories, and landing on a card previews it on the
 * car straight away. OK equips (or, for something you don't own yet, asks you to press OK again to buy).
 */

const TABS: { slot: CarSlot; label: string }[] = [
  { slot: 'body', label: 'Car' },
  { slot: 'paint', label: 'Colour' },
  { slot: 'accent', label: 'Stripes' },
  { slot: 'finish', label: 'Finish' },
  { slot: 'wheel', label: 'Wheels' },
  { slot: 'rim', label: 'Rims' },
  { slot: 'tint', label: 'Glass' },
];

export default function TvGarage() {
  const go = useUi((s) => s.go);
  const toast = useUi((s) => s.toast);
  const p = useProfile();
  const view = useRef<GarageView | null>(null);
  const build = p.racing.active;
  const saved = p.racing.builds[build] ?? activeCar(p.racing);
  const [draft, setDraft] = useState<CarLoadout>(saved);
  const [slot, setSlot] = useState<CarSlot>('body');
  const [armed, setArmed] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  // The showroom replaces the menu backdrop while the garage is open.
  useEffect(() => {
    const v = new GarageView(saved);
    view.current = v;
    engine.setView(v);
    audio.startMusic('garage');
    // Start on the card of what is equipped, so Left and Right feel like browsing from here.
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[data-equipped="true"]')?.focus());
    return () => {
      void import('../../game/session').then((m) => {
        if (engine.view === v) m.showMenu();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => view.current?.setLoadout(draft), [draft]);

  const items: CarItem[] = useMemo(() => [...carItemsFor(slot)].sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.price - b.price), [slot]);
  const owned = (it: CarItem) => p.owns(it.key);
  const equipped = (it: CarItem) => saved[it.slot] === it.id;

  const preview = (it: CarItem) => {
    setArmed(null);
    setDraft((d) => ({ ...d, [it.slot]: it.id }));
    const shot = SHOT_FOR[it.slot];
    if (shot) view.current?.look(shot);
  };
  const equip = (it: CarItem) => {
    const next = { ...saved, [it.slot]: it.id };
    p.setRacing({ builds: p.racing.builds.map((b, i) => (i === build ? next : b)), active: build });
    setDraft(next);
    audio.play('confirm');
    toast({ text: `${it.name} equipped`, kind: 'success', ttl: 1600 });
  };
  const choose = (it: CarItem) => {
    if (owned(it)) return equip(it);
    if (it.unlock) return toast({ text: `${it.name}: earn it in races (${it.unlock.n} ${it.unlock.kind}).`, kind: 'info' });
    if (armed !== it.key) {
      setArmed(it.key);
      return toast({ text: `Press OK again to buy ${it.name} for ${it.price.toLocaleString()} coins.`, kind: 'info', ttl: 3500 });
    }
    setArmed(null);
    if (p.buy(it.key, it.price)) {
      toast({ text: `${it.name} is yours.`, kind: 'success' });
      equip(it);
    } else toast({ text: 'Not enough coins yet. Race to earn more.', kind: 'warn' });
  };

  const swatch = (it: CarItem) => {
    if (it.slot === 'paint' || it.slot === 'accent') return <span className="tvg__dot" style={{ background: hexCss(CAR_COLORS[it.id]?.hex ?? 0) }} />;
    if (it.slot === 'finish') return <img src={finishThumb(it.id, draft)} alt="" />;
    if (it.slot === 'wheel') return <WheelThumb id={it.id} />;
    if (it.slot === 'body') return <span aria-hidden>{TYPE_ICON[BODIES[it.id]?.type ?? ''] ?? '🚗'}</span>;
    if (it.slot === 'rim') return <span aria-hidden>⭕</span>;
    return <span aria-hidden>▦</span>;
  };
  const meta = (it: CarItem) => (equipped(it) ? '✓ EQUIPPED' : owned(it) ? RARITY_LABEL[it.rarity] : it.unlock ? 'Earn in races' : `${it.price.toLocaleString()} coins`);

  return (
    <div className="tvg">
      <div className="tvg__top">
        <div className="tvg__name">
          <span className="tvg__build">Build {build + 1}</span>
          <span className="tvg__car">{BODIES[draft.body]?.name ?? 'Car'}</span>
          <span className="tvg__sub">
            {BODIES[draft.body]?.type} · {CAR_COLORS[draft.paint]?.name} · {CAR_FINISHES[draft.finish]?.name}
          </span>
        </div>
        <div className="tvg__coins">
          <Coin size={22} /> <span className="num">{p.coins.toLocaleString()}</span>
        </div>
      </div>
      <div />
      <div className="tvg__dock">
        <div className="tvg__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.slot}
              role="tab"
              className="tvg__tab"
              aria-pressed={slot === t.slot}
              onFocus={() => {
                setSlot(t.slot);
                setArmed(null);
                const shot = SHOT_FOR[t.slot];
                if (shot) view.current?.look(shot);
              }}
              onClick={() => setSlot(t.slot)}
            >
              {t.label}
            </button>
          ))}
          <button className="tvg__tab tvg__tab--go" onClick={() => go('play')}>
            Race ▶
          </button>
        </div>
        <div className="tvg__strip" role="listbox" aria-label={SLOT_LABEL[slot]} ref={strip}>
          {items.map((it) => (
            <button key={it.key} className="tvg__card" role="option" aria-selected={draft[it.slot] === it.id} data-equipped={equipped(it)} data-locked={!owned(it)} onFocus={() => preview(it)} onClick={() => choose(it)}>
              <span className="tvg__swatch">{swatch(it)}</span>
              <span className="tvg__cname">{it.name}</span>
              <span className="tvg__cmeta">{meta(it)}</span>
            </button>
          ))}
        </div>
        <div className="tvg__hint">
          <span><kbd>◀ ▶</kbd>Browse</span>
          <span><kbd>▲ ▼</kbd>Category</span>
          <span><kbd>OK</kbd>Equip</span>
          <span><kbd>Back</kbd>Leave</span>
        </div>
      </div>
    </div>
  );
}
