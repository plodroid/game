import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Preset = 'veryLow' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'fire' | 'dive' | 'sprint' | 'slide' | 'dodge'
  | 'special' | 'emote' | 'scoreboard' | 'pause' | 'chat' | 'talk' | 'map' | 'view';

/** VELOCITY's own actions, bound separately from the shooter's (changing one never changes the other). */
export type RaceAction =
  | 'accelerate' | 'brake' | 'reverse' | 'steerLeft' | 'steerRight' | 'handbrake' | 'boost' | 'item' | 'camera' | 'lookBack'
  | 'reset' | 'horn' | 'pause';
export const RACE_ACTIONS: RaceAction[] = ['accelerate', 'brake', 'reverse', 'steerLeft', 'steerRight', 'handbrake', 'boost', 'item', 'camera', 'lookBack', 'reset', 'horn', 'pause'];

/** Voice chat: hold a key to talk, an always-open mic, or off. */
export type VoiceMode = 'ptt' | 'open' | 'off';
/** Who you hear in a match: everyone by distance, teammates anywhere plus rivals nearby, or everyone. */
export type VoiceRange = 'proximity' | 'team' | 'all';

export interface GraphicsSettings {
  preset: Preset;
  /** Multiplier on the device pixel ratio. */
  renderScale: number;
  /** Cap on rendered height in pixels; 0 = native. */
  maxHeight: number;
  /** 0 low … 3 ultra. */
  textureQuality: number;
  /** 0 off, 1 low, 2 medium, 3 high, 4 ultra (soft). */
  shadowQuality: number;
  shadowResolution: number;
  particles: number;
  /** 0 very low … 3 ultra (paint atlas density, gloss, relief). */
  paintQuality: number;
  drawDistance: number;
  /** 0 low, 1 medium, 2 high geometry detail. */
  modelDetail: number;
  antiAliasing: 'off' | 'fxaa' | 'msaa';
  bloom: boolean;
  ambientOcclusion: boolean;
  reflections: boolean;
  postProcessing: boolean;
  fpsCap: number;
  showFps: boolean;
  adaptiveHints: boolean;
}

export interface Settings {
  graphics: GraphicsSettings;
  audio: {
    master: number;
    music: number;
    sfx: number;
    weapons: number;
    ui: number;
    ambient: number;
    voice: number;
    voiceMode: VoiceMode;
    voiceRange: VoiceRange;
    /** The microphone to use (a device id from the browser); empty = the system default. */
    micId: string;
    /** Sound and a pop-up when a message arrives or someone calls. */
    notifySounds: boolean;
  };
  controls: {
    mouseSensitivity: number;
    aimSensitivity: number;
    invertY: boolean;
    gamepadSensitivity: number;
    vibration: boolean;
    touchControls: 'auto' | 'on' | 'off';
    bindings: Record<Action, string[]>;
    /** Which controller button (standard layout index) does each action. */
    padBindings: Record<Action, number | null>;
    /** VELOCITY: keys and controller buttons for driving. */
    raceBindings: Record<RaceAction, string[]>;
    racePadBindings: Record<RaceAction, number | null>;
    /** VELOCITY camera: chase distance multiplier and preset. */
    raceCamera: 'near' | 'far' | 'hood';
    /** Steering sensitivity for keys and sticks. */
    raceSteer: number;
    /** Which button names to show; auto picks from the connected controller (PlayStation if unsure). */
    padStyle: 'auto' | 'playstation' | 'xbox';
    /** On-screen buttons: size, see-through and buzz. */
    touchScale: number;
    touchOpacity: number;
    touchHaptics: boolean;
  };
  gameplay: {
    cameraSensitivity: number;
    cameraSmoothing: number;
    cameraShake: number;
    crosshair: 'dot' | 'cross' | 'ring';
    hudScale: number;
    hitIndicators: boolean;
    damageIndicators: boolean;
    teamIndicators: boolean;
  };
  accessibility: {
    colorblind: 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia';
    textScale: number;
    reducedMotion: 'system' | 'on' | 'off';
    subtitles: boolean;
    visualAudio: boolean;
    highContrast: boolean;
  };
  /** First-run hardware check already shown. */
  benchmarked: boolean;
  /** Kind of device that saved these settings; graphics only carry over between the same kind. */
  device?: DeviceClass;
}

