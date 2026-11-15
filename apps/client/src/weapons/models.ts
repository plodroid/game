import * as THREE from 'three';
import { FINISHES, WEAPONS, type WeaponDef, type WeaponId, type WeaponKind } from '@chromashift/shared';
import { patternTexture } from '../characters/patterns';
import { buildAsset } from '../modeling/assetBuild';
import { boxUV, chamferBox, Parts, seedOfText, slab, tube, turned } from '../modeling/kit';
import { publishedAsset } from '../modeling/library';
import { surfaceMaps, surfaceMaterial } from '../modeling/surfaces';

/** The second colour each finish pattern is drawn in. */
const PATTERN_INK = { camo: 0x3b4a22, stripes: 0xe0b03a, carbon: 0x3a3a44, marble: 0x9a93b4, galaxy: 0xffffff } as const;

export interface WeaponModel {
  group: THREE.Group;
  /** Tip of the barrel, for muzzle effects. */
  muzzle: THREE.Object3D;
  dispose(): void;
}

/*
 * Paint guns, modelled properly. Each family has its own silhouette: receivers and grips are cut
 * from side outlines and given chamfered thickness, barrels, nozzles and tanks are turned profiles,
 * guards and hoses are bent tubes. A weapon is merged into one mesh per material (finish, polymer,
 * steel, team paint, glass), so even the busiest gun is five draws.
 *
 * Everything is built in the weapon frame: grip at the origin, barrel toward -Z, up +Y, in metres.
 * Nothing reaches further back than the hand's own length, because the forearm is behind it.
 */

type Mat = 'shell' | 'poly' | 'steel' | 'team' | 'glass';
type P2 = [number, number];

/** A grip with finger grooves, leaning back, hanging from height `top` behind z = `z0`. */
function grip(p: Parts, z0: number, top: number, bottom: number, width: number) {
  const h = top - bottom, lean = 0.038;
  const back = (y: number) => z0 + 0.03 + (lean * (top - y)) / h;
  const front = (y: number) => z0 - 0.022 + (lean * (top - y)) / h;
  const outline: P2[] = [[back(top), top], [back(bottom) + 0.004, bottom + 0.012], [back(bottom), bottom], [front(bottom), bottom]];
  for (let i = 3; i >= 1; i--) {
    const y = bottom + (h * i) / 4, y2 = y - h / 8;
    outline.push([front(y2) + 0.006, y2 + 0.004], [front(y) - 0.001, y]);
  }
  outline.push([front(top), top]);
  p.add('poly', slab(outline, width, 0.011));
  // A steel floor plate, so the grip ends cleanly.
  p.add('steel', slab([[back(bottom) + 0.002, bottom + 0.002], [back(bottom) + 0.002, bottom - 0.007], [front(bottom) - 0.003, bottom - 0.007], [front(bottom) - 0.003, bottom + 0.002]], width + 0.004, 0.002));
}

/** A trigger guard bent from rod, and the trigger inside it. */
function guard(p: Parts, zBack: number, zFront: number, top: number, drop: number) {
  p.add('poly', tube([[0, top, zFront], [0, top - drop * 0.75, zFront - 0.004], [0, top - drop, (zFront + zBack) / 2], [0, top - drop * 0.85, zBack + 0.006], [0, top - drop * 0.3, zBack + 0.012]], 0.0048, 6));
  const zt = zBack - 0.012;
  p.add('steel', slab([[zt, top], [zt + 0.007, top - drop * 0.3], [zt + 0.001, top - drop * 0.62], [zt - 0.005, top - drop * 0.6], [zt - 0.003, top - drop * 0.3], [zt - 0.008, top]], 0.008, 0.002));
}

/** A paint tank lying along the barrel: glass, the paint inside, and a cap at each end. */
function tank(p: Parts, y: number, z0: number, z1: number, r: number, seg: number) {
  const k = r * 0.45;
  p.add('glass', turned([[0, z1], [r * 0.8, z1 + k * 0.3], [r, z1 + k], [r, z0 - k], [r * 0.8, z0 - k * 0.3], [0, z0]], seg, false), 0, y, 0);
  const q = r * 0.78;
  p.add('team', turned([[0, z1 + 0.008], [q, z1 + k], [q, z0 - k], [0, z0 - 0.008]], seg, false), 0, y, 0);
  for (const z of [z0 - 0.004, z1 + 0.004]) p.add('poly', turned([[r * 0.5, z + 0.008], [r + 0.003, z + 0.006], [r + 0.003, z - 0.006], [r * 0.5, z - 0.008]], seg), 0, y, 0);
}

