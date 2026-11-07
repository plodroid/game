import * as THREE from 'three';
import { ACCENT_COLORS, COLORWAYS, HAIR_COLORS, SKIN_TONES, splitWay, WEAPONS, type Colorway, type Cosmetics, type WeaponId } from '@chromashift/shared';
import { buildWeapon, type WeaponModel } from '../weapons/models';
import { buildBack } from './back';
import { compactRig } from './compact';
import { shapeOf } from './gear';
import { buildHead, type HeadParts } from './head';
import { darken, patternTexture, type Pattern } from './patterns';

/**
 * Procedural "Shifter" character. The rig is a plain Object3D hierarchy so a skinned GLB can
 * replace it later: anything exposing the same joint names works with the Animator.
 */
export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  chest: THREE.Object3D;
  head: THREE.Object3D;
  shoulderL: THREE.Object3D;
  shoulderR: THREE.Object3D;
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
  blob: THREE.Mesh;
  canisterFill: THREE.Mesh;
  weapon: WeaponModel;
  offWeapon: WeaponModel | null;
  teamMats: THREE.MeshStandardMaterial[];
  dispose(): void;
}

const seg = (detail: number, lo: number, hi: number) => Math.round(lo + ((hi - lo) * detail) / 2);

function capsule(r: number, len: number, detail: number) {
  return new THREE.CapsuleGeometry(r, len, seg(detail, 3, 6), seg(detail, 7, 14));
}

function lathe(points: [number, number][], detail: number) {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    seg(detail, 10, 24),
  );
}

const PROFILES: Record<string, [number, number][]> = {
  regular: [[0.001, 0], [0.155, 0.02], [0.16, 0.16], [0.205, 0.3], [0.18, 0.4], [0.1, 0.45], [0.001, 0.46]],
  slim: [[0.001, 0], [0.14, 0.02], [0.145, 0.18], [0.185, 0.32], [0.15, 0.41], [0.08, 0.44], [0.001, 0.45]],
  vest: [[0.001, 0], [0.15, 0.02], [0.16, 0.16], [0.2, 0.3], [0.17, 0.4], [0.1, 0.44], [0.001, 0.45]],
  bulky: [[0.001, 0], [0.18, 0.02], [0.19, 0.16], [0.23, 0.3], [0.205, 0.41], [0.12, 0.46], [0.001, 0.47]],
};

type Part = 'accent' | 'dark' | 'white' | 'team' | 'skin' | 'second';

interface OutfitLook {
  profile: keyof typeof PROFILES;
  body: Part;
  /** Upper and lower arm. */
  arms: [Part, Part];
  collar: 'ring' | 'hood' | 'tall' | 'none' | 'lapel';
  pattern?: Pattern;
  /** A second colour some outfits use (raincoat yellow, lab-coat white). */
  second?: number;
  fat?: boolean;
  extra?: 'pockets' | 'lapels' | 'armStripes' | 'cuffs' | 'patch' | 'overalls' | 'apron' | 'scarf' | 'bands' | 'skirt' | 'poncho' | 'tux' | 'armor' | 'chestSplat';
}

const OUTFIT: Record<string, OutfitLook> = {
  jacket: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'ring' },
  hoodie: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'hood' },
  tee: { profile: 'regular', body: 'accent', arms: ['accent', 'skin'], collar: 'none', extra: 'chestSplat' },
  tank: { profile: 'slim', body: 'accent', arms: ['skin', 'skin'], collar: 'none' },
  vest: { profile: 'vest', body: 'accent', arms: ['skin', 'skin'], collar: 'none', extra: 'pockets' },
  stripetee: { profile: 'regular', body: 'accent', arms: ['accent', 'skin'], collar: 'none', pattern: 'stripes', second: 0xf4efe9 },
  turtleneck: { profile: 'slim', body: 'accent', arms: ['accent', 'accent'], collar: 'tall' },
  tracksuit: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'ring', extra: 'armStripes' },
  bomber: { profile: 'bulky', body: 'dark', arms: ['dark', 'dark'], collar: 'ring', extra: 'cuffs' },
  varsity: { profile: 'regular', body: 'accent', arms: ['white', 'white'], collar: 'ring', extra: 'patch' },
  overalls: { profile: 'regular', body: 'white', arms: ['white', 'skin'], collar: 'none', extra: 'overalls' },
  apron: { profile: 'regular', body: 'dark', arms: ['dark', 'dark'], collar: 'ring', extra: 'apron' },
  raincoat: { profile: 'bulky', body: 'second', arms: ['second', 'second'], collar: 'hood', second: 0xffc532 },
  checkhoodie: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'hood', pattern: 'check', second: 0x17131c },
  polkavest: { profile: 'vest', body: 'accent', arms: ['skin', 'skin'], collar: 'none', pattern: 'dots', second: 0xf4efe9 },
  scarf: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'none', extra: 'scarf' },
  suit: { profile: 'slim', body: 'dark', arms: ['dark', 'dark'], collar: 'none', extra: 'lapels' },
  puffer: { profile: 'bulky', body: 'accent', arms: ['accent', 'accent'], collar: 'tall', fat: true, extra: 'bands' },
  labcoat: { profile: 'regular', body: 'second', arms: ['second', 'second'], collar: 'lapel', second: 0xf3f1ec, extra: 'skirt' },
  poncho: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'ring', extra: 'poncho' },
  camo: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'ring', pattern: 'camo', second: 0x6b7334 },
  drip: { profile: 'regular', body: 'accent', arms: ['accent', 'accent'], collar: 'hood', pattern: 'drip', second: -1 },
  tux: { profile: 'slim', body: 'dark', arms: ['dark', 'dark'], collar: 'none', extra: 'tux' },
  armor: { profile: 'regular', body: 'dark', arms: ['dark', 'dark'], collar: 'tall', extra: 'armor' },
};

