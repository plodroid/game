import { MapBuilder, spawnRow } from './builder';
import type { MapDef } from './types';

/*
 * Four more arenas. Like the others, each is authored for team 0's half (south, z < 0) and
 * mirrored through the centre for team 1, so both sides get the same routes and sightlines.
 */

// A sunny working harbour: container stacks, a raised boardwalk and catwalks over the water.
const docks = new MapBuilder()
  .box(0, 0, 40, 70, -1, 0, { mat: 'floor', mirror: false })
  .box(0, -31, 14, 8, 0, 2, { mat: 'base' })
  .box(0, -35.2, 14, 0.4, 2, 4.4, { mat: 'wall' })
  .ramp([-4.5, 2, -27], [-4.5, 0, -21.5], 3.6)
  .ramp([4.5, 2, -27], [4.5, 0, -21.5], 3.6)
  // Container stacks to climb and hide behind.
  .box(-12, -18, 3, 7, 0, 2.6, { mat: 'crate' })
  .box(-12, -19, 3, 3, 2.6, 5.2, { mat: 'crate' })
  .box(11, -15, 7, 3, 0, 2.6, { mat: 'crate' })
  .box(-5, -11, 2.4, 6, 0, 2.4, { mat: 'crate' })
  .box(7, -24, 3, 3, 0, 1.6, { mat: 'crate' })
  // Raised boardwalk in the middle.
  .box(0, 0, 12, 6, 0, 1.6, { mat: 'metal', mirror: false })
  .ramp([0, 1.6, -3], [0, 0, -8], 4)
  // Catwalk along the west quay.
  .box(-16, 2, 4, 20, 0, 2.2, { mat: 'metal' })
  .ramp([-16, 0, -14], [-16, 2.2, -8], 3)
  // Edges: low kerbs and invisible bounds over the water.
  .box(-20.25, 0, 0.5, 70.5, 0, 0.6, { mat: 'trim' })
  .box(0, -35.25, 40, 0.5, 0, 0.6, { mat: 'trim' })
  .box(-20.75, 0, 0.5, 72, 0, 16, { mat: 'invisible' })
  .box(0, -35.75, 42, 0.5, 0, 16, { mat: 'invisible' })
  .zone(0, 1.6, 0, 12, 6)
  .prop({ kind: 'antenna', x: -18, y: 0, z: -26, s: 1.4, h: 14 })
  .prop({ kind: 'tank', x: 16, y: 0, z: -30, s: 2, h: 5 })
  .prop({ kind: 'lamp', x: -19.5, y: 0.6, z: -6, s: 1 })
  .prop({ kind: 'lamp', x: 19.5, y: 0.6, z: -20, s: 1 })
  .prop({ kind: 'building', x: -46, y: -40, z: -30, s: 18, h: 50 })
  .prop({ kind: 'building', x: 40, y: -40, z: -60, s: 22, h: 58 })
  .prop({ kind: 'pipe', x: 12, y: 0, z: -33, s: 1, h: 6 })
  .build();

export const DOCKS: MapDef = {
  id: 'docks',
  name: 'Dye Docks',
  description: 'A sunny harbour. Container stacks, a raised boardwalk and long falls into the bay.',
  theme: {
    skyTop: 0x2f7fe0,
    skyHorizon: 0xd5e9fb,
    skyBottom: 0xb9d6ea,
    fog: 0xcfe2f2,
    sunColor: 0xfff2dc,
    sunIntensity: 3.2,
    sunDir: [0.58, 0.74, -0.35],
    ambient: 0x9cc7ff,
    ground: 0x9cc4cf,
    clouds: 0.36,
    haze: 2.3,
    sea: -1.45,
    materials: { floor: 0x9a7a5c, wall: 0x6f7d8c, metal: 0x5c6773, trim: 0x2c3440, glass: 0x9fd8ff, base: 0x7d8899, crate: 0xd9653b, island: 0x6aa36f, invisible: 0 },
  },
  ...docks,
  spawns: spawnRow(2, -31, [-3, -1, 1, 3]),
  killY: -10,
  extent: { minX: -20, maxX: 20, minZ: -35, maxZ: 35, maxY: 8 },
};

