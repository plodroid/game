import type { Room } from '@colyseus/sdk';
import {
  BTN,
  createPlayerState,
  DT,
  forEachPellet,
  GameWorld,
  hash2,
  MAPS,
  MSG,
  muzzle,
  packInput,
  PHASES,
  straightTime,
  stepMovement,
  TICK_RATE,
  unpackEffect,
  unpackEvent,
  unpackPlayer,
  v3,
  WEAPONS,
  BEACON_LAUNCH,
  SPECIALS,
  type Effect,
  type Input,
  type Launcher,
  type MatchConfig,
  type MatchEnd,
  type MatchStart,
  type Phase,
  type PlayerState,
  type SimEvent,
  type Snapshot,
  type Team,
  type Vec3,
  type WeaponId,
} from '@chromashift/shared';
import type { FrameInput, MatchOutcome, MatchSource, ProjectileView, ViewPlayer } from '../game/source';

/** Remote players are drawn this many ticks in the past (≈100 ms) for smooth interpolation. */
const INTERP_TICKS = 6;

interface Remote {
  view: ViewPlayer;
  buf: { k: number; s: PlayerState }[];
}

interface Cosmetic extends ProjectileView {
  age: number;
}

/**
 * Network match: the server is authoritative. The local player is predicted with the same
 * movement code and reconciled against each snapshot; everyone else is interpolated.
 */
export class OnlineSource implements MatchSource {
  readonly online = true;
  readonly world: GameWorld;
  readonly config: MatchConfig;
  readonly localId: number;
  private view: ViewPlayer[] = [];
  private remotes = new Map<number, Remote>();
  private local: PlayerState;
  private localView: ViewPlayer;
  private collider;
  private history: Input[] = [];
  private seq = 0;
  private acc = 0;
  private outBuf: number[][] = [];
  private sendT = 0;
  private cosmetics: Cosmetic[] = [];
  private fx: Effect[] = [];
  private ph: Phase = 'intro';
  private pt = 0;
  private tl = 0;
  private sc: [number, number] = [0, 0];
  private ho: number[] = [];
  private events: SimEvent[] = [];
  private latestK = 0;
  private renderK = -1;
  private outcomeData: MatchOutcome | null = null;
  private launchers: Launcher[] = [];
  private corr = v3();
  private repaint = false;
  private pingMs: number | null = null;
  private pingTimer: number;
  private lastSnapAt = performance.now();
  private prevFireButtons = 0;
  private offs: (() => void)[] = [];

