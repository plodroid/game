import { WEAPONS, type Vec3, type WeaponId } from '@chromashift/shared';
import { useSettings } from '../settings/settings';

type Bus = 'music' | 'sfx' | 'weapons' | 'ui' | 'ambient';
export type Sfx =
  | 'shot' | 'splat' | 'drip' | 'hit' | 'hurt' | 'ko' | 'jump' | 'land' | 'dive' | 'surface' | 'swim' | 'empty'
  | 'special' | 'ready' | 'blast' | 'spawn' | 'click' | 'hover' | 'back' | 'confirm' | 'count' | 'go' | 'time' | 'zone';

interface PlayOpts {
  at?: Vec3;
  gain?: number;
  pitch?: number;
  weapon?: WeaponId;
}

const MAX_VOICES = 40;
const SFX: Sfx[] = [
  'splat',
  'drip',
  'hit',
  'hurt',
  'ko',
  'jump',
  'land',
  'dive',
  'surface',
  'swim',
  'empty',
  'special',
  'ready',
  'blast',
  'spawn',
  'click',
  'hover',
  'back',
  'confirm',
  'count',
  'go',
  'time',
  'zone',
];
const SHOT_BASES = ['pulse', 'arc', 'lobber', 'roller', 'dual'];
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Procedural audio: every sound is synthesised at runtime, so there are no audio assets to
 * license, download or cache, and it works offline.
 */