/** A jar standing on top: glass, paint, a lid and a collar. */
function jar(p: Parts, y: number, z: number, r: number, h: number, seg: number) {
  const up = -Math.PI / 2;
  p.add('glass', turned([[0, 0], [r * 0.78, 0], [r, h * 0.2], [r, h * 0.7], [r * 0.6, h * 0.95], [r * 0.42, h]], seg, false), 0, y, z, up);
  p.add('team', turned([[0, 0.004], [r * 0.7, 0.006], [r * 0.82, h * 0.22], [r * 0.82, h * 0.6], [0, h * 0.62]], seg, false), 0, y, z, up);
  p.add('poly', turned([[r * 0.44, h * 0.98], [r * 0.5, h], [r * 0.5, h * 1.14], [0, h * 1.16]], seg), 0, y, z, up);
  p.add('steel', turned([[r * 0.8, -0.006], [r * 0.9, -0.004], [r * 0.9, 0.008], [r * 0.8, 0.012]], seg), 0, y, z, up);
}

interface Style {
  /** 0 … 2: which muzzle, which top line, which rear cap. */
  muzzle: number;
  top: number;
  rear: number;
}

/* ---------- The five families ---------- */

function sprayer(p: Parts, seg: number, st: Style) {
  const y = 0.12;
  // Receiver: three top lines so tunings of the same gun read differently.
  const top: P2[][] = [
    [[0.07, 0.168], [-0.1, 0.168], [-0.13, 0.158], [-0.215, 0.158]],
    [[0.06, 0.176], [-0.06, 0.176], [-0.12, 0.154], [-0.215, 0.154]],
    [[0.075, 0.162], [-0.03, 0.172], [-0.15, 0.172], [-0.2, 0.158], [-0.215, 0.158]],
  ];
  p.add('shell', slab([[0.1, 0.07], [0.105, 0.14], ...top[st.top], [-0.225, 0.14], [-0.225, 0.09], [-0.15, 0.072], [-0.02, 0.062]], 0.066, 0.009));
  // Raised side panels and a paint stripe.
  p.add('poly', slab([[0.06, 0.085], [0.06, 0.125], [-0.08, 0.125], [-0.1, 0.105], [-0.1, 0.085]], 0.073, 0.004));
  p.add('team', slab([[-0.12, 0.133], [-0.12, 0.146], [-0.208, 0.146], [-0.208, 0.133]], 0.0695, 0.002));
  for (const z of [0.045, -0.06]) p.both('steel', () => turned([[0, 0.0015], [0.005, 0.0015], [0.005, -0.0015], [0, -0.0015]], 8), 0.0372, 0.105, z, 0, Math.PI / 2);
  // Rear cap.
  if (st.rear === 1) p.add('poly', slab([[0.1, 0.075], [0.125, 0.085], [0.125, 0.135], [0.1, 0.145]], 0.05, 0.01));
  else if (st.rear === 2) p.add('poly', turned([[0, 0.128], [0.022, 0.124], [0.03, 0.11], [0.03, 0.1], [0, 0.1]], seg), 0, 0.108, 0);
  // Feed housing ahead of the trigger.
  p.add('poly', slab([[-0.1, 0.07], [-0.105, 0.002], [-0.158, -0.004], [-0.15, 0.075]], 0.04, 0.006));
  p.add('team', slab([[-0.112, 0.05], [-0.114, 0.015], [-0.148, 0.012], [-0.144, 0.05]], 0.0425, 0.002));
  grip(p, 0.035, 0.064, -0.078, 0.046);
  guard(p, 0.0, -0.098, 0.064, 0.058);
  // Tank over the back, in a cradle, with its hose.
  tank(p, 0.216, 0.09, -0.07, 0.036, seg);
  for (const z of [0.062, -0.042]) p.add('shell', slab([[z + 0.012, 0.16], [z + 0.012, 0.19], [z - 0.012, 0.19], [z - 0.012, 0.16]], 0.05, 0.004));
  p.add('poly', tube([[0.02, 0.208, -0.078], [0.036, 0.2, -0.105], [0.037, 0.176, -0.135], [0.034, 0.15, -0.15]], 0.006, 6));
  // Sight rail and front post.
  p.add('poly', slab([[-0.09, 0.166], [-0.09, 0.177], [-0.185, 0.177], [-0.185, 0.166]], 0.028, 0.003));
  p.add('steel', slab([[-0.2, 0.156], [-0.2, 0.184], [-0.19, 0.184], [-0.182, 0.156]], 0.009, 0.002));
  // Ribbed barrel shroud.
  const ribs: P2[] = [[0.016, -0.2], [0.028, -0.214]];
  for (let z = -0.214; z > -0.32; z -= 0.036) ribs.push([0.028, z - 0.02], [0.0235, z - 0.024], [0.0235, z - 0.032], [0.028, z - 0.036]);
  ribs.push([0.028, -0.335], [0.02, -0.345], [0.02, -0.385]);
  p.add('steel', turned(ribs, seg), 0, y, 0);
  muzzleDevice(p, st.muzzle, y, -0.38, 0.02, seg);
}

