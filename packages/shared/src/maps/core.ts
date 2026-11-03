import { MapBuilder, spawnRow } from './builder';
import type { MapDef } from './types';

// Indoor arena: corridors, two objective pads, a central tower linked by catwalks.
const m = new MapBuilder()
  .box(0, 0, 40, 60, -1, 0, { mat: 'floor', mirror: false })
  .box(0, 0, 6, 6, 0, 4, { mat: 'metal', mirror: false })
  .box(0, 0, 40.5, 60.5, 11, 11.4, { mat: 'glass', mirror: false })
  // Outer walls (paintable — climb them in paint form)
  .box(-20.25, 0, 0.5, 60, 0, 11, { mat: 'wall' })
  .box(0, -30.25, 41, 0.5, 0, 11, { mat: 'wall' })
  // Spawn platform
  .box(0, -26.5, 12, 7, 0, 1.5, { mat: 'base' })
  .ramp([0, 1.5, -23], [0, 0, -19], 5)
  .box(-6.3, -25, 0.6, 4, 1.5, 3, { mat: 'trim' })
  // Corridor walls
  .box(-9, -15, 0.6, 12, 0, 4, { mat: 'wall' })
  .box(-13.5, -9, 9, 0.6, 0, 4, { mat: 'wall' })
  .box(6, -13, 0.6, 6, 0, 3.2, { mat: 'wall' })
  .box(13, -20.5, 0.6, 7, 0, 4, { mat: 'wall' })
  // Low tunnel on the right lane
  .box(9.5, -17.5, 6, 3, 2.4, 3.2, { mat: 'metal' })
  // Objective pads (two zones after mirroring)
  .box(-11, 2, 8, 8, 0, 0.6, { mat: 'metal' })
  .zone(-11, 0.6, 2, 8, 8)
  .zone(11, 0.6, -2, 8, 8)
  // Side balconies and catwalks to the tower
  .box(-17.5, -9, 5, 10, 0, 3, { mat: 'wall' })
  .ramp([-17.5, 0, -19.5], [-17.5, 3, -14], 3)
  .ramp([-15, 3, -6], [-3, 4, -1.5], 2)
  .ramp([0, 4, -3], [0, 0, -10], 3)
  // Cover
  .box(-4, -6, 1.5, 1.5, 0, 1.3, { mat: 'crate' })
  .box(4.5, -7.5, 2.6, 1.2, 0, 1.6, { mat: 'crate' })
  .box(-16, 4.5, 1.4, 1.4, 0, 1.4, { mat: 'crate' })
  .box(15, -6, 0.6, 5, 0, 2.2, { mat: 'trim' })
  .prop({ kind: 'panel', x: -19.9, y: 6, z: -18, s: 1, yaw: Math.PI / 2 })
  .prop({ kind: 'panel', x: 19.9, y: 6, z: -4, s: 1, yaw: -Math.PI / 2 })
  .prop({ kind: 'lamp', x: -8, y: 10.9, z: -14, s: 1 })
  .prop({ kind: 'lamp', x: 8, y: 10.9, z: -22, s: 1 })
  .prop({ kind: 'lamp', x: 0, y: 10.9, z: -6, s: 1 })
  .prop({ kind: 'pipe', x: -19.6, y: 0, z: -28, s: 1, h: 11 })
  .build();

export const CORE: MapDef = {
  id: 'core',
  name: 'Core',
  description: 'A futuristic indoor arena of corridors, twin objective pads and a central tower.',
  theme: {
    skyTop: 0x0d1024,
    skyHorizon: 0x1b2347,
    skyBottom: 0x070812,
    fog: 0x161b33,
    sunColor: 0xe8eeff,
    sunIntensity: 2.3,
    sunDir: [0.3, 0.9, 0.25],
    ambient: 0x9aa6e0,
    ground: 0x3a4166,
    indoor: true,
    materials: {
      floor: 0xd3d8e4,
      wall: 0xb4bccf,
      metal: 0x8590aa,
      trim: 0x3b4260,
      glass: 0xbfe6ff,
      base: 0x6a7392,
      crate: 0xc4cde3,
      island: 0x7fb069,
      invisible: 0,
    },
  },
  ...m,
  spawns: spawnRow(1.5, -27, [-3, -1, 1, 3]),
  killY: -8,
  extent: { minX: -20, maxX: 20, minZ: -30, maxZ: 30, maxY: 11 },
};
