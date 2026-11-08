import type { MediaConnection, Peer as PeerType } from 'peerjs';
import { create } from 'zustand';
import { audio } from '../audio/audio';
import { getMic } from '../audio/mic';
import type { CallDoc } from '../auth/social';
import { useAccount } from '../auth/account';
import { useSettings } from '../settings/settings';
import { useUi } from '../state/ui';

/*
 * Calls between friends and in groups. Firestore carries the ringing (a call document the people
 * in it can see); the voice itself goes straight between browsers over WebRTC, like the in-game
 * voice chat. A call lives outside every screen: it keeps going while you browse the menus or play,
 * and ends when you hang up or close the app.
 */

interface CallStore {
  /** The call you are in (placed or answered). */
  call: CallDoc | null;
  /** Someone calling you right now. */
  incoming: CallDoc | null;
  /** Every call document you can see (active group calls can be joined). */
  calls: CallDoc[];
  /** Account ids heard on the call. */
  peers: string[];
  speaking: Record<string, boolean>;
  micMuted: boolean;
  deafened: boolean;
  error: string | null;
  /** Seconds since you joined. */
  startedAt: number;
}

export const useCall = create<CallStore>()(() => ({
  call: null,
  incoming: null,
  calls: [],
  peers: [],
  speaking: {},
  micMuted: false,
  deafened: false,
  error: null,
  startedAt: 0,
}));

type Social = typeof import('../auth/social');
let api: Social | null = null;
const social = async () => (api ??= await import('../auth/social'));

const RING_MS = 45_000;
const THRESHOLD = 0.035;
const peerId = (callId: string, uid: string) => `chromashift-v1-cl-${callId}-${uid}`;
const myUid = () => useAccount.getState().user?.uid ?? '';

interface Remote {
  uid: string;
  call: MediaConnection;
  el: HTMLAudioElement;
  analyser: AnalyserNode;
}

let peer: PeerType | null = null;
let ctx: AudioContext | null = null;
let mic: MediaStream | null = null;
let silent: MediaStream | null = null;
let micAnalyser: AnalyserNode | null = null;
let timer = 0;
let raf = 0;
let ringingOut = 0;
const remotes = new Map<string, Remote>();
/** When we last tried to call each person, so a missed attempt is retried but not spammed. */
const tried = new Map<string, number>();

function audioCtx() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

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

