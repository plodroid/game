import { useEffect, useState } from 'react';
import { env } from '../env';
import { IS_TEST } from '../release';
import { useUi } from '../state/ui';
import { useUpdates } from '../updates';
import { Button } from './kit';

/*
 * The update screens. "What's new" opens once after an update arrives (pictures from the game and
 * what changed, in plain words). When a newer version marked as required is online, this one shows
 * a screen that can only be closed by updating, so nobody keeps playing an old version.
 */

/** The release this build belongs to (matches public/whatsnew/whatsnew.json at build time). */
export const RELEASE_ID = 'velocity-1';
const SEEN_KEY = 'chromashift.seen';

interface Notes {
  id: string;
  mandatory?: boolean;
  kicker: string;
  title: string;
  sub: string;
  images: string[];
  sections: { title: string; items: string[] }[];
}

const url = (f: string) => `${env.base}whatsnew/${f}`;

async function fetchNotes(): Promise<Notes | null> {
  try {
    const r = await fetch(url('whatsnew.json'), { cache: 'no-store' });
    if (!r.ok) return null;
    const n = (await r.json()) as Notes;
    return n && typeof n.id === 'string' && Array.isArray(n.sections) ? n : null;
  } catch {
    return null;
  }
}

/** Reloads into the newest version (through the service worker when there is one). */
function updateNow() {
  const apply = useUpdates.getState().apply;
  if (apply) apply();
  else location.reload();
}

function Card({ n, must, onClose }: { n: Notes; must: boolean; onClose?: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % Math.max(1, n.images.length)), 4200);
    return () => clearInterval(t);
  }, [n.images.length]);
  const go = useUi((s) => s.go);
  return (
    <div className="whatsnew" role="dialog" aria-modal="true" aria-label={n.kicker}>
      <div className="whatsnew__card">
        <div className="whatsnew__hero">
          {n.images.map((src, k) => (
            <img key={src} src={url(src)} alt="" data-on={k === i} loading={k ? 'lazy' : 'eager'} />
          ))}
          <div className="whatsnew__dots">
            {n.images.map((src, k) => (
              <button key={src} aria-label={`Picture ${k + 1}`} aria-pressed={k === i} onClick={() => setI(k)} />
            ))}
          </div>
          <div className="whatsnew__over">
            <span className="whatsnew__kicker">{n.kicker}</span>
            {/* The title may emphasise a word with <em>; nothing else is allowed through. */}
            <h2 className="whatsnew__title" dangerouslySetInnerHTML={{ __html: n.title.replace(/<(?!\/?em>)[^>]*>/g, '') }} />
            <p className="whatsnew__sub">{n.sub}</p>
          </div>
        </div>
        <div className="whatsnew__body">
          {n.sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <ul>
                {s.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="whatsnew__foot">
          {must ? (
            <>
              <span className="whatsnew__must">You must update to keep playing.</span>
              <Button variant="primary" size="lg" onClick={updateNow}>
                Update now
              </Button>
            </>
          ) : (
            <>
              <span className="muted small">Everything you had is still here.</span>
              <span className="row" style={{ gap: 8 }}>
                <Button onClick={onClose}>Close</Button>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    try {
                      localStorage.setItem('chromashift.playMode', 'velocity');
                    } catch {
                      /* fine */
                    }
                    onClose?.();
                    go('play');
                  }}
                >
                  Try VELOCITY
                </Button>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function WhatsNew() {
  const [notes, setNotes] = useState<Notes | null>(null);
  const [must, setMust] = useState<Notes | null>(null);
  useEffect(() => {
    // Not on the owner's test version; in development only when asked for (?whatsnew).
    if (IS_TEST || (import.meta.env.DEV && !location.search.includes('whatsnew'))) return;
    let alive = true;
    const check = async () => {
      const n = await fetchNotes();
      if (!alive || !n) return;
      if (n.id === RELEASE_ID) {
        // This version: show what's new once.
        let seen = '';
        try {
          seen = localStorage.getItem(SEEN_KEY) ?? '';
        } catch {
          /* private mode */
        }
        if (seen !== n.id) setNotes(n);
      } else if (n.mandatory) setMust(n);
    };
    void check();
    const t = setInterval(() => void check(), 10 * 60_000);
    const vis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', vis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  if (must) return <Card n={must} must />;
  if (!notes) return null;
  return (
    <Card
      n={notes}
      must={false}
      onClose={() => {
        try {
          localStorage.setItem(SEEN_KEY, notes.id);
        } catch {
          /* shown again next time */
        }
        setNotes(null);
      }}
    />
  );
}
