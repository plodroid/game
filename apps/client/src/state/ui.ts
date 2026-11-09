import { create } from 'zustand';
import type { Cosmetics, MatchResult, SpecialId, WeaponId } from '@chromashift/shared';

export type Screen =
  | 'home' | 'play' | 'custom' | 'online' | 'lobby' | 'locker' | 'progression' | 'profile' | 'settings' | 'auth' | 'social'
  | 'match' | 'results';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error' | 'warn';
  action?: { label: string; run: () => void };
  ttl: number;
}

export interface ResultsData {
  result: MatchResult;
  you: number;
  xp: number;
  levelBefore: number;
  xpBefore: number;
  online: boolean;
  recorded: boolean;
  coins: number;
}

interface UiStore {
  screen: Screen;
  history: Screen[];
  paused: boolean;
  loading: string | null;
  toasts: Toast[];
  results: ResultsData | null;
  online: boolean;
  /** Something the locker is showing on the character before it's bought or equipped. */
  tryOn: { cosmetics?: Partial<Cosmetics>; weapon?: WeaponId; emote?: string } | null;
  go(s: Screen): void;
  setTryOn(t: UiStore['tryOn']): void;
  back(): void;
  setPaused(p: boolean): void;
  setLoading(l: string | null): void;
  toast(t: Omit<Toast, 'id' | 'ttl' | 'kind'> & Partial<Pick<Toast, 'kind' | 'ttl'>>): number;
  dismiss(id: number): void;
  setResults(r: ResultsData | null): void;
}

let toastId = 1;

export const useUi = create<UiStore>()((set, get) => ({
  screen: 'home',
  history: [],
  paused: false,
  loading: null,
  toasts: [],
  results: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  tryOn: null,
  setTryOn: (tryOn) => set({ tryOn }),
  // Going to the screen you just came from steps back instead of stacking, so Lobby -> Online -> Back
  // can't bounce between the two (the lobby sends you to Online when it has no room).
  go: (s) =>
    set((st) => {
      if (st.screen === s) return st;
      if (st.history[st.history.length - 1] === s) return { screen: s, history: st.history.slice(0, -1) };
      return { screen: s, history: [...st.history, st.screen].slice(-12) };
    }),
  back: () => {
    const h = get().history;
    set({ screen: h[h.length - 1] ?? 'home', history: h.slice(0, -1) });
  },
  setPaused: (paused) => set({ paused }),
  setLoading: (loading) => set({ loading }),
  toast: (t) => {
    const id = toastId++;
    const toast: Toast = { kind: 'info', ttl: 4500, ...t, id };
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.text !== t.text), toast].slice(-4) }));
    if (toast.ttl > 0) setTimeout(() => get().dismiss(id), toast.ttl);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setResults: (results) => set({ results }),
}));

if (typeof window !== 'undefined') {
  addEventListener('online', () => useUi.setState({ online: true }));
  addEventListener('offline', () => useUi.setState({ online: false }));
}

export interface FeedItem {
  id: number;
  killer: string;
  victim: string;
  killerTeam: number;
  victimTeam: number;
  cause: string;
}

export interface BoardRow {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  weapon: WeaponId;
  kills: number;
  deaths: number;
  assists: number;
  paint: number;
  alive: boolean;
  you: boolean;
  cosmetics?: Cosmetics;
}

export interface HudState {
  active: boolean;
  phase: string;
  countdown: number;
  timeLeft: number;
  untimed: boolean;
  mode: string;
  score: [number, number];
  holders: number[];
  myTeam: number;
  hp: number;
  ink: number;
  charge: number;
  special: SpecialId;
  surge: number;
  weapon: WeaponId;
  alive: boolean;
  respawnIn: number;
  /** Who you're watching while you're out of the fight. */
  spectating: { id: number; name: string; killer: boolean } | null;
  diving: boolean;
  feed: FeedItem[];
  notice: { id: number; text: string; tone: 'neutral' | 'good' | 'bad' } | null;
  caption: string | null;
  hitAt: number;
  koAt: number;
  hurt: { id: number; angle: number }[];
  cues: { id: number; angle: number }[];
  board: BoardRow[];
  showBoard: boolean;
  fps: number;
  ping: number | null;
  net: 'local' | 'good' | 'poor' | 'lost';
  lowInkAt: number;
  /** Minimap shown large (toggled with the map key). */
  bigMap: boolean;
}

const initialHud: HudState = {
  active: false,
  phase: 'intro',
  countdown: 0,
  timeLeft: 0,
  untimed: false,
  mode: 'turf',
  score: [0, 0],
  holders: [],
  myTeam: 0,
  hp: 100,
  ink: 100,
  charge: 0,
  special: 'surge',
  surge: 0,
  weapon: 'pulse',
  alive: true,
  respawnIn: 0,
  spectating: null,
  diving: false,
  feed: [],
  notice: null,
  caption: null,
  hitAt: 0,
  koAt: 0,
  hurt: [],
  cues: [],
  board: [],
  showBoard: false,
  fps: 0,
  ping: null,
  net: 'local',
  lowInkAt: 0,
  bigMap: false,
};

export const useHud = create<HudState>()(() => ({ ...initialHud }));
/** Player 2's readout in split screen. */
export const useHud2 = create<HudState>()(() => ({ ...initialHud }));
