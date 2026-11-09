import type { MediaConnection, Peer as PeerType } from 'peerjs';
import { create } from 'zustand';
import { getMic } from '../audio/mic';
import { useSettings } from '../settings/settings';

/*
 * Voice chat: every player in a room calls every other player directly (a small mesh, at most
 * eight people), through the same free PeerJS broker and STUN servers the games use. Peer ids
 * come from the room code and player id, so nobody has to exchange anything first.
 * In a match, voices fade with distance (proximity chat); in the lobby everyone is heard.
 */

interface VoiceStore {
  /** Player ids talking right now (including you, only while your voice is actually going out). */
  speaking: Record<number, boolean>;
  /** Your microphone is sending (key held, or open mic) and not muted. */
  live: boolean;
  /** Joined the voice mesh for this room. */
  active: boolean;
  error: string | null;
  /** Player ids connected on voice. */
  peers: number[];
  /** Players you've muted in this room. */
  muted: Record<number, boolean>;
  /** Your microphone switched off. */
  micMuted: boolean;
  /** Nobody else is heard. */
  deafened: boolean;
}

export const useVoice = create<VoiceStore>()(() => ({
  speaking: {},
  live: false,
  active: false,
  error: null,
  peers: [],
  muted: {},
  micMuted: false,
  deafened: false,
}));

const voiceId = (code: string, pid: number) => `chromashift-v1-vc-${code.toLowerCase()}-${pid}`;
const THRESHOLD = 0.035;

/** Proximity chat: full volume up close, fading out to silence by FAR metres. */
const NEAR = 8,
  FAR = 40;
export const proximityGain = (d: number) =>
  d <= NEAR ? 1 : d >= FAR ? 0 : ((FAR - d) / (FAR - NEAR)) ** 1.5;

interface Remote {
  pid: number;
  call: MediaConnection;
  el: HTMLAudioElement;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
}

let peer: PeerType | null = null;
let room: { code: string; me: number } | null = null;
let ctx: AudioContext | null = null;
/** What we send: silence until the microphone is allowed, then the mic. */
let out: MediaStream | null = null;
let mic: MediaStream | null = null;
let micAnalyser: AnalyserNode | null = null;
let held = false;
const remotes = new Map<number, Remote>();
/** Per-player distance gain from the match (1 everywhere in the lobby). */
const near = new Map<number, number>();
let raf = 0;

function audioCtx() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A silent track to call with before the microphone is on, so others can still be heard. */
function silence() {
  const c = audioCtx();
  const dest = c.createMediaStreamDestination();
  const osc = c.createConstantSource();
  osc.offset.value = 0;
  osc.connect(dest);
  osc.start();
  return dest.stream;
}

const level = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>) => {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
};

/** Speech has gaps between words; a talker stays lit this long after their last loud moment. */
const HOLD_MS = 350;