/** Nozzle on the end of a barrel of radius `r` at `z`: a plain nozzle, a flared one, or a pronged brake. */
function muzzleDevice(p: Parts, kind: number, y: number, z: number, r: number, seg: number) {
  if (kind === 1) {
    p.add('poly', turned([[r, z], [r * 1.5, z - 0.012], [r * 2.1, z - 0.045], [r * 1.9, z - 0.047], [r * 1.1, z - 0.02], [r * 0.8, z - 0.006]], seg), 0, y, 0);
    p.add('team', turned([[r * 2.02, z - 0.035], [r * 2.28, z - 0.038], [r * 2.28, z - 0.046], [r * 2.0, z - 0.048]], seg), 0, y, 0);
  } else if (kind === 2) {
    p.add('poly', turned([[r, z], [r * 1.45, z - 0.006], [r * 1.45, z - 0.03], [r * 0.9, z - 0.03], [r * 0.8, z - 0.01]], seg), 0, y, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      p.add('steel', chamferBox(0.006, 0.006, 0.026, 0.0015), Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3, z - 0.04);
    }
    p.add('team', turned([[r * 1.47, z - 0.008], [r * 1.62, z - 0.01], [r * 1.62, z - 0.018], [r * 1.47, z - 0.02]], seg), 0, y, 0);
  } else {
    p.add('poly', turned([[r, z], [r * 1.6, z - 0.01], [r * 1.7, z - 0.045], [r * 1.1, z - 0.045], [r * 0.9, z - 0.02]], seg), 0, y, 0);
    p.add('team', turned([[r * 1.7, z - 0.02], [r * 1.9, z - 0.025], [r * 1.9, z - 0.035], [r * 1.7, z - 0.04]], seg), 0, y, 0);
  }
}

function blaster(p: Parts, seg: number, st: Style) {
  const y = 0.13;
  p.add('shell', turned([[0, 0.1], [0.058, 0.098], [0.078, 0.082], [0.078, -0.02], [0.072, -0.03], [0.072, -0.13], [0.078, -0.14], [0.078, -0.24]], seg + 2), 0, y, 0);
  for (const z of [-0.005, -0.135]) p.add('team', turned([[0.079, z], [0.086, z - 0.005], [0.086, z - 0.025], [0.079, z - 0.03]], seg + 2), 0, y, 0);
  // The bell: flared, squared-off or stepped.
  const bell: P2[][] = [
    [[0.07, -0.24], [0.085, -0.27], [0.12, -0.33], [0.13, -0.385], [0.122, -0.395], [0.105, -0.36], [0.06, -0.3], [0.05, -0.25]],
    [[0.07, -0.24], [0.11, -0.262], [0.116, -0.39], [0.104, -0.395], [0.098, -0.28], [0.05, -0.25]],
    [[0.07, -0.24], [0.092, -0.25], [0.092, -0.3], [0.118, -0.31], [0.118, -0.39], [0.106, -0.395], [0.1, -0.325], [0.074, -0.315], [0.05, -0.25]],
  ];
  p.add('poly', turned(bell[st.muzzle], seg + 2), 0, y, 0);
  const lip = st.muzzle === 0 ? 0.13 : 0.117;
  p.add('steel', turned([[lip - 0.002, -0.372], [lip + 0.007, -0.376], [lip + 0.007, -0.392], [lip - 0.004, -0.397]], seg + 2), 0, y, 0);
  // Lower receiver wraps the underside of the tube.
  p.add('poly', slab([[0.095, 0.036], [0.102, 0.1], [-0.12, 0.1], [-0.16, 0.076], [-0.16, 0.054], [-0.05, 0.036]], 0.072, 0.01));
  grip(p, 0.045, 0.04, -0.092, 0.05);
  guard(p, 0.01, -0.085, 0.04, 0.052);
  // Foregrip.
  p.add('poly', slab([[-0.1, 0.056], [-0.094, -0.03], [-0.13, -0.036], [-0.142, 0.056]], 0.04, 0.009));
  // Rear pad.
  if (st.rear !== 1) p.add('poly', turned([[0, 0.128], [0.046, 0.122], [0.064, 0.102], [0.056, 0.098], [0, 0.098]], seg), 0, y, 0);
  else p.add('poly', slab([[0.098, 0.07], [0.124, 0.085], [0.124, 0.175], [0.098, 0.19]], 0.09, 0.012));
  // Canister on top, and a carry handle ahead of it.
  if (st.top === 1) tank(p, 0.245, 0.07, -0.08, 0.04, seg);
  else jar(p, 0.204, 0.02, st.top === 2 ? 0.05 : 0.058, 0.1, seg);
  p.add('steel', tube([[0, 0.2, -0.085], [0, 0.246, -0.105], [0, 0.25, -0.185], [0, 0.202, -0.215]], 0.008, 6));
}

