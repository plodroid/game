import { useSettings } from '../settings/settings';

/** Opens the microphone the player chose in the audio settings (or the system default). */
export async function getMic(): Promise<MediaStream> {
  const id = useSettings.getState().audio.micId;
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (id) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: id } } });
    } catch (e) {
      // That microphone was unplugged: fall back to the default instead of failing.
      if ((e as { name?: string }).name === 'NotAllowedError') throw e;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

export interface MicDevice {
  id: string;
  label: string;
}

/** Microphones the browser knows about. Names appear once the microphone has been allowed. */
export async function listMics(): Promise<MicDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}
