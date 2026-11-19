import { audio } from '../audio/audio';
import { backfire, ENGINE_VOICES, engineLoop, LOOP_RPM, type LoopName } from '../audio/engineSynth';
import { env } from '../env';

/*
 * One car's engine, the way racing games do it: four looping recordings (idle, low, mid, high revs)
 * play together, crossfaded with equal-power curves by the engine's RPM, each nudged in pitch only
 * a little towards the current revs. The RPM comes from a six-speed gearbox: it climbs through a
 * gear, drops on the upshift, blips on the downshift and settles to a lumpy idle when you stop.
 * Under throttle a filter opens and the sound gets louder and grittier; lift off from high revs and
 * the exhaust pops.
 *
 * The V8 set is loaded from public/sounds/ (idle.wav, low.wav, mid.wav, high.wav, backfire.wav);
 * replace those with real recordings and every V8 car uses them. The other engine sounds are
 * modelled in the browser with the same exhaust-pulse model. Everything runs outside React: the
 * race view calls update() each frame.
 */

const LOOPS: LoopName[] = ['idle', 'low', 'mid', 'high'];
const IDLE = 900, REDLINE = 8000;
/** km/h at the redline in each gear (1st … 6th). */
const GEAR_TOP = [0, 58, 96, 132, 168, 205, 250];

interface SampleSet {
  loops: Record<LoopName, AudioBuffer>;
  backfire: AudioBuffer;
}

const sets = new Map<string, Promise<SampleSet>>();

function fromSamples(ctx: BaseAudioContext, data: Float32Array, rate: number) {
  const b = ctx.createBuffer(1, data.length, rate);
  b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return b;
}

/** Modelled loops for an engine voice (used when no file is available for it). */
function modelled(ctx: BaseAudioContext, engine: string): SampleSet {
  const v = ENGINE_VOICES[engine] ?? ENGINE_VOICES.v8;
  const rate = Math.min(32000, ctx.sampleRate);
  const loops = {} as Record<LoopName, AudioBuffer>;
  for (const n of LOOPS) loops[n] = fromSamples(ctx, engineLoop(v, LOOP_RPM[n], rate, 1.6, engine.length * 13), rate);
  return { loops, backfire: fromSamples(ctx, backfire(rate), rate) };
}

/** The sample set for an engine sound: the V8 one from files (falling back to the model), the others modelled. */
function samplesFor(ctx: BaseAudioContext, engine: string): Promise<SampleSet> {
  const key = engine === 'v8' || !ENGINE_VOICES[engine] ? 'v8' : engine;
  let p = sets.get(key);
  if (p) return p;
  if (key !== 'v8') p = Promise.resolve(modelled(ctx, key));
  else {
    const load = async (name: string) => {
      const r = await fetch(`${env.base}sounds/${name}.wav`);
      if (!r.ok) throw new Error(`${name}.wav: ${r.status}`);
      return ctx.decodeAudioData(await r.arrayBuffer());
    };
    p = Promise.all([...LOOPS.map(load), load('backfire')])
      .then(([idle, low, mid, high, bf]) => ({ loops: { idle, low, mid, high }, backfire: bf }))
      .catch(() => modelled(ctx, 'v8'));
  }
  sets.set(key, p);
  return p;
}

/** Soft clipping curve for the exhaust rasp. */
function raspCurve() {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 3.2) / Math.tanh(3.2);
  }
  return c;
}
let curve: Float32Array<ArrayBuffer> | null = null;

export interface EngineFrame {
  /** Ground speed, m/s. */
  speed: number;
  throttle: number;
  /** Volume for distance (1 for your own car). */
  gain: number;
  pan: number;
}