export type DeviceClass = 'desktop' | 'mobile';
/** Phones and tablets (touch-first) keep their own graphics settings apart from computers. */
export const deviceClass = (): DeviceClass =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';

type Tunables = Omit<GraphicsSettings, 'preset' | 'fpsCap' | 'showFps' | 'adaptiveHints' | 'antiAliasing'> & {
  antiAliasing: GraphicsSettings['antiAliasing'];
};

/** Preset definitions. VERY LOW targets old GPUs like the GT 740: no shadows, AO, bloom or reflections. */
export const PRESETS: Record<Exclude<Preset, 'custom'>, Tunables> = {
  veryLow: {
    renderScale: 0.6, maxHeight: 720, textureQuality: 0, shadowQuality: 0, shadowResolution: 512, particles: 0.25,
    paintQuality: 0, drawDistance: 90, modelDetail: 0, antiAliasing: 'off', bloom: false, ambientOcclusion: false,
    reflections: false, postProcessing: false,
  },
  low: {
    renderScale: 0.8, maxHeight: 900, textureQuality: 1, shadowQuality: 1, shadowResolution: 1024, particles: 0.5,
    paintQuality: 1, drawDistance: 140, modelDetail: 0, antiAliasing: 'off', bloom: false, ambientOcclusion: false,
    reflections: false, postProcessing: false,
  },
  medium: {
    renderScale: 1, maxHeight: 1080, textureQuality: 2, shadowQuality: 2, shadowResolution: 2048, particles: 0.75,
    paintQuality: 2, drawDistance: 220, modelDetail: 1, antiAliasing: 'fxaa', bloom: false, ambientOcclusion: false,
    reflections: true, postProcessing: true,
  },
  high: {
    renderScale: 1, maxHeight: 1440, textureQuality: 3, shadowQuality: 3, shadowResolution: 2048, particles: 1,
    paintQuality: 3, drawDistance: 320, modelDetail: 2, antiAliasing: 'fxaa', bloom: true, ambientOcclusion: false,
    reflections: true, postProcessing: true,
  },
  ultra: {
    renderScale: 1.25, maxHeight: 0, textureQuality: 3, shadowQuality: 4, shadowResolution: 4096, particles: 1,
    paintQuality: 3, drawDistance: 420, modelDetail: 2, antiAliasing: 'msaa', bloom: true, ambientOcclusion: true,
    reflections: true, postProcessing: true,
  },
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  fire: ['Mouse0'],
  dive: ['Mouse2', 'KeyF'],
  sprint: ['ShiftLeft'],
  slide: ['KeyZ'],
  dodge: ['KeyQ'],
  special: ['KeyE'],
  emote: ['KeyG'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
  chat: ['KeyT', 'Enter'],
  talk: ['KeyV'],
  map: ['KeyM'],
  view: ['KeyC'],
};

/** Standard-layout controller buttons: 0 ✕/A, 1 ○/B, 2 □/X, 3 △/Y, 4 L1, 5 R1, 6 L2, 7 R2, 8 Share, 9 Options, 10 L3, 11 R3, 12-15 D-pad. */
export const DEFAULT_PAD: Record<Action, number | null> = {
  forward: null,
  back: null,
  left: null,
  right: null,
  fire: 7,
  dive: 6,
  jump: 0,
  slide: 1,
  dodge: 2,
  special: 5,
  sprint: 10,
  emote: 3,
  scoreboard: 8,
  pause: 9,
  chat: null,
  talk: 12,
  map: 15,
  view: 11,
};

export const DEFAULT_RACE_BINDINGS: Record<RaceAction, string[]> = {
  accelerate: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  reverse: ['KeyX'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  boost: ['ShiftLeft'],
  item: ['KeyE'],
  camera: ['KeyC'],
  lookBack: ['KeyQ'],
  reset: ['KeyR'],
  horn: ['KeyH'],
  pause: ['Escape'],
};

/** Racing on a controller: triggers drive, the left stick steers (fixed), buttons do the rest. */
export const DEFAULT_RACE_PAD: Record<RaceAction, number | null> = {
  accelerate: 7,
  brake: 6,
  reverse: 4,
  steerLeft: 14,
  steerRight: 15,
  handbrake: 0,
  boost: 2,
  item: 5,
  camera: 3,
  lookBack: 11,
  reset: 8,
  horn: 10,
  pause: 9,
};

export const DEFAULT_SETTINGS: Settings = {
  graphics: { preset: 'medium', ...PRESETS.medium, fpsCap: 60, showFps: false, adaptiveHints: true },
  audio: {
    master: 0.8,
    music: 0.55,
    sfx: 0.8,
    weapons: 0.75,
    ui: 0.6,
    ambient: 0.5,
    voice: 0.9,
    voiceMode: 'ptt',
    voiceRange: 'proximity',
    micId: '',
    notifySounds: true,
  },
  controls: {
    mouseSensitivity: 1,
    aimSensitivity: 1,
    invertY: false,
    gamepadSensitivity: 1,
    vibration: true,
    touchControls: 'auto',
    bindings: DEFAULT_BINDINGS,
    padBindings: DEFAULT_PAD,
    raceBindings: DEFAULT_RACE_BINDINGS,
    racePadBindings: DEFAULT_RACE_PAD,
    raceCamera: 'near',
    raceSteer: 1,
    padStyle: 'auto',
    touchScale: 1,
    touchOpacity: 0.7,
    touchHaptics: true,
  },
  gameplay: {
    cameraSensitivity: 1,
    cameraSmoothing: 0.35,
    cameraShake: 0.7,
    crosshair: 'ring',
    hudScale: 1,
    hitIndicators: true,
    damageIndicators: true,
    teamIndicators: true,
  },
  accessibility: {
    colorblind: 'off',
    textScale: 1,
    reducedMotion: 'system',
    subtitles: false,
    visualAudio: false,
    highContrast: false,
  },
  benchmarked: false,
};

interface SettingsStore extends Settings {
  setGraphics(patch: Partial<GraphicsSettings>): void;
  applyPreset(p: Exclude<Preset, 'custom'>): void;
  set<K extends 'audio' | 'controls' | 'gameplay' | 'accessibility'>(section: K, patch: Partial<Settings[K]>): void;
  bind(action: Action, slot: number, code: string): void;
  /** Puts a controller button on an action (null clears it); a button belongs to one action. */
  bindPad(action: Action, button: number | null): void;
  /** VELOCITY bindings (their own set: a key can be on a shooter action and a racing action at once). */
  bindRace(action: RaceAction, slot: number, code: string): void;
  bindRacePad(action: RaceAction, button: number | null): void;
  reset(section?: keyof Settings): void;
  /** Overwrites from a cloud profile. */
  load(s: Partial<Settings>): void;
}

/** Saved bindings over the defaults. Emote used to sit on T, which is chat now. */
function migrateBindings(saved?: Partial<Record<Action, string[]>>): Record<Action, string[]> {
  const out = { ...DEFAULT_BINDINGS, ...saved };
  if (saved?.emote?.length === 1 && saved.emote[0] === 'KeyT') out.emote = DEFAULT_BINDINGS.emote;
  // Slide used to sit on C, which now switches between first and third person.
  if (saved?.slide?.length === 1 && saved.slide[0] === 'KeyC') out.slide = DEFAULT_BINDINGS.slide;
  return out;
}

const merge = (s: Partial<Settings>): Settings => ({
  ...DEFAULT_SETTINGS,
  ...s,
  graphics: { ...DEFAULT_SETTINGS.graphics, ...s.graphics },
  audio: { ...DEFAULT_SETTINGS.audio, ...s.audio },
  controls: {
    ...DEFAULT_SETTINGS.controls,
    ...s.controls,
    bindings: migrateBindings(s.controls?.bindings),
    padBindings: { ...DEFAULT_PAD, ...s.controls?.padBindings },
    raceBindings: { ...DEFAULT_RACE_BINDINGS, ...s.controls?.raceBindings },
    racePadBindings: { ...DEFAULT_RACE_PAD, ...s.controls?.racePadBindings },
  },
  gameplay: { ...DEFAULT_SETTINGS.gameplay, ...s.gameplay },
  accessibility: { ...DEFAULT_SETTINGS.accessibility, ...s.accessibility },
});

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      setGraphics: (patch) =>
        set((s) => {
          const g = { ...s.graphics, ...patch };
          // Touching any tunable turns the preset into Custom, unless it still matches a preset exactly.
          if (!('preset' in patch)) {
            const match = (Object.keys(PRESETS) as Exclude<Preset, 'custom'>[]).find((k) =>
              (Object.keys(PRESETS[k]) as (keyof Tunables)[]).every((f) => PRESETS[k][f] === g[f]),
            );
            g.preset = match ?? 'custom';
          }
          return { graphics: g };
        }),
      applyPreset: (p) => set((s) => ({ graphics: { ...s.graphics, ...PRESETS[p], preset: p } })),
      set: (section, patch) => set((s) => ({ [section]: { ...s[section], ...patch } }) as Partial<Settings>),
      bind: (action, slot, code) =>
        set((s) => {
          const bindings = { ...s.controls.bindings };
          // A key belongs to one action at a time.
          for (const a of Object.keys(bindings) as Action[]) bindings[a] = bindings[a].filter((c) => c !== code);
          const list = [...(bindings[action] ?? [])];
          list[slot] = code;
          bindings[action] = list.filter(Boolean).slice(0, 2);
          return { controls: { ...s.controls, bindings } };
        }),
      bindPad: (action, button) =>
        set((s) => {
          const padBindings = { ...s.controls.padBindings };
          if (button !== null) for (const a of Object.keys(padBindings) as Action[]) if (padBindings[a] === button) padBindings[a] = null;
          padBindings[action] = button;
          return { controls: { ...s.controls, padBindings } };
        }),
      bindRace: (action, slot, code) =>
        set((s) => {
          const raceBindings = { ...s.controls.raceBindings };
          for (const a of Object.keys(raceBindings) as RaceAction[]) raceBindings[a] = raceBindings[a].filter((c) => c !== code);
          const list = [...(raceBindings[action] ?? [])];
          list[slot] = code;
          raceBindings[action] = list.filter(Boolean).slice(0, 2);
          return { controls: { ...s.controls, raceBindings } };
        }),
      bindRacePad: (action, button) =>
        set((s) => {
          const racePadBindings = { ...s.controls.racePadBindings };
          if (button !== null) for (const a of Object.keys(racePadBindings) as RaceAction[]) if (racePadBindings[a] === button) racePadBindings[a] = null;
          racePadBindings[action] = button;
          return { controls: { ...s.controls, racePadBindings } };
        }),
      reset: (section) =>
        set(
          () =>
            (section
              ? { [section]: structuredClone(DEFAULT_SETTINGS[section]) }
              : structuredClone(DEFAULT_SETTINGS)) as Partial<Settings>,
        ),
      load: (s) =>
        set(() => {
          const cur = get();
          // Another kind of device's graphics (a phone's, on a PC) would be wrong here: keep ours.
          const own = s.device && s.device !== deviceClass();
          return merge({
            ...cur,
            ...s,
            graphics: own ? cur.graphics : { ...cur.graphics, ...s.graphics },
            benchmarked: own ? cur.benchmarked : (s.benchmarked ?? cur.benchmarked),
          });
        }),
    }),
    {
      name: 'chromashift.settings.v1',
      version: 1,
      merge: (persisted, current) => ({ ...current, ...merge((persisted ?? {}) as Partial<Settings>) }),
    },
  ),
);

/** Plain snapshot of the settings (without store methods) for cloud sync. */
export function settingsSnapshot(): Settings {
  const { graphics, audio, controls, gameplay, accessibility, benchmarked } = useSettings.getState();
  return { graphics, audio, controls, gameplay, accessibility, benchmarked, device: deviceClass() };
}

export function prefersReducedMotion(): boolean {
  const m = useSettings.getState().accessibility.reducedMotion;
  if (m !== 'system') return m === 'on';
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
