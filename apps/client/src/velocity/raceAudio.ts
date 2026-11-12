import { ENGINES, HORNS, type CarLoadout } from '@chromashift/shared';
import { audio } from '../audio/audio';

/*
 * Racing sound, all synthesised: each engine is two oscillators through a filter whose pitch
 * follows the revs and whose brightness and volume follow the throttle (so it sounds different
 * idling, pulling hard and coasting); tyre squeal and wind are filtered noise; hits, boosts and
 * horns are short one-off sounds. Only the cars closest to you get an engine voice.
 */

interface Voice {
  a: OscillatorNode;
  b: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  profile: (typeof ENGINES)[string];
}

export class RaceAudio {
  private voices = new Map<number, Voice>();
  private squeal: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private dead = false;

  private ctx() {
    return this.dead ? null : audio.ctx;
  }

  private voice(id: number, loadout: CarLoadout): Voice | null {
    const ctx = this.ctx(), out = audio.bus('sfx');
    if (!ctx || !out) return null;
    let v = this.voices.get(id);
    if (v) return v;
    const profile = ENGINES[loadout.engine] ?? ENGINES.inline4;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = profile.wave;
    b.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2 + profile.grit * 6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const bg = ctx.createGain();
    bg.gain.value = 0.35 + profile.grit * 0.5;
    a.connect(filter);
    b.connect(bg).connect(filter);
    filter.connect(gain).connect(pan).connect(out);
    a.start();
    b.start();
    v = { a, b, filter, gain, pan, profile };
    this.voices.set(id, v);
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
  engines(list: { id: number; loadout: CarLoadout; rpm: number; throttle: number; gain: number; pan: number }[], player: { slip: number; speed: number } | null) {
    const ctx = this.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const live = new Set<number>();
    for (const c of list) {
      const v = this.voice(c.id, c.loadout);
      if (!v) continue;
      live.add(c.id);
      const f = v.profile.base + v.profile.spread * c.rpm;
      v.a.frequency.setTargetAtTime(f, t, 0.04);
      v.b.frequency.setTargetAtTime(f * 0.5, t, 0.04);
      v.filter.frequency.setTargetAtTime(500 + 3200 * (0.25 + c.throttle * 0.75) * (0.5 + c.rpm * 0.5), t, 0.05);
      v.gain.gain.setTargetAtTime(c.gain * (0.035 + 0.075 * c.throttle + 0.02 * c.rpm), t, 0.05);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, c.pan)), t, 0.05);
    }
    for (const [id, v] of this.voices)
      if (!live.has(id)) {
        v.gain.gain.setTargetAtTime(0, t, 0.08);
        setTimeout(() => {
          try {
            v.a.stop();
            v.b.stop();
          } catch {
            /* already stopped */
          }
        }, 400);
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
    for (const v of this.voices.values()) {
      try {
        v.gain.gain.value = 0;
        v.a.stop();
        v.b.stop();
      } catch {
        /* stopped */
      }
    }
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
