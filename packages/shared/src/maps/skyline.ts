import { MapBuilder, spawnRow } from './builder';
import type { MapDef } from './types';

// Rooftop arena. Team 0 spawns south (z < 0) and faces north.
const m = new MapBuilder()
  // Shared centre pieces
  .box(0, 0, 44, 72, -1, 0, { mat: 'floor', mirror: false })
  .box(0, 0, 10, 10, 0, 2.5, { mat: 'metal', mirror: false })
  .box(0, 0, 4.4, 0.6, 2.5, 3.6, { mat: 'wall', mirror: false })
  // Spawn deck, backdrop and ramps down to the roof
  .box(0, -31.5, 14, 9, 0, 2, { mat: 'base' })
  .box(0, -35.8, 14, 0.4, 2, 4.6, { mat: 'wall' })
  .ramp([-4.5, 2, -27], [-4.5, 0, -21.5], 3.6)
  .ramp([4.5, 2, -27], [4.5, 0, -21.5], 3.6)
  // Centre platform access
  .ramp([0, 2.5, -5], [0, 0, -11.5], 4.2)
  .ramp([-5, 2.5, 2.2], [-11, 0, 2.2], 3)
  // Left annex roof with ramp and a sloped bridge into the centre
  .box(-16, -16, 12, 10, 0, 3, { mat: 'wall' })
  .ramp([-13.5, 0, -26.5], [-13.5, 3, -21], 3.2)
  .ramp([-10, 3, -12.2], [-5, 2.5, -4.6], 2.4)
  // Right side: unpaintable skylight, cover and the water-tower climb
  .box(15, -13, 8, 9, 0, 1, { mat: 'glass' })
  .box(17, -30, 5, 5, 0, 3.2, { mat: 'metal' })
  .box(9, -9, 1.6, 1.6, 0, 1.4, { mat: 'crate' })
  .box(-9, -5.5, 1.4, 1.4, 0, 1.4, { mat: 'crate' })
  .box(-5.5, -17.5, 4.2, 0.7, 0, 2, { mat: 'wall' })
  .box(6.5, -20, 0.7, 4.6, 0, 1.9, { mat: 'wall' })
  .box(18.5, -3, 3, 1.4, 0, 1.2, { mat: 'crate' })
  .box(-19, -27, 2.4, 2.4, 0, 1.6, { mat: 'crate' })
  // Parapets and invisible bounds
  .box(-22.25, 0, 0.5, 72.5, 0, 1.1, { mat: 'trim' })
  .box(0, -36.25, 44, 0.5, 0, 1.1, { mat: 'trim' })
  .box(-22.75, 0, 0.5, 74, 0, 16, { mat: 'invisible' })
  .box(0, -36.75, 46, 0.5, 0, 16, { mat: 'invisible' })
  .zone(0, 2.5, 0, 10, 10)
  // Decoration
  .prop({ kind: 'tank', x: 17, y: 3.2, z: -30, s: 1.8, h: 4 })
  .prop({ kind: 'antenna', x: -20, y: 0, z: -34, s: 1, h: 9 })
  .prop({ kind: 'billboard', x: -14, y: 3, z: -20.6, s: 1, yaw: 0 })
  .prop({ kind: 'building', x: -34, y: -60, z: -20, s: 14, h: 52 })
  .prop({ kind: 'building', x: 36, y: -60, z: -42, s: 18, h: 70 })
  .prop({ kind: 'building', x: -12, y: -60, z: -56, s: 16, h: 64 })
  .prop({ kind: 'building', x: 22, y: -60, z: -64, s: 12, h: 80 })
  .prop({ kind: 'building', x: -48, y: -60, z: -58, s: 20, h: 90 })
  .prop({ kind: 'building', x: 44, y: -60, z: -8, s: 12, h: 48 })
  .prop({ kind: 'lamp', x: -21.5, y: 1.1, z: -12, s: 1 })
  .prop({ kind: 'lamp', x: 21.5, y: 1.1, z: -24, s: 1 })
  .prop({ kind: 'pipe', x: 21.3, y: 0, z: -8, s: 1, h: 10 })
  .build();

export const SKYLINE: MapDef = {
  id: 'skyline',
  name: 'Skyline',
  description: 'Sunset rooftops with ramps, bridges and a climbable water tower.',
  theme: {
    skyTop: 0x2b3a8f,
    skyHorizon: 0xffb38a,
    skyBottom: 0x3a2f5c,
    fog: 0xe8a58f,
    sunColor: 0xfff0d6,
    sunIntensity: 2.6,
    sunDir: [-0.45, 0.62, -0.64],
    ambient: 0x8f9bd6,
    ground: 0x5b4a6e,
    materials: {
      floor: 0xd9d4cc,
      wall: 0xb9bfcc,
      metal: 0x7d8799,
      trim: 0x3d4459,
      glass: 0x9fd8ff,
      base: 0x585f75,
      crate: 0xc9a77a,
      island: 0x7fb069,
      invisible: 0,
    },
  },
  ...m,
  spawns: spawnRow(2, -31, [-3, -1, 1, 3]),
  killY: -12,
  extent: { minX: -22, maxX: 22, minZ: -36, maxZ: 36, maxY: 8 },
};
