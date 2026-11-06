import * as THREE from 'three';
import {
  dirFromAngles,
  FEET_OFFSET,
  forwardXZ,
  INTRO_TIME,
  MAX_INK,
  muzzle,
  OUTRO_TIME,
  PAINT_KIND,
  pitchOf,
  rightXZ,
  SPECIALS,
  v3,
  WEAPONS,
  yawOf,
  type SimEvent,
  type Vec3,
} from '@chromashift/shared';
import { audio } from '../audio/audio';
import { Animator, type AnimState } from '../characters/animator';
import { buildCharacter, type Rig } from '../characters/model';
import { buildEnvironment, type Environment } from '../rendering/environment';
import { Effects } from '../rendering/effects';
import { buildMapMeshes } from '../rendering/mapMesh';
import { PaintAtlas, type PaintUniforms } from '../rendering/paintAtlas';
import { teamColors, teamNames } from '../rendering/palette';
import { Post } from '../rendering/post';
import { prefersReducedMotion, useSettings, type GraphicsSettings } from '../settings/settings';
import { useHud, useUi, type BoardRow, type FeedItem } from '../state/ui';
import { useChat } from '../state/chat';
import { proximityGain, voice, useVoice } from '../multiplayer/voice';
import { ThirdPersonCamera } from './camera';
import { engine, type View } from './engine';
import { touch } from './input';
import type { FrameInput, MatchOutcome, MatchSource, ViewPlayer } from './source';

interface CharView {
  rig: Rig;
  anim: Animator;
  tag: Tag | null;
  yaw: number;
  wasAlive: boolean;
  wasDiving: boolean;
  wasGrounded: boolean;
  rippleT: number;
  team: number;
}

const tmp = new THREE.Vector3(), tmp2 = v3(), camDir = v3(), aimPt = v3(), muz = v3(), fwd = v3(), right = v3();
const KILL_CAUSE: Record<string, string> = { fall: 'fell', special: 'special' };

/** Renders and drives one match from any MatchSource (offline simulation or network). */
export class MatchView implements View {
  readonly kind = 'match';
  private scene = new THREE.Scene();
  private cam: ThirdPersonCamera;
  private atlas: PaintAtlas;
  private env: Environment;
  private fx: Effects;
  private mapGroup: THREE.Group;
  private post: Post;
  private chars = new Map<number, CharView>();
  private colors: [THREE.Color, THREE.Color];
  private uniforms: PaintUniforms;
  private deco: THREE.Object3D[] = [];
  private zoneMeshes: THREE.Mesh[] = [];
  private hudT = 0;
  private feed: FeedItem[] = [];
  private feedId = 1;
  private lastCount = -1;
  private minuteWarned = false;
  private splatBudget = 0;
  private hurt: { id: number; angle: number; t: number }[] = [];
  private cues: { id: number; angle: number; t: number }[] = [];
  private deathAt: Vec3 | null = null;
  private killer = -1;
  private ended = false;
  private swimT = 0;
  private frame = 0;
  private notice: { id: number; text: string; tone: 'neutral' | 'good' | 'bad'; t: number } | null = null;
  private caption: { text: string; t: number } | null = null;
  private input: FrameInput;
  /** Scratch camera for intro/outro shots (a camera so lookAt aims -Z like the real one). */
  private shot = new THREE.PerspectiveCamera();

