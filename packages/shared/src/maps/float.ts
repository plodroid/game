import { MapBuilder, spawnRow } from './builder';
import type { MapDef } from './types';

// Floating islands at different heights joined by bridges, beams and launch pads.
const m = new MapBuilder()
  .box(0, 0, 18, 16, -3, 2, { mat: 'island', mirror: false })
  .box(0, 0, 6, 6, 2, 5, { mat: 'metal', mirror: false })
  // Home island and spawn rim
  .box(0, -32, 16, 10, -3, 0, { mat: 'island' })
  .box(0, -37.2, 16, 0.6, 0, 3.2, { mat: 'trim' })
  // Front island and its ramp
  .box(-8, -19, 12, 10, -2.5, 1.5, { mat: 'island' })
  .ramp([-4.5, 0, -27.2], [-5, 1.5, -24], 3.2)
  // Lower right island via bridge
  .box(12, -19, 10, 12, -4, -0.5, { mat: 'island' })
  .ramp([7.2, 0, -28.5], [9, -0.5, -25], 2.6)
  // Bridges into the centre
  .ramp([-6, 1.5, -14], [-5, 2, -8], 2.4)
  .ramp([10, -0.5, -13], [6, 2, -8], 1.2)
  // Stepping stones for aerial routes
  .box(20, -4, 3.2, 3.2, -0.5, 0.8, { mat: 'island' })
  .box(-17, -7, 3.5, 3.5, 0.5, 1.7, { mat: 'island' })
  .box(-3, -19.5, 1.4, 1.4, 1.5, 2.8, { mat: 'crate' })
  .box(13, -21, 1.6, 1.6, -0.5, 0.9, { mat: 'crate' })
  .box(3.5, -4.5, 3, 0.6, 2, 3.2, { mat: 'wall' })
  // Launch pads: home → front island, centre → high platform
  .pad(5.5, 0, -30.5, -2.5, 12, 8)
  .pad(6.2, 2, 0, -8, 13, 0)
  .zone(0, 5, 0, 6, 6)
  .prop({ kind: 'tree', x: -12, y: 1.5, z: -22, s: 1.2 })
  .prop({ kind: 'tree', x: 5.5, y: 0, z: -35, s: 1 })
  .prop({ kind: 'crystal', x: 15, y: -0.5, z: -23, s: 1.3 })
  .prop({ kind: 'crystal', x: -7, y: 2, z: 6, s: 1 })
  .prop({ kind: 'rock', x: -30, y: -10, z: -26, s: 6 })
  .prop({ kind: 'rock', x: 32, y: -16, z: -6, s: 9 })
  .prop({ kind: 'rock', x: 10, y: -22, z: -52, s: 12 })
  .prop({ kind: 'cloud', x: -40, y: -20, z: -30, s: 18 })
  .prop({ kind: 'cloud', x: 30, y: -26, z: -48, s: 24 })
  .prop({ kind: 'cloud', x: 46, y: -14, z: 4, s: 16 })
  .build();

export const FLOAT: MapDef = {
  id: 'float',
  name: 'Float',
  description: 'Islands adrift in the clouds. Risky beams, launch pads and long drops.',
  theme: {
    skyTop: 0x3f7fe0,
    skyHorizon: 0xcfe9ff,
    skyBottom: 0xf4f8ff,
    fog: 0xdcecff,
    sunColor: 0xfffaf0,
    sunIntensity: 2.8,
    sunDir: [0.5, 0.75, -0.35],
    ambient: 0xa8c4f0,
    ground: 0xbcd3ef,
    materials: {
      floor: 0xd8d2c4,
      wall: 0xc2b8a3,
      metal: 0x8a93a6,
      trim: 0x5a6276,
      glass: 0x9fd8ff,
      base: 0x8f97ab,
      crate: 0xc79f6b,
      island: 0x8cc26f,
      invisible: 0,
    },
  },
  ...m,
  spawns: spawnRow(0, -33.5, [-3, -1, 1, 3]),
  killY: -14,
  extent: { minX: -24, maxX: 24, minZ: -38, maxZ: 38, maxY: 8 },
};
