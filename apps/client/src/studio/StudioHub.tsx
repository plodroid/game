import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetFromWeaponParts, blankAsset, newNodeId, WEAPON_IDS, WEAPONS, type AssetKind, type ModelAsset } from '@chromashift/shared';
import { useAccount } from '../auth/account';
import { isOwner } from '../auth/admin';
import { publishedAssets, useLibrary } from '../modeling/library';
import { useUi } from '../state/ui';
import { Icon } from '../ui/icons';
import { Button, Header } from '../ui/kit';
import { MyMaps } from '../ui/MyMaps';
import { Studio } from './Studio';
import { draftsOf, removeDraft, syncDrafts, unpublishAsset, useDrafts } from './store';

/*
 * The owner's content workshop. Pick what to make (a map opens Map Studio; everything else opens
 * the modelling workspace), then start something new or carry on with a draft. Drafts are private;
 * published assets are what every player's game uses.
 */

const KINDS: { kind: AssetKind | 'map'; title: string; desc: string; pig: string; icon: 'map' | 'gun' | 'car' | 'gem' | 'tree' | 'swatch' }[] = [
  { kind: 'map', title: 'Map', desc: 'Arenas and racing tracks, in Map Studio', pig: 'teal', icon: 'map' },
  { kind: 'weapon', title: 'Gun / weapon', desc: 'Model a weapon for the weapon list', pig: 'magenta', icon: 'gun' },
  { kind: 'vehicle', title: 'Vehicle', desc: 'Car bodies and vehicle models', pig: 'gold', icon: 'car' },
  { kind: 'accessory', title: 'Accessory', desc: 'Things that fit on cars: roof, bonnet, boot', pig: 'cobalt', icon: 'gem' },
  { kind: 'prop', title: 'Environment / prop', desc: 'Scenery and objects to place on maps', pig: 'forest', icon: 'tree' },
  { kind: 'material', title: 'Material / texture', desc: 'Reusable materials for every asset', pig: 'graphite', icon: 'swatch' },
];

const ART: Record<string, string> = {
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  gem: 'M6 3h12l4 6-10 12L2 9zM2 9h20M9 3l-2 6 5 12 5-12-2-6',
  tree: 'M12 22v-7M12 15c-4 0-7-2.5-7-6s3-6 7-6 7 2.5 7 6-3 6-7 6zM9 22h6',
  swatch: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
};

function KindIcon({ id }: { id: string }) {
  if (id === 'gun') return <Icon.gun size={26} />;
  if (id === 'car') return <Icon.car size={26} />;
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ART[id]} />
    </svg>
  );
}

/** A new asset of a kind, with something on the grid to start from. */
function fresh(kind: AssetKind): ModelAsset {
  const a = blankAsset(kind, kind === 'weapon' ? 'New weapon' : kind === 'vehicle' ? 'New vehicle' : kind === 'accessory' ? 'New accessory' : kind === 'prop' ? 'New prop' : 'New materials');
  if (kind === 'material') a.nodes = [{ id: newNodeId(), name: 'Preview ball', t: 'prim', shape: 'sphere', mat: 0, p: [0, 1, 0], r: [0, 0, 0], s: [2, 2, 2] }];
  if (kind === 'accessory') a.meta.slot = 'roof';
  return a;
}

