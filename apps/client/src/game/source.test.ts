import { beforeAll, describe, expect, it } from 'vitest';
import { BTN, DEFAULT_COSMETICS, initPhysics, Simulation, type PlayerInfo } from '@chromashift/shared';
import { OfflineSource, type FrameInput } from './source';

beforeAll(async () => {
  await initPhysics();
});

const info = (id: number, team: 0 | 1): PlayerInfo => ({ id, name: `P${id}`, team, weapon: 'pulse', special: 'surge', bot: false, cosmetics: DEFAULT_COSMETICS });
const input = (over: Partial<FrameInput>): FrameInput => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, aimYaw: 0, aimPitch: 0, buttons: 0, consume: () => {}, ...over });

describe('split screen: two local players in one match', () => {
  it('feeds each player their own controls', () => {
    const sim = new Simulation({ map: 'skyline', mode: 'practice', duration: 0, seed: 7 }, [info(1, 0), info(2, 0)]);
    const src = new OfflineSource(sim, 1);
    // Get past the intro.
    for (let i = 0; i < 400; i++) src.update(1 / 60, input({}), [{ id: 2, input: input({}) }]);
    const a0 = { ...sim.byId(1)!.pos }, b0 = { ...sim.byId(2)!.pos };
    // Player 2 runs forward and fires; player 1 stands still.
    for (let i = 0; i < 120; i++) src.update(1 / 60, input({}), [{ id: 2, input: input({ mz: 1, buttons: BTN.FIRE }) }]);
    const a1 = sim.byId(1)!.pos, b1 = sim.byId(2)!.pos;
    expect(Math.hypot(a1.x - a0.x, a1.z - a0.z)).toBeLessThan(0.5);
    expect(Math.hypot(b1.x - b0.x, b1.z - b0.z)).toBeGreaterThan(3);
    expect(sim.byId(2)!.shots).toBeGreaterThan(0);
    expect(sim.byId(1)!.shots).toBe(0);
    src.dispose();
  });
});