function lobber(p: Parts, seg: number, st: Style) {
  const y = 0.125;
  p.add('shell', slab([[0.11, 0.065], [0.115, 0.15], [0.08, 0.17], [-0.1, 0.17], [-0.19, 0.15], [-0.19, 0.075], [-0.12, 0.06]], 0.11, 0.014));
  p.add('poly', slab([[0.07, 0.085], [0.07, 0.13], [-0.09, 0.13], [-0.13, 0.11], [-0.13, 0.085]], 0.117, 0.004));
  // Wide stub barrel with a thick lip.
  const lips: P2[][] = [
    [[0.05, -0.17], [0.068, -0.185], [0.068, -0.25], [0.078, -0.255], [0.078, -0.285], [0.06, -0.285], [0.055, -0.2]],
    [[0.05, -0.17], [0.062, -0.18], [0.062, -0.235], [0.086, -0.25], [0.088, -0.29], [0.07, -0.29], [0.052, -0.2]],
    [[0.05, -0.17], [0.07, -0.18], [0.07, -0.29], [0.058, -0.29], [0.055, -0.2]],
  ];
  p.add('steel', turned(lips[st.muzzle], seg + 2), 0, y, 0);
  const lr = st.muzzle === 1 ? 0.089 : st.muzzle === 2 ? 0.071 : 0.079;
  p.add('team', turned([[lr, -0.262], [lr + 0.006, -0.266], [lr + 0.006, -0.279], [lr, -0.283]], seg + 2), 0, y, 0);
  // Hopper: a funnel of paint on top.
  const up = -Math.PI / 2;
  if (st.top === 1) jar(p, 0.17, 0.02, 0.06, 0.09, seg);
  else {
    p.add('poly', turned([[0.026, 0], [0.03, 0.014], [0.072, 0.074], [0.077, 0.075], [0.077, 0.09], [0.07, 0.09], [0.066, 0.078], [0.024, 0.018]], seg + 2), 0, 0.166, 0.012, up);
    p.add('team', turned([[0, 0.084], [0.03, 0.082], [0.068, 0.074], [0.068, 0.07], [0, 0.07]], seg + 2, false), 0, 0.166, 0.012, up);
  }
  // Shells clipped to both sides.
  for (const z of [-0.02, -0.055, -0.09])
    p.both('team', () => turned([[0, 0.032], [0.011, 0.024], [0.0135, 0.006], [0.0135, -0.03], [0, -0.03]], 8, false), 0.066, 0.1, z, up);
  p.both('poly', () => chamferBox(0.008, 0.012, 0.1, 0.002), 0.079, 0.1, -0.055);
  grip(p, 0.05, 0.066, -0.076, 0.05);
  guard(p, 0.015, -0.085, 0.066, 0.055);
  // Front hand guard and a leaf sight.
  p.add('poly', slab([[-0.09, 0.062], [-0.1, 0.02], [-0.17, 0.02], [-0.182, 0.077]], 0.06, 0.01));
  p.add('steel', slab([[-0.118, 0.168], [-0.118, 0.216], [-0.127, 0.216], [-0.136, 0.168]], 0.034, 0.003, [[[-0.122, 0.185], [-0.122, 0.205], [-0.127, 0.205], [-0.13, 0.185]]]));
  if (st.rear === 1) p.add('poly', slab([[0.112, 0.08], [0.132, 0.09], [0.132, 0.14], [0.112, 0.15]], 0.08, 0.01));
}

