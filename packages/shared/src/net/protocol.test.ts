import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS } from '../config/cosmetics';
import { createPlayerState, emptyInput, type Input } from '../sim/player';
import type { SimEvent } from '../sim/events';
import { generateRoomCode, normalizeRoomCode, validateUsername } from '../validation';
import { packEvent, packInput, packPlayer, unpackEvent, unpackInput, unpackPlayer } from './protocol';

describe('protocol', () => {
  it('round-trips inputs and rejects garbage', () => {
    const i: Input = { seq: 42, mx: 0.5, mz: -1, yaw: 1.2345, pitch: -0.4, aimYaw: 1.3, aimPitch: -0.41, buttons: 5 };
    const out = emptyInput();
    expect(unpackInput(packInput(i), out)).toBe(true);
    expect(out.seq).toBe(42);
    expect(out.mx).toBeCloseTo(0.5);
    expect(out.yaw).toBeCloseTo(1.2345, 3);
    expect(unpackInput([1, 2, 3], out)).toBe(false);
    expect(unpackInput([1, 'x', 0, 0, 0, 0, 0, 0], out)).toBe(false);
    expect(unpackInput([1, 9999, 0, 0, 0, 0, 0, 0xffff], out)).toBe(true);
    expect(out.mx).toBe(1);
    expect(out.buttons).toBeLessThan(256);
  });

  it('round-trips player state', () => {
    const p = createPlayerState({ id: 7, name: 'a', team: 1, weapon: 'arc', special: 'nova', bot: false, cosmetics: DEFAULT_COSMETICS });
    p.pos.x = 12.345;
    p.vel.y = -3.2;
    p.diving = true;
    p.hp = 63.5;
    const q = createPlayerState({ id: 0, name: 'b', team: 0, weapon: 'pulse', special: 'surge', bot: false, cosmetics: DEFAULT_COSMETICS });
    expect(unpackPlayer(packPlayer(p), q)).toBe(7);
    expect(q.pos.x).toBeCloseTo(12.345, 3);
    expect(q.vel.y).toBeCloseTo(-3.2, 3);
    expect(q.diving).toBe(true);
    expect(q.hp).toBeCloseTo(63.5, 1);
  });

  it('round-trips events', () => {
    const events: SimEvent[] = [
      { t: 'paint', seq: 3, x: 1.25, y: 0, z: -4.5, r: 0.95, team: 1, kind: 0 },
      { t: 'fire', id: 2, w: 'lobber', x: 1, y: 1.2, z: 3, yaw: 0.5, pitch: 0.1, seed: 4294967295, n: 9 },
      { t: 'kill', id: 3, by: 2, w: 'fall' },
    ];
    for (const e of events) expect(unpackEvent(packEvent(e)!)).toEqual(e);
  });
});

describe('validation', () => {
  it('enforces username rules', () => {
    expect(validateUsername('Painter_01')).toBeNull();
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('admin')).not.toBeNull();
    expect(validateUsername('_lead')).not.toBeNull();
    expect(validateUsername('a..b')).not.toBeNull();
    expect(validateUsername('x'.repeat(30))).not.toBeNull();
  });

  it('generates and normalises room codes', () => {
    const c = generateRoomCode();
    expect(normalizeRoomCode(c.toLowerCase())).toBe(c);
    expect(normalizeRoomCode(' ab-cde ')).toBe('ABCDE');
    expect(normalizeRoomCode('ABC0E')).toBeNull();
    expect(normalizeRoomCode('ABCD')).toBeNull();
  });
});