export class CarAudioController {
  /** Engine speed, RPM. */
  rpm = IDLE;
  gear = 1;
  private target = IDLE;
  /** Seconds left of an upshift (power cut) and of a downshift throttle blip. */
  private shiftT = 0;
  private blipT = 0;
  private lastThrottle = 0;
  private popCd = 0;
  private load = 0;
  private turboWhistle = 0;
  private ready = false;
  private dead = false;
  private set: SampleSet | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private dry!: GainNode;
  private wet!: GainNode;
  private filter!: BiquadFilterNode;
  private out!: GainNode;
  private pan!: StereoPannerNode;
  private whistle: { o: OscillatorNode; g: GainNode } | null = null;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    readonly engine: string,
  ) {
    const mix = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve ??= raspCurve() as Float32Array<ArrayBuffer>;
    shaper.oversample = '2x';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.9;
    this.filter.frequency.value = 900;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    mix.connect(this.dry).connect(this.filter);
    mix.connect(shaper).connect(this.wet).connect(this.filter);
    this.filter.connect(this.out).connect(this.pan).connect(dest);
    for (let i = 0; i < LOOPS.length; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(mix);
      this.gains.push(g);
    }
    // A turbo whistles over the engine.
    if (engine === 'turbo') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      g.gain.value = 0;
      o.connect(g).connect(this.filter);
      o.start();
      this.whistle = { o, g };
    }
    void samplesFor(ctx, engine).then((set) => {
      if (this.dead) return;
      this.set = set;
      // All four loops start together and stay in step.
      const t = ctx.currentTime + 0.02;
      LOOPS.forEach((n, i) => {
        const s = ctx.createBufferSource();
        s.buffer = set.loops[n];
        s.loop = true;
        s.connect(this.gains[i]);
        s.start(t, (i * 0.37) % s.buffer.duration);
        this.sources.push(s);
      });
      this.ready = true;
    });
  }

  /** The gearbox: turns road speed and throttle into revs, shifting like a real car. */
  private gearbox(dt: number, kmh: number, throttle: number) {
    const engaged = (g: number) => (kmh / GEAR_TOP[g]) * (REDLINE - 200);
    this.shiftT = Math.max(0, this.shiftT - dt);
    this.blipT = Math.max(0, this.blipT - dt);
    if (this.shiftT === 0) {
      const up = throttle > 0.5 ? 7400 : 5200;
      if (this.gear < 6 && engaged(this.gear) > up) {
        this.gear++;
        this.shiftT = 0.16;
      } else if (this.gear > 1) {
        const down = throttle > 0.5 ? 3900 : 2300;
        if (engaged(this.gear) < down && engaged(this.gear - 1) < 7200) {
          this.gear--;
          this.shiftT = 0.1;
          this.blipT = 0.16;
        }
      }
    }
    let target = engaged(this.gear);
    // Pulling away: the clutch lets the revs rise ahead of the wheels in first.
    if (this.gear === 1 && kmh < 22) target = Math.max(target, IDLE + throttle * 3400 * (1 - kmh / 30));
    // Standing still: idle, or free revs if the throttle is pressed.
    if (kmh < 1.5) target = IDLE + throttle * 5600;
    if (this.blipT > 0) target += 900 * (this.blipT / 0.16);
    this.target = Math.max(IDLE, Math.min(REDLINE, target));
    // Revs fall fast after an upshift, rise a little more slowly under load.
    const k = this.target < this.rpm ? (this.shiftT > 0 ? 18 : 9) : 7 + throttle * 6;
    this.rpm += (this.target - this.rpm) * Math.min(1, dt * k);
  }

  update(dt: number, f: EngineFrame) {
    if (this.dead) return;
    const t = this.ctx.currentTime;
    const throttle = Math.max(0, Math.min(1, f.throttle));
    this.gearbox(dt, f.speed * 3.6, throttle);
    // Load: how hard the engine is working (nothing during a shift, a kick on a blip).
    const loadWant = this.shiftT > 0 ? 0.12 : Math.max(throttle, this.blipT > 0 ? 0.7 : 0);
    this.load += (loadWant - this.load) * Math.min(1, dt * 14);
    // Pops: lifting off sharply from high revs, or a hard upshift near the redline.
    this.popCd = Math.max(0, this.popCd - dt);
    if (this.popCd === 0 && this.rpm > 5500 && this.lastThrottle > 0.55 && throttle < 0.15) this.pop(f.gain, 1);
    this.lastThrottle = throttle;
    if (!this.ready || !this.set) return;
    // Equal-power crossfade between the two loops either side of the revs.
    const pts = LOOPS.map((n) => LOOP_RPM[n]);
    const w = [0, 0, 0, 0];
    if (this.rpm <= pts[0]) w[0] = 1;
    else if (this.rpm >= pts[3]) w[3] = 1;
    else
      for (let i = 0; i < 3; i++)
        if (this.rpm >= pts[i] && this.rpm <= pts[i + 1]) {
          const x = (this.rpm - pts[i]) / (pts[i + 1] - pts[i]);
          w[i] = Math.cos((x * Math.PI) / 2);
          w[i + 1] = Math.sin((x * Math.PI) / 2);
        }
    for (let i = 0; i < 4; i++) {
      this.gains[i].gain.setTargetAtTime(w[i], t, 0.025);
      // Pitch only nudged, so a sample never turns robotic or chipmunk.
      const rate = Math.max(0.8, Math.min(1.3, this.rpm / pts[i]));
      this.sources[i].playbackRate.setTargetAtTime(rate, t, 0.03);
    }
    const hi = (this.rpm - IDLE) / (REDLINE - IDLE);
    // Under load the filter opens and the engine is louder; coasting it closes and goes quiet.
    this.filter.frequency.setTargetAtTime(800 + this.load * 3600 + hi * 1400, t, 0.04);
    this.wet.gain.setTargetAtTime(Math.max(0, (this.rpm - 5500) / 2500) * this.load * 0.45, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - Math.max(0, (this.rpm - 5500) / 2500) * this.load * 0.25, t, 0.05);
    const vol = (0.13 + this.load * 0.11 + hi * 0.05) * f.gain;
    this.out.gain.setTargetAtTime(vol, t, 0.12);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, f.pan)), t, 0.05);
    if (this.whistle) {
      this.turboWhistle += ((this.load > 0.4 ? hi : 0) - this.turboWhistle) * Math.min(1, dt * 3);
      this.whistle.o.frequency.setTargetAtTime(2200 + hi * 4200, t, 0.08);
      this.whistle.g.gain.setTargetAtTime(this.turboWhistle * 0.05, t, 0.08);
    }
  }

  /** Exhaust crackle, slightly different in pitch each time. */
  private pop(gain: number, k: number) {
    if (!this.set) return;
    this.popCd = 0.7;
    const s = this.ctx.createBufferSource();
    s.buffer = this.set.backfire;
    s.playbackRate.value = 0.85 + Math.random() * 0.35;
    const g = this.ctx.createGain();
    g.gain.value = 0.32 * k * gain;
    s.connect(g).connect(this.pan);
    s.start();
  }

  /** Fades out and disconnects everything (on leaving the car, the race, or a hot reload). */
  dispose() {
    if (this.dead) return;
    this.dead = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.05);
    const nodes: AudioScheduledSourceNode[] = [...this.sources, ...(this.whistle ? [this.whistle.o] : [])];
    setTimeout(() => {
      for (const n of nodes)
        try {
          n.stop();
          n.disconnect();
        } catch {
          /* already stopped */
        }
      try {
        this.pan.disconnect();
      } catch {
        /* already gone */
      }
    }, 300);
  }
}

/** Warms the sample sets for the engines about to be heard, so the first rev isn't silent. */
export function preloadEngines(engines: string[]) {
  const ctx = audio.ctx;
  if (!ctx) return;
  for (const e of new Set(engines)) void samplesFor(ctx, e);
}