  constructor(
    readonly source: MatchSource,
    private onEnd: (o: MatchOutcome) => void,
  ) {
    const g = useSettings.getState().graphics;
    const r = engine.renderer;
    const map = source.world.map;
    this.colors = teamColors();
    this.cam = new ThirdPersonCamera(engine.aspect, Math.max(200, g.drawDistance * 1.6));
    this.atlas = new PaintAtlas(r, source.world.grid, g.paintQuality);
    this.atlas.rebuildFromGrid();
    this.uniforms = {
      paintMap: { value: this.atlas.target.texture },
      teamA: { value: this.colors[0] },
      teamB: { value: this.colors[1] },
      paintTexel: { value: new THREE.Vector2(1 / this.atlas.width, 1 / this.atlas.height) },
      paintRelief: { value: 1.8 },
    };
    const shading = g.paintQuality === 0 ? 0 : g.paintQuality === 1 ? 1 : 2;
    this.env = buildEnvironment(this.scene, r, map, {
      shadowQuality: g.shadowQuality,
      shadowResolution: g.shadowResolution,
      drawDistance: g.drawDistance,
      reflections: g.reflections,
      lambert: shading === 0,
    });
    this.mapGroup = buildMapMeshes(source.world, map.theme, this.uniforms, {
      textureQuality: g.textureQuality,
      shading,
      aoRays: [0, 4, 6, 7][g.textureQuality],
      anisotropy: g.textureQuality >= 2 ? Math.min(8, r.capabilities.getMaxAnisotropy()) : 1,
      shadows: g.shadowQuality > 0,
    });
    this.scene.add(this.mapGroup);
    this.fx = new Effects(this.scene, g.particles, this.colors);
    this.buildDecor();
    this.post = new Post(r, this.scene, this.cam.camera, g);
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;

    const me = source.players().find((p) => p.id === source.localId);
    if (me) this.cam.snapTo(me.state.yaw);
    this.input = { mx: 0, mz: 0, yaw: 0, pitch: 0, aimYaw: 0, aimPitch: 0, buttons: 0, consume: () => engine.input.consume() };
    engine.input.onPause = () => {
      if (this.source.phase() !== 'ended') useUi.getState().setPaused(true);
    };
    // Take control straight away: keys work now, and the mouse is captured while the click
    // that started the match still counts as a gesture (otherwise on the first key or click).
    engine.input.wantsLock = true;
    engine.input.engaged = true;
    engine.input.lock();
    engine.input.onScoreboard = (open) => useHud.setState({ showBoard: open });
    engine.input.onChat = () => useChat.getState().setOpen(true);
    engine.input.onTalk = (down) => void voice.talk(down);
    engine.input.onMap = () => useHud.setState((h) => ({ bigMap: !h.bigMap }));
    audio.startMusic('match');
    audio.startAmbient(map.theme.indoor ? 'hum' : 'wind');
    audio.onWorldSound = (at, kind) => this.worldCue(at, kind);
    useHud.setState({ active: true, mode: source.config.mode, untimed: source.config.duration === 0, feed: [], board: [], notice: null, caption: null });
  }

