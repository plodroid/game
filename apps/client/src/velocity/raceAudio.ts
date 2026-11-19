import { HORNS, type CarLoadout } from '@chromashift/shared';
import { audio } from '../audio/audio';
import { CarAudioController } from './carAudio';

/*
 * Racing sound. Each engine is a CarAudioController (sampled loops crossfaded by RPM through a
 * virtual gearbox); tyre squeal and wind are filtered noise; hits, boosts and horns are short
 * one-off sounds. Only the cars closest to you get an engine voice.
 */

export class RaceAudio {
  private voices = new Map<number, CarAudioController>();
  private squeal: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private dead = false;

  private ctx() {
    return this.dead ? null : audio.ctx;
  }

  private voice(id: number, loadout: CarLoadout): CarAudioController | null {
    const ctx = this.ctx(), out = audio.bus('sfx');
    if (!ctx || !out) return null;
    let v = this.voices.get(id);
    // A car that changed engine (the garage) gets a new voice.
    if (v && v.engine !== loadout.engine) {
      v.dispose();
      v = undefined;
    }
    if (!v) this.voices.set(id, (v = new CarAudioController(ctx, out, loadout.engine)));
    return v;
  }

  private loop(freq: number, type: BiquadFilterType) {
    const ctx = this.ctx(), out = audio.bus('sfx'), buf = audio.noiseBuffer;
    if (!ctx || !out || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = type === 'bandpass' ? 6 : 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(out);
    src.start();
    return { src, filter, gain };
  }

  /** Per frame: engines of the given cars (gain already includes distance), squeal and wind for the player. */
  engines(list: { id: number; loadout: CarLoadout; speed: number; throttle: number; gain: number; pan: number }[], player: { slip: number; speed: number } | null, dt = 1 / 60) {
    const ctx = this.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const live = new Set<number>();
    for (const c of list) {
      const v = this.voice(c.id, c.loadout);
      if (!v) continue;
      live.add(c.id);
      v.update(dt, { speed: c.speed, throttle: c.throttle, gain: c.gain, pan: c.pan });
    }
    for (const [id, v] of this.voices)
      if (!live.has(id)) {
        v.dispose();
        this.voices.delete(id);
      }
    this.squeal ??= this.loop(1900, 'bandpass');
    this.wind ??= this.loop(500, 'lowpass');
    if (this.squeal && this.wind) {
      const slip = player?.slip ?? 0, speed = player?.speed ?? 0;
      const sq = slip > 0.35 && speed > 6 ? Math.min(1, (slip - 0.35) * 2) : 0;
      this.squeal.gain.gain.setTargetAtTime(sq * 0.22, t, 0.06);
      this.squeal.filter.frequency.setTargetAtTime(1500 + speed * 15, t, 0.1);
      this.wind.gain.gain.setTargetAtTime(Math.min(0.18, (speed / 50) ** 2 * 0.18), t, 0.2);
      this.wind.filter.frequency.setTargetAtTime(300 + speed * 18, t, 0.2);
    }
  }

  /** A bump or crash: a noise crunch plus a thump, louder for harder hits. */
  /** The wall bounce: a quick falling "boing" over a soft thud. */
  bonk(gain: number) {
    const ctx = this.ctx();
    const out = audio.bus('sfx');
    if (!ctx || !out || gain < 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.28);
    const wob = ctx.createOscillator();
    wob.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.value = 40;
    wob.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(out);
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(140, t);
    th.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.5 * gain, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    th.connect(tg).connect(out);
    for (const x of [o, wob, th]) {
      x.start(t);
      x.stop(t + 0.35);
    }
  }

  impact(strength: number, gain: number) {
    const ctx = this.ctx(), out = audio.bus('sfx'), buf = audio.noiseBuffer;
    if (!ctx || !out || !buf || gain < 0.02) return;
    const t = ctx.currentTime;
    const k = Math.min(1, strength / 18) * gain;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + k * 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * k + 0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + k * 0.3);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random(), 0.7);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5 * k + 0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** A whoosh for boosts and mini-turbos. */
  whoosh(gain: number, high = false) {
    const ctx = this.ctx(), out = audio.bus('sfx'), buf = audio.noiseBuffer;
    if (!ctx || !out || !buf || gain < 0.02) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(high ? 900 : 400, t);
    f.frequency.exponentialRampToValueAtTime(high ? 4000 : 2400, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * gain, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random(), 0.8);
  }

  /** The car's horn. */
  horn(id: string, gain: number) {
    const ctx = this.ctx(), out = audio.bus('sfx');
    if (!ctx || !out || gain < 0.02) return;
    const h = HORNS[id] ?? HORNS.beep;
    const t = ctx.currentTime;
    const step = h.notes.length > 2 ? 0.12 : 0;
    h.notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = h.wave;
      o.frequency.value = freq;
      const g = ctx.createGain();
      const st = t + i * step;
      const len = step || 0.5;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.09 * gain, st + 0.02);
      g.gain.setValueAtTime(0.09 * gain, st + len * 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, st + len);
      o.connect(g).connect(out);
      o.start(st);
      o.stop(st + len + 0.05);
    });
  }

  dispose() {
    this.dead = true;
    for (const v of this.voices.values()) v.dispose();
    this.voices.clear();
    for (const l of [this.squeal, this.wind]) {
      try {
        if (l) l.gain.gain.value = 0;
        l?.src.stop();
      } catch {
        /* stopped */
      }
    }
  }
}