function pistol(p: Parts, seg: number, st: Style) {
  const tops: P2[][] = [
    [[0.045, 0.128], [-0.13, 0.128], [-0.15, 0.118]],
    [[0.04, 0.132], [-0.06, 0.132], [-0.1, 0.122], [-0.15, 0.122]],
    [[0.05, 0.124], [-0.02, 0.132], [-0.14, 0.132], [-0.15, 0.124]],
  ];
  p.add('shell', slab([[0.055, 0.075], [0.06, 0.118], ...tops[st.top], [-0.15, 0.075]], 0.05, 0.007));
  for (let i = 0; i < 4; i++) p.add('poly', slab([[0.046 - i * 0.011, 0.084], [0.046 - i * 0.011, 0.118], [0.041 - i * 0.011, 0.118], [0.041 - i * 0.011, 0.084]], 0.0525, 0.0012));
  p.add('poly', slab([[0.05, 0.045], [0.056, 0.078], [-0.15, 0.078], [-0.15, 0.055], [-0.07, 0.045]], 0.046, 0.006));
  grip(p, 0.02, 0.05, -0.06, 0.042);
  guard(p, -0.01, -0.082, 0.05, 0.04);
  p.add('steel', turned([[0.014, -0.14], [0.016, -0.15], [0.016, -0.22], [0.021, -0.225], [0.021, -0.246], [0.012, -0.246], [0.01, -0.16]], seg), 0, 0.098, 0);
  p.add('team', turned([[0.0215, -0.229], [0.026, -0.232], [0.026, -0.24], [0.0215, -0.243]], seg), 0, 0.098, 0);
  // Under-barrel tank.
  p.add('glass', turned([[0, -0.05], [0.016, -0.055], [0.018, -0.07], [0.018, -0.125], [0.014, -0.14], [0, -0.142]], seg, false), 0, 0.05, 0);
  p.add('team', turned([[0, -0.058], [0.013, -0.066], [0.013, -0.126], [0, -0.136]], seg, false), 0, 0.05, 0);
  p.add('steel', slab([[-0.138, 0.126], [-0.138, 0.142], [-0.131, 0.142], [-0.126, 0.126]], 0.007, 0.0015));
  p.add('steel', slab([[0.04, 0.126], [0.04, 0.14], [0.03, 0.14], [0.03, 0.126]], 0.03, 0.002, [[[0.037, 0.132], [0.037, 0.141], [0.033, 0.141], [0.033, 0.132]]]));
  if (st.rear === 1) p.add('poly', slab([[0.058, 0.08], [0.075, 0.09], [0.075, 0.112], [0.058, 0.118]], 0.03, 0.006));
  if (st.muzzle === 1) p.add('poly', turned([[0.021, -0.246], [0.03, -0.256], [0.032, -0.275], [0.024, -0.275], [0.016, -0.25]], seg), 0, 0.098, 0);
}

/** The roller lives in a tilted handle group; these are in the handle's frame. */
function roller(p: Parts, seg: number, st: Style) {
  // Pole with a ribbed rubber sleeve where it is held.
  p.add('steel', turned([[0.014, 0.1], [0.02, 0.09], [0.02, -0.84], [0.026, -0.85], [0.026, -0.875], [0.014, -0.88]], seg), 0, 0, 0);
  const sleeve: P2[] = [[0.02, 0.105], [0.034, 0.098]];
  for (let z = 0.098; z > -0.05; z -= 0.03) sleeve.push([0.034, z - 0.022], [0.03, z - 0.025], [0.03, z - 0.027], [0.034, z - 0.03]);
  sleeve.push([0.034, -0.062], [0.022, -0.07]);
  p.add('poly', turned(sleeve, seg), 0, 0, 0);
  p.add('team', turned([[0.022, -0.072], [0.03, -0.076], [0.03, -0.096], [0.022, -0.1]], seg), 0, 0, 0);
  p.add('steel', slab([[-0.01, -0.03], [-0.02, -0.075], [-0.05, -0.07], [-0.045, -0.03]], 0.012, 0.003));
  // The yoke: two arms out to the ends of the drum.
  p.both('steel', () => tube([[0.006, 0, -0.8], [0.22, 0.012, -0.83], [0.47, 0.004, -0.87], [0.492, -0.02, -0.98]], 0.015, 6), 0, 0, 0);
  p.add('steel', turned([[0.017, 0.5], [0.017, -0.5]], 8), 0, -0.02, -0.98, 0, Math.PI / 2);
  // The drum: a napped sleeve in team paint between two caps.
  const nap: P2[] = [[0.1, 0.42], [0.15, 0.405]];
  for (let x = 0.405; x > -0.39; x -= 0.09) nap.push([0.156, x - 0.03], [0.156, x - 0.06], [0.151, x - 0.075], [0.151, x - 0.09]);
  nap.push([0.15, -0.405], [0.1, -0.42]);
  p.add('team', turned(nap, seg + 4), 0, -0.02, -0.98, 0, Math.PI / 2);
  p.both('shell', () => turned([[0.04, 0.03], [0.136, 0.026], [0.146, 0.012], [0.146, -0.03], [0.04, -0.03]], seg + 4), 0.445, -0.02, -0.98, 0, Math.PI / 2);
  p.both('steel', () => turned([[0, 0.012], [0.03, 0.01], [0.042, 0], [0, 0]], seg), 0.476, -0.02, -0.98, 0, Math.PI / 2);
  // A splash shield arching over the top of the drum.
  if (st.top !== 2) {
    const arc: P2[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (0.12 + (0.62 * i) / 8);
      arc.push([-0.98 + Math.cos(a) * 0.178, -0.02 + Math.sin(a) * 0.178]);
    }
    for (let i = 8; i >= 0; i--) {
      const a = Math.PI * (0.12 + (0.62 * i) / 8);
      arc.push([-0.98 + Math.cos(a) * 0.168, -0.02 + Math.sin(a) * 0.168]);
    }
    p.add('shell', slab(arc, 0.9, 0.003));
  }
  // The paint line from the handle to the drum.
  p.add('poly', tube([[0.024, 0.008, -0.1], [0.03, 0.02, -0.4], [0.026, 0.03, -0.76], [0.012, 0.06, -0.86], [0, 0.09, -0.93]], 0.007, 6));
  if (st.rear === 1) p.add('poly', turned([[0, 0.135], [0.03, 0.128], [0.036, 0.11], [0.02, 0.104]], seg), 0, 0, 0);
}