class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private noise!: AudioBuffer;
  private voices = 0;
  private burst = new Map<Sfx, { t: number; n: number }>();
  /** Every effect rendered once into a buffer: playing one is a single source, not a synth graph. */
  private bank = new Map<string, AudioBuffer>();
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private music: { timer: number; step: number; next: number; kind: 'menu' | 'match' } | null = null;
  private intensity = 0;
  private ambient: { src: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;
  /** Fires for loud world sounds so the HUD can show visual audio cues. */
  onWorldSound: ((at: Vec3, kind: Sfx) => void) | null = null;

  /** Must be called from a user gesture the first time (autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      for (const b of ['music', 'sfx', 'weapons', 'ui', 'ambient'] as Bus[]) {
        this.buses[b] = ctx.createGain();
        this.buses[b].connect(this.master);
      }
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      useSettings.subscribe(() => this.applyVolumes());
      // The system can suspend or interrupt audio (device switch, sleep, another app taking the
      // output); any key or click brings it back instead of the game staying silent.
      const wake = () => this.ctx && this.ctx.state !== 'running' && void this.ctx.resume();
      addEventListener('keydown', wake, true);
      addEventListener('pointerdown', wake, true);
      void this.prerender();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = useSettings.getState().audio;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master, t, 0.03);
    this.buses.music.gain.setTargetAtTime(a.music * 0.5, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(a.sfx, t, 0.03);
    this.buses.weapons.gain.setTargetAtTime(a.weapons * 0.8, t, 0.03);
    this.buses.ui.gain.setTargetAtTime(a.ui * 0.7, t, 0.03);
    this.buses.ambient.gain.setTargetAtTime(a.ambient * 0.6, t, 0.05);
  }

  setListener(p: Vec3, yaw: number) {
    this.listener.x = p.x;
    this.listener.y = p.y;
    this.listener.z = p.z;
    this.listener.yaw = yaw;
  }

  /** Distance attenuation and stereo pan relative to the camera. */
  private spatial(at?: Vec3) {
    if (!at) return { gain: 1, pan: 0 };
    const dx = at.x - this.listener.x, dy = at.y - this.listener.y, dz = at.z - this.listener.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 60) return null;
    const gain = 1 / Math.pow(1 + d / 9, 1.25);
    const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / d) * 0.85)) : 0;
    return { gain, pan };
  }

  private out(bus: Bus, at: Vec3 | undefined, gain: number): AudioNode | null {
    if (!this.ctx || this.voices >= MAX_VOICES) return null;
    const sp = this.spatial(at);
    if (!sp || sp.gain * gain < 0.01) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain * sp.gain;
    if (sp.pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = sp.pan;
      g.connect(p).connect(this.buses[bus]);
    } else g.connect(this.buses[bus]);
    return g;
  }

  private track(node: AudioScheduledSourceNode) {
    // Only live sounds count towards the voice limit (not ones being rendered into the bank).
    if (node.context !== this.ctx) return;
    this.voices++;
    node.onended = () => this.voices--;
  }

  /**
   * Renders each effect once, offline, into a short buffer. Same synthesis, done ahead of time:
   * during play each sound is then one buffer source instead of several oscillators and filters,
   * which keeps the audio thread light on phones and older PCs.
   */
  private async prerender() {
    const live = this.ctx;
    if (!live || typeof OfflineAudioContext === 'undefined') return;
    const rate = live.sampleRate;
    for (const key of [...SFX, ...SHOT_BASES.map((b) => `shot:${b}`)]) {
      try {
        const off = new OfflineAudioContext(1, Math.ceil(rate * 1.3), rate);
        this.synth(key, off.destination, 0, 1);
        const buf = await off.startRendering();
        // Trim the silent tail.
        const d = buf.getChannelData(0);
        let end = d.length - 1;
        while (end > 0 && Math.abs(d[end]) < 1e-4) end--;
        const out = live.createBuffer(1, Math.min(d.length, end + 64), rate);
        out.copyToChannel(d.subarray(0, out.length), 0);
        this.bank.set(key, out);
      } catch {
        // Rendering unsupported here: that sound keeps being synthesised live.
      }
    }
  }

  private tone(
    dest: AudioNode,
    t: number,
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    attack = 0.004,
  ) {
    const ctx = dest.context;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(o);
  }

  private hiss(
    dest: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    vol: number,
  ) {
    const ctx = dest.context;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
    this.track(s);
  }

  play(name: Sfx, o: PlayOpts = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // After a hitch the game catches up several ticks at once; stacking dozens of copies of one
    // sound on the same instant only clips, so a few per moment is plenty.
    const burst = this.burst.get(name);
    if (burst && t - burst.t < 0.03) {
      if (burst.n >= 3) return;
      burst.n++;
    } else this.burst.set(name, { t, n: 1 });
    const p = o.pitch ?? 1;
    const vary = 0.94 + Math.random() * 0.12;
    const bus: Bus = name === 'shot' ? 'weapons' : ['click', 'hover', 'back', 'confirm', 'count', 'go', 'time', 'ready'].includes(name) ? 'ui' : 'sfx';
    const dest = this.out(bus, o.at, o.gain ?? 1);
    if (!dest) return;
    if (o.at && (name === 'shot' || name === 'blast' || name === 'ko')) this.onWorldSound?.(o.at, name);
    const k = p * vary;
    const key = name === 'shot' ? `shot:${WEAPONS[o.weapon ?? 'pulse']?.base ?? 'pulse'}` : name;
    const buf = this.bank.get(key);
    if (!buf) return this.synth(key, dest, t, k);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = k;
    src.connect(dest);
    src.start(t);
    this.track(src);
  }

  /** The synthesis of one effect (`shot:<base>` for weapon shots) into `dest`, starting at `t`. */
  private synth(key: string, dest: AudioNode, t: number, k: number) {
    const [name, base] = key.split(':') as [Sfx, string | undefined];
    switch (name) {
      case 'shot': {
        const w = base ?? 'pulse';
        if (w === 'arc') {
          this.tone(dest, t, 180 * k, 48, 0.22, 'sine', 0.7);
          this.hiss(dest, t, 0.25, 'lowpass', 2400, 300, 0.8, 0.5);
        } else if (w === 'lobber') {
          for (let i = 0; i < 3; i++) this.tone(dest, t + i * 0.035, 260 * k, 620 * k, 0.12, 'triangle', 0.3);
        } else if (w === 'roller') {
          this.hiss(dest, t, 0.28, 'bandpass', 600, 2600, 1.2, 0.55);
        } else if (w === 'dual') {
          this.tone(dest, t, 900 * k, 380, 0.05, 'square', 0.12);
          this.hiss(dest, t, 0.05, 'highpass', 3000, 1800, 0.7, 0.2);
        } else {
          this.tone(dest, t, 640 * k, 240, 0.07, 'square', 0.14);
          this.hiss(dest, t, 0.08, 'bandpass', 2600, 1200, 1.1, 0.35);
        }
        break;
      }
      case 'splat':
        this.hiss(dest, t, 0.14, 'bandpass', 900 * k, 260, 1.6, 0.45);
        this.tone(dest, t, 220 * k, 90, 0.08, 'sine', 0.2);
        break;
      case 'drip':
        this.tone(dest, t, 700 * k, 300, 0.05, 'sine', 0.08);
        break;
      case 'hit':
        this.tone(dest, t, 1500 * k, 1100, 0.06, 'triangle', 0.35);
        this.tone(dest, t + 0.03, 2200 * k, 1800, 0.05, 'sine', 0.2);
        break;
      case 'hurt':
        this.tone(dest, t, 160 * k, 70, 0.16, 'sawtooth', 0.25);
        this.hiss(dest, t, 0.12, 'lowpass', 1200, 200, 0.7, 0.3);
        break;
      case 'ko':
        this.hiss(dest, t, 0.5, 'bandpass', 1400, 120, 0.9, 0.8);
        this.tone(dest, t, 520 * k, 80, 0.45, 'triangle', 0.4);
        break;
      case 'jump':
        this.hiss(dest, t, 0.12, 'bandpass', 500, 1500, 1.5, 0.18);
        break;
      case 'land':
        this.tone(dest, t, 110 * k, 50, 0.1, 'sine', 0.35);
        break;
      case 'dive':
        this.tone(dest, t, 500 * k, 140, 0.12, 'sine', 0.35);
        this.hiss(dest, t, 0.1, 'lowpass', 1600, 300, 0.8, 0.25);
        break;
      case 'surface':
        this.tone(dest, t, 180 * k, 560, 0.1, 'sine', 0.3);
        break;
      case 'swim':
        this.tone(dest, t, (240 + Math.random() * 260) * k, 160, 0.06, 'sine', 0.08);
        break;
      case 'empty':
        this.tone(dest, t, 2400, 2000, 0.03, 'square', 0.08);
        break;
      case 'special':
        this.tone(dest, t, 220 * k, 880 * k, 0.4, 'sawtooth', 0.22, 0.05);
        this.hiss(dest, t, 0.45, 'bandpass', 400, 4000, 2, 0.25);
        break;
      case 'ready':
        [0, 4, 7, 12].forEach((n, i) => this.tone(dest, t + i * 0.06, NOTE(72 + n), NOTE(72 + n), 0.2, 'triangle', 0.18));
        break;
      case 'blast':
        this.tone(dest, t, 120 * k, 35, 0.4, 'sine', 0.8);
        this.hiss(dest, t, 0.45, 'lowpass', 3000, 150, 0.6, 0.7);
        break;
      case 'spawn':
        this.tone(dest, t, 300 * k, 900 * k, 0.25, 'sine', 0.2, 0.04);
        break;
      case 'zone':
        [0, 7].forEach((n, i) => this.tone(dest, t + i * 0.09, NOTE(67 + n), NOTE(67 + n), 0.25, 'triangle', 0.22));
        break;
      case 'click':
        this.tone(dest, t, 1800 * k, 1200, 0.035, 'sine', 0.18);
        break;
      case 'hover':
        this.tone(dest, t, 2600 * k, 2400, 0.02, 'sine', 0.05);
        break;
      case 'back':
        this.tone(dest, t, 900 * k, 500, 0.06, 'sine', 0.16);
        break;
      case 'confirm':
        this.tone(dest, t, NOTE(76), NOTE(76), 0.08, 'triangle', 0.18);
        this.tone(dest, t + 0.07, NOTE(83), NOTE(83), 0.14, 'triangle', 0.18);
        break;
      case 'count':
        this.tone(dest, t, NOTE(69), NOTE(69), 0.14, 'square', 0.12);
        break;
      case 'go':
        [0, 4, 7].forEach((n) => this.tone(dest, t, NOTE(81 + n), NOTE(81 + n), 0.45, 'square', 0.08));
        break;
      case 'time':
        this.tone(dest, t, NOTE(57), NOTE(52), 0.7, 'sawtooth', 0.18);
        break;
    }
  }

  jingle(win: boolean) {
    if (!this.ctx) return;
    const dest = this.out('music', undefined, 1);
    if (!dest) return;
    const t = this.ctx.currentTime + 0.05;
    const seq = win ? [60, 64, 67, 72, 76, 79, 84] : [64, 62, 60, 57, 55];
    seq.forEach((n, i) => this.tone(dest, t + i * (win ? 0.09 : 0.16), NOTE(n), NOTE(n), win ? 0.35 : 0.5, 'triangle', 0.22));
    if (win) this.tone(dest, t + seq.length * 0.09, NOTE(72), NOTE(72), 1.2, 'sawtooth', 0.08);
  }

  /** Simple lookahead sequencer playing original patterns. */
  startMusic(kind: 'menu' | 'match') {
    if (!this.ctx) return;
    if (this.music?.kind === kind) return;
    this.stopMusic();
    const m = { timer: 0, step: 0, next: this.ctx.currentTime + 0.1, kind };
    this.music = m;
    const bpm = kind === 'menu' ? 96 : 128;
    const sixteenth = 60 / bpm / 4;
    // i–VI–III–VII in A minor, one chord per bar.
    const roots = [45, 41, 48, 43];
    const chords = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
    m.timer = window.setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || this.music !== m) return;
      // If the page stalled, skip the beats that were missed rather than playing them all at once.
      if (m.next < ctx.currentTime) {
        const missed = Math.ceil((ctx.currentTime - m.next) / sixteenth);
        m.step += missed;
        m.next += missed * sixteenth;
      }
      while (m.next < ctx.currentTime + 0.15) {
        const s = m.step % 16, bar = Math.floor(m.step / 16) % 4;
        const t = m.next;
        const dest = this.buses.music;
        const root = roots[bar], ch = chords[bar];
        if (kind === 'match') {
          if (s % 4 === 0) this.drum(dest, t, 'kick');
          if (s === 4 || s === 12) this.drum(dest, t, 'snare');
          if (s % 2 === 1 || this.intensity > 0.5) this.drum(dest, t, 'hat');
          if (s % 2 === 0) this.voice(dest, t, NOTE(root + (s % 8 === 6 ? 12 : 0)), sixteenth * 1.6, 'sawtooth', 0.09, 700);
          const arp = ch[(m.step >> 1) % 3] + 12 * (1 + (this.intensity > 0.5 ? (s >> 3) % 2 : 0));
          if (s % 2 === 0) this.voice(dest, t, NOTE(root + 24 + arp - 12), sixteenth * 1.2, 'triangle', 0.05, 4000);
        } else {
          if (s === 0 || s === 10) this.drum(dest, t, 'kick');
          if (s === 8) this.drum(dest, t, 'snare');
          if (s % 4 === 2) this.drum(dest, t, 'hat');
          if (s === 0) for (const n of ch) this.voice(dest, t, NOTE(root + 24 + n), sixteenth * 15, 'sawtooth', 0.025, 1200);
          if (s % 3 === 0) this.voice(dest, t, NOTE(root + 36 + ch[(m.step / 3) % 3 | 0]), sixteenth * 2, 'triangle', 0.03, 5000);
        }
        m.step++;
        m.next += sixteenth;
      }
    }, 25);
  }

  setIntensity(x: number) {
    this.intensity = x;
  }

  stopMusic() {
    if (this.music) clearInterval(this.music.timer);
    this.music = null;
  }

  private drum(dest: AudioNode, t: number, kind: 'kick' | 'snare' | 'hat') {
    if (kind === 'kick') this.tone(dest, t, 150, 42, 0.18, 'sine', 0.9);
    else if (kind === 'snare') {
      this.hiss(dest, t, 0.13, 'bandpass', 1800, 900, 0.8, 0.35);
      this.tone(dest, t, 200, 150, 0.06, 'triangle', 0.2);
    } else this.hiss(dest, t, 0.035, 'highpass', 7500, 6000, 0.7, 0.12);
  }

  private voice(dest: AudioNode, t: number, f: number, dur: number, type: OscillatorType, vol: number, cutoff: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(cutoff, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.4), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(filt).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(o);
  }

  startAmbient(kind: 'wind' | 'hum') {
    if (!this.ctx) return;
    this.stopAmbient();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'wind' ? 'bandpass' : 'lowpass';
    f.frequency.value = kind === 'wind' ? 420 : 180;
    f.Q.value = kind === 'wind' ? 0.6 : 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = kind === 'wind' ? 220 : 40;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = kind === 'wind' ? 0.22 : 0.3;
    src.connect(f).connect(g).connect(this.buses.ambient);
    src.start();
    lfo.start();
    this.ambient = { src, lfo };
  }

  stopAmbient() {
    if (!this.ambient) return;
    this.ambient.src.stop();
    this.ambient.lfo.stop();
    this.ambient = null;
  }
}

export const audio = new AudioEngine();