// Formal gardens in spring: hedge lanes, flower terraces and a gazebo in the middle.
const gardens = new MapBuilder()
  .box(0, 0, 46, 70, -1, 0, { mat: 'island', mirror: false })
  .box(0, -31.5, 14, 9, 0, 1.5, { mat: 'base' })
  .ramp([-4.5, 1.5, -27], [-4.5, 0, -22.5], 3.6)
  .ramp([4.5, 1.5, -27], [4.5, 0, -22.5], 3.6)
  // Hedges.
  .box(-8, -17, 10, 1, 0, 2.2, { mat: 'wall' })
  .box(8, -12, 1, 8, 0, 2.2, { mat: 'wall' })
  .box(-14, -6, 1, 10, 0, 2.2, { mat: 'wall' })
  .box(11, -21, 6, 1, 0, 2.2, { mat: 'wall' })
  // Gazebo: a raised floor with four posts.
  .box(0, 0, 10, 10, 0, 1.2, { mat: 'floor', mirror: false })
  .box(-4.2, -4.2, 0.6, 0.6, 1.2, 3.6, { mat: 'trim' })
  .box(4.2, -4.2, 0.6, 0.6, 1.2, 3.6, { mat: 'trim' })
  .ramp([0, 1.2, -5], [0, 0, -9], 4)
  // Flower terrace on the west, with its stair.
  .box(-17, -20, 8, 8, 0, 2.4, { mat: 'floor' })
  .ramp([-17, 0, -28.5], [-17, 2.4, -24], 3.4)
  .box(14, -4, 4, 4, 0, 0.8, { mat: 'metal' })
  .box(-22.75, 0, 0.5, 70.5, 0, 1, { mat: 'trim' })
  .box(0, -35.75, 46, 0.5, 0, 1, { mat: 'trim' })
  .box(-23.25, 0, 0.5, 72, 0, 16, { mat: 'invisible' })
  .box(0, -36.25, 48, 0.5, 0, 16, { mat: 'invisible' })
  .zone(0, 1.2, 0, 10, 10)
  .prop({ kind: 'tree', x: -19, y: 0, z: -8, s: 1.3 })
  .prop({ kind: 'tree', x: 19, y: 0, z: -14, s: 1.1 })
  .prop({ kind: 'tree', x: -10, y: 0, z: -27, s: 1 })
  .prop({ kind: 'tree', x: 12, y: 0, z: -28, s: 1.2 })
  .prop({ kind: 'rock', x: 10, y: 0, z: -6, s: 0.8 })
  .prop({ kind: 'lamp', x: -6, y: 0, z: -24, s: 1 })
  .prop({ kind: 'cloud', x: -30, y: 34, z: -40, s: 6 })
  .build();

export const GARDENS: MapDef = {
  id: 'gardens',
  name: 'Bloom Gardens',
  description: 'Spring gardens with hedge lanes, flower terraces and a gazebo to fight over.',
  theme: {
    skyTop: 0x2f7fe0,
    skyHorizon: 0xd5e9fb,
    skyBottom: 0xb9d6ea,
    fog: 0xcfe2f2,
    sunColor: 0xfff4e0,
    sunIntensity: 3.2,
    sunDir: [-0.45, 0.8, -0.38],
    ambient: 0xa6cff2,
    ground: 0x8cb86a,
    clouds: 0.4,
    haze: 2,
    sea: -1.5,
    materials: { floor: 0xe8dcc0, wall: 0x3f8f4a, metal: 0x9aa5b1, trim: 0x55603f, glass: 0x9fd8ff, base: 0xb8a47a, crate: 0xc98f5b, island: 0x7cc56a, invisible: 0 },
  },
  ...gardens,
  spawns: spawnRow(1.5, -31.5, [-3, -1, 1, 3]),
  killY: -10,
  extent: { minX: -23, maxX: 23, minZ: -36, maxZ: 36, maxY: 8 },
};

// Red-rock terraces at sunset, stepped high ground and crystal cover that won't take paint.
const canyon = new MapBuilder()
  .box(0, 0, 40, 72, -1, 0, { mat: 'floor', mirror: false })
  .box(0, -32, 14, 8, 0, 3, { mat: 'base' })
  .ramp([-5, 3, -28], [-5, 0, -21], 3.6)
  .ramp([5, 3, -28], [5, 0, -21], 3.6)
  // Terraces stepping up towards the middle on the west side.
  .box(-13, -18, 10, 8, 0, 1.5, { mat: 'wall' })
  .box(-13, -8, 10, 6, 0, 3, { mat: 'wall' })
  .ramp([-13, 1.5, -14], [-13, 3, -11], 3)
  .ramp([-13, 0, -26.5], [-13, 1.5, -22], 3)
  // The arch in the middle.
  .box(0, 0, 8, 8, 0, 2, { mat: 'base', mirror: false })
  .ramp([0, 2, -4], [0, 0, -9], 4)
  // Crystals (unpaintable) and boulders.
  .box(6, -14, 2, 2, 0, 2.2, { mat: 'glass' })
  .box(9, -24, 3, 3, 0, 1.5, { mat: 'crate' })
  .box(15, -22, 4, 10, 0, 2.2, { mat: 'wall' })
  .ramp([15, 0, -31.5], [15, 2.2, -27], 3)
  .box(-20.25, 0, 0.5, 72.5, 0, 6, { mat: 'wall' })
  .box(0, -36.25, 40, 0.5, 0, 6, { mat: 'wall' })
  .box(-20.75, 0, 0.5, 74, 0, 16, { mat: 'invisible' })
  .box(0, -36.75, 42, 0.5, 0, 16, { mat: 'invisible' })
  .zone(0, 2, 0, 8, 8)
  .prop({ kind: 'crystal', x: 6, y: 2.2, z: -14, s: 1 })
  .prop({ kind: 'crystal', x: -18, y: 3, z: -6, s: 0.8 })
  .prop({ kind: 'rock', x: 11, y: 0, z: -8, s: 1.2 })
  .prop({ kind: 'rock', x: -6, y: 0, z: -18, s: 0.9 })
  .prop({ kind: 'building', x: -40, y: -30, z: -40, s: 26, h: 40 })
  .build();

