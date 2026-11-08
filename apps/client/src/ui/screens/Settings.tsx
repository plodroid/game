import { useEffect, useState } from 'react';
import { engine, PRESET_LABEL } from '../../game/engine';
import { audio } from '../../audio/audio';
import { getMic, listMics, type MicDevice } from '../../audio/mic';
import { PAD_BUTTON, useButtonStyle, useDevice } from '../../game/devices';
import { menu } from '../../game/session';
import { PALETTES } from '../../rendering/palette';
import { benchmark, probeHardware, recommend, type HardwareReport } from '../../settings/hardware';
import { DEFAULT_BINDINGS, DEFAULT_PAD, useSettings, type Action, type Preset } from '../../settings/settings';
import { useUi } from '../../state/ui';
import { checkForUpdates, useUpdates, type UpdateResult } from '../../updates';
import { Button, Header, KeyCapture, keyLabel, Segmented, Setting, Slider, Toggle } from '../kit';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay' | 'accessibility';
const TABS: { id: Tab; label: string }[] = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'audio', label: 'Audio' },
  { id: 'controls', label: 'Controls' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'accessibility', label: 'Accessibility' },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('graphics');
  const reset = useSettings((s) => s.reset);
  const paused = useUi((s) => s.paused);
  const back = useUi((s) => s.back);
  return (
    <main className={`screen ${paused ? 'screen--solid' : ''}`} data-pig="graphite">
      <Header
        title="Settings"
        sub="Saved automatically on this device, and to your account when signed in."
        onBack={back}
        end={
          <Button variant="ghost" onClick={() => reset(tab)}>
            Reset {TABS.find((t) => t.id === tab)!.label.toLowerCase()}
          </Button>
        }
      />
      <div className="col--wide">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <section className="panel" key={tab}>
          {tab === 'graphics' && <Graphics />}
          {tab === 'audio' && <Audio />}
          {tab === 'controls' && <Controls />}
          {tab === 'gameplay' && <Gameplay />}
          {tab === 'accessibility' && <Accessibility />}
        </section>
        <UpdateCheck />
        <div className="row" style={{ marginTop: 14 }}>
          <Button variant="ghost" onClick={() => reset()}>
            Reset everything to defaults
          </Button>
        </div>
      </div>
    </main>
  );
}

function UpdateCheck() {
  const { ready, apply } = useUpdates();
  const [state, setState] = useState<UpdateResult | 'checking' | null>(null);
  const check = () => {
    setState('checking');
    checkForUpdates().then(setState, () => setState('unavailable'));
  };
  const msg =
    ready || state === 'ready'
      ? 'A new version is ready.'
      : state === 'latest'
        ? 'You have the latest version.'
        : state === 'unavailable'
          ? 'Updates are only checked in the installed or online app.'
          : state === 'checking'
            ? 'Checking…'
            : 'Looks for a newer version of the game.';
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <Setting name="Updates" hint={msg}>
        {ready || state === 'ready' ? (
          <Button variant="primary" onClick={() => apply?.()}>
            Update now
          </Button>
        ) : (
          <Button onClick={check} disabled={state === 'checking'}>
            Check for updates
          </Button>
        )}
      </Setting>
    </section>
  );
}

const NEXT = 'Applies from the next match.';