/* ---------- Attachments ---------- */

function attachment(p: Parts, kind: WeaponKind, extra: string, seg: number) {
  const top = kind === 'dual' ? 0.13 : kind === 'burst' ? 0.21 : kind === 'lobber' ? 0.172 : 0.178;
  const zf = kind === 'dual' ? -0.07 : kind === 'burst' ? -0.15 : kind === 'lobber' ? -0.06 : -0.135;
  const by = kind === 'auto' ? 0.12 : kind === 'burst' ? 0.13 : kind === 'lobber' ? 0.125 : 0.098;
  if (kind === 'roller') {
    switch (extra) {
      case 'tank':
      case 'drum':
        tank(p, 0.05, -0.2, -0.38, 0.034, seg);
        p.add('steel', chamferBox(0.03, 0.03, 0.02, 0.004), 0, 0.022, -0.29);
        break;
      case 'rings':
        for (const z of [-0.25, -0.45, -0.65]) p.add('team', turned([[0.021, z + 0.012], [0.03, z + 0.008], [0.03, z - 0.008], [0.021, z - 0.012]], seg), 0, 0, 0);
        break;
      case 'grip':
      case 'scope':
        p.add('poly', tube([[0, -0.018, -0.3], [0, -0.09, -0.31], [0, -0.1, -0.39], [0, -0.018, -0.41]], 0.012, 6));
        break;
      case 'fins':
      case 'spikes':
        for (const sx of [-1, 1])
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            p.add('team', turned([[0, 0.03], [0.012, 0], [0, 0]], 6, false), sx * 0.48, -0.02 + Math.sin(a) * 0.1, -0.98 + Math.cos(a) * 0.1, 0, (sx * Math.PI) / 2);
          }
        break;
    }
    return;
  }
  switch (extra) {
    case 'scope': {
      const y = top + 0.036;
      p.add('poly', turned([[0.014, 0.075], [0.021, 0.066], [0.021, 0.04], [0.014, 0.03], [0.014, -0.03], [0.021, -0.04], [0.021, -0.072], [0.016, -0.078]], seg), 0, y, zf);
      for (const z of [0.07, -0.074]) p.add('glass', turned([[0, z], [0.0155, z]], seg, false), 0, y, zf);
      for (const z of [0.022, -0.022]) p.add('steel', slab([[zf + z + 0.007, top - 0.004], [zf + z + 0.007, y + 0.004], [zf + z - 0.007, y + 0.004], [zf + z - 0.007, top - 0.004]], 0.02, 0.003));
      p.add('steel', turned([[0.006, 0.006], [0.009, 0.004], [0.009, -0.004], [0.006, -0.006]], 8), 0, y + 0.02, zf, -Math.PI / 2);
      break;
    }
    case 'drum': {
      const z = kind === 'dual' ? -0.1 : -0.128;
      p.add('team', turned([[0, 0.03], [0.05, 0.03], [0.058, 0.022], [0.058, -0.022], [0.05, -0.03], [0, -0.03]], seg + 2), 0, kind === 'dual' ? 0.02 : 0.0, z, 0, Math.PI / 2);
      p.both('poly', () => turned([[0, 0.006], [0.022, 0.004], [0.022, -0.002], [0, -0.002]], 10), 0.031, kind === 'dual' ? 0.02 : 0.0, z, 0, Math.PI / 2);
      break;
    }
    case 'fins':
      for (const z of [0.0, -0.03, -0.06]) p.both('team', () => slab([[zf + z, by - 0.012], [zf + z + 0.022, by + 0.05], [zf + z + 0.012, by + 0.052], [zf + z - 0.012, by - 0.012]], 0.005, 0.0012), kind === 'burst' ? 0.085 : kind === 'lobber' ? 0.064 : 0.04, 0, 0, 0, 0, -0.35);
      break;
    case 'tank':
      if (kind === 'dual') tank(p, top + 0.022, 0.03, -0.07, 0.02, seg);
      else tank(p, top + 0.05, zf + 0.09, zf - 0.07, 0.043, seg);
      if (kind !== 'dual') for (const z of [zf + 0.06, zf - 0.04]) p.add('poly', chamferBox(0.03, 0.03, 0.016, 0.003), 0, top + 0.006, z);
      break;
    case 'spikes': {
      // A saw-tooth ridge along the top.
      const ridge: P2[] = [[zf + 0.07, top - 0.002]];
      for (let i = 0; i < 4; i++) ridge.push([zf + 0.052 - i * 0.034, top + 0.03], [zf + 0.036 - i * 0.034, top + 0.004]);
      ridge.push([zf - 0.07, top - 0.002]);
      p.add('team', slab(ridge, 0.012, 0.003));
      break;
    }
    case 'rings':
      for (const z of kind === 'dual' ? [-0.17, -0.195] : kind === 'burst' ? [-0.06, -0.09, -0.2] : kind === 'lobber' ? [-0.2, -0.225] : [-0.235, -0.27, -0.305]) {
        const r = kind === 'dual' ? 0.0165 : kind === 'burst' ? 0.079 : kind === 'lobber' ? 0.069 : 0.0285;
        p.add('team', turned([[r, z + 0.007], [r + 0.007, z + 0.004], [r + 0.007, z - 0.004], [r, z - 0.007]], seg + 2), 0, by, 0);
      }
      break;
    case 'grip': {
      const z = kind === 'dual' ? -0.105 : kind === 'burst' ? -0.2 : -0.185;
      const y0 = kind === 'dual' ? 0.047 : kind === 'burst' ? 0.058 : 0.074;
      p.add('poly', slab([[z + 0.016, y0], [z + 0.02, y0 - 0.075], [z - 0.012, y0 - 0.08], [z - 0.02, y0]], 0.034, 0.008));
      p.add('steel', chamferBox(0.036, 0.008, 0.05, 0.002), 0, y0 + 0.002, z);
      break;
    }
  }
}