export const CANYON: MapDef = {
  id: 'canyon',
  name: 'Prism Canyon',
  description: 'Sun-scorched terraces of red rock by the sea, a central arch and crystals that shrug off paint.',
  theme: {
    skyTop: 0x2f7fe0,
    skyHorizon: 0xdfeaf4,
    skyBottom: 0xc9d8e2,
    fog: 0xd8e2ea,
    sunColor: 0xffefd2,
    sunIntensity: 3.4,
    sunDir: [0.42, 0.78, -0.46],
    ambient: 0xa9c8ef,
    ground: 0xd9a47a,
    clouds: 0.28,
    haze: 2.6,
    sea: -1.6,
    materials: { floor: 0xe0b07a, wall: 0xb5653e, metal: 0x7a6a8c, trim: 0x5b3a2e, glass: 0x9fe8ff, base: 0xc98a5a, crate: 0x8f6a4a, island: 0xc2a35f, invisible: 0 },
  },
  ...canyon,
  spawns: spawnRow(3, -32, [-3, -1, 1, 3]),
  killY: -10,
  extent: { minX: -20, maxX: 20, minZ: -36, maxZ: 36, maxY: 8 },
};

// A rooftop arcade above the beach: neon cabinets for cover, a stage, and balconies.
const arcade = new MapBuilder()
  .box(0, 0, 36, 64, -1, 0, { mat: 'floor', mirror: false })
  .box(0, -28.5, 12, 7, 0, 1.5, { mat: 'base' })
  .ramp([-4, 1.5, -25], [-4, 0, -20.5], 3.4)
  .ramp([4, 1.5, -25], [4, 0, -20.5], 3.4)
  // Cabinets.
  .box(-6, -14, 1.4, 1.4, 0, 2, { mat: 'crate' })
  .box(-2, -16.5, 1.4, 1.4, 0, 2, { mat: 'crate' })
  .box(5, -12, 1.4, 1.4, 0, 2, { mat: 'crate' })
  .box(10, -18, 1.4, 3, 0, 2, { mat: 'crate' })
  .box(-10, -22, 3, 1.4, 0, 2, { mat: 'crate' })
  // The stage.
  .box(0, 0, 10, 4, 0, 1.2, { mat: 'metal', mirror: false })
  .ramp([0, 1.2, -2], [0, 0, -6], 4)
  // East balcony with its stair.
  .box(14, -8, 5, 14, 0, 2.8, { mat: 'metal' })
  .ramp([14, 0, -21], [14, 2.8, -15], 3.2)
  .box(-18.25, 0, 0.5, 64.5, 0, 1.2, { mat: 'trim' })
  .box(0, -32.25, 36, 0.5, 0, 1.2, { mat: 'trim' })
  .box(-18.75, 0, 0.5, 66, 0, 16, { mat: 'invisible' })
  .box(0, -32.75, 38, 0.5, 0, 16, { mat: 'invisible' })
  .zone(0, 1.2, 0, 10, 4)
  .prop({ kind: 'billboard', x: -17.6, y: 1.2, z: -10, s: 1.2, yaw: Math.PI / 2 })
  .prop({ kind: 'panel', x: 6, y: 0, z: -30, s: 1.4 })
  .prop({ kind: 'lamp', x: -17.6, y: 1.2, z: -24, s: 1 })
  .prop({ kind: 'lamp', x: 17.6, y: 1.2, z: -2, s: 1 })
  .prop({ kind: 'building', x: -40, y: -50, z: -24, s: 16, h: 70 })
  .prop({ kind: 'building', x: 34, y: -50, z: -50, s: 20, h: 90 })
  .build();

export const ARCADE: MapDef = {
  id: 'arcade',
  name: 'Neon Arcade',
  description: 'A rooftop arcade above the beach: cabinet cover, a centre stage and high balconies.',
  theme: {
    skyTop: 0x2f7fe0,
    skyHorizon: 0xd5e9fb,
    skyBottom: 0xb9d6ea,
    fog: 0xcfe2f2,
    sunColor: 0xfff2dc,
    sunIntensity: 3.2,
    sunDir: [-0.38, 0.8, -0.46],
    ambient: 0x9cc7ff,
    ground: 0xd8c8b0,
    clouds: 0.36,
    haze: 2.1,
    sea: -48,
    land: 140,
    materials: { floor: 0xd9d1c4, wall: 0x7fc4d8, metal: 0x9aa0b8, trim: 0xff4d94, glass: 0x6ff3ff, base: 0xf2c27a, crate: 0x2fd3d0, island: 0x7cc56a, invisible: 0 },
  },
  ...arcade,
  spawns: spawnRow(1.5, -28.5, [-3, -1, 1, 3]),
  killY: -10,
  extent: { minX: -18, maxX: 18, minZ: -32, maxZ: 32, maxY: 8 },
};