function Graphics() {
  const g = useSettings((s) => s.graphics);
  const set = useSettings((s) => s.setGraphics);
  const apply = useSettings((s) => s.applyPreset);
  const [hw, setHw] = useState<HardwareReport | null>(null);
  const presets: Exclude<Preset, 'custom'>[] = ['veryLow', 'low', 'medium', 'high', 'ultra'];
  const needsReload = (g.antiAliasing === 'msaa' && !g.postProcessing) !== engine.contextAA;

  const check = () => {
    const base = probeHardware(engine.renderer.getContext() as WebGL2RenderingContext);
    const m = menu();
    const ms = m ? benchmark(engine.renderer, m.benchScene.scene, m.benchScene.camera) : null;
    const full = { ...base, benchmarkMs: ms };
    setHw({ ...full, ...recommend(full) });
  };

  return (
    <>
      <Setting name="Preset" hint={g.preset === 'custom' ? 'Custom: you changed individual options.' : 'Very Low is tuned for old GPUs such as the GT 740.'}>
        <Segmented value={g.preset === 'custom' ? ('' as Preset) : g.preset} onChange={(p) => apply(p as Exclude<Preset, 'custom'>)} label="Preset" options={presets.map((p) => ({ value: p, label: PRESET_LABEL[p] }))} />
      </Setting>
      <Setting name="Hardware check" hint="Measures this device and recommends a preset. Never changes anything by itself.">
        <Button onClick={check}>Run check</Button>
      </Setting>
      {hw && (
        <div className="panel" style={{ margin: '8px 0 12px', background: 'rgba(0,0,0,0.25)' }}>
          <p style={{ margin: '0 0 8px' }}>
            Recommended: <strong>{PRESET_LABEL[hw.recommended]}</strong>
          </p>
          <p className="muted small" style={{ margin: '0 0 10px' }}>
            {hw.reason} Max texture {hw.maxTexture}px · {hw.cores} CPU threads{hw.memoryGb ? ` · ~${hw.memoryGb} GB memory` : ''}
          </p>
          <Button variant="primary" onClick={() => apply(hw.recommended)}>
            Apply {PRESET_LABEL[hw.recommended]}
          </Button>
        </div>
      )}
      <Setting name="Resolution scale" hint="Lower renders fewer pixels for more speed.">
        <Slider label="Resolution scale" value={g.renderScale} min={0.5} max={1.5} step={0.05} onChange={(v) => set({ renderScale: v })} />
      </Setting>
      <Setting name="Render resolution cap" hint="Limits the rendered height on big or high-DPI screens.">
        <select className="select" value={g.maxHeight} onChange={(e) => set({ maxHeight: Number(e.target.value) })} aria-label="Render resolution cap">
          {[0, 1440, 1080, 900, 720, 540].map((h) => (
            <option key={h} value={h}>
              {h ? `${h}p` : 'Native'}
            </option>
          ))}
        </select>
      </Setting>
      <Setting name="Texture quality" hint={NEXT}>
        <Segmented value={g.textureQuality} onChange={(v) => set({ textureQuality: v })} label="Texture quality" options={['Low', 'Medium', 'High', 'Ultra'].map((l, i) => ({ value: i, label: l }))} />
      </Setting>
      <Setting name="Shadows">
        <Segmented value={g.shadowQuality} onChange={(v) => set({ shadowQuality: v })} label="Shadow quality" options={['Off', 'Low', 'Medium', 'High', 'Ultra'].map((l, i) => ({ value: i, label: l }))} />
      </Setting>
      <Setting name="Shadow resolution">
        <Segmented value={g.shadowResolution} onChange={(v) => set({ shadowResolution: v })} label="Shadow resolution" options={[512, 1024, 2048, 4096].map((v) => ({ value: v, label: String(v), disabled: g.shadowQuality === 0 }))} />
      </Setting>
      <Setting name="Particle density" hint={NEXT}>
        <Slider label="Particle density" value={g.particles} min={0} max={1} step={0.05} onChange={(v) => set({ particles: v })} />
      </Setting>
      <Setting name="Paint quality" hint={`Atlas resolution, gloss and raised edges. ${NEXT}`}>
        <Segmented value={g.paintQuality} onChange={(v) => set({ paintQuality: v })} label="Paint quality" options={['Very low', 'Low', 'High', 'Ultra'].map((l, i) => ({ value: i, label: l }))} />
      </Setting>
      <Setting name="Draw distance" hint="Also sets the fog distance.">
        <Slider label="Draw distance" value={g.drawDistance} min={60} max={420} step={10} format={(v) => `${v} m`} onChange={(v) => set({ drawDistance: v })} />
      </Setting>
      <Setting name="Model detail" hint={NEXT}>
        <Segmented value={g.modelDetail} onChange={(v) => set({ modelDetail: v })} label="Model detail" options={['Low', 'Medium', 'High'].map((l, i) => ({ value: i, label: l }))} />
      </Setting>
      <Setting name="Anti-aliasing" hint={needsReload ? 'MSAA without post-processing needs a restart.' : 'FXAA is cheap; MSAA is sharper but costs more.'}>
        <Segmented value={g.antiAliasing} onChange={(v) => set({ antiAliasing: v })} label="Anti-aliasing" options={[{ value: 'off', label: 'Off' }, { value: 'fxaa', label: 'FXAA' }, { value: 'msaa', label: 'MSAA' }]} />
        {needsReload && <Button onClick={() => location.reload()}>Restart</Button>}
      </Setting>
      <Setting name="Post-processing" hint="Required for bloom, ambient occlusion and FXAA.">
        <Toggle label="Post-processing" checked={g.postProcessing} onChange={(v) => set({ postProcessing: v })} />
      </Setting>
      <Setting name="Bloom">
        <Toggle label="Bloom" checked={g.bloom} onChange={(v) => set({ bloom: v })} />
      </Setting>
      <Setting name="Ambient occlusion" hint="Screen-space AO. Expensive, for high-end GPUs only.">
        <Toggle label="Ambient occlusion" checked={g.ambientOcclusion} onChange={(v) => set({ ambientOcclusion: v })} />
      </Setting>
      <Setting name="Reflections" hint={`Sky reflections on glossy surfaces. ${NEXT}`}>
        <Toggle label="Reflections" checked={g.reflections} onChange={(v) => set({ reflections: v })} />
      </Setting>
      <Setting name="Frame-rate cap">
        <Segmented value={g.fpsCap} onChange={(v) => set({ fpsCap: v })} label="Frame-rate cap" options={[{ value: 30, label: '30' }, { value: 60, label: '60' }, { value: 120, label: '120' }, { value: 0, label: 'Display' }]} />
      </Setting>
      <Setting name="V-Sync" hint="Browsers always present frames in sync with the display, so a web game can’t switch V-Sync off. Use the cap above instead.">
        <span className="muted small">Always on</span>
      </Setting>
      <Setting name="Show FPS">
        <Toggle label="Show FPS" checked={g.showFps} onChange={(v) => set({ showFps: v })} />
      </Setting>
      <Setting name="Performance hints" hint="Suggests a lower preset if a match runs slowly. It never changes settings without asking.">
        <Toggle label="Performance hints" checked={g.adaptiveHints} onChange={(v) => set({ adaptiveHints: v })} />
      </Setting>
    </>
  );
}