export default function StudioHub() {
  useAccount((s) => s.user?.uid);
  const owner = isOwner();
  const go = useUi((s) => s.go);
  const toast = useUi((s) => s.toast);
  const { drafts, thumbs } = useDrafts();
  useLibrary((s) => s.v);
  const [kind, setKind] = useState<AssetKind | 'map' | null>(null);
  const [open, setOpen] = useState<ModelAsset | null>(null);

  useEffect(() => {
    if (owner) void syncDrafts();
  }, [owner]);
  // The Studio is the owner's alone. Anyone else who reaches this screen is sent home; saving and
  // publishing are refused by the server for them in any case.
  useEffect(() => {
    if (!owner) go('home');
  }, [owner, go]);
  if (!owner) return null;

  const list = kind && kind !== 'map' ? draftsOf(kind, drafts) : [];
  const live = kind && kind !== 'map' ? publishedAssets(kind) : [];
  const legacy = kind === 'weapon' ? WEAPON_IDS.filter((id) => WEAPONS[id].look.parts?.length) : [];
  const info = KINDS.find((k) => k.kind === kind);

  return (
    <main className="screen" data-pig="graphite">
      <Header title={info ? info.title : 'Studio'} sub={info ? info.desc : 'Make and manage the game’s official content. Only you can see this.'} onBack={() => (kind ? setKind(null) : go('home'))} />
      {!kind && (
        <div className="studio-kinds stagger">
          {KINDS.map((k) => (
            <button key={k.kind} className="studio-kind" data-pig={k.pig} onClick={() => setKind(k.kind)}>
              <span className="studio-kind__icon"><KindIcon id={k.icon} /></span>
              <span className="studio-kind__title">{k.title}</span>
              <span className="studio-kind__desc">{k.desc}</span>
            </button>
          ))}
        </div>
      )}

      {kind === 'map' && <MyMaps onClose={() => setKind(null)} />}

      {kind && kind !== 'map' && (
        <div className="col--wide stagger">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Button variant="primary" size="lg" onClick={() => setOpen(fresh(kind))}>
              <Icon.plus size={16} /> New {info?.title.toLowerCase()}
            </Button>
          </div>

          <section className="panel">
            <h3 className="panel__title">Drafts ({list.length})</h3>
            {list.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing in progress. Drafts are private until you publish them.</p>}
            <div className="studio-list">
              {list.map((d) => (
                <div key={d.id} className="studio-item">
                  {thumbs[d.id] ? <img src={thumbs[d.id]} alt="" /> : <span className="studio-item__blank" />}
                  <span className="studio-item__name">
                    {d.name}
                    <span className="muted small">{d.nodes.length} parts · {new Date(d.updatedAt).toLocaleDateString()}</span>
                  </span>
                  <Button onClick={() => setOpen(d)}>Open</Button>
                  <Button variant="ghost" onClick={() => window.confirm(`Delete the draft “${d.name}”?`) && void removeDraft(d.id)}>Delete</Button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h3 className="panel__title">Published ({live.length})</h3>
            {live.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing published yet. What you publish here is used by every player’s game.</p>}
            <div className="studio-list">
              {live.map((d) => (
                <div key={d.id} className="studio-item">
                  <span className="studio-item__blank" data-live="true" />
                  <span className="studio-item__name">
                    {d.name}
                    <span className="muted small">live · id {d.id}</span>
                  </span>
                  <Button onClick={() => setOpen(d)}>Edit</Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Remove “${d.name}” from the game? Anything using it goes back to its built-in model.`)) return;
                      const err = await unpublishAsset(d.id);
                      toast(err ? { text: err, kind: 'error' } : { text: `${d.name} removed.`, kind: 'success' });
                    }}
                  >
                    Unpublish
                  </Button>
                </div>
              ))}
            </div>
            {kind === 'weapon' && <p className="muted small" style={{ margin: '10px 0 0' }}>To put a published model on a weapon, open the weapon under Admin weapons and choose it as its Studio model.</p>}
            {kind === 'prop' && <p className="muted small" style={{ margin: '10px 0 0' }}>Published props can be placed on maps in Map Studio, under Scenery.</p>}
            {kind === 'accessory' && <p className="muted small" style={{ margin: '10px 0 0' }}>Published accessories are saved in the library; fitting them to cars in the Garage is not wired up yet.</p>}
          </section>

          {legacy.length > 0 && (
            <section className="panel">
              <h3 className="panel__title">Guns from the old editor</h3>
              <p className="muted small" style={{ marginTop: 0 }}>Open one as a copy to rework it here. The original stays as it is until you publish and choose the new model.</p>
              <div className="studio-list">
                {legacy.map((id) => (
                  <div key={id} className="studio-item">
                    <span className="studio-item__blank" />
                    <span className="studio-item__name">{WEAPONS[id].name}</span>
                    <Button onClick={() => setOpen(assetFromWeaponParts(`wea-${id}`.slice(0, 32), WEAPONS[id].name, WEAPONS[id].look.parts ?? [], WEAPONS[id].look.muzzle))}>Open a copy</Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {open && createPortal(<Studio key={open.id} asset={open} onClose={() => setOpen(null)} />, document.body)}
    </main>
  );
}
