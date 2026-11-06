import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Preset = 'veryLow' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'fire' | 'dive' | 'sprint' | 'slide' | 'dodge'
  | 'special' | 'emote' | 'scoreboard' | 'pause' | 'chat' | 'talk' | 'map';

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
  };
  controls: {
    mouseSensitivity: number;
    aimSensitivity: number;
    invertY: boolean;
    gamepadSensitivity: number;
    vibration: boolean;
    touchControls: 'auto' | 'on' | 'off';
    bindings: Record<Action, string[]>;
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
  slide: ['KeyC'],
  dodge: ['KeyQ'],
  special: ['KeyE'],
  emote: ['KeyG'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
  chat: ['KeyT', 'Enter'],
  talk: ['KeyV'],
  map: ['KeyM'],
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
  },
  controls: {
    mouseSensitivity: 1,
    aimSensitivity: 1,
    invertY: false,
    gamepadSensitivity: 1,
    vibration: true,
    touchControls: 'auto',
    bindings: DEFAULT_BINDINGS,
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
  reset(section?: keyof Settings): void;
  /** Overwrites from a cloud profile. */
  load(s: Partial<Settings>): void;
}

/** Saved bindings over the defaults. Emote used to sit on T, which is chat now. */
function migrateBindings(saved?: Partial<Record<Action, string[]>>): Record<Action, string[]> {
  const out = { ...DEFAULT_BINDINGS, ...saved };
  if (saved?.emote?.length === 1 && saved.emote[0] === 'KeyT') out.emote = DEFAULT_BINDINGS.emote;
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