function MicAccess() {
  const [state, setState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  useEffect(() => {
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((r) => {
      setState(r.state);
      r.onchange = () => setState(r.state);
    }, () => undefined);
  }, []);
  const ask = () =>
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((m) => (m.getTracks().forEach((t) => t.stop()), setState('granted')))
      .catch(() => setState('denied'));
  return (
    <Setting
      name="Microphone access"
      hint={state === 'granted' ? 'Allowed. Voice chat can use your microphone.' : state === 'denied' ? 'Blocked. Allow the microphone for this app or site in your phone or browser settings, then try again.' : 'Voice chat needs permission to use your microphone.'}
    >
      <Button onClick={ask} disabled={state === 'granted'}>
        {state === 'granted' ? 'Allowed' : 'Allow microphone'}
      </Button>
    </Setting>
  );
}

function MicPicker() {
  const mic = useSettings((s) => s.audio.micId);
  const set = useSettings((s) => s.set);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [level, setLevel] = useState<number | null>(null);
  const refresh = () => void listMics().then(setMics);
  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, []);
  // A live level so you can see the chosen microphone is picking you up.
  useEffect(() => {
    if (level === null) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    void getMic()
      .then((m) => {
        if (stop) return m.getTracks().forEach((t) => t.stop());
        stream = m;
        ctx = new AudioContext();
        const a = ctx.createAnalyser();
        a.fftSize = 512;
        ctx.createMediaStreamSource(m).connect(a);
        const buf = new Float32Array(512);
        const tick = () => {
          a.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          raf = requestAnimationFrame(tick);
        };
        tick();
        refresh();
      })
      .catch(() => setLevel(null));
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level === null, mic]);
  return (
    <Setting name="Microphone" hint="Pick the microphone for voice chat, calls and voice messages. Use Test to see it pick you up.">
      <select className="select" value={mic} onChange={(e) => set('audio', { micId: e.target.value })} aria-label="Microphone">
        <option value="">System default</option>
        {mics.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        {mic && !mics.some((m) => m.id === mic) && <option value={mic}>Saved microphone (not plugged in)</option>}
      </select>
      <Button onClick={() => setLevel(level === null ? 0 : null)}>{level === null ? 'Test' : 'Stop'}</Button>
      {level !== null && (
        <span className="meter-mini" aria-label="Microphone level">
          <span style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
      )}
    </Setting>
  );
}

function Notifications() {
  const a = useSettings((s) => s.audio);
  const set = useSettings((s) => s.set);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  return (
    <>
      <Setting name="Message and call sounds" hint="A chime for new messages and invites, and a ringtone when someone calls.">
        <Toggle label="Message and call sounds" checked={a.notifySounds} onChange={(v) => set('audio', { notifySounds: v })} />
        <Button onClick={() => audio.play('notify')}>Hear it</Button>
      </Setting>
      {perm !== 'unsupported' && (
        <Setting name="Pop-up notifications" hint="Shows a notification when someone calls while the game is in the background.">
          <Button disabled={perm === 'granted'} onClick={() => void Notification.requestPermission().then(setPerm)}>
            {perm === 'granted' ? 'Allowed' : perm === 'denied' ? 'Blocked in browser' : 'Allow'}
          </Button>
        </Setting>
      )}
    </>
  );
}

function Audio() {
  const a = useSettings((s) => s.audio);
  const set = useSettings((s) => s.set);
  const rows: [Exclude<keyof typeof a, 'voiceMode' | 'voiceRange' | 'micId' | 'notifySounds'>, string][] = [
    ['master', 'Master'],
    ['music', 'Music'],
    ['sfx', 'Sound effects'],
    ['weapons', 'Weapons'],
    ['ui', 'Interface'],
    ['ambient', 'Ambience'],
    ['voice', 'Voice chat'],
  ];
  const talk = useSettings((s) => s.controls.bindings.talk?.[0]);
  return (
    <>
      {rows.map(([k, l]) => (
        <Setting key={k} name={l}>
          <Slider label={l} value={a[k]} min={0} max={1} onChange={(v) => set('audio', { [k]: v })} />
        </Setting>
      ))}
      <MicAccess />
      <MicPicker />
      <Notifications />
      <Setting name="Voice chat microphone" hint={`Push to talk: hold ${keyLabel(talk)} to speak. Your browser asks for the microphone the first time.`}>
        <Segmented
          label="Voice chat microphone"
          value={a.voiceMode}
          onChange={(v) => set('audio', { voiceMode: v })}
          options={[
            { value: 'ptt', label: 'Push to talk' },
            { value: 'open', label: 'Open mic' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </Setting>
      <Setting
        name="Voice chat range"
        hint="Proximity: players fade out with distance, like being there. Team: teammates are heard anywhere, rivals only up close."
      >
        <Segmented
          label="Voice chat range"
          value={a.voiceRange}
          onChange={(v) => set('audio', { voiceRange: v })}
          options={[
            { value: 'proximity', label: 'Proximity' },
            { value: 'team', label: 'Team + nearby' },
            { value: 'all', label: 'Everyone' },
          ]}
        />
      </Setting>
    </>
  );
}

const ACTIONS: [Action, string][] = [
  ['forward', 'Move forward'],
  ['back', 'Move back'],
  ['left', 'Move left'],
  ['right', 'Move right'],
  ['fire', 'Fire'],
  ['dive', 'Paint dive (hold)'],
  ['jump', 'Jump / double jump'],
  ['sprint', 'Sprint'],
  ['slide', 'Slide (while sprinting)'],
  ['dodge', 'Dodge'],
  ['special', 'Special'],
  ['emote', 'Emote'],
  ['chat', 'Open chat'],
  ['talk', 'Push to talk (hold)'],
  ['map', 'Bigger minimap'],
  ['view', 'First / third person'],
  ['scoreboard', 'Scoreboard (hold)'],
  ['pause', 'Pause'],
];

/** The actions a controller can do (movement is the left stick and looking is the right stick). */
const PAD_ACTIONS = ACTIONS.filter(([a]) => !['forward', 'back', 'left', 'right'].includes(a));

/** Rebinds a controller button: pick from the list (works on any device), or press the button on the controller itself. */
function PadSlot({ action }: { action: Action }) {
  const value = useSettings((s) => s.controls.padBindings[action]);
  const bindPad = useSettings((s) => s.bindPad);
  const style = useButtonStyle();
  const connected = useDevice((d) => d.pad !== null);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    let raf = 0;
    const t0 = performance.now();
    const base = new Set<number>();
    const tick = () => {
      const p = [...(navigator.getGamepads?.() ?? [])].find((x) => x?.connected);
      if (p) {
        // Ignore anything already held when listening began.
        p.buttons.forEach((b, i) => {
          if (performance.now() - t0 < 250) return void (b.pressed && base.add(i));
          if (b.pressed && !base.has(i)) {
            bindPad(action, i);
            setListening(false);
          }
          if (!b.pressed) base.delete(i);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const esc = (e: KeyboardEvent) => e.code === 'Escape' && setListening(false);
    addEventListener('keydown', esc);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', esc);
    };
  }, [listening, action, bindPad]);
  return (
    <>
      <select className="select select--pad" value={value ?? ''} onChange={(e) => bindPad(action, e.target.value === '' ? null : Number(e.target.value))} aria-label={`Controller button for ${action}`}>
        <option value="">Not set</option>
        {PAD_BUTTON[style].slice(0, 16).map((n, i) => (
          <option key={n} value={i}>
            {n}
          </option>
        ))}
      </select>
      {connected && (
        <button type="button" className="key" data-listening={listening} onClick={() => setListening(!listening)}>
          {listening ? 'Press a button…' : 'Press'}
        </button>
      )}
    </>
  );
}

function ControllerControls() {
  const c = useSettings((s) => s.controls);
  const set = useSettings((s) => s.set);
  const pad = useDevice();
  const style = useButtonStyle();
  return (
    <>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        {pad.pad
          ? `Detected: ${pad.pad === 'playstation' ? 'PlayStation-style' : 'Xbox'} controller${pad.padName ? ` (${pad.padName.replace(/\(.*?Vendor.*?\)/, '').trim().slice(0, 48)})` : ''}.`
          : 'No controller yet. Connect one (USB or Bluetooth, on a computer, phone or tablet) and press any button on it. Until then, PlayStation buttons are shown.'}
      </p>
      <Setting name="Button names" hint="Auto uses the controller you’re holding, and PlayStation names if it can’t tell.">
        <Segmented
          value={c.padStyle}
          onChange={(v) => set('controls', { padStyle: v })}
          label="Button names"
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'playstation', label: 'PlayStation' },
            { value: 'xbox', label: 'Xbox' },
          ]}
        />
      </Setting>
      <Setting name="Gamepad sensitivity">
        <Slider label="Gamepad sensitivity" value={c.gamepadSensitivity} min={0.2} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set('controls', { gamepadSensitivity: v })} />
      </Setting>
      <Setting name="Controller vibration">
        <Toggle label="Controller vibration" checked={c.vibration} onChange={(v) => set('controls', { vibration: v })} />
      </Setting>
      <Setting name="Move and look" hint="The left stick moves and the right stick looks. Sticks can’t be remapped.">
        <span className="muted small">Fixed</span>
      </Setting>
      <h3 className="panel__title" style={{ marginTop: 18 }}>
        Controller buttons ({style === 'playstation' ? 'PlayStation' : 'Xbox'})
      </h3>
      {PAD_ACTIONS.map(([a, label]) => (
        <Setting key={a} name={label}>
          <PadSlot action={a} />
        </Setting>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <Button onClick={() => set('controls', { padBindings: DEFAULT_PAD })}>Reset controller buttons</Button>
      </div>
    </>
  );
}

function TouchControlsSettings() {
  const c = useSettings((s) => s.controls);
  const set = useSettings((s) => s.set);
  return (
    <>
      <Setting name="Touch controls" hint="Auto shows them on touch screens, and hides them while you play with a controller.">
        <Segmented value={c.touchControls} onChange={(v) => set('controls', { touchControls: v })} label="Touch controls" options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
      </Setting>
      <Setting name="Button size" hint="Bigger buttons are easier to hit; smaller ones leave more of the screen.">
        <Slider label="Button size" value={c.touchScale} min={0.7} max={1.5} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => set('controls', { touchScale: v })} />
      </Setting>
      <Setting name="Button opacity">
        <Slider label="Button opacity" value={c.touchOpacity} min={0.25} max={1} step={0.05} onChange={(v) => set('controls', { touchOpacity: v })} />
      </Setting>
      <Setting name="Vibrate on touch" hint="A short buzz when you press a button (where the phone allows it).">
        <Toggle label="Vibrate on touch" checked={c.touchHaptics} onChange={(v) => set('controls', { touchHaptics: v })} />
      </Setting>
      <Setting name="Look sensitivity" hint="Dragging anywhere on the right side turns the camera.">
        <Slider label="Camera sensitivity" value={useSettings.getState().gameplay.cameraSensitivity} min={0.3} max={2.5} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => useSettings.getState().set('gameplay', { cameraSensitivity: v })} />
      </Setting>
      <div className="touch-preview" style={{ ['--ts' as string]: c.touchScale, ['--to' as string]: c.touchOpacity }} aria-hidden>
        <span className="touch-preview__stick" />
        <span className="touch-preview__b touch-preview__b--fire">FIRE</span>
        <span className="touch-preview__b touch-preview__b--jump">JUMP</span>
        <span className="touch-preview__b touch-preview__b--dive">DIVE</span>
      </div>
    </>
  );
}

function KeyboardControls() {
  const c = useSettings((s) => s.controls);
  const set = useSettings((s) => s.set);
  const bind = useSettings((s) => s.bind);
  return (
    <>
      <Setting name="Mouse sensitivity">
        <Slider label="Mouse sensitivity" value={c.mouseSensitivity} min={0.1} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set('controls', { mouseSensitivity: v })} />
      </Setting>
      <Setting name="Aim sensitivity" hint="Multiplier while firing, for finer aim.">
        <Slider label="Aim sensitivity" value={c.aimSensitivity} min={0.3} max={1.5} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => set('controls', { aimSensitivity: v })} />
      </Setting>
      <Setting name="Invert Y-axis">
        <Toggle label="Invert Y-axis" checked={c.invertY} onChange={(v) => set('controls', { invertY: v })} />
      </Setting>
      <h3 className="panel__title" style={{ marginTop: 22 }}>
        Key bindings
      </h3>
      <p className="muted small" style={{ margin: '-6px 0 6px' }}>
        Click a slot, then press a key or mouse button. Esc cancels.
      </p>
      {ACTIONS.map(([a, label]) => (
        <Setting key={a} name={label}>
          <KeyCapture code={c.bindings[a]?.[0]} onSet={(code) => bind(a, 0, code)} />
          <KeyCapture code={c.bindings[a]?.[1]} onSet={(code) => bind(a, 1, code)} />
        </Setting>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <Button onClick={() => set('controls', { bindings: DEFAULT_BINDINGS })}>Reset key bindings</Button>
      </div>
    </>
  );
}

type Kind = 'keyboard' | 'pad' | 'touch';

/** Controls for every kind of device: pick the one you play on and change what each button does. */
function Controls() {
  const last = useDevice((d) => d.last);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const [kind, setKind] = useState<Kind>(last === 'pad' ? 'pad' : coarse ? 'touch' : 'keyboard');
  return (
    <>
      <Segmented
        value={kind}
        onChange={setKind}
        label="Device"
        options={[
          { value: 'keyboard', label: 'Keyboard & mouse' },
          { value: 'pad', label: 'Controller' },
          { value: 'touch', label: 'Touch' },
        ]}
      />
      <p className="muted small" style={{ margin: '8px 0 14px' }}>
        Every kind of device can be changed here, whichever one you’re using. The game switches to controller buttons by itself when you press one.
      </p>
      {kind === 'keyboard' && <KeyboardControls />}
      {kind === 'pad' && <ControllerControls />}
      {kind === 'touch' && <TouchControlsSettings />}
    </>
  );
}

function Gameplay() {
  const g = useSettings((s) => s.gameplay);
  const set = useSettings((s) => s.set);
  return (
    <>
      <Setting name="Camera sensitivity" hint="Overall turn speed for every input device.">
        <Slider label="Camera sensitivity" value={g.cameraSensitivity} min={0.3} max={2.5} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => set('gameplay', { cameraSensitivity: v })} />
      </Setting>
      <Setting name="Camera smoothing" hint="How softly the camera follows. Aiming is never smoothed.">
        <Slider label="Camera smoothing" value={g.cameraSmoothing} min={0} max={1} onChange={(v) => set('gameplay', { cameraSmoothing: v })} />
      </Setting>
      <Setting name="Camera shake">
        <Slider label="Camera shake" value={g.cameraShake} min={0} max={1} onChange={(v) => set('gameplay', { cameraShake: v })} />
      </Setting>
      <Setting name="Crosshair">
        <Segmented value={g.crosshair} onChange={(v) => set('gameplay', { crosshair: v })} label="Crosshair" options={[{ value: 'ring', label: 'Ring' }, { value: 'dot', label: 'Dot' }, { value: 'cross', label: 'Cross' }]} />
      </Setting>
      <Setting name="HUD scale">
        <Slider label="HUD scale" value={g.hudScale} min={0.75} max={1.35} step={0.05} onChange={(v) => set('gameplay', { hudScale: v })} />
      </Setting>
      <Setting name="Hit indicators" hint="Crosshair flash when your shots land.">
        <Toggle label="Hit indicators" checked={g.hitIndicators} onChange={(v) => set('gameplay', { hitIndicators: v })} />
      </Setting>
      <Setting name="Damage indicators" hint="Shows which direction damage came from.">
        <Toggle label="Damage indicators" checked={g.damageIndicators} onChange={(v) => set('gameplay', { damageIndicators: v })} />
      </Setting>
      <Setting name="Team indicators" hint="Name tags and markers over teammates.">
        <Toggle label="Team indicators" checked={g.teamIndicators} onChange={(v) => set('gameplay', { teamIndicators: v })} />
      </Setting>
    </>
  );
}

function Accessibility() {
  const a = useSettings((s) => s.accessibility);
  const set = useSettings((s) => s.set);
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  return (
    <>
      <Setting name="Colour-blind team colours" hint="Team markers also use shapes (▲ and ●). Applies from the next match for the arena.">
        <Segmented
          value={a.colorblind}
          onChange={(v) => set('accessibility', { colorblind: v })}
          label="Colour-blind mode"
          options={[
            { value: 'off', label: 'Off' },
            { value: 'deuteranopia', label: 'Deuteranopia' },
            { value: 'protanopia', label: 'Protanopia' },
            { value: 'tritanopia', label: 'Tritanopia' },
          ]}
        />
      </Setting>
      <div className="row" style={{ padding: '4px 0 10px', justifyContent: 'flex-end' }}>
        {PALETTES[a.colorblind].map((c) => (
          <span key={c} className="swatch__color" style={{ background: hex(c), width: 26, height: 26 }} />
        ))}
      </div>
      <Setting name="Text size">
        <Slider label="Text size" value={a.textScale} min={0.85} max={1.4} step={0.05} onChange={(v) => set('accessibility', { textScale: v })} />
      </Setting>
      <Setting name="Reduced motion" hint="Removes camera sway, FOV kicks and most interface movement.">
        <Segmented value={a.reducedMotion} onChange={(v) => set('accessibility', { reducedMotion: v })} label="Reduced motion" options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
      </Setting>
      <Setting name="Subtitles" hint="Captions for countdowns, horns and other audio cues.">
        <Toggle label="Subtitles" checked={a.subtitles} onChange={(v) => set('accessibility', { subtitles: v })} />
      </Setting>
      <Setting name="Visual audio indicators" hint="Edge markers for loud sounds such as shots and blasts.">
        <Toggle label="Visual audio indicators" checked={a.visualAudio} onChange={(v) => set('accessibility', { visualAudio: v })} />
      </Setting>
      <Setting name="High contrast interface">
        <Toggle label="High contrast" checked={a.highContrast} onChange={(v) => set('accessibility', { highContrast: v })} />
      </Setting>
    </>
  );
}
