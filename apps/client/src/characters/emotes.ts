/*
 * Emotes: each one is its own piece of choreography, written as a pose over time.
 *
 * Joint conventions (the rig faces -Z, +X is the character's right):
 *  - shoulder x lifts an arm forward and up (π/2 = straight ahead, π = straight up);
 *  - shoulder z swings it sideways *before* the lift, so a sideways angle keeps the hand that far
 *    out whatever the lift. The helpers below take "out" as positive for either arm;
 *  - elbow x folds the forearm forward and up; hip x lifts a thigh, knee x (negative) bends it.
 * Head is 0.225 wide, so a hand held overhead needs about 0.45 rad of "out" to stay clear of it.
 */

export const JOINTS = ['hips', 'spine', 'chest', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR', 'kneeL', 'kneeR'] as const;
export type Joint = (typeof JOINTS)[number];
export type V3 = [number, number, number];

export interface EmoteCtx {
  t: Record<Joint, V3>;
  /** Seconds since the emote began, and 0..1 through it. */
  T: number;
  p: number;
  /** Body lift (m) and sideways/backwards slide (m, +z is backwards), turn about the vertical axis, and somersault 0..1 (-1 = none). */
  y: number;
  z: number;
  spin: number | null;
  flip: number;
}

const PI = Math.PI;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, max = Math.max, min = Math.min;
const sm = (a: number, b: number, x: number) => {
  const k = min(1, max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** 0→1→0 over [a, b]. */
const hump = (a: number, b: number, x: number) => sin(sm(a, b, x) * PI);
/** Squared sine, always >= 0: a bounce that rests on the floor between hops. */
const bounce = (x: number) => abs(sin(x));

type Pose = (c: EmoteCtx) => void;

const arm = (c: EmoteCtx, side: 'L' | 'R', lift: number, out = 0, bend = 0, turn = 0) => {
  c.t[side === 'L' ? 'shoulderL' : 'shoulderR'] = [lift, turn, side === 'R' ? out : -out];
  c.t[side === 'L' ? 'elbowL' : 'elbowR'] = [bend, 0, 0];
};
const arms = (c: EmoteCtx, lift: number, out: number, bend = 0) => {
  arm(c, 'L', lift, out, bend);
  arm(c, 'R', lift, out, bend);
};
const leg = (c: EmoteCtx, side: 'L' | 'R', hip: number, knee = 0, out = 0) => {
  c.t[side === 'L' ? 'hipL' : 'hipR'] = [hip, 0, side === 'R' ? out : -out];
  c.t[side === 'L' ? 'kneeL' : 'kneeR'] = [-Math.abs(knee), 0, 0];
};
const legs = (c: EmoteCtx, hip: number, knee: number, out = 0) => {
  leg(c, 'L', hip, knee, out);
  leg(c, 'R', hip, knee, out);
};
/** Both knees bent into a crouch, the pelvis dropping to match. */
const crouch = (c: EmoteCtx, k: number) => {
  legs(c, 0.55 * k, 1.1 * k);
  c.y -= 0.17 * k;
  c.t.spine[0] += 0.12 * k;
};

export const EMOTE_MOVES: Record<string, Pose> = {
  // Greetings
  wave(c) {
    // Right hand up beside the head, the forearm swinging like a windscreen wiper.
    arm(c, 'R', 2.0, 0.55, 1.1 + sin(c.T * 9) * 0.45);
    arm(c, 'L', 0.05, 0.12);
    c.t.head[2] = -0.08;
    c.t.spine[2] = 0.05;
  },
  salute(c) {
    const k = sm(0.1, 0.4, c.T) * (1 - sm(1.9, 2.3, c.T));
    arm(c, 'R', 2.45 * k, 0.85 * k, 2.45 * k);
    arm(c, 'L', 0.05, 0.1);
    c.t.head[0] = -0.06 * k;
    c.t.spine[0] = -0.08 * k;
    legs(c, 0, 0);
  },
  bow(c) {
    const k = sin(sm(0, 0.6, c.T) * PI * 0.5) * (1 - sm(1.5, 2.3, c.T));
    c.t.spine[0] = 0.85 * k;
    c.t.head[0] = -0.15 * k;
    arm(c, 'R', 1.5 * k, -0.35 * k, 1.5 * k);
    arm(c, 'L', -0.65 * k, 0.15);
    leg(c, 'L', -0.1 * k, 0);
    c.y -= 0.03 * k;
  },
  curtsy(c) {
    const k = sin(sm(0, 0.7, c.T) * PI * 0.5) * (1 - sm(1.6, 2.3, c.T));
    arms(c, 0.1 * k, 0.75 * k, 0.5 * k);
    leg(c, 'R', -0.35 * k, 0.4 * k);
    leg(c, 'L', 0.45 * k, 1.4 * k);
    c.t.hips[1] = -0.2 * k;
    c.t.head[0] = 0.18 * k;
    c.t.head[2] = 0.1 * k;
    c.y -= 0.1 * k;
  },
  tada(c) {
    const k = sm(0.15, 0.5, c.T) * (1 - sm(1.8, 2.3, c.T));
    arms(c, 2.4 * k, 1.0 * k, 0.1);
    c.t.spine[0] = -0.18 * k;
    c.t.head[0] = -0.25 * k;
    c.y += 0.04 * k;
    legs(c, 0, 0, 0.15);
  },

  // Joy
  cheer(c) {
    const hop = bounce(c.T * 5.5);
    arms(c, 2.75, 0.6 + sin(c.T * 11) * 0.18, 0.15);
    c.y += hop * 0.12;
    legs(c, 0.1 * (1 - hop), 0.5 * (1 - hop));
    c.t.head[0] = -0.2;
  },
  jump(c) {
    // Crouch, spring up with arms thrown wide, tuck, land.
    const up = hump(0.35, 1.05, c.T);
    const load = sm(0, 0.3, c.T) * (1 - sm(0.3, 0.4, c.T)) + sm(1.05, 1.15, c.T) * (1 - sm(1.15, 1.4, c.T));
    c.y += up * 0.55;
    crouch(c, load);
    legs(c, up * 0.45, up * 1.1 + load * 0.4);
    arms(c, 2.5 * up - 0.4 * load, 0.7 * up + 0.2);
  },
  fistpump(c) {
    const k = max(0, sin(c.T * 6));
    arm(c, 'R', 1.4 + 1.5 * k, 0.4, 1.3 - 0.9 * k);
    arm(c, 'L', 0.1, 0.12);
    c.y += k * 0.08;
    legs(c, 0.1, 0.3);
    c.t.spine[0] = -0.1 * k;
    c.t.head[0] = -0.2 * k;
  },
  raiseroof(c) {
    const k = sin(c.T * 7);
    arm(c, 'R', 1.6, 0.8, 1.35 + k * 0.45);
    arm(c, 'L', 1.6, 0.8, 1.35 - k * 0.45);
    // The wrists push upward in turn.
    c.t.shoulderR[0] += max(0, k) * 0.7;
    c.t.shoulderL[0] += max(0, -k) * 0.7;
    c.y += abs(sin(c.T * 3.5)) * 0.04;
    c.t.head[0] = -0.1;
    legs(c, 0.05, 0.2);
  },
  laugh(c) {
    const k = sin(c.T * 17);
    c.t.spine[0] = -0.25 + k * 0.06;
    c.t.head[0] = -0.35 + k * 0.05;
    arm(c, 'L', 1.1, -0.2, 1.7);
    arm(c, 'R', 0.9, 0.35, 1.2);
    c.t.chest[0] = k * 0.06;
    c.y += max(0, k) * 0.03;
    legs(c, 0.05, 0.15);
  },

  // Showing off
  flex(c) {
    const pump = 1 + 0.12 * sin(c.T * 8);
    const k = sm(0.1, 0.5, c.T) * (1 - sm(2, 2.35, c.T));
    arms(c, 0.15 * k, 1.35 * k, 2.35 * k * pump);
    c.t.chest[0] = -0.12 * k;
    c.t.head[0] = -0.1 * k;
    c.y += 0.02 * k;
    legs(c, 0.05 * k, 0.1 * k, 0.12 * k);
  },
  superhero(c) {
    // Fists on hips, chest out, chin up, the wind in the cape.
    const k = sm(0, 0.4, c.T) * (1 - sm(2, 2.35, c.T));
    arm(c, 'R', 0.2 * k, 0.75 * k, 1.5 * k);
    arm(c, 'L', 0.2 * k, 0.75 * k, 1.5 * k);
    legs(c, 0, 0, 0.2 * k);
    c.t.chest[0] = -0.18 * k;
    c.t.head[0] = -0.2 * k;
    c.t.head[1] = sin(c.T * 1.4) * 0.35 * k;
  },
  tpose(c) {
    const k = sm(0, 0.15, c.T) * (1 - sm(2.25, 2.4, c.T));
    arms(c, 0, PI / 2 * k, 0);
    c.t.head[0] = -0.1 * k;
    c.y += sin(c.T * 40) * 0.004 * k;
  },
  strut(c) {
    // A model's walk on the spot: hips swing, shoulders counter-swing.
    const s = sin(c.T * 5);
    leg(c, 'L', max(0, s) * 0.7 - 0.1, max(0, -s) * 0.5);
    leg(c, 'R', max(0, -s) * 0.7 - 0.1, max(0, s) * 0.5);
    c.t.hips[1] = s * 0.3;
    c.t.spine[1] = -s * 0.35;
    arm(c, 'L', -s * 0.6, 0.12, 0.4);
    arm(c, 'R', s * 0.6, 0.12, 0.4);
    c.t.head[1] = -s * 0.1;
    c.y += abs(cos(c.T * 5)) * 0.03;
  },

  // Dancing
  dance(c) {
    // The running man: knees pump alternately while the arms drive the other way.
    const s = sin(c.T * 7);
    leg(c, 'L', 0.2 + max(0, s) * 1.3, 0.2 + max(0, s) * 1.6);
    leg(c, 'R', 0.2 + max(0, -s) * 1.3, 0.2 + max(0, -s) * 1.6);
    arm(c, 'L', 0.85 - s * 0.5, 0.15, 1.5);
    arm(c, 'R', 0.85 + s * 0.5, 0.15, 1.5);
    c.t.spine[0] = 0.1;
    c.t.spine[1] = s * 0.2;
    c.y += abs(cos(c.T * 7)) * 0.07 - 0.04;
    c.z = 0;
  },
  disco(c) {
    // The point: one arm up across the sky, then down to the floor, on the beat.
    const up = sin(c.T * 4.2) > 0;
    const w = sm(-0.2, 0.2, sin(c.T * 4.2));
    arm(c, 'R', 0.9 + 1.9 * w, 0.55 - 0.1 * w, 0.05);
    arm(c, 'L', 0.05, -0.1);
    c.t.hips[2] = up ? 0.12 : -0.12;
    c.t.spine[2] = up ? -0.1 : 0.1;
    c.t.head[1] = up ? 0.3 : -0.2;
    c.t.head[2] = up ? -0.1 : 0.12;
    leg(c, 'L', 0, 0.3, 0.12);
    leg(c, 'R', 0.2, 0.3, 0.3);
    c.y += abs(sin(c.T * 4.2)) * 0.03;
  },
  twist(c) {
    const k = sin(c.T * 6);
    crouch(c, 0.5);
    c.t.hips[1] = k * 0.5;
    c.t.spine[1] = -k * 0.7;
    arm(c, 'L', 0.9, 0.5 - k * 0.2, 1.4);
    arm(c, 'R', 0.9, 0.5 + k * 0.2, 1.4);
    c.t.head[1] = k * 0.3;
  },
  sway(c) {
    // Slow side-to-side, both arms swaying overhead like a crowd at a concert.
    const w = sin(c.T * 3);
    arms(c, 2.7, 0.75, 0.2);
    c.t.shoulderL[2] += w * 0.2;
    c.t.shoulderR[2] += w * 0.2;
    c.t.hips[2] = w * 0.12;
    c.t.spine[2] = -w * 0.14;
    c.t.head[2] = w * 0.14;
    leg(c, 'L', 0, 0.2, 0.06 + max(0, w) * 0.1);
    leg(c, 'R', 0, 0.2, 0.06 + max(0, -w) * 0.1);
    c.y -= abs(w) * 0.02;
  },
  floss(c) {
    // Arms swing across the body, hips go the other way.
    const w = sin(c.T * 8);
    arm(c, 'R', 0.65, -0.35 * w, 0.15);
    arm(c, 'L', 0.65, 0.35 * w, 0.15);
    c.t.shoulderR[0] = 1.1 - 1.1 * w;
    c.t.shoulderL[0] = 1.1 + 1.1 * w;
    c.t.shoulderR[2] = -0.3;
    c.t.shoulderL[2] = 0.3;
    c.t.hips[2] = w * 0.3;
    c.t.hips[1] = -w * 0.3;
    c.t.spine[1] = w * 0.2;
    crouch(c, 0.35);
  },
  shuffle(c) {
    // Heel-toe slides and a lean, arms loose.
    const s = sin(c.T * 8);
    leg(c, 'L', 0.1 + max(0, s) * 0.4, 0.15 + max(0, s) * 0.6, 0.05 + max(0, s) * 0.2);
    leg(c, 'R', 0.1 + max(0, -s) * 0.4, 0.15 + max(0, -s) * 0.6, 0.05 + max(0, -s) * 0.2);
    c.t.hips[2] = s * 0.12;
    c.t.spine[0] = 0.2;
    arm(c, 'L', 0.8 + s * 0.4, 0.3, 1.2);
    arm(c, 'R', 0.8 - s * 0.4, 0.3, 1.2);
    c.t.head[0] = -0.1;
    c.y += abs(s) * 0.03 - 0.05;
  },
  moonwalk(c) {
    // Glide backwards on the balls of the feet, one arm swinging.
    const s = sin(c.T * 6);
    leg(c, 'L', max(0, s) * 0.5, max(0, -s) * 0.7 + 0.1);
    leg(c, 'R', max(0, -s) * 0.5, max(0, s) * 0.7 + 0.1);
    c.z = sm(0, 1.4, c.T) * 0.9 * (1 - sm(1.8, 2.4, c.T));
    arm(c, 'R', 0.4 + s * 0.5, 0.2, 0.4);
    arm(c, 'L', 0.4 - s * 0.5, 0.2, 0.4);
    c.t.head[0] = -0.1;
  },
  robot(c) {
    // Snaps between poses, held for a beat each.
    const step = Math.floor(c.T * 3.5) % 4;
    const A: [number, number, number, number][] = [
      [1.57, 1.57, 0.1, 1.57],
      [0.0, 1.57, 1.57, 0.1],
      [1.57, 0.1, 1.57, 1.57],
      [0.2, 1.57, 0.2, 1.57],
    ];
    const a = A[step];
    arm(c, 'L', a[0], 0.2, a[1]);
    arm(c, 'R', a[2], 0.2, a[3]);
    c.t.head[1] = [-0.45, 0, 0.45, 0][step];
    c.t.spine[1] = [0.15, -0.15, 0.15, -0.15][step];
    c.t.hips[1] = 0;
    leg(c, 'L', 0, 0.05);
    leg(c, 'R', 0, 0.05);
  },
  twirl(c) {
    // Slow pirouette on tiptoe with arms in a loose circle.
    c.spin = sm(0.2, 2.0, c.T) * PI * 2;
    arms(c, 1.5, 0.6, 0.5);
    c.t.shoulderL[0] = 2.3;
    c.t.shoulderR[0] = 1.2;
    leg(c, 'R', -0.2, 1.2);
    leg(c, 'L', 0, 0.05);
    c.y += 0.05;
  },
  spin(c) {
    // Two fast turns with arms wide, then a stop and a pose.
    c.spin = sm(0, 1.7, c.T) * PI * 4;
    const stop = sm(1.7, 1.9, c.T);
    arms(c, 0.1 + stop * 2.4, 1.45 - stop * 0.8, 0);
    legs(c, 0, 0.15, 0.1);
    c.y += hump(0, 1.7, c.T) * 0.05;
    c.t.spine[2] = (1 - stop) * 0.12;
  },
  windmill(c) {
    // Arms pump up and down alternately.
    const a = c.T * 7;
    arm(c, 'L', 1.2 + sin(a) * 1.0, 0.6, 0.1);
    arm(c, 'R', 1.2 - sin(a) * 1.0, 0.6, 0.1);
    c.t.spine[1] = sin(a) * 0.15;
    legs(c, 0.1, 0.25, 0.1);
    c.y -= 0.03;
  },
  chicken(c) {
    // Elbows flap, knees bob, head pecks.
    const k = abs(sin(c.T * 9));
    arm(c, 'L', 0.35, 0.35 + k * 0.8, 2.3);
    arm(c, 'R', 0.35, 0.35 + k * 0.8, 2.3);
    c.t.head[0] = max(0, sin(c.T * 9)) * 0.35;
    c.t.spine[0] = 0.15;
    crouch(c, 0.5 + k * 0.2);
  },
  twostep(c) {
    // Step-touch with a snap: feet go out and in, hands clap overhead on the touch.
    const s = sin(c.T * 5);
    leg(c, 'R', 0.05, 0.1, 0.1 + max(0, s) * 0.35);
    leg(c, 'L', 0.05, 0.1, 0.1 + max(0, -s) * 0.35);
    const hit = abs(sin(c.T * 5));
    arm(c, 'L', 2.2, 0.55 - hit * 0.45, 0.4 + hit * 0.2);
    arm(c, 'R', 2.2, 0.55 - hit * 0.45, 0.4 + hit * 0.2);
    c.t.hips[2] = s * 0.1;
    c.y += (1 - hit) * 0.04;
  },
  marching(c) {
    const s = sin(c.T * 6);
    leg(c, 'L', max(0, s) * 1.45, max(0, s) * 1.5);
    leg(c, 'R', max(0, -s) * 1.45, max(0, -s) * 1.5);
    arm(c, 'L', -s * 0.9, 0.1, 0.3);
    arm(c, 'R', s * 0.9, 0.1, 0.3);
    c.t.chest[0] = -0.08;
    c.t.head[0] = -0.1;
    c.y += abs(cos(c.T * 6)) * 0.03;
  },
  jacks(c) {
    // Jumping jacks: feet apart and arms up, then together and arms down.
    const o = (sin(c.T * 7) + 1) / 2;
    arms(c, 0.08 + 2.55 * o, 0.12 + 0.55 * o, 0);
    legs(c, 0, 0.1 * (1 - o), 0.05 + 0.32 * o);
    c.y += (1 - abs(o * 2 - 1)) * 0.0 + abs(cos(c.T * 7)) * 0.1;
  },

  // Gestures
  clap(c) {
    // Hands in front of the chest, clapping on a bounce.
    const hit = abs(sin(c.T * 7));
    arms(c, 1.3, 0.28 * (1 - hit) + 0.02, 1.2);
    c.t.shoulderR[2] = -0.3 + 0.3 * hit - 0.05 + 0.05;
    c.t.shoulderL[2] = 0.3 - 0.3 * hit + 0.05 - 0.05;
    c.y += (1 - hit) * 0.03;
    c.t.head[0] = 0.1 * hit;
  },
  point(c) {
    const k = sm(0.1, 0.4, c.T) * (1 - sm(2, 2.35, c.T));
    arm(c, 'R', 1.55 * k, 0.12 * k, 0.05);
    arm(c, 'L', 0.05, 0.1);
    c.t.head[1] = -0.2 * k;
    c.t.spine[1] = -0.2 * k;
    c.t.head[0] = sin(c.T * 5) * 0.08 * k;
    leg(c, 'L', 0.2 * k, 0.1);
  },
  shrug(c) {
    const k = sm(0.1, 0.4, c.T) * (1 - sm(1.9, 2.3, c.T));
    arms(c, 0.5 * k, 0.55 * k, 1.5 * k);
    c.t.head[2] = 0.2 * k;
    c.t.head[0] = -0.05 * k;
    c.t.chest[2] = 0.05 * k;
    c.y += 0.02 * k;
  },
  facepalm(c) {
    const k = sm(0.15, 0.55, c.T) * (1 - sm(1.8, 2.3, c.T));
    arm(c, 'R', 1.0 * k, -0.1 * k, 2.3 * k);
    arm(c, 'L', 0.05, 0.1);
    c.t.head[0] = 0.28 * k;
    c.t.head[1] = sin(c.T * 3) * 0.12 * k;
    c.t.spine[0] = 0.18 * k;
  },
  think(c) {
    // One hand on the chin, the other arm propping its elbow, head tilted.
    const k = sm(0.1, 0.5, c.T) * (1 - sm(1.9, 2.3, c.T));
    arm(c, 'R', 1.0 * k, -0.15 * k, 2.4 * k);
    arm(c, 'L', 0.65 * k, -0.3 * k, 1.5 * k);
    c.t.head[0] = -0.1 * k;
    c.t.head[2] = 0.18 * k;
    c.t.head[1] = sin(c.T * 1.5) * 0.2 * k;
    leg(c, 'R', 0.08 * k, 0.1);
  },
  heart(c) {
    // Hands meet in front of the chest in a heart, with a gentle pulse.
    const k = sm(0.1, 0.5, c.T) * (1 - sm(1.9, 2.3, c.T));
    const pulse = 1 + sin(c.T * 7) * 0.08;
    arm(c, 'L', 1.25 * k * pulse, -0.5 * k, 1.5 * k);
    arm(c, 'R', 1.25 * k * pulse, -0.5 * k, 1.5 * k);
    c.t.head[2] = sin(c.T * 3) * 0.1 * k;
    c.y += abs(sin(c.T * 3.5)) * 0.03 * k;
  },
  peace(c) {
    // Relaxed pose, one arm out in front in a peace sign, other hand on the hip.
    const k = sm(0.1, 0.4, c.T) * (1 - sm(2, 2.35, c.T));
    arm(c, 'R', 1.5 * k, 0.5 * k, 0.9 * k);
    arm(c, 'L', 0.2 * k, 0.75 * k, 1.5 * k);
    c.t.head[2] = -0.2 * k;
    c.t.hips[2] = 0.08 * k;
    leg(c, 'R', 0.05, 0.1, 0.22 * k);
  },
  rockon(c) {
    // Horns up, head banging.
    const b = sin(c.T * 8);
    arm(c, 'R', 1.9, 0.6, 1.0 + 0.1 * b);
    arm(c, 'L', 0.1, 0.15);
    c.t.head[0] = 0.3 * b + 0.1;
    c.t.spine[0] = 0.15 + 0.1 * b;
    crouch(c, 0.4);
  },
  victory(c) {
    arms(c, 2.8, 0.55, 0);
    c.y += bounce(c.T * 5) * 0.14;
    c.t.head[0] = -0.2;
    legs(c, 0.05, 0.15, 0.1);
  },
  defeat(c) {
    c.t.head[0] = 0.55;
    c.t.spine[0] = 0.3;
    arms(c, 0.08, 0.15, 0.1);
    c.y -= 0.05;
    legs(c, 0.05, 0.15);
  },

  // Playing instruments, sports and sillier things
  guitar(c) {
    // The neck arm out left, the strumming arm sweeping, knees bent and head thrown back on the downbeat.
    const s = sin(c.T * 12);
    arm(c, 'L', 1.1, 0.4, 0.45);
    arm(c, 'R', 0.55, -0.15, 1.35 + s * 0.35);
    c.t.spine[0] = -0.12;
    c.t.head[0] = sin(c.T * 6) * 0.14;
    c.t.hips[1] = 0.25;
    crouch(c, 0.45);
  },
  drums(c) {
    const k = sin(c.T * 10);
    arm(c, 'L', 1.15 + max(0, k) * 0.55, 0.28, 1.2 - max(0, k) * 0.8);
    arm(c, 'R', 1.15 + max(0, -k) * 0.55, 0.28, 1.2 - max(0, -k) * 0.8);
    c.t.head[0] = abs(sin(c.T * 5)) * 0.18;
    leg(c, 'R', 0.25 + abs(sin(c.T * 5)) * 0.15, 0.25);
    leg(c, 'L', 0.1, 0.15);
    c.y -= 0.04;
  },
  conduct(c) {
    // Baton hand sweeping figure-eights, the other hand cueing.
    arm(c, 'R', 1.5 + sin(c.T * 3) * 0.35, 0.35 + cos(c.T * 3) * 0.3, 0.7);
    arm(c, 'L', 1.1 + sin(c.T * 3 + 2) * 0.25, 0.4, 1.0);
    c.t.head[2] = cos(c.T * 3) * 0.1;
    c.t.spine[1] = sin(c.T * 3) * 0.12;
    c.t.hips[2] = sin(c.T * 3) * 0.05;
  },
  boxing(c) {
    // Shadow boxing: bounce on the toes, alternate jabs.
    const j = sin(c.T * 8);
    arm(c, 'R', 1.45 + max(0, j) * 0.1, -0.1, 1.95 - max(0, j) * 1.85);
    arm(c, 'L', 1.45 + max(0, -j) * 0.1, -0.1, 1.95 - max(0, -j) * 1.85);
    c.t.spine[1] = j * 0.25;
    c.t.head[0] = 0.1;
    crouch(c, 0.35);
    c.y += abs(sin(c.T * 5)) * 0.04;
  },
  karate(c) {
    // Wide stance, alternating chops.
    const j = sin(c.T * 5);
    legs(c, 0.45, 0.8, 0.45);
    c.y -= 0.14;
    arm(c, 'R', 1.5 - max(0, j) * 0.3, 0.1 + max(0, j) * 0.25, 0.3 + (1 - max(0, j)) * 1.2);
    arm(c, 'L', 1.5 - max(0, -j) * 0.3, 0.1 + max(0, -j) * 0.25, 0.3 + (1 - max(0, -j)) * 1.2);
    c.t.spine[1] = j * 0.3;
    c.t.head[1] = -j * 0.2;
  },
  kick(c) {
    // Soccer kicks: wind up the leg, swing through.
    const s = sin(c.T * 4.5);
    leg(c, 'R', max(0, s) * 1.45 - max(0, -s) * 0.7, max(0, -s) * 1.5 + 0.1);
    leg(c, 'L', 0.05, 0.25);
    arm(c, 'L', 0.8, 0.75, 0.3);
    arm(c, 'R', -0.2, 0.55, 0.3);
    c.t.spine[0] = -0.1 * max(0, s);
    c.t.hips[1] = -0.2 * max(0, s);
  },
  swim(c) {
    // Freestyle on the spot, leaning over into the stroke.
    const a = c.T * 5;
    c.t.spine[0] = 0.55;
    c.t.head[0] = -0.5;
    arm(c, 'R', 1.5 + sin(a) * 1.5, 0.7, 0.4 + max(0, cos(a)) * 0.6);
    arm(c, 'L', 1.5 + sin(a + PI) * 1.5, 0.7, 0.4 + max(0, -cos(a)) * 0.6);
    leg(c, 'L', sin(a * 2) * 0.35, 0.2);
    leg(c, 'R', -sin(a * 2) * 0.35, 0.2);
    c.y -= 0.05;
  },
  lasso(c) {
    // A lasso whirled overhead.
    const a = c.T * 9;
    arm(c, 'R', 2.5, 0.6 + sin(a) * 0.12, 0.5 + cos(a) * 0.15);
    c.t.shoulderR[1] = cos(a) * 0.2;
    arm(c, 'L', 0.1, 0.15);
    crouch(c, 0.4);
    c.t.spine[2] = sin(a) * 0.05;
    c.t.spine[1] = sin(c.T * 2) * 0.1;
    c.y += abs(sin(a / 2)) * 0.03;
  },
  zombie(c) {
    // Arms out, head lolling, shuffle.
    const s = sin(c.T * 3.5);
    arms(c, 1.45, 0.1, 0.1);
    c.t.head[2] = 0.35 + sin(c.T * 2) * 0.1;
    c.t.head[0] = 0.25;
    c.t.spine[0] = 0.22;
    leg(c, 'L', max(0, s) * 0.5, max(0, s) * 0.5 + 0.1);
    leg(c, 'R', max(0, -s) * 0.5, max(0, -s) * 0.5 + 0.1);
    c.t.hips[1] = s * 0.15;
    c.y -= 0.02;
  },
  sneak(c) {
    // Creeping low with a finger to the lips, then a look over each shoulder.
    crouch(c, 0.9);
    const s = sin(c.T * 4);
    leg(c, 'L', 0.55 + max(0, s) * 0.6, 1.1 + max(0, s) * 0.5);
    leg(c, 'R', 0.55 + max(0, -s) * 0.6, 1.1 + max(0, -s) * 0.5);
    arm(c, 'R', 1.2, -0.3, 2.4);
    arm(c, 'L', 0.5, 0.45, 0.9);
    c.t.head[1] = sin(c.T * 2.2) * 0.7;
    c.t.spine[0] = 0.35;
  },
  tantrum(c) {
    // Stomping in place, fists pounding.
    const s = sin(c.T * 8);
    leg(c, 'L', max(0, s) * 0.55, max(0, s) * 0.5);
    leg(c, 'R', max(0, -s) * 0.55, max(0, -s) * 0.5);
    arm(c, 'L', 0.2 + max(0, s) * 0.8, 0.4, 0.6);
    arm(c, 'R', 0.2 + max(0, -s) * 0.8, 0.4, 0.6);
    c.t.head[0] = 0.25;
    c.t.spine[0] = 0.15;
    c.y += abs(cos(c.T * 8)) * 0.04 - 0.04;
  },
  dab(c) {
    // Head dropped into the bent elbow, the other arm shooting out and up.
    const k = sm(0.1, 0.35, c.T) * (1 - sm(2, 2.35, c.T));
    arm(c, 'L', 1.4 * k, -0.2 * k, 2.4 * k);
    arm(c, 'R', 2.2 * k, 0.75 * k, 0.05);
    c.t.head[0] = 0.35 * k;
    c.t.head[1] = 0.55 * k;
    c.t.spine[1] = 0.15 * k;
    c.t.spine[2] = -0.05 * k;
  },
  sprinkler(c) {
    // One hand behind the neck, the other arm out, jerking round in little steps.
    const step = Math.floor(c.T * 5.5) % 6;
    arm(c, 'L', 2.0, 0.85, 2.3);
    arm(c, 'R', 1.5, 0.15 + step * 0.0, 0.1);
    c.t.spine[1] = -0.7 + step * 0.28;
    c.t.head[1] = -0.5 + step * 0.2;
    c.t.hips[1] = -0.2 + step * 0.08;
    leg(c, 'L', 0.1, 0.2);
    leg(c, 'R', 0.05, 0.1, 0.12);
  },

  // Winding down
  stretch(c) {
    // Arms up and clasped overhead, leaning side to side.
    const w = sin(c.T * 1.6);
    arms(c, 2.95, 0.4, 0.15);
    c.t.spine[2] = w * 0.3;
    c.t.chest[2] = w * 0.15;
    c.t.head[2] = w * 0.1;
    c.t.hips[2] = -w * 0.08;
    c.y += 0.02;
  },
  yawn(c) {
    // A huge stretch, one hand finally covering the mouth.
    const open = hump(0.1, 1.3, c.T);
    const cover = sm(1.2, 1.6, c.T) * (1 - sm(1.9, 2.3, c.T));
    arms(c, 2.5 * open, 0.6 * open, 0.3);
    arm(c, 'R', 1.0 * cover + 2.5 * open * (1 - cover), 0.6 * open * (1 - cover) - 0.25 * cover, 2.3 * cover + 0.3 * open * (1 - cover));
    c.t.head[0] = -0.4 * open + 0.25 * cover;
    c.t.spine[0] = -0.2 * open;
  },
  sleepy(c) {
    // Dozing on your feet: the head drops, jerks up, drifts down again.
    const d = sm(0, 0.9, c.T % 1.2) * (1 - sm(1.0, 1.05, c.T % 1.2));
    arms(c, 0.05, 0.1, 0.15);
    c.t.head[0] = 0.15 + d * 0.55;
    c.t.spine[0] = 0.08 + d * 0.15;
    c.t.hips[2] = sin(c.T * 1.8) * 0.04;
    legs(c, 0, 0.1);
  },
  sit(c) {
    // Take a seat on thin air, knees up, hands on the knees.
    const k = sm(0, 0.45, c.T) * (1 - sm(1.95, 2.35, c.T));
    legs(c, 1.5 * k, 1.5 * k);
    arm(c, 'L', 0.9 * k, 0.12 * k, 0.5 * k);
    arm(c, 'R', 0.9 * k, 0.12 * k, 0.5 * k);
    c.y -= 0.42 * k;
    c.t.head[0] = -0.05 * k;
    c.t.spine[0] = -0.1 * k;
  },
  kneel(c) {
    // Down on one knee, head bowed, one hand on the raised knee.
    const k = sm(0, 0.5, c.T) * (1 - sm(1.9, 2.35, c.T));
    leg(c, 'L', 1.5 * k, 1.5 * k);
    leg(c, 'R', -0.15 * k, 1.7 * k);
    arm(c, 'L', 0.9 * k, 0.15 * k, 0.6 * k);
    arm(c, 'R', 0.3 * k, 0.2 * k, 0.5 * k);
    c.t.head[0] = 0.3 * k;
    c.t.spine[0] = 0.1 * k;
    c.y -= 0.36 * k;
  },
  backflip(c) {
    // Crouch, launch, one full somersault, land.
    const f = sm(0.45, 1.35, c.T);
    const air = sin(f * PI);
    const load = sm(0, 0.4, c.T) * (1 - sm(0.4, 0.5, c.T)) + sm(1.35, 1.45, c.T) * (1 - sm(1.45, 1.8, c.T));
    c.flip = f;
    c.y += air * 0.85;
    crouch(c, load);
    legs(c, 1.2 * air + 0.55 * load, 1.4 * air + 1.1 * load);
    arms(c, 2.7 * air - 0.5 * load, 0.2, 0.2);
  },
};

export const MOVE_IDS = Object.keys(EMOTE_MOVES);