export interface ModelOptions {
  cosmetics: Cosmetics;
  team: THREE.Color;
  weapon: WeaponId;
  detail: number;
  lambert: boolean;
}

export function buildCharacter(o: ModelOptions): Rig {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mat = (color: number | THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = o.lambert
      ? new THREE.MeshLambertMaterial({
          color,
          map: extra.map ?? null,
          emissive: extra.emissive ?? 0x000000,
          emissiveIntensity: extra.emissiveIntensity ?? 1,
          transparent: extra.transparent ?? false,
          opacity: extra.opacity ?? 1,
          side: extra.side ?? THREE.FrontSide,
        })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...extra });
    mats.push(m);
    return m;
  };
  const d = o.detail;
  const c = o.cosmetics;
  const mix = (a: number, b: number, t: number) => {
    const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const wayOf = (id: string) => {
    const [base, w] = splitWay(id);
    return [base, w ? COLORWAYS[w] : undefined] as const;
  };
  /** The materials a colourway paints a piece in, in place of the player's own colours. */
  const paint = (cw: Colorway) => {
    const ex = { metalness: cw.metal ?? 0, roughness: cw.rough ?? 0.55 };
    const lit = (col: number) => (cw.glow ? { emissive: col, emissiveIntensity: cw.glow } : {});
    return {
      accent: mat(cw.a, { ...ex, ...lit(cw.a) }),
      teamFlat: mat(cw.b, { ...ex, ...lit(cw.b) }),
      team: mat(cw.b, { ...ex, emissive: cw.b, emissiveIntensity: Math.max(0.3, cw.glow ?? 0) }),
      dark: mat(cw.dark, { roughness: 0.7, metalness: (cw.metal ?? 0) * 0.5 }),
      white: mat(cw.light, ex),
      make: (color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) => mat(mix(color, cw.a, 0.55), { ...extra, ...ex }),
    };
  };
  const [outfitId, outfitWay] = wayOf(c.outfit);
  const [gearId, gearWay] = wayOf(c.headgear);
  const [faceId, faceWay] = wayOf(c.face);
  const [backId, backWay] = wayOf(c.back);
  const accentColor = outfitWay?.a ?? ACCENT_COLORS[c.accent] ?? 0x2a2d3a;
  const skin = mat(SKIN_TONES[c.skin] ?? SKIN_TONES[1], { roughness: 0.75 });
  const accent = mat(accentColor, { roughness: outfitWay?.rough ?? 0.7, metalness: outfitWay?.metal ?? 0, ...(outfitWay?.glow ? { emissive: accentColor, emissiveIntensity: outfitWay.glow * 0.6 } : {}) });
  const dark = mat(0x23252f, { roughness: 0.8 });
  const white = mat(0xf3f0ea, { roughness: 0.5 });
  const eyeMat = mat(0x14151c, { roughness: 0.25 });
  const team = mat(o.team, { emissive: o.team, emissiveIntensity: 0.35, roughness: 0.35 }) as THREE.MeshStandardMaterial;
  const teamFlat = mat(o.team, { roughness: 0.45 }) as THREE.MeshStandardMaterial;
  const glass = mat(o.team, { transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.1, emissive: o.team, emissiveIntensity: 0.25 }) as THREE.MeshStandardMaterial;
  const dye = HAIR_COLORS[c.hairColor];
  const hair = !dye || c.hairColor === 'team' ? team : mat(dye.color, { roughness: 0.45, metalness: dye.metal ?? 0, emissive: dye.glow ? dye.color : 0, emissiveIntensity: dye.glow ?? 0 });

  // An outfit's colourway repaints its trim, highlights and second colour too.
  const look = OUTFIT[outfitId] ?? OUTFIT.jacket;
  const ow = outfitWay ? paint(outfitWay) : null;
  const second = outfitWay ? outfitWay.b : look.second === -1 ? o.team.getHex() : (look.second ?? 0xffffff);
  const patterned = look.pattern ? mat(0xffffff, { roughness: 0.7, map: patternTexture(look.pattern, look.body === 'second' ? second : accentColor, outfitWay ? outfitWay.dark : look.second === -1 ? o.team.getHex() : (look.second ?? darken(accentColor, 0.6))) }) : null;
  const secondMat = mat(second, { roughness: outfitId === 'raincoat' ? 0.25 : 0.65 });
  const part = (p: Part) => ({ accent, dark: ow?.dark ?? dark, white: ow?.white ?? white, team: ow?.teamFlat ?? teamFlat, skin, second: secondMat })[p];
  const bodyMat = patterned ?? part(look.body);

  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const me = new THREE.Mesh(g(geo), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    return me;
  };
  const node = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = node(body, 0, 0.86, 0);
  hips.add(mesh(new THREE.SphereGeometry(0.16, seg(d, 8, 16), seg(d, 6, 12)).scale(1, 0.62, 0.78), dark, 0, 0, 0));
  const spine = node(hips, 0, 0.06, 0);

  // Torso by outfit.
  spine.add(mesh(lathe(PROFILES[look.profile], d).scale(1, 1, 0.76), bodyMat));
  spine.add(mesh(new THREE.BoxGeometry(0.03, 0.36, 0.012), team, 0, 0.22, -0.148));
  const front = look.profile === 'bulky' ? -0.168 : -0.15;
  switch (look.collar) {
    case 'hood': {
      const hood = mesh(new THREE.TorusGeometry(0.13, 0.05, seg(d, 4, 8), seg(d, 8, 16), Math.PI).scale(1, 1, 0.8), bodyMat, 0, 0.42, 0.07);
      hood.rotation.x = -0.4;
      spine.add(hood);
      break;
    }
    case 'ring':
      spine.add(mesh(new THREE.TorusGeometry(0.1, 0.028, seg(d, 4, 8), seg(d, 10, 18)).scale(1, 1, 0.8), part(look.body === 'dark' ? 'accent' : look.body), 0, 0.42, 0).rotateX(Math.PI / 2));
      break;
    case 'tall':
      spine.add(mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.09, seg(d, 10, 18), 1, true).scale(1, 1, 0.85), part(look.body), 0, 0.47, 0));
      break;
    case 'lapel':
      for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.012).rotateZ(sx * 0.35), part(look.body), sx * 0.06, 0.32, front + 0.01));
      break;
  }
  switch (look.extra) {
    case 'pockets':
      for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), dark, sx * 0.08, 0.14, -0.13));
      break;
    case 'lapels':
      for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.012, 0.34, 0.012), team, sx * 0.1, 0.2, -0.13));
      break;
    case 'chestSplat':
      spine.add(mesh(new THREE.ShapeGeometry(shapeOf('splat', 0.06)).rotateY(Math.PI), teamFlat, 0.05, 0.27, front - 0.006));
      break;
    case 'patch':
      spine.add(mesh(new THREE.CircleGeometry(0.045, 12).rotateY(Math.PI), teamFlat, 0.07, 0.28, front - 0.006));
      break;
    case 'overalls':
      spine.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.03), accent, 0, 0.14, front + 0.005));
      for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.035, 0.24, 0.3), accent, sx * 0.09, 0.3, 0));
      spine.add(mesh(lathe([[0.001, -0.02], [0.165, -0.02], [0.165, 0.12], [0.001, 0.12]], d).scale(1, 1, 0.78), accent));
      break;
    case 'apron':
      spine.add(mesh(new THREE.BoxGeometry(0.24, 0.42, 0.02), white, 0, 0.12, front + 0.01));
      for (const [x, y, r] of [[-0.05, 0.1, 0.035], [0.06, 0.02, 0.028], [0.02, 0.22, 0.025]])
        spine.add(mesh(new THREE.CircleGeometry(r, 10).rotateY(Math.PI), teamFlat, x, y, front - 0.002));
      break;
    case 'scarf':
      spine.add(mesh(new THREE.TorusGeometry(0.11, 0.045, seg(d, 5, 8), seg(d, 12, 20)).scale(1, 1, 0.85).rotateX(Math.PI / 2), teamFlat, 0, 0.43, 0));
      spine.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.025).rotateZ(0.15), teamFlat, 0.07, 0.32, front - 0.02));
      break;
    case 'bands':
      for (const y of [0.08, 0.18, 0.28])
        spine.add(mesh(new THREE.TorusGeometry(0.205, 0.016, 4, seg(d, 14, 24)).scale(1, 1, 0.78).rotateX(Math.PI / 2), part(look.body), 0, y, 0));
      break;
    case 'skirt':
      spine.add(mesh(lathe([[0.17, 0.02], [0.2, -0.2], [0.24, -0.42], [0.22, -0.44]], d).scale(1, 1, 0.8), secondMat));
      break;
    case 'poncho': {
      const pon = mesh(lathe([[0.001, 0.47], [0.12, 0.44], [0.3, 0.2], [0.32, 0.16]], d).scale(1, 1, 0.85), mat(0xffffff, { roughness: 0.8, map: patternTexture('stripes', accentColor, o.team.getHex()), side: THREE.DoubleSide }));
      spine.add(pon);
      break;
    }
    case 'tux':
      spine.add(mesh(new THREE.BoxGeometry(0.1, 0.3, 0.02), white, 0, 0.26, front + 0.012));
      for (const sx of [-1, 1]) spine.add(mesh(new THREE.ConeGeometry(0.025, 0.05, 4).rotateZ((sx * Math.PI) / 2), teamFlat, sx * 0.025, 0.4, front - 0.004));
      break;
    case 'armor': {
      const plate = mat(0xb9bcc6, { metalness: 0.8, roughness: 0.3 });
      spine.add(mesh(new THREE.SphereGeometry(0.19, seg(d, 10, 18), seg(d, 6, 10), 0, Math.PI * 2, 0, Math.PI / 2.4).scale(1, 0.9, 0.7).rotateX(-Math.PI / 2), plate, 0, 0.25, -0.02));
      spine.add(mesh(new THREE.CircleGeometry(0.04, 6).rotateY(Math.PI), team, 0, 0.27, front - 0.04));
      break;
    }
  }
  // Belt with the pigment canister: its fill shows the player's ink.
  spine.add(mesh(new THREE.TorusGeometry(0.155, 0.022, 4, seg(d, 12, 20)).scale(1, 1, 0.78), dark, 0, 0.02, 0).rotateX(Math.PI / 2));
  const can = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, seg(d, 8, 14)), mat(0xdfe8f5, { transparent: true, opacity: 0.35, roughness: 0.1 }), 0, 0.06, 0.15);
  spine.add(can);
  const canisterFill = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, seg(d, 8, 14)).translate(0, 0.065, 0), team, 0, -0.005, 0.15);
  spine.add(canisterFill);

  const chest = node(spine, 0, 0.36, 0);
  const neck = node(chest, 0, 0.06, 0);
  neck.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, seg(d, 6, 12)), skin, 0, 0, 0));
  const head = node(neck, 0, 0.07, 0);
  const make: HeadParts['make'] = (color, extra) => mat(color, extra);
  // Skin, face, hair and headgear are all built on one head surface, so every combination fits.
  buildHead(head, { hair: c.hair, headgear: gearId, face: faceId }, { skin, hair, accent, dark, white, eye: eyeMat, team, teamFlat, glass, make }, d, (x) => void g(x), {
    gear: gearWay ? paint(gearWay) : undefined,
    face: faceWay ? paint(faceWay) : undefined,
  });

  const bw = backWay ? paint(backWay) : null;
  buildBack(spine, backId, {
    mesh,
    mat: bw ? (col, ex) => bw.make(col, ex) : mat,
    team: bw?.team ?? team,
    teamFlat: bw?.teamFlat ?? teamFlat,
    dark: bw?.dark ?? dark,
    white: bw?.white ?? white,
    accent: bw?.accent ?? accent,
    glass,
    detail: d,
  });

  // Arms
  const [upper, lower] = look.arms.map((p) => (p === look.body && patterned ? patterned : part(p)));
  const fat = look.fat ? 1.3 : 1;
  const arm = (side: number) => {
    const shoulder = node(chest, side * 0.2, 0.0, 0);
    shoulder.add(mesh(new THREE.SphereGeometry(0.07 * fat, seg(d, 6, 12), seg(d, 4, 8)), look.arms[0] === 'skin' ? skin : upper));
    if (look.extra === 'armor') shoulder.add(mesh(new THREE.SphereGeometry(0.09, seg(d, 8, 14), seg(d, 4, 8), 0, Math.PI * 2, 0, Math.PI / 2), mat(0xb9bcc6, { metalness: 0.8, roughness: 0.3 }), 0, 0.01, 0));
    shoulder.add(mesh(capsule(0.055 * fat, 0.17, d), upper, 0, -0.13, 0));
    if (look.extra === 'armStripes') shoulder.add(mesh(new THREE.BoxGeometry(0.012, 0.24, 0.02), white, side * 0.054, -0.14, 0));
    const elbow = node(shoulder, 0, -0.27, 0);
    elbow.add(mesh(capsule(0.05 * (look.fat ? 1.2 : 1), 0.15, d), lower, 0, -0.11, 0));
    elbow.add(mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.05, seg(d, 6, 12)), look.extra === 'cuffs' ? accent : team, 0, -0.17, 0));
    if (look.extra === 'armStripes') elbow.add(mesh(new THREE.BoxGeometry(0.012, 0.18, 0.02), white, side * 0.05, -0.1, 0));
    const hand = node(elbow, 0, -0.25, 0);
    hand.add(mesh(new THREE.SphereGeometry(0.055, seg(d, 6, 12), seg(d, 4, 8)), dark));
    return { shoulder, elbow, hand };
  };
  const L = arm(-1), R = arm(1);

  const leg = (side: number) => {
    const hip = node(hips, side * 0.09, -0.02, 0);
    hip.add(mesh(capsule(0.07, 0.22, d), dark, 0, -0.18, 0));
    const knee = node(hip, 0, -0.38, 0);
    knee.add(mesh(new THREE.SphereGeometry(0.064, seg(d, 6, 12), seg(d, 4, 8)), dark));
    knee.add(mesh(capsule(0.06, 0.2, d), dark, 0, -0.17, 0));
    const foot = node(knee, 0, -0.38, 0);
    const shoe = mesh(new THREE.CapsuleGeometry(0.06, 0.13, 3, seg(d, 6, 12)).rotateX(Math.PI / 2).scale(1.1, 0.85, 1), white, 0, -0.025, -0.045);
    foot.add(shoe);
    foot.add(mesh(new THREE.BoxGeometry(0.13, 0.02, 0.24), teamFlat, 0, -0.07, -0.045));
    return { hip, knee };
  };
  const LL = leg(-1), RL = leg(1);

  const weapon = buildWeapon(o.weapon, team, dark, white, d, o.lambert, c.finish);
  R.hand.add(weapon.group);
  let offWeapon: WeaponModel | null = null;
  if (WEAPONS[o.weapon]?.kind === 'dual') {
    offWeapon = buildWeapon(o.weapon, team, dark, white, d, o.lambert, c.finish);
    L.hand.add(offWeapon.group);
  }

  // Paint-dive form: a glossy blob that skims along the surface.
  const blobMat = new THREE.MeshStandardMaterial({ color: o.team, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 1, emissive: o.team, emissiveIntensity: 0.15 });
  mats.push(blobMat);
  const blob = new THREE.Mesh(g(new THREE.SphereGeometry(0.4, seg(d, 10, 24), seg(d, 8, 16))), blobMat);
  blob.visible = false;
  blob.castShadow = false;
  root.add(blob);

  compactRig(
    root,
    // Joints the animation moves, plus the weapons (they can be hidden on their own).
    [
      root,
      body,
      hips,
      spine,
      chest,
      head,
      L.shoulder,
      R.shoulder,
      L.elbow,
      R.elbow,
      L.hand,
      R.hand,
      LL.hip,
      RL.hip,
      LL.knee,
      RL.knee,
      weapon.group,
      ...(offWeapon ? [offWeapon.group] : []),
    ],
    new Set([blob, canisterFill]),
    (x) => void g(x),
  );

  return {
    root, body, hips, spine, chest, head,
    shoulderL: L.shoulder, shoulderR: R.shoulder, elbowL: L.elbow, elbowR: R.elbow, handL: L.hand, handR: R.hand,
    hipL: LL.hip, hipR: RL.hip, kneeL: LL.knee, kneeR: RL.knee,
    blob, canisterFill, weapon, offWeapon,
    teamMats: [team, teamFlat, glass, blobMat],
    dispose() {
      for (const x of geos) x.dispose();
      for (const m of mats) m.dispose();
      weapon.dispose();
      offWeapon?.dispose();
    },
  };
}