  private buildDecor() {
    const map = this.source.world.map;
    // Spawn rings
    map.spawns.forEach((sp, team) => {
      const cx = sp.reduce((a, s) => a + s.x, 0) / sp.length, cz = sp.reduce((a, s) => a + s.z, 0) / sp.length;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(3.6, 4.1, 48),
        new THREE.MeshBasicMaterial({ color: this.colors[team], transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, sp[0].y + 0.04, cz);
      this.add(ring);
    });
    for (const pad of map.pads) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(pad.r, pad.r * 1.08, 0.14, 28), new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.4 }));
      disc.position.y = 0.07;
      const glow = new THREE.Mesh(new THREE.RingGeometry(pad.r * 0.45, pad.r * 0.9, 28), new THREE.MeshBasicMaterial({ color: 0xffe27a, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.15;
      g.add(disc, glow);
      g.position.set(pad.x, pad.y, pad.z);
      this.add(g);
    }
    for (const z of map.zones) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(z.h.x * 2, z.h.z * 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(z.c.x, z.c.y + 0.06, z.c.z);
      this.zoneMeshes.push(m);
      this.add(m);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(z.h.x * 2, 0.01, z.h.z * 2)),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      );
      edge.position.set(z.c.x, z.c.y + 0.07, z.c.z);
      this.add(edge);
    }
  }

  private add(o: THREE.Object3D) {
    this.deco.push(o);
    this.scene.add(o);
  }

  private charFor(v: ViewPlayer): CharView {
    let c = this.chars.get(v.id);
    if (c) return c;
    const g = useSettings.getState().graphics;
    const rig = buildCharacter({
      cosmetics: v.info.cosmetics,
      team: this.colors[v.info.team],
      weapon: v.info.weapon,
      detail: g.modelDetail,
      lambert: g.paintQuality === 0,
    });
    // The rig casts from merged shadow-only copies (see compactRig); without shadows, nothing casts.
    if (g.shadowQuality === 0) rig.root.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    this.scene.add(rig.root);
    const me = this.source.players().find((p) => p.id === this.source.localId);
    const friendly = me ? me.info.team === v.info.team : false;
    let tag: Tag | null = null;
    if (v.id !== this.source.localId) {
      tag = nameTag(v.info.name, this.colors[v.info.team], friendly);
      rig.root.add(tag.sprite);
      tag.sprite.position.y = 2.28;
    }
    // Blob shadow on the cheapest preset (no shadow maps).
    if (g.shadowQuality === 0) {
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.03;
      rig.root.add(blob);
    }
    c = { rig, anim: new Animator(rig, WEAPONS[v.info.weapon].kind), tag, yaw: v.state.yaw, wasAlive: v.state.alive, wasDiving: false, wasGrounded: true, rippleT: 0, team: v.info.team };
    this.chars.set(v.id, c);
    return c;
  }

  private me(): ViewPlayer | undefined {
    return this.source.players().find((p) => p.id === this.source.localId);
  }

  update(dt: number) {
    const ui = useUi.getState();
    const settings = useSettings.getState();
    const src = this.source;
    const me = this.me();
    const input = engine.input;
    input.pollPad();
    const playing = src.phase() === 'playing';
    const paused = ui.paused;

    if (!paused) {
      const l = input.look(dt);
      this.cam.yaw += l.yaw;
      this.cam.pitch += l.pitch;
    }

    // Crosshair-corrected aim: fire from the muzzle towards whatever the screen centre points at.
    const inp = this.input;
    inp.yaw = this.cam.yaw;
    inp.pitch = this.cam.pitch;
    inp.aimYaw = this.cam.yaw;
    inp.aimPitch = this.cam.pitch;
    if (me && me.state.alive) {
      const cp = this.cam.camera.position;
      dirFromAngles(camDir, this.cam.yaw, this.cam.pitch);
      const hit = src.world.raycast(cp, camDir, 120);
      let dist = hit ? hit.dist : 80;
      for (const o of src.players()) {
        if (o.info.team === me.info.team || !o.state.alive) continue;
        const ox = o.pos.x - cp.x, oy = o.pos.y - cp.y, oz = o.pos.z - cp.z;
        const along = ox * camDir.x + oy * camDir.y + oz * camDir.z;
        if (along < 0 || along > dist) continue;
        const perp2 = ox * ox + oy * oy + oz * oz - along * along;
        if (perp2 < 0.36) dist = along;
      }
      aimPt.x = cp.x + camDir.x * dist;
      aimPt.y = cp.y + camDir.y * dist;
      aimPt.z = cp.z + camDir.z * dist;
      muzzle(muz, me.state.pos, this.cam.yaw, WEAPONS[me.info.weapon], me.state.shots);
      tmp2.x = aimPt.x - muz.x;
      tmp2.y = aimPt.y - muz.y;
      tmp2.z = aimPt.z - muz.z;
      const fwdDot = tmp2.x * camDir.x + tmp2.y * camDir.y + tmp2.z * camDir.z;
      if (fwdDot > 1.5) {
        inp.aimYaw = yawOf(tmp2);
        inp.aimPitch = pitchOf(tmp2);
      }
    }
    const stick = input.stick();
    input.wantsLock = !paused;
    const active = !paused && (input.locked || input.engaged || touch.active || !!navigator.getGamepads?.()?.some((p) => p?.connected));
    inp.mx = active ? stick.x : 0;
    inp.mz = active ? stick.z : 0;
    inp.buttons = active ? input.buttons() : 0;

    // Offline matches pause for real; online they keep running.
    const events = paused && !src.online ? [] : src.update(dt, inp);
    this.splatBudget = 6;
    if (src.consumeRepaint?.()) this.atlas.rebuildFromGrid();
    for (const e of events) this.onEvent(e);

    this.updateCharacters(dt);
    this.fx.setProjectiles(src.projectiles());
    this.fx.syncEffects(src.effects());
    this.fx.update(dt);

    const target = me && me.state.alive ? me.pos : this.deathAt ?? me?.pos ?? v3();
    if (me && !me.state.alive && this.killer >= 0) {
      const k = src.players().find((p) => p.id === this.killer);
      if (k) {
        const want = Math.atan2(-(k.pos.x - target.x), -(k.pos.z - target.z));
        let d = want - this.cam.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.cam.yaw += d * (1 - Math.exp(-3 * dt));
      }
    }
    const reduced = prefersReducedMotion();
    this.cam.update(dt, src.world, target, {
      smoothing: settings.gameplay.cameraSmoothing,
      diving: !!me?.state.diving,
      fast: !reduced && !!me && (me.state.swimming || me.state.surgeT > 0),
      shake: reduced ? 0 : settings.gameplay.cameraShake,
    });
    if (!reduced && me) this.cinematic(me);
    const c = this.cam.camera;
    audio.setListener(c.position, this.cam.yaw);
    if (me && !this.ended) this.localAudio(dt, me);

    if (src.phase() === 'ended' && !this.ended) {
      const o = src.outcome();
      if (o) {
        this.ended = true;
        this.onEnd(o);
      }
    }

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 1 / 15;
      this.pushHud(me);
    }
    if (playing && src.config.duration > 0) audio.setIntensity(src.timeLeft() < 30 ? 1 : 0);
  }

  /**
   * Intro: an establishing shot above the arena that eases down to your shoulder by "GO".
   * Outro: a slow pull-back while "TIME!" shows. Overlays the gameplay camera each frame.
   */
  private cinematic(me: ViewPlayer) {
    const src = this.source;
    const ph = src.phase();
    const cam = this.cam.camera;
    const smooth = (x: number) => x * x * (3 - 2 * x);
    if (ph === 'intro') {
      const e = smooth(1 - Math.min(1, Math.max(0, (src.phaseT() - 0.5) / (INTRO_TIME - 0.5))));
      const ex = src.world.map.extent;
      const y = me.state.yaw;
      // Behind the player (forward is -sin/-cos of yaw), high up, looking over the arena;
      // pulled in short of walls and roofs so enclosed maps keep the shot inside.
      const o = { x: me.pos.x, y: me.pos.y + 1, z: me.pos.z };
      const dx = Math.sin(y) * 13, dy = 14, dz = Math.cos(y) * 13;
      const len = Math.hypot(dx, dy, dz);
      const hit = src.world.raycast(o, { x: dx / len, y: dy / len, z: dz / len }, len);
      const k = hit ? Math.max(0, hit.dist - 0.6) / len : 1;
      this.shot.position.set(o.x + dx * k, o.y + dy * k, o.z + dz * k);
      this.shot.lookAt((ex.minX + ex.maxX) / 2, 0, (ex.minZ + ex.maxZ) / 2);
      cam.position.lerpVectors(this.shot.position, cam.position, e);
      cam.quaternion.slerpQuaternions(this.shot.quaternion, cam.quaternion, e);
    } else if (ph === 'ending' || ph === 'ended') {
      const k = smooth(ph === 'ended' ? 1 : Math.min(1, 1 - src.phaseT() / OUTRO_TIME));
      this.shot.position.copy(cam.position);
      this.shot.quaternion.copy(cam.quaternion);
      this.shot.translateZ(k * 4);
      this.shot.position.y += k * 2.5;
      this.shot.lookAt(me.pos.x, me.pos.y, me.pos.z);
      cam.position.copy(this.shot.position);
      cam.quaternion.slerp(this.shot.quaternion, k);
    }
  }

  private localAudio(dt: number, me: ViewPlayer) {
    const s = me.state;
    const ch = this.chars.get(me.id);
    if (!ch) return;
    if (s.diving !== ch.wasDiving) audio.play(s.diving ? 'dive' : 'surface', { gain: 0.6 });
    if (s.swimming && Math.hypot(s.vel.x, s.vel.z) > 2) {
      this.swimT -= dt;
      if (this.swimT <= 0) {
        this.swimT = 0.11;
        audio.play('swim', { gain: 0.5 });
      }
    }
    if (!s.grounded && ch.wasGrounded && s.vel.y > 5) audio.play('jump', { gain: 0.5 });
    if (s.grounded && !ch.wasGrounded && s.landT < 0.05) audio.play('land', { gain: 0.4 });
  }

  private onEvent(e: SimEvent) {
    const src = this.source;
    const me = this.me();
    const local = src.localId;
    switch (e.t) {
      case 'paint': {
        this.atlas.stamp(e, e.r, e.team, e.kind);
        if (e.kind === PAINT_KIND.IMPACT || e.kind === PAINT_KIND.DEATH || e.kind === PAINT_KIND.NOVA) {
          this.fx.splash(e, e.team, e.r);
          if (this.splatBudget-- > 0) audio.play('splat', { at: e, gain: Math.min(1, 0.35 + e.r * 0.25), pitch: 1.4 - Math.min(0.6, e.r * 0.15) });
        }
        break;
      }
      case 'fire': {
        const c = this.chars.get(e.id);
        c?.anim.fire();
        if (c) {
          c.rig.weapon.muzzle.getWorldPosition(tmp);
          dirFromAngles(tmp2, e.yaw, e.pitch);
          this.fx.muzzle(tmp, tmp2, c.team);
        }
        audio.play('shot', { at: e, weapon: e.w, gain: e.id === local ? 0.8 : 0.9 });
        if (e.id === local) {
          const kind = WEAPONS[e.w]?.kind;
          if (kind === 'burst' || kind === 'lobber') this.cam.addShake(0.25);
          engine.input.rumble(kind === 'burst' ? 0.6 : 0.15, 60);
        }
        break;
      }
      case 'hit': {
        const victim = src.players().find((p) => p.id === e.id);
        this.chars.get(e.id)?.anim.hit();
        if (e.id === local && victim) {
          audio.play('hurt', { gain: 0.8 });
          const by = src.players().find((p) => p.id === e.by);
          if (by) {
            const a = Math.atan2(-(by.pos.x - victim.pos.x), -(by.pos.z - victim.pos.z)) - this.cam.yaw;
            this.hurt.push({ id: this.feedId++, angle: Math.atan2(Math.sin(a), Math.cos(a)), t: performance.now() });
          }
          this.cam.addShake(Math.min(0.5, e.dmg / 120));
          engine.input.rumble(Math.min(1, e.dmg / 80), 120);
        }
        if (e.by === local && e.id !== local) {
          useHud.setState({ hitAt: performance.now() });
          audio.play('hit', { gain: 0.7 });
        }
        break;
      }
      case 'kill': {
        const v = src.players().find((p) => p.id === e.id);
        const k = src.players().find((p) => p.id === e.by);
        if (v) {
          this.fx.burst({ x: v.pos.x, y: v.pos.y, z: v.pos.z }, k ? k.info.team : v.info.team, 26, 6, 0.12);
          audio.play('ko', { at: v.pos, gain: 0.9 });
          this.feed.unshift({
            id: this.feedId++,
            killer: k ? k.info.name : '',
            victim: v.info.name,
            killerTeam: k ? k.info.team : -1,
            victimTeam: v.info.team,
            cause: KILL_CAUSE[e.w] ?? WEAPONS[e.w as keyof typeof WEAPONS]?.name ?? '',
          });
          this.feed = this.feed.slice(0, 5);
        }
        if (e.by === local && e.id !== local) {
          useHud.setState({ koAt: performance.now() });
          this.say(`Splatted ${v?.info.name ?? ''}`, 'good');
        }
        if (e.id === local) {
          this.deathAt = v ? { ...v.pos } : null;
          this.killer = e.by;
          this.say(k ? `Splatted by ${k.info.name}` : 'Out of bounds', 'bad');
          this.cam.addShake(0.6);
        }
        break;
      }
      case 'spawn': {
        const c = this.chars.get(e.id);
        c?.anim.spawned();
        const p = src.players().find((x) => x.id === e.id);
        if (p) this.fx.ring({ x: p.pos.x, y: p.pos.y - FEET_OFFSET, z: p.pos.z }, p.info.team, 2.5, 0.5);
        if (e.id === local && p) {
          this.cam.snapTo(p.state.yaw);
          this.deathAt = null;
          this.killer = -1;
          audio.play('spawn', { gain: 0.6 });
        }
        break;
      }
      case 'special': {
        const p = src.players().find((x) => x.id === e.id);
        audio.play('special', { at: e, gain: 0.9 });
        if (p) this.fx.ring(e, p.info.team, SPECIALS[e.s].radius || 2.5, 0.6);
        if (e.id === local) this.say(SPECIALS[e.s].name, 'good');
        else if (p && me && p.info.team !== me.info.team) this.caption = { text: `Rival ${SPECIALS[e.s].name}`, t: 2 };
        break;
      }
      case 'blast': {
        this.fx.ring(e, e.team, e.r, 0.35 + e.r * 0.04);
        this.fx.burst(e, e.team, 8 + e.r * 6, 3 + e.r, 0.08);
        if (e.r > 1) audio.play('blast', { at: e, gain: Math.min(1, e.r / 4) });
        if (me && Math.hypot(me.pos.x - e.x, me.pos.z - e.z) < e.r * 2) this.cam.addShake(Math.min(0.5, e.r / 10));
        break;
      }
      case 'empty':
        this.chars.get(e.id)?.anim.empty();
        if (e.id === local) {
          audio.play('empty', { gain: 0.8 });
          useHud.setState({ lowInkAt: performance.now() });
        }
        break;
      case 'zone': {
        const names = teamNames();
        audio.play('zone');
        if (e.team < 0) this.say('Zone neutral', 'neutral');
        else this.say(`${names[e.team]} took a zone`, me && me.info.team === e.team ? 'good' : 'bad');
        break;
      }
      case 'phase':
        if (e.phase === 'playing') {
          audio.play('go');
          this.say('GO!', 'neutral');
          this.capt('[Start horn]');
        } else if (e.phase === 'ending') {
          audio.play('time');
          this.say(src.config.mode === 'knockout' ? 'KNOCKOUT!' : 'TIME!', 'neutral');
          this.capt('[Final buzzer]');
        }
        break;
    }
  }

  private say(text: string, tone: 'neutral' | 'good' | 'bad') {
    this.notice = { id: this.feedId++, text, tone, t: 2.2 };
  }
  private capt(text: string) {
    if (useSettings.getState().accessibility.subtitles) this.caption = { text, t: 2 };
  }

  /** Off-screen loud sounds become edge indicators when "visual audio" is on. */
  private worldCue(at: Vec3, _kind: string) {
    if (!useSettings.getState().accessibility.visualAudio) return;
    const c = this.cam.camera.position;
    if (Math.hypot(at.x - c.x, at.z - c.z) < 3) return;
    const a = Math.atan2(-(at.x - c.x), -(at.z - c.z)) - this.cam.yaw;
    this.cues.push({ id: this.feedId++, angle: Math.atan2(Math.sin(a), Math.cos(a)), t: performance.now() });
    if (this.cues.length > 6) this.cues.shift();
  }

  private updateCharacters(dt: number) {
    const src = this.source;
    const me = this.me();
    const seen = new Set<number>();
    const camPos = this.cam.camera.position;
    const speaking = useVoice.getState().speaking;
    for (const v of src.players()) {
      seen.add(v.id);
      const c = this.charFor(v);
      const s = v.state;
      const root = c.rig.root;
      root.position.set(v.pos.x, v.pos.y - FEET_OFFSET, v.pos.z);
      const speed = Math.hypot(s.vel.x, s.vel.z);
      // Face the aim while shooting or idle, the travel direction while running.
      const faceAim = s.firing || s.sinceFire < 0.7 || speed < 1 || v.id === src.localId;
      let want = faceAim ? s.aimYaw : Math.atan2(-s.vel.x, -s.vel.z);
      if (s.climbing) want = s.yaw;
      let d = want - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.yaw += d * (1 - Math.exp(-(faceAim ? 22 : 12) * dt));
      root.rotation.y = c.yaw;
      root.visible = s.alive;
      if (c.wasAlive && !s.alive) c.anim.hit();
      c.wasAlive = s.alive;
      const enemy = !!me && v.info.team !== me.info.team;
      const revealed = s.disruptedT > 0;
      const near = Math.hypot(v.pos.x - camPos.x, v.pos.z - camPos.z) < 5;
      const hidden = enemy && s.swimming && !revealed && !near && s.sinceFire > 1;
      forwardXZ(fwd, c.yaw);
      rightXZ(right, c.yaw);
      const vx = s.dodgeDir.x * right.x + s.dodgeDir.z * right.z, vz = s.dodgeDir.x * fwd.x + s.dodgeDir.z * fwd.z;
      const st: AnimState = {
        alive: s.alive,
        grounded: s.grounded,
        diving: s.diving,
        swimming: s.swimming,
        climbing: s.climbing,
        firing: s.firing,
        rolling: s.rolling,
        sliding: s.slideT > 0 && s.grounded,
        dodge: s.dodgeT > 0 ? 1 - s.dodgeT / 0.2 : -1,
        dodgeX: vx,
        dodgeZ: vz,
        speed,
        vy: s.vel.y,
        landT: s.landT,
        aimPitch: s.aimPitch,
        ink: s.ink / MAX_INK,
        emote: v.info.cosmetics.emote,
        emoteT: s.emoteT,
        outcome: 'none',
        hiddenBlob: hidden,
        wallYaw: c.yaw,
      };
      c.anim.update(dt, st);
      if (s.alive && s.swimming && speed > 3) {
        c.rippleT -= dt;
        if (c.rippleT <= 0) {
          c.rippleT = hidden ? 0.18 : 0.08;
          this.fx.ripple({ x: v.pos.x, y: v.pos.y - FEET_OFFSET, z: v.pos.z }, v.info.team);
        }
      }
      if (c.tag) {
        // Teammates always show; rivals show when in sight (walls hide them) and not lurking in paint.
        const teamInd = useSettings.getState().gameplay.teamIndicators;
        const dist = this.cam.camera.position.distanceTo(root.position);
        const close = enemy ? dist < 34 : true;
        c.tag.sprite.visible = s.alive && (enemy ? revealed || (!hidden && close) : teamInd);
        // Up close a tag would fill the screen: nearer than 7 m it shrinks to hold a steady size.
        const k = Math.min(1, dist / 7);
        c.tag.sprite.scale.set(1.75 * k, 0.7 * k, 1);
        (c.tag.sprite.material as THREE.SpriteMaterial).depthTest = !revealed && enemy;
        const hp = Math.round(Math.max(0, s.hp) / 5) * 5, talking = !!speaking[v.id];
        if (hp !== c.tag.hp || talking !== c.tag.talking) c.tag.draw(hp, talking);
      }
      // Hide our own model if the camera is squeezed into it.
      if (v.id === src.localId) c.rig.body.visible = c.rig.body.visible && this.cam.camera.position.distanceTo(root.position) > 1.1;
      c.wasDiving = s.diving;
      c.wasGrounded = s.grounded;
    }
    for (const [id, c] of this.chars)
      if (!seen.has(id)) {
        c.rig.root.removeFromParent();
        c.rig.dispose();
        this.chars.delete(id);
      }
  }

  private pushHud(me: ViewPlayer | undefined) {
    const src = this.source;
    const now = performance.now();
    this.hurt = this.hurt.filter((h) => now - h.t < 900);
    this.cues = this.cues.filter((h) => now - h.t < 1200);
    if (this.notice) {
      this.notice.t -= 1 / 15;
      if (this.notice.t <= 0) this.notice = null;
    }
    if (this.caption) {
      this.caption.t -= 1 / 15;
      if (this.caption.t <= 0) this.caption = null;
    }
    const phase = src.phase();
    const countdown = phase === 'intro' ? Math.ceil(src.phaseT() - 0.5) : 0;
    if (phase === 'intro' && countdown !== this.lastCount && countdown > 0 && countdown <= 3) {
      audio.play('count');
      this.capt(`[Countdown ${countdown}]`);
    }
    this.lastCount = countdown;
    const tl = src.timeLeft();
    if (phase === 'playing' && src.config.duration >= 90 && tl <= 60 && !this.minuteWarned) {
      this.minuteWarned = true;
      this.say('1 minute left!', 'neutral');
      this.capt('[One minute warning]');
    }
    if (phase === 'playing' && tl <= 10 && tl > 0 && Math.ceil(tl) !== Math.ceil(tl + 1 / 15)) audio.play('count', { gain: 0.6 });
    for (let i = 0; i < this.zoneMeshes.length; i++) {
      const h = src.holders()[i] ?? -1;
      const m = this.zoneMeshes[i].material as THREE.MeshBasicMaterial;
      m.color.copy(h >= 0 ? this.colors[h] : new THREE.Color(0xffffff));
      m.opacity = h >= 0 ? 0.28 : 0.12;
    }
    // Proximity chat: each voice's volume follows how far that player is from your camera.
    if (src.online && useVoice.getState().active) {
      const range = useSettings.getState().audio.voiceRange;
      const cp = this.cam.camera.position;
      const gains = new Map<number, number>();
      for (const p of src.players()) {
        if (p.id === src.localId || p.info.bot) continue;
        const mate = !!me && p.info.team === me.info.team;
        gains.set(
          p.id,
          range === 'all' || (range === 'team' && mate)
            ? 1
            : proximityGain(Math.hypot(p.pos.x - cp.x, p.pos.y - cp.y, p.pos.z - cp.z)),
        );
      }
      voice.setNear(gains);
    }
    const board: BoardRow[] = src.players().map((p) => ({
      id: p.id,
      name: p.info.name,
      team: p.info.team,
      bot: p.info.bot,
      weapon: p.info.weapon,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      assists: p.stats.assists,
      paint: Math.round(p.stats.paint),
      alive: p.state.alive,
      you: p.id === src.localId,
    }));
    const s = me?.state;
    useHud.setState({
      phase,
      countdown,
      timeLeft: tl,
      score: src.score(),
      holders: [...src.holders()],
      myTeam: me?.info.team ?? 0,
      hp: s?.hp ?? 0,
      ink: s?.ink ?? 0,
      charge: s?.charge ?? 0,
      special: me?.info.special ?? 'surge',
      surge: s?.surgeT ?? 0,
      weapon: me?.info.weapon ?? 'pulse',
      alive: s?.alive ?? false,
      respawnIn: s && !s.alive ? Math.max(0, s.respawnT) : 0,
      diving: !!s?.diving,
      feed: this.feed,
      notice: this.notice ? { id: this.notice.id, text: this.notice.text, tone: this.notice.tone } : null,
      caption: this.caption?.text ?? null,
      hurt: this.hurt.map(({ id, angle }) => ({ id, angle })),
      cues: this.cues.map(({ id, angle }) => ({ id, angle })),
      board,
      ping: src.ping(),
      net: src.online ? (src.ping() == null ? 'lost' : (src.ping() ?? 0) > 180 ? 'poor' : 'good') : 'local',
    });
  }

  render(dt: number) {
    const r = engine.renderer;
    const q = useSettings.getState().graphics.shadowQuality;
    // First frame: compile every shader the match can use (effects and paint included), so none
    // compiles mid-match and stalls a frame.
    if (this.frame === 0) {
      this.post.warm();
      this.atlas.warm();
    }
    this.frame++;
    // Shadow maps refresh less often on lower presets.
    if (q > 0 && this.frame % (q >= 3 ? 1 : q === 2 ? 2 : 3) === 0) r.shadowMap.needsUpdate = true;
    this.atlas.flush();
    this.post.render(dt);
  }

  resize() {
    this.cam.camera.aspect = engine.aspect;
    this.cam.camera.updateProjectionMatrix();
    this.post.setSize();
  }

  applyGraphics(g: GraphicsSettings) {
    const r = engine.renderer;
    this.post.dispose();
    this.post = new Post(r, this.scene, this.cam.camera, g);
    this.scene.fog = new THREE.Fog(this.source.world.map.theme.fog, g.drawDistance * 0.3, g.drawDistance);
    this.cam.camera.far = Math.max(200, g.drawDistance * 1.6);
    this.cam.camera.updateProjectionMatrix();
    const sun = this.env.sun;
    sun.castShadow = g.shadowQuality > 0;
    if (sun.castShadow && sun.shadow.mapSize.x !== g.shadowResolution) {
      sun.shadow.mapSize.set(g.shadowResolution, g.shadowResolution);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    r.shadowMap.needsUpdate = true;
  }

  restore() {
    this.atlas.rebuildFromGrid();
    engine.renderer.shadowMap.needsUpdate = true;
  }

  /** What the minimap draws: the map and who's where. Rivals only appear while they're in sight. */
  radar() {
    const src = this.source;
    const me = src.players().find((p) => p.id === src.localId);
    return {
      map: src.world.map,
      yaw: this.cam.yaw,
      colors: this.colors,
      players: src.players().map((v) => {
        const c = this.chars.get(v.id);
        const ally = !!me && v.info.team === me.info.team;
        return { id: v.id, x: v.pos.x, z: v.pos.z, team: v.info.team, name: v.info.name, me: v.id === src.localId, alive: v.state.alive, seen: ally || !!c?.tag?.sprite.visible };
      }),
    };
  }

  dispose() {
    audio.onWorldSound = null;
    audio.stopAmbient();
    engine.input.onPause = null;
    engine.input.onScoreboard = null;
    engine.input.onChat = null;
    engine.input.onTalk = null;
    engine.input.onMap = null;
    void voice.talk(false);
    voice.setNear(null);
    useChat.getState().setOpen(false);
    engine.input.wantsLock = false;
    engine.input.engaged = false;
    engine.input.unlock();
    useHud.setState({ active: false, showBoard: false });
    for (const c of this.chars.values()) c.rig.dispose();
    this.fx.dispose();
    this.env.dispose();
    this.mapGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
    for (const o of this.deco)
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    this.atlas.dispose();
    this.post.dispose();
    this.source.dispose();
    engine.renderer.shadowMap.autoUpdate = true;
  }
}