const geoCache = new Map<string, Map<string, THREE.BufferGeometry>>();

/** The merged geometry of a built-in weapon model: one per material. Shared and kept. */
function weaponGeometry(def: WeaponDef, detail: number): Map<string, THREE.BufferGeometry> {
  const h = seedOfText(def.id);
  // The five originals are the reference designs; every other weapon varies from its family.
  const original = def.id === def.base;
  const st: Style = original ? { muzzle: 0, top: 0, rear: 0 } : { muzzle: h % 3, top: (h >>> 3) % 3, rear: (h >>> 6) % 3 };
  const key = `${def.kind}|${def.look.extra}|${st.muzzle}${st.top}${st.rear}|${detail}`;
  let hit = geoCache.get(key);
  if (hit) return hit;
  const p = new Parts();
  const seg = 8 + detail * 3;
  switch (def.kind) {
    case 'auto': sprayer(p, seg, st); break;
    case 'burst': blaster(p, seg, st); break;
    case 'lobber': lobber(p, seg, st); break;
    case 'dual': pistol(p, seg, st); break;
    case 'roller': roller(p, seg, st); break;
  }
  attachment(p, def.kind, def.look.extra, seg);
  hit = p.merged();
  // Finish patterns repeat about four times along the gun.
  const shell = hit.get('shell');
  if (shell) boxUV(shell, 4);
  geoCache.set(key, hit);
  return hit;
}

const MUZZLE: Record<WeaponKind, [number, number, number]> = { auto: [0, 0.12, -0.42], roller: [0, 0, -1.0], burst: [0, 0.13, -0.4], lobber: [0, 0.14, -0.3], dual: [0, 0.09, -0.26] };

/**
 * Built in a canonical frame (grip at origin, barrel toward -Z, up +Y) and rotated onto the
 * hand, whose -Y runs along the forearm.
 */
