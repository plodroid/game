/*
 * Writes the default engine loops into apps/client/public/sounds/. They are modelled (see
 * engineSynth.ts), not recordings: replace any of these files with a real recording of the same
 * name (a seamless loop near the stated revs) and the game uses it instead.
 *
 *   node --experimental-strip-types scripts/make-engine-sounds.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { backfire, ENGINE_VOICES, engineLoop, LOOP_RPM, wav } from '../apps/client/src/audio/engineSynth.ts';

const RATE = 32000;
const dir = new URL('../apps/client/public/sounds/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, rpm] of Object.entries(LOOP_RPM)) {
  const bytes = wav(engineLoop(ENGINE_VOICES.v8, rpm, RATE), RATE);
  writeFileSync(new URL(`${name}.wav`, dir), bytes);
  console.log(`${name}.wav  ${rpm} rpm  ${(bytes.length / 1024).toFixed(0)} KB`);
}
writeFileSync(new URL('backfire.wav', dir), wav(backfire(RATE), RATE));
console.log('backfire.wav');