function watchLevels() {
  const buf = new Float32Array(512);
  const loud = new Map<number, number>();
  const tick = () => {
    const now = performance.now();
    for (const r of remotes.values()) if (level(r.analyser, buf) > THRESHOLD) loud.set(r.pid, now);
    if (room && useVoice.getState().live && micAnalyser && level(micAnalyser, buf) > THRESHOLD) loud.set(room.me, now);
    const speaking: Record<number, boolean> = {};
    for (const r of remotes.values()) speaking[r.pid] = now - (loud.get(r.pid) ?? -1e9) < HOLD_MS;
    if (room) speaking[room.me] = useVoice.getState().live && now - (loud.get(room.me) ?? -1e9) < HOLD_MS;
    const prev = useVoice.getState().speaking;
    if (Object.keys(speaking).some((k) => speaking[+k] !== prev[+k]) || Object.keys(prev).length !== Object.keys(speaking).length) useVoice.setState({ speaking });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Sets every remote voice's volume: settings, mutes, deafen and distance. */
function applyVolumes() {
  const a = useSettings.getState().audio;
  const v = useVoice.getState();
  const base = Math.max(0, Math.min(1, a.voice * a.master));
  for (const r of remotes.values())
    r.el.volume = v.deafened || v.muted[r.pid] ? 0 : base * (near.get(r.pid) ?? 1);
}

const syncPeers = () => useVoice.setState({ peers: [...remotes.keys()].sort((x, y) => x - y) });

function attach(pid: number, call: MediaConnection) {
  remotes.get(pid)?.call.close();
  call.on('stream', (stream) => {
    const prev = remotes.get(pid);
    if (prev?.call === call && prev.el.srcObject === stream) return;
    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    void el.play().catch(() => undefined);
    const c = audioCtx();
    const source = c.createMediaStreamSource(stream);
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    remotes.set(pid, { pid, call, el, analyser, source });
    applyVolumes();
    syncPeers();
  });
  call.on('close', () => drop(pid, call));
  call.on('error', () => drop(pid, call));
}

function drop(pid: number, call?: MediaConnection) {
  const r = remotes.get(pid);
  if (!r || (call && r.call !== call)) return;
  r.el.srcObject = null;
  r.source.disconnect();
  r.call.close();
  remotes.delete(pid);
  syncPeers();
}

/** Sends the microphone (or silence) on every call. */
function sendTrack() {
  const track = (mic ?? out)?.getAudioTracks()[0];
  if (!track) return;
  for (const r of remotes.values())
    for (const s of r.call.peerConnection?.getSenders() ?? []) if (s.track?.kind === 'audio' && s.track !== track) void s.replaceTrack(track);
}

const inApp = typeof navigator !== 'undefined' && (/Electron/i.test(navigator.userAgent) || !!(window as unknown as { __CHROMASHIFT_DESKTOP__?: boolean }).__CHROMASHIFT_DESKTOP__);

function listen(stream: MediaStream) {
  const c = audioCtx();
  micAnalyser = c.createAnalyser();
  micAnalyser.fftSize = 512;
  c.createMediaStreamSource(stream).connect(micAnalyser);
}

/** The player picked a different microphone: switch to it without leaving the room. */
async function swapMic() {
  if (!mic) return;
  mic.getTracks().forEach((t) => t.stop());
  mic = null;
  await ensureMic();
}

async function ensureMic() {
  if (mic) return true;
  try {
    mic = await getMic();
    listen(mic);
    sendTrack();
    applyMic();
    useVoice.setState({ error: null });
    return true;
  } catch (e) {
    const name = (e as { name?: string }).name;
    useVoice.setState({
      error:
        name === 'NotFoundError'
          ? 'No microphone found.'
          : inApp
            ? 'Microphone blocked. In Windows Settings → Privacy → Microphone, allow desktop apps.'
            : 'Microphone blocked. Allow it for this site in your browser to talk.',
    });
    return false;
  }
}

/** Mic track on only while talking (held key or open mic) and not muted. */
function applyMic() {
  const mode = useSettings.getState().audio.voiceMode;
  const live = !!mic && !useVoice.getState().micMuted && (mode === 'open' || (mode === 'ptt' && held));
  mic?.getAudioTracks().forEach((t) => (t.enabled = live));
  if (live !== useVoice.getState().live) useVoice.setState({ live });
}

export const voice = {
  /** Joins the room's voice mesh and calls the players already in it. */
  join(code: string, me: number, others: number[]) {
    if (useSettings.getState().audio.voiceMode === 'off' && !useSettings.getState().audio.voice) return;
    if (room?.code === code && room.me === me && peer && !peer.destroyed) return voice.update(others);
    voice.leave();
    room = { code, me };
    out = silence();
    void import('peerjs').then(async ({ Peer }) => {
      const { PEER_OPTIONS } = await import('./p2p');
      if (!room || room.code !== code) return;
      const p = new Peer(voiceId(code, me), PEER_OPTIONS);
      peer = p;
      p.on('open', () => {
        useVoice.setState({ active: true, error: null });
        voice.update(others);
      });
      // Calls from players who joined after us.
      p.on('call', (call) => {
        const pid = Number(call.peer.split('-').pop());
        if (!Number.isFinite(pid)) return call.close();
        call.answer(mic ?? out ?? undefined);
        attach(pid, call);
      });
      p.on('error', () => undefined);
      if (useSettings.getState().audio.voiceMode === 'open') void ensureMic();
      watchLevels();
    });
  },
  /** Calls anyone not connected yet; the player with the higher id calls, so each pair links once. */
  update(others: number[]) {
    if (!peer || !room || peer.destroyed || !peer.open) return;
    for (const pid of [...remotes.keys()]) if (!others.includes(pid)) drop(pid);
    for (const pid of others) {
      if (remotes.has(pid) || pid > room.me) continue;
      const stream = mic ?? out;
      if (!stream) continue;
      attach(pid, peer.call(voiceId(room.code, pid), stream));
    }
  },
  /** Push-to-talk key. */
  async talk(down: boolean) {
    held = down;
    if (down && useSettings.getState().audio.voiceMode !== 'off' && !(await ensureMic())) return;
    applyMic();
  },
  /** In a match: how loud each player is from where you are (pid → 0..1). Null in the lobby. */
  setNear(gains: Map<number, number> | null) {
    let changed = false;
    if (!gains) {
      changed = near.size > 0;
      near.clear();
    } else
      for (const [pid, g] of gains) {
        const q = Math.round(g * 20) / 20;
        if (near.get(pid) !== q) {
          near.set(pid, q);
          changed = true;
        }
      }
    if (changed) applyVolumes();
  },
  mute(pid: number, on: boolean) {
    useVoice.setState((v) => ({ muted: { ...v.muted, [pid]: on } }));
    applyVolumes();
  },
  setMicMuted(on: boolean) {
    useVoice.setState({ micMuted: on });
    applyMic();
  },
  setDeafened(on: boolean) {
    useVoice.setState({ deafened: on });
    applyVolumes();
  },
  leave() {
    cancelAnimationFrame(raf);
    for (const pid of [...remotes.keys()]) drop(pid);
    peer?.destroy();
    peer = null;
    room = null;
    mic?.getTracks().forEach((t) => t.stop());
    mic = null;
    micAnalyser = null;
    held = false;
    near.clear();
    useVoice.setState({ speaking: {}, live: false, active: false, peers: [], muted: {} });
  },
};

// Volume and mic mode follow the settings live.
useSettings.subscribe((s, prev) => {
  if (s.audio === prev.audio) return;
  if (s.audio.micId !== prev.audio.micId) void swapMic();
  applyVolumes();
  if (s.audio.voiceMode === 'open' && room) void ensureMic();
  applyMic();
});