export function buildWeapon(
  id: WeaponId,
  team: THREE.Material,
  dark: THREE.Material,
  light: THREE.Material,
  detail: number,
  lambert: boolean,
  finish = 'factory',
): WeaponModel {
  const def = WEAPONS[id] ?? WEAPONS.pulse;
  const f = FINISHES[finish] ?? FINISHES.factory;
  const geos: THREE.BufferGeometry[] = [];
  const own: (THREE.Material | { dispose(): void })[] = [];
  const s = (n: number) => Math.round(n + (n * detail) / 2);
  const map = f.pattern ? patternTexture(f.pattern, f.color, PATTERN_INK[f.pattern]) : null;
  const glow = f.glow ? { emissive: f.color, emissiveIntensity: f.glow } : {};
  const peel = lambert || detail < 1 ? null : surfaceMaps('paint', 128);
  const shell = lambert
    ? new THREE.MeshLambertMaterial({ color: map ? 0xffffff : f.color, map, ...glow })
    : new THREE.MeshStandardMaterial({ color: map ? 0xffffff : f.color, map, roughness: f.rough, metalness: f.metal, normalMap: peel?.normalMap ?? null, normalScale: new THREE.Vector2(0.35, 0.35), ...glow });
  const glass = new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  own.push(shell, glass);
  const group = new THREE.Group();
  const muzzle = new THREE.Object3D();
  group.add(muzzle);
  const Z = Math.PI / 2;

  const asset = def.look.asset ? publishedAsset(def.look.asset) : undefined;
  const parts = def.look.parts;
  if (asset) {
    // A weapon modelled in the Studio: its materials take the game's team paint and finish.
    const built = buildAsset(asset, { lambert, size: detail >= 1 ? 128 : 0, role: (role) => (role === 'team' ? team : role === 'finish' ? shell : role === 'glass' ? glass : undefined) });
    group.add(built.group);
    own.push(built);
    const m = built.points.muzzle;
    muzzle.position.set(m?.x ?? 0, m?.y ?? 0.12, m?.z ?? -0.42);
  } else if (parts?.length) {
    // A gun from the old editor: a list of primitive shapes, drawn as it always was.
    const mat = { team, dark, light, shell };
    for (const q of parts) {
      const geo =
        q.s === 'box' ? new THREE.BoxGeometry(1, 1, 1)
        : q.s === 'cyl' ? new THREE.CylinderGeometry(0.5, 0.5, 1, s(10)).rotateX(Z)
        : q.s === 'sphere' ? new THREE.SphereGeometry(0.5, s(10), s(8))
        : q.s === 'cone' ? new THREE.ConeGeometry(0.5, 1, s(10)).rotateX(-Z)
        : new THREE.TorusGeometry(0.5, 0.12, 6, s(14));
      geos.push(geo);
      const part = new THREE.Mesh(geo, mat[q.c]);
      part.position.set(q.x, q.y, q.z);
      part.castShadow = true;
      group.add(part);
      part.scale.set(q.w, q.h, q.d);
      if (q.rx || q.ry || q.rz) part.rotation.set(((q.rx ?? 0) * Math.PI) / 180, ((q.ry ?? 0) * Math.PI) / 180, ((q.rz ?? 0) * Math.PI) / 180);
    }
    muzzle.position.set(0, def.look.muzzle?.[0] ?? 0.1, def.look.muzzle?.[1] ?? -0.4);
  } else {
    const poly = surfaceMaterial({ color: 0x2b2932, rough: 0.82, surface: 'rubber', lambert, size: detail >= 1 ? 128 : 0 });
    const steel = surfaceMaterial({ color: 0xb6bac6, rough: 0.34, metal: 0.92, surface: 'brushed', lambert, size: detail >= 1 ? 128 : 0 });
    own.push(poly, steel);
    const mats: Record<Mat, THREE.Material> = { shell, poly, steel, team, glass };
    // The roller hangs from a handle tilted slightly down, so the drum stays off the floor.
    const holder = def.kind === 'roller' ? new THREE.Group() : group;
    if (holder !== group) {
      holder.rotation.x = 0.15;
      group.add(holder);
      holder.add(muzzle);
    }
    for (const [name, geo] of weaponGeometry(def, Math.max(0, Math.min(2, Math.round(detail))))) {
      if (!geo.attributes.position?.count) continue;
      const mesh = new THREE.Mesh(geo, mats[name as Mat] ?? shell);
      mesh.castShadow = name !== 'glass';
      // Glass draws after the paint inside it.
      if (name === 'glass') mesh.renderOrder = 2;
      holder.add(mesh);
    }
    muzzle.position.set(...MUZZLE[def.kind]);
  }

  group.scale.set(def.look.bulk, def.look.bulk, def.look.len);
  group.rotation.x = -Math.PI / 2;
  return {
    group,
    muzzle,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of own) m.dispose();
    },
  };
}
