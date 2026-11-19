/*
 * Engine sound, modelled rather than beeped: a loop is a train of exhaust pulses, one per cylinder
 * firing, each a short ring of the exhaust pipe's resonance plus a puff of combustion noise. The
 * cylinders fire a little unevenly (the lumpy idle), the pipe and body filter the result, and the
 * loop is a whole number of engine cycles long, so it repeats without a seam. No DOM here: the
 * build script uses the same code to write the default sample files.
 */

export interface EngineVoice {
  /** Firings per two revolutions (four-stroke cylinders; a rotary counts each rotor face). */
  cylinders: number;
  /** Exhaust pipe resonance at idle, Hz (rises with revs). */
  pipe: number;
  /** How uneven the firings are, 0 … 1. */
  lump: number;
  /** Combustion noise in each pulse, 0 … 1. */
  noise: number;
  /** Electric: a motor whine instead of firings. */
  electric?: boolean;
}

/** One voice per engine sound in the garage. */
export const ENGINE_VOICES: Record<string, EngineVoice> = {
  inline4: { cylinders: 4, pipe: 150, lump: 0.12, noise: 0.35 },
  v8: { cylinders: 8, pipe: 95, lump: 0.45, noise: 0.45 },
  v12: { cylinders: 12, pipe: 170, lump: 0.06, noise: 0.25 },
  turbo: { cylinders: 6, pipe: 130, lump: 0.15, noise: 0.5 },
  rotary: { cylinders: 6, pipe: 210, lump: 0.05, noise: 0.6 },
  electric: { cylinders: 0, pipe: 0, lump: 0, noise: 0.1, electric: true },
};

/** The four loops and the revs each was "recorded" at. */
export const LOOP_RPM = { idle: 1000, low: 3000, mid: 5500, high: 7500 } as const;
export type LoopName = keyof typeof LOOP_RPM;

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A seamless loop of an engine at `rpm`, about `seconds` long. */
export function engineLoop(v: EngineVoice, rpm: number, rate: number, seconds = 1.6, seed = 7): Float32Array {
  const cycle = 120 / rpm;
  const cycles = Math.max(4, Math.round(seconds / cycle));
  const n = Math.round(cycles * cycle * rate);
  const out = new Float32Array(n);
  const r = rand(seed + Math.round(rpm));
  const hi = Math.min(1, (rpm - 800) / 7000);
  if (v.electric) {
    // A motor: a whine at the pole frequency with two harmonics, and a little bearing hiss.
    const f = (rpm / 60) * 6;
    // Rounded so the loop closes on whole periods.
    const per = Math.max(1, Math.round(f * (n / rate)));
    const fq = per / (n / rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      out[i] = Math.sin(2 * Math.PI * fq * t) * 0.5 + Math.sin(2 * Math.PI * fq * 2 * t) * 0.18 + Math.sin(2 * Math.PI * fq * 3 * t) * 0.06 + (r() - 0.5) * 0.04;
    }
    return normalise(out);
  }
  const firings = v.cylinders;
  const interval = cycle / firings;
  // Per-cylinder character, the same every cycle so the loop repeats.
  const amp = Array.from({ length: firings }, () => 1 + (r() - 0.5) * 2 * v.lump);
  const late = Array.from({ length: firings }, () => (r() - 0.5) * v.lump * interval * 0.5);
  const pipe = v.pipe * (1 + hi * 1.4);
  const tau = Math.min(interval * 0.8, 0.035 - hi * 0.02);
  const len = Math.min(n, Math.ceil(tau * 6 * rate));
  const noiseTau = tau * 0.35;
  // A bank of noise the pulses draw on (fixed per loop).
  const noise = new Float32Array(len);
  for (let i = 0; i < len; i++) noise[i] = r() * 2 - 1;
  for (let c = 0; c < cycles; c++)
    for (let k = 0; k < firings; k++) {
      const t0 = (c * cycle + k * interval + late[k]) * rate;
      const a = amp[k];
      const start = Math.floor(t0), frac = t0 - start;
      for (let j = 0; j < len; j++) {
        const t = (j - frac) / rate;
        if (t < 0) continue;
        const env = Math.exp(-t / tau);
        const body = Math.sin(2 * Math.PI * pipe * t) * 0.7 + Math.sin(2 * Math.PI * pipe * 2.37 * t) * 0.25 * (0.4 + hi);
        const puff = noise[j] * Math.exp(-t / noiseTau) * v.noise;
        // Pulses that run past the end wrap round to the start: the loop is seamless.
        out[(start + j) % n] += a * (env * body + puff);
      }
    }
  // The car round it: a low-pass that opens with revs, and a DC block.
  const cutoff = 700 + hi * 3800;
  let lp = 0, hpIn = 0, hpOut = 0;
  const kLp = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  const kHp = Math.exp((-2 * Math.PI * 30) / rate);
  // Two passes so the filters' state is settled where the loop wraps.
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      lp += (out[i] - lp) * kLp;
      const y = kHp * (hpOut + lp - hpIn);
      hpIn = lp;
      hpOut = y;
      if (pass === 1) out[i] = y * 0.8 + lp * 0.2;
    }
  return normalise(out);
}

/** A crackle of exhaust pops: two to four sharp bangs with a low thump. */
export function backfire(rate: number, seed = 3): Float32Array {
  const n = Math.round(rate * 0.55);
  const out = new Float32Array(n);
  const r = rand(seed);
  const pops = 2 + Math.floor(r() * 3);
  let t = 0;
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(t * rate);
    const big = p === 0 ? 1 : 0.4 + r() * 0.5;
    for (let j = 0; at + j < n && j < rate * 0.12; j++) {
      const s = j / rate;
      out[at + j] += big * ((r() * 2 - 1) * Math.exp(-s / 0.008) * 0.9 + Math.sin(2 * Math.PI * 70 * s) * Math.exp(-s / 0.04) * 0.8);
    }
    t += 0.05 + r() * 0.1;
  }
  return normalise(out, 0.9);
}

function normalise(a: Float32Array, peak = 0.8) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}

/** 16-bit mono WAV bytes. */
export function wav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return out;
}