function watchLevels() {
  const buf = new Float32Array(512);
  const loud = new Map<string, number>();
  const tick = () => {
    const now = performance.now();
    for (const r of remotes.values()) if (level(r.analyser, buf) > THRESHOLD) loud.set(r.uid, now);
    const me = myUid();
    const st = useCall.getState();
    if (micAnalyser && !st.micMuted && level(micAnalyser, buf) > THRESHOLD) loud.set(me, now);
    const speaking: Record<string, boolean> = {};
    for (const r of remotes.values()) speaking[r.uid] = now - (loud.get(r.uid) ?? -1e9) < 350;
    speaking[me] = !st.micMuted && now - (loud.get(me) ?? -1e9) < 350;
    const prev = st.speaking;
    const keys = Object.keys(speaking);
    if (keys.length !== Object.keys(prev).length || keys.some((k) => speaking[k] !== prev[k])) useCall.setState({ speaking });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function applyVolumes() {
  const a = useSettings.getState().audio;
  const deaf = useCall.getState().deafened;
  for (const r of remotes.values()) r.el.volume = deaf ? 0 : Math.max(0, Math.min(1, a.voice * a.master));
}

const syncPeers = () => useCall.setState({ peers: [...remotes.keys()] });

function attach(uid: string, call: MediaConnection) {
  remotes.get(uid)?.call.close();
  call.on('stream', (stream) => {
    if (remotes.get(uid)?.call === call && remotes.get(uid)?.el.srcObject === stream) return;
    const el = new Audio();
    el.srcObject = stream;
    el.autoplay = true;
    void el.play().catch(() => undefined);
    const c = audioCtx();
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    c.createMediaStreamSource(stream).connect(analyser);
    remotes.set(uid, { uid, call, el, analyser });
    applyVolumes();
    syncPeers();
    audio.play('joined');
  });
  const gone = () => {
    const r = remotes.get(uid);
    if (!r || r.call !== call) return;
    r.el.srcObject = null;
    remotes.delete(uid);
    syncPeers();
  };
  call.on('close', gone);
  call.on('error', gone);
}

/** Starts the microphone and the peer for this call. */
async function openMedia(c: CallDoc) {
  const me = myUid();
  silent ??= silence();
  try {
    mic = await getMic();
    const a = audioCtx().createAnalyser();
    a.fftSize = 512;
    audioCtx().createMediaStreamSource(mic).connect(a);
    micAnalyser = a;
    useCall.setState({ error: null });
  } catch {
    mic = null;
    useCall.setState({ error: 'Microphone blocked. You can hear everyone, but they can’t hear you. Allow the microphone in your browser or device settings.' });
  }
  const [{ Peer }, { PEER_OPTIONS }] = await Promise.all([import('peerjs'), import('./p2p')]);
  if (useCall.getState().call?.id !== c.id) return;
  const p = new Peer(peerId(c.id, me), PEER_OPTIONS);
  peer = p;
  p.on('call', (call) => {
    const uid = call.peer.slice(call.peer.lastIndexOf('-') + 1);
    call.answer(mic ?? silent ?? undefined);
    attach(uid, call);
  });
  p.on('error', () => undefined);
  watchLevels();
  timer = window.setInterval(connectAll, 2000);
}

/** Calls everyone in the call that we should be calling (the larger account id calls, so each pair links once). */
function connectAll() {
  const c = useCall.getState().call;
  const me = myUid();
  if (!c || !peer?.open) return;
  const now = Date.now();
  for (const uid of c.joined) {
    if (uid === me || remotes.has(uid) || uid > me) continue;
    if (now - (tried.get(uid) ?? 0) < 3000) continue;
    tried.set(uid, now);
    attach(uid, peer.call(peerId(c.id, uid), mic ?? silent!));
  }
  for (const uid of [...remotes.keys()]) if (!c.joined.includes(uid)) {
    remotes.get(uid)?.call.close();
    remotes.delete(uid);
    syncPeers();
  }
}

function closeMedia() {
  clearInterval(timer);
  cancelAnimationFrame(raf);
  for (const r of remotes.values()) {
    r.el.srcObject = null;
    r.call.close();
  }
  remotes.clear();
  tried.clear();
  peer?.destroy();
  peer = null;
  mic?.getTracks().forEach((t) => t.stop());
  mic = null;
  micAnalyser = null;
}

function applyMute() {
  const muted = useCall.getState().micMuted;
  mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
}

/** The call document you're in changed: connect to new people, and end if everyone else is gone. */
function sync(doc: CallDoc | undefined) {
  const st = useCall.getState();
  const mine = st.call;
  if (!mine) return;
  if (!doc) {
    // A call that was only just made may not have reached the list yet.
    if (Date.now() - st.startedAt < 5000) return;
    // Someone closed it.
    void end(false);
    useUi.getState().toast({ text: 'The call ended.', kind: 'info' });
    return;
  }
  useCall.setState({ call: doc });
  const me = myUid();
  const others = doc.members.filter((u) => u !== me);
  if (doc.caller === me && doc.status === 'ringing') {
    const pending = others.filter((u) => !doc.declined.includes(u));
    if (!pending.length) {
      useUi.getState().toast({ text: others.length > 1 ? 'Nobody picked up.' : 'They declined the call.', kind: 'info' });
      void end(true);
      return;
    }
  }
  if (doc.status === 'active' && ringingOut) {
    audio.stopRing();
    ringingOut = 0;
  }
  // Everyone else left while it was active: hang up.
  if (doc.status === 'active' && doc.joined.length <= 1 && st.peers.length === 0 && Date.now() - st.startedAt > 8000) void end(true);
  connectAll();
}

async function begin(c: CallDoc, outgoing: boolean) {
  if (useCall.getState().call) await end(true);
  tried.clear();
  useCall.setState({ call: c, incoming: null, micMuted: false, deafened: false, speaking: {}, peers: [], error: null, startedAt: Date.now() });
  audio.stopRing();
  if (outgoing) {
    audio.startRing(false);
    ringingOut = window.setTimeout(() => {
      const cur = useCall.getState().call;
      if (cur?.id === c.id && cur.status === 'ringing') {
        useUi.getState().toast({ text: 'No answer.', kind: 'info' });
        void end(true);
      }
    }, RING_MS);
  }
  await openMedia(c);
}

/** Leaves the call (the last one out closes it for everyone). */
async function end(remote: boolean) {
  const c = useCall.getState().call;
  clearTimeout(ringingOut);
  ringingOut = 0;
  audio.stopRing();
  closeMedia();
  useCall.setState({ call: null, peers: [], speaking: {}, startedAt: 0 });
  if (c) audio.play('hangup');
  if (c && remote) await (await social()).hangUp(c).catch(() => undefined);
}

export const callActions = {
  /** Places a call to a conversation's people. */
  async start(convo: Parameters<Social['startCall']>[0], members: string[], names: Record<string, string>, title: string) {
    if (useCall.getState().call) return useUi.getState().toast({ text: 'You’re already in a call. Hang up first.', kind: 'warn' });
    if (!navigator.mediaDevices?.getUserMedia) return useUi.getState().toast({ text: 'This device can’t make calls.', kind: 'error' });
    try {
      const c = await (await social()).startCall(convo, members, names, title);
      await begin(c, true);
    } catch {
      useUi.getState().toast({ text: 'Couldn’t start the call.', kind: 'error' });
    }
  },
  async answer() {
    const c = useCall.getState().incoming;
    if (!c) return;
    try {
      await (await social()).answerCall(c.id);
      await begin({ ...c, joined: [...c.joined, myUid()], status: 'active' }, false);
    } catch {
      useUi.getState().toast({ text: 'Couldn’t join the call.', kind: 'error' });
    }
  },
  /** Joins an active group call from its chat. */
  async join(c: CallDoc) {
    if (useCall.getState().call) return;
    try {
      await (await social()).answerCall(c.id);
      await begin({ ...c, joined: [...c.joined, myUid()], status: 'active' }, false);
    } catch {
      useUi.getState().toast({ text: 'Couldn’t join the call.', kind: 'error' });
    }
  },
  async decline() {
    const c = useCall.getState().incoming;
    audio.stopRing();
    useCall.setState({ incoming: null });
    if (c) await (await social()).declineCall(c.id).catch(() => undefined);
  },
  hangUp: () => end(true),
  setMicMuted(on: boolean) {
    useCall.setState({ micMuted: on });
    applyMute();
  },
  setDeafened(on: boolean) {
    useCall.setState({ deafened: on });
    applyVolumes();
  },
};

/** Fed by the social layer with every call document this account can see. */
export function onCalls(calls: CallDoc[]) {
  const me = myUid();
  const now = Date.now();
  useCall.setState({ calls });
  sync(useCall.getState().call ? calls.find((c) => c.id === useCall.getState().call!.id) : undefined);
  // Someone is ringing us: a fresh ringing call we haven't answered or declined.
  if (useCall.getState().call) return;
  const ring = calls.find((c) => c.status === 'ringing' && c.caller !== me && !c.joined.includes(me) && !c.declined.includes(me) && now - c.createdAt < RING_MS);
  const cur = useCall.getState().incoming;
  if (ring && cur?.id !== ring.id) {
    useCall.setState({ incoming: ring });
    audio.startRing(true);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden)
      try {
        new Notification(`${ring.callerName} is calling`, { body: ring.kind === 'group' ? `Group call: ${ring.title}` : 'Open the game to answer.', tag: ring.id });
      } catch {
        /* some phones only allow notifications from a service worker */
      }
  } else if (!ring && cur) {
    audio.stopRing();
    useCall.setState({ incoming: null });
  }
  // Ringing calls that nobody answered stop ringing on their own.
  if (ring) {
    const left = RING_MS - (now - ring.createdAt);
    window.setTimeout(() => {
      if (useCall.getState().incoming?.id === ring.id) {
        audio.stopRing();
        useCall.setState({ incoming: null });
      }
    }, Math.max(0, left));
  }
}

/** Signed out or app closing: leave quietly. */
export function resetCalls() {
  audio.stopRing();
  closeMedia();
  useCall.setState({ call: null, incoming: null, calls: [], peers: [], speaking: {} });
}

addEventListener('pagehide', () => {
  const c = useCall.getState().call;
  closeMedia();
  if (c && api) void api.hangUp(c).catch(() => undefined);
});

// Changing the microphone in the settings applies to a call in progress.
useSettings.subscribe((s, prev) => {
  if (s.audio.micId === prev.audio.micId || !mic || !peer) return;
  void (async () => {
    mic?.getTracks().forEach((t) => t.stop());
    try {
      mic = await getMic();
    } catch {
      return;
    }
    const a = audioCtx().createAnalyser();
    a.fftSize = 512;
    audioCtx().createMediaStreamSource(mic).connect(a);
    micAnalyser = a;
    const track = mic.getAudioTracks()[0];
    for (const r of remotes.values()) for (const sender of r.call.peerConnection?.getSenders() ?? []) if (sender.track?.kind === 'audio') void sender.replaceTrack(track);
    applyMute();
  })();
});
useSettings.subscribe((s, prev) => s.audio !== prev.audio && applyVolumes());
