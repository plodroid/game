/*
 * Turns almost any picture, sound or video into something small and universal before it is sent:
 * pictures become PNG, sounds become MP3, videos become MP4. Everything is converted in the browser,
 * so what a file can be read as depends on what the browser itself can open (HEIC is added for
 * browsers that can't). Messages live in the chat database, so there is a size limit: pictures
 * shrink to fit, sounds are cut at 70 seconds and videos at 10.
 */

export type Converted =
  | { kind: 'image'; url: string }
  | { kind: 'audio'; url: string; duration: number }
  | { kind: 'video'; url: string; duration: number };

export const MAX_AUDIO_SECONDS = 70;
export const MAX_VIDEO_SECONDS = 10;
const IMAGE_MAX_CHARS = 410_000;
const AUDIO_MAX_CHARS = 395_000;
const VIDEO_MAX_CHARS = 690_000;

const ext = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
const IMAGE_EXT = /^(png|jpe?g|gif|webp|avif|bmp|heic|heif|tiff?|svg|ico|jfif)$/;
const AUDIO_EXT = /^(mp3|wav|ogg|oga|opus|m4a|aac|flac|wma|aiff?|amr|weba)$/;
const VIDEO_EXT = /^(mp4|m4v|mov|mkv|webm|avi|3gp|ogv|wmv|mpe?g|ts)$/;

export function mediaKind(f: File): 'image' | 'audio' | 'video' | null {
  if (f.type.startsWith('image/') || IMAGE_EXT.test(ext(f))) return 'image';
  if (f.type.startsWith('audio/') || AUDIO_EXT.test(ext(f))) return 'audio';
  if (f.type.startsWith('video/') || VIDEO_EXT.test(ext(f))) return 'video';
  return null;
}

const readAsDataUrl = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });

async function toPng(file: File): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    if (!/heic|heif/i.test(file.type + file.name)) throw new Error('This browser can’t open that picture.');
    // Most browsers can't read HEIC (iPhone photos): convert it first.
    try {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/png' });
      bmp = await createImageBitmap(Array.isArray(out) ? out[0] : out);
    } catch {
      throw new Error('Couldn’t read that HEIC picture.');
    }
  }
  for (const max of [1280, 960, 720, 540, 400, 300]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    if (url.length < IMAGE_MAX_CHARS) return url;
  }
  throw new Error('That picture is too detailed to send.');
}

async function toMp3(file: File): Promise<{ url: string; duration: number }> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('This browser can’t open that sound.');
  } finally {
    void ctx.close();
  }
  const rate = 22050;
  const seconds = Math.min(decoded.duration, MAX_AUDIO_SECONDS);
  // Mix down to one channel at a low rate: small enough to send, plenty for speech and short music.
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const ints = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) ints[i] = Math.max(-1, Math.min(1, pcm[i])) * 0x7fff;
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(1, rate, 32);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < ints.length; i += 1152) {
    const b = enc.encodeBuffer(ints.subarray(i, i + 1152));
    if (b.length) parts.push(new Uint8Array(b));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  const url = await readAsDataUrl(new Blob(parts as BlobPart[], { type: 'audio/mpeg' }));
  if (url.length > AUDIO_MAX_CHARS) throw new Error('That sound is too long to send.');
  return { url, duration: Math.round(seconds * 10) / 10 };
}

async function toMp4(file: File): Promise<{ url: string; duration: number }> {
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('This browser can’t convert videos.');
  const v = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  v.src = objectUrl;
  v.muted = true;
  v.playsInline = true;
  try {
    await new Promise<void>((ok, no) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => no(new Error('This browser can’t open that video.'));
    });
    const k = Math.min(1, 360 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round((v.videoWidth * k) / 2) * 2);
    c.height = Math.max(2, Math.round((v.videoHeight * k) / 2) * 2);
    const g = c.getContext('2d')!;
    const stream = c.captureStream(24);
    // The sound rides along when the browser exposes it.
    const cap = (v as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    cap?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 330_000, audioBitsPerSecond: 40_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((ok) => (rec.onstop = () => ok()));
    const seconds = Math.min(Number.isFinite(v.duration) ? v.duration : MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS);
    let raf = 0;
    const draw = () => {
      g.drawImage(v, 0, 0, c.width, c.height);
      if (v.ended || v.currentTime >= seconds) return rec.state !== 'inactive' && rec.stop();
      raf = requestAnimationFrame(draw);
    };
    rec.start(250);
    await v.play();
    draw();
    // A stuck video must never hold the chat: stop a little after it should have finished.
    const guard = setTimeout(() => rec.state !== 'inactive' && rec.stop(), (seconds + 4) * 1000);
    await done;
    clearTimeout(guard);
    cancelAnimationFrame(raf);
    const url = await readAsDataUrl(new Blob(chunks, { type: mime.split(';')[0] }));
    if (url.length > VIDEO_MAX_CHARS) throw new Error('That video is too big to send. Try a shorter one.');
    return { url, duration: Math.round(seconds * 10) / 10 };
  } finally {
    v.pause();
    URL.revokeObjectURL(objectUrl);
  }
}

/** Converts a picked file for sending, or throws an Error whose message is fit to show the player. */
export async function convertMedia(file: File): Promise<Converted> {
  const kind = mediaKind(file);
  if (kind === 'image') return { kind, url: await toPng(file) };
  if (kind === 'audio') return { kind, ...(await toMp3(file)) };
  if (kind === 'video') return { kind, ...(await toMp4(file)) };
  throw new Error('That kind of file can’t be sent. Try a picture, sound or video.');
}