  constructor(
    private room: Room,
    start: MatchStart,
  ) {
    this.config = start.config;
    this.localId = start.you;
    this.world = new GameWorld(MAPS[this.config.map]);
    this.collider = this.world.createPlayerCollider();
    const mine = start.players.find((p) => p.id === start.you) ?? start.players[0];
    this.local = createPlayerState(mine);
    this.localView = { id: mine.id, info: mine, state: this.local, pos: v3(), stats: { kills: 0, deaths: 0, assists: 0, paint: 0, specials: 0 } };
    this.view.push(this.localView);
    for (const info of start.players) {
      if (info.id === start.you) continue;
      const s = createPlayerState(info);
      const view: ViewPlayer = { id: info.id, info, state: s, pos: v3(), stats: { kills: 0, deaths: 0, assists: 0, paint: 0, specials: 0 } };
      this.remotes.set(info.id, { view, buf: [] });
      this.view.push(view);
    }
    this.offs.push(room.onMessage(MSG.SNAP, (s: Snapshot) => this.onSnap(s)));
    this.offs.push(
      room.onMessage(MSG.SYNC, (s: { rle: number[] }) => {
        this.world.grid.decode(s.rle);
        this.repaint = true;
      }),
    );
    this.offs.push(
      room.onMessage(MSG.END, (e: MatchEnd) => {
        this.outcomeData = { result: e.result, xp: e.xp[this.localId] ?? 0, recorded: e.recorded };
      }),
    );
    const ping = () => room.ping((ms) => (this.pingMs = ms));
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  private onSnap(s: Snapshot) {
    this.lastSnapAt = performance.now();
    this.latestK = s.k;
    if (this.renderK < 0) this.renderK = s.k - INTERP_TICKS;
    this.ph = PHASES[s.ph] ?? 'playing';
    this.tl = s.tl / 10;
    this.pt = s.pt / 10;
    this.sc = [s.sc[0] / 100, s.sc[1] / 100];
    this.ho = s.ho;
    for (const raw of s.e) {
      const e = unpackEvent(raw);
      if (!e) continue;
      if (e.t === 'paint') this.world.grid.paintSphere(e, e.r, e.team);
      // Our own shots and empty clicks were already shown when we pressed fire.
      if ((e.t === 'fire' || e.t === 'empty') && e.id === this.localId) continue;
      if (e.t === 'fire') {
        const r = this.remotes.get(e.id);
        if (r) this.spawnCosmetic(e.w, e, e.yaw, e.pitch, e.seed, r.view.info.team);
      }
      this.events.push(e);
    }
    this.fx = s.fx.map(unpackEffect);
    for (const arr of s.p) {
      const id = arr[0];
      if (id === this.localId) this.reconcile(arr);
      else {
        const r = this.remotes.get(id);
        if (!r) continue;
        const st = r.buf.length >= 10 ? r.buf.shift()!.s : createPlayerState(r.view.info);
        unpackPlayer(arr, st);
        r.buf.push({ k: s.k, s: st });
      }
    }
    for (const row of s.st ?? []) {
      const v = row[0] === this.localId ? this.localView : this.remotes.get(row[0])?.view;
      if (!v) continue;
      v.stats.kills = row[1];
      v.stats.deaths = row[2];
      v.stats.assists = row[3];
      v.stats.paint = row[4];
    }
  }

  /** Snap to the server's state, then replay inputs it hasn't processed yet. */
  private reconcile(arr: number[]) {
    const L = this.local;
    const bx = L.pos.x, by = L.pos.y, bz = L.pos.z;
    const wasAlive = L.alive;
    unpackPlayer(arr, L);
    this.history = this.history.filter((i) => i.seq > L.lastSeq);
    if (L.alive) {
      this.collectLaunchers();
      const frozen = this.ph !== 'playing';
      for (const i of this.history) {
        L.firing = !!(i.buttons & BTN.FIRE) && !frozen;
        stepMovement(this.world, L, this.collider, i, DT, frozen, this.launchers);
      }
    }
    const dx = bx - L.pos.x, dy = by - L.pos.y, dz = bz - L.pos.z;
    // Small errors are smoothed out visually; teleports (respawn, big corrections) snap.
    if (wasAlive && L.alive && Math.hypot(dx, dy, dz) < 2) {
      this.corr.x += dx;
      this.corr.y += dy;
      this.corr.z += dz;
    } else this.corr.x = this.corr.y = this.corr.z = 0;
  }

  private collectLaunchers() {
    this.launchers.length = 0;
    for (const p of this.world.map.pads) this.launchers.push({ ...p, team: -1 });
    for (const e of this.fx)
      if (e.kind === 'beacon')
        this.launchers.push({ x: e.pos.x, y: e.pos.y, z: e.pos.z, r: SPECIALS.beacon.radius, vx: 0, vy: BEACON_LAUNCH, vz: 0, team: e.team });
  }

  private spawnCosmetic(w: WeaponId, o: Vec3, yaw: number, pitch: number, seed: number, team: Team) {
    forEachPellet(WEAPONS[w], yaw, pitch, seed, (d, speed) => {
      this.cosmetics.push({ pos: { x: o.x, y: o.y, z: o.z }, vel: { x: d.x * speed, y: d.y * speed, z: d.z * speed }, team, weapon: w, age: 0 });
    });
  }

  private stepCosmetics(dt: number) {
    const list = this.cosmetics;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const w = WEAPONS[p.weapon];
      const st = straightTime(w);
      const falling = p.age > st;
      p.age += dt;
      p.vel.y -= (falling ? w.gravity : 2.5) * dt;
      if (falling && w.kind !== 'lobber') {
        p.vel.x *= 1 - 2.2 * dt;
        p.vel.z *= 1 - 2.2 * dt;
      }
      const len = Math.hypot(p.vel.x, p.vel.y, p.vel.z) * dt;
      const d = { x: (p.vel.x * dt) / len, y: (p.vel.y * dt) / len, z: (p.vel.z * dt) / len };
      if ((w.burstAtRange && falling) || this.world.raycast(p.pos, d, len + 0.05) || p.age > st + 2.5) {
        list.splice(i, 1);
        continue;
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
    }
  }

  /** Mirrors the server's fire cadence so our own shots appear instantly. */
  private predictFire(i: Input, frozen: boolean) {
    const L = this.local;
    const w = WEAPONS[L.weapon];
    const pressed = i.buttons & ~this.prevFireButtons;
    this.prevFireButtons = i.buttons;
    L.fireCd -= DT;
    if (frozen || !(i.buttons & BTN.FIRE)) {
      if (L.fireCd < -DT) L.fireCd = 0;
      return;
    }
    const ready = w.kind === 'roller' ? pressed & BTN.FIRE && L.fireCd <= 0 : L.fireCd <= 0;
    if (!ready) return;
    if (L.ink < w.inkPerShot) {
      L.fireCd = 0.4;
      this.events.push({ t: 'empty', id: L.id });
      return;
    }
    L.ink -= w.inkPerShot;
    L.sinceFire = 0;
    L.fireCd = Math.max(L.fireCd, 0) + w.fireInterval;
    const n = L.shots++;
    const seed = hash2(L.id, n);
    const o = muzzle(v3(), L.pos, L.yaw, w, n);
    this.spawnCosmetic(w.id, o, i.aimYaw, i.aimPitch, seed, L.team);
    this.events.push({ t: 'fire', id: L.id, w: w.id, x: o.x, y: o.y, z: o.z, yaw: i.aimYaw, pitch: i.aimPitch, seed, n });
  }

  update(dt: number, inp: FrameInput): SimEvent[] {
    const L = this.local;
    this.acc = Math.min(this.acc + dt, 0.2);
    this.collectLaunchers();
    while (this.acc >= DT) {
      const i: Input = { seq: ++this.seq, mx: inp.mx, mz: inp.mz, yaw: inp.yaw, pitch: inp.pitch, aimYaw: inp.aimYaw, aimPitch: inp.aimPitch, buttons: inp.buttons };
      inp.consume();
      this.history.push(i);
      if (this.history.length > 180) this.history.shift();
      this.outBuf.push(packInput(i));
      const frozen = this.ph !== 'playing';
      if (L.alive) {
        this.predictFire(i, frozen);
        L.firing = !!(i.buttons & BTN.FIRE) && !frozen;
        stepMovement(this.world, L, this.collider, i, DT, frozen, this.launchers);
      }
      this.stepCosmetics(DT);
      this.acc -= DT;
    }
    this.sendT += dt;
    if (this.sendT >= 1 / 30 && this.outBuf.length) {
      this.room.send(MSG.INPUT, this.outBuf);
      this.outBuf = [];
      this.sendT = 0;
    }

    // Interpolate remote players a little in the past, nudging the clock towards the server.
    this.renderK += dt * TICK_RATE;
    const target = this.latestK - INTERP_TICKS;
    if (Math.abs(this.renderK - target) > 30) this.renderK = target;
    else this.renderK += (target - this.renderK) * 0.05;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let j = 0; j < b.length - 1; j++)
        if (b[j].k <= this.renderK && b[j + 1].k >= this.renderK) {
          a = b[j];
          c = b[j + 1];
          break;
        }
      const t = c.k > a.k ? Math.min(1, Math.max(0, (this.renderK - a.k) / (c.k - a.k))) : 1;
      const s = r.view.state;
      Object.assign(s, t < 0.5 ? a.s : c.s, { pos: s.pos, vel: s.vel, dodgeDir: s.dodgeDir });
      const far = Math.abs(c.s.pos.x - a.s.pos.x) + Math.abs(c.s.pos.z - a.s.pos.z) > 4;
      const k = far ? 1 : t;
      for (const ax of ['x', 'y', 'z'] as const) {
        s.pos[ax] = a.s.pos[ax] + (c.s.pos[ax] - a.s.pos[ax]) * k;
        s.vel[ax] = a.s.vel[ax] + (c.s.vel[ax] - a.s.vel[ax]) * k;
      }
      s.dodgeDir.x = c.s.dodgeDir.x;
      s.dodgeDir.z = c.s.dodgeDir.z;
      let dy = c.s.aimYaw - a.s.aimYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      s.aimYaw = a.s.aimYaw + dy * k;
      s.aimPitch = a.s.aimPitch + (c.s.aimPitch - a.s.aimPitch) * k;
      r.view.pos.x = s.pos.x;
      r.view.pos.y = s.pos.y;
      r.view.pos.z = s.pos.z;
    }
    const f = Math.exp(-10 * dt);
    this.corr.x *= f;
    this.corr.y *= f;
    this.corr.z *= f;
    this.localView.pos.x = L.pos.x + this.corr.x;
    this.localView.pos.y = L.pos.y + this.corr.y;
    this.localView.pos.z = L.pos.z + this.corr.z;
    const out = this.events;
    this.events = [];
    return out;
  }

  consumeRepaint() {
    const r = this.repaint;
    this.repaint = false;
    return r;
  }

  players() {
    return this.view;
  }
  projectiles() {
    return this.cosmetics;
  }
  effects() {
    return this.fx;
  }
  phase() {
    return this.ph;
  }
  phaseT() {
    return this.pt;
  }
  timeLeft() {
    return this.tl;
  }
  score() {
    return this.sc;
  }
  holders() {
    return this.ho;
  }
  outcome() {
    return this.ph === 'ended' ? this.outcomeData : null;
  }
  ping() {
    // No snapshot for two seconds means the link is down, whatever the last ping said.
    return performance.now() - this.lastSnapAt > 2000 ? null : this.pingMs;
  }
  dispose() {
    clearInterval(this.pingTimer);
    for (const off of this.offs) off();
    this.world.dispose();
  }
}