interface Tag {
  sprite: THREE.Sprite;
  hp: number;
  talking: boolean;
  draw(hp: number, talking: boolean): void;
}

/**
 * The tag over a player: a segmented health bar in their team's paint above their name, which
 * brightens with a microphone beside it while they talk on voice chat.
 */
function nameTag(name: string, color: THREE.Color, friendly: boolean): Tag {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const paint = `#${color.getHexString()}`;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.75, 0.7, 1);
  sprite.renderOrder = 10;
  const label = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  const tag: Tag = {
    sprite,
    hp: -1,
    talking: false,
    draw(hp, talking) {
      tag.hp = hp;
      tag.talking = talking;
      ctx.clearRect(0, 0, c.width, c.height);
      // Health: ten segments, like [|||||||   ].
      const bw = 200, bh = 18, bx = (c.width - bw) / 2, by = 10;
      ctx.fillStyle = 'rgba(14,11,20,0.82)';
      ctx.beginPath();
      ctx.roundRect(bx - 4, by - 4, bw + 8, bh + 8, 9);
      ctx.fill();
      const lit = Math.ceil((hp / 100) * 10);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < lit ? (hp <= 30 ? '#ff5a5f' : paint) : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.roundRect(bx + i * (bw / 10) + 1.5, by, bw / 10 - 3, bh, 3);
        ctx.fill();
      }
      // Name, plus the mic while talking.
      ctx.font = '800 30px "Archivo Variable", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width;
      const mic = talking ? 30 : 0;
      const x = (c.width - w - mic) / 2, y = 62;
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(10,8,16,0.9)';
      ctx.strokeText(label, x, y);
      if (talking) {
        ctx.shadowColor = paint;
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = talking ? '#ffffff' : 'rgba(240,236,246,0.82)';
      ctx.fillText(label, x, y);
      ctx.shadowBlur = 0;
      if (talking) {
        const mx = x + w + 18;
        ctx.fillStyle = paint;
        ctx.strokeStyle = 'rgba(10,8,16,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(mx - 6, y - 15, 12, 20, 6);
        ctx.stroke();
        ctx.fill();
        ctx.strokeStyle = paint;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mx, y - 2, 10, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.moveTo(mx, y + 8);
        ctx.lineTo(mx, y + 14);
        ctx.stroke();
      }
      // Team marker: triangle for team A's shape language, dot for rivals.
      ctx.fillStyle = paint;
      ctx.beginPath();
      if (friendly) {
        ctx.moveTo(148, 92);
        ctx.lineTo(172, 92);
        ctx.lineTo(160, 106);
      } else ctx.arc(160, 99, 8, 0, Math.PI * 2);
      ctx.fill();
      tex.needsUpdate = true;
    },
  };
  tag.draw(100, false);
  return tag;
}

