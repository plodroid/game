import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { registerBody, type VehicleType } from '@chromashift/shared';

/*
 * The supplied car models (made by scripts/process-cars.cjs, see docs/VELOCITY_EXPANSION_AUDIT.md).
 * They are files, so the game reads models/cars/cars.json at run time and adds the cars it lists to
 * the garage. If that file is missing, nothing is added and the procedural bodies are all there is.
 */

export interface WheelInfo {
  centre: [number, number, number];
  /** Visual tyre radius in metres, after the tyre scale was brought into 1.170 - 1.200. */
  radius: number;
  width: number;
}
export interface ImportedCar {
  id: string;
  file: string;
  name: string;
  type: VehicleType;
  rarity: string;
  size: [number, number, number];
  triangles: number;
  wheels: Record<'FL' | 'FR' | 'RL' | 'RR', WheelInfo>;
  licence: string;
  /** Filled in once the model has loaded. */
  scene?: THREE.Group;
}

const cars = new Map<string, ImportedCar>();
let loading: Promise<void> | null = null;

export const isImported = (id: string) => cars.has(id);
/** The car, only once its model has loaded. */
export const importedCar = (id: string) => {
  const c = cars.get(id);
  return c?.scene ? c : undefined;
};
export const importedList = () => [...cars.values()];

const base = () => `${import.meta.env.BASE_URL}models/cars/`;

/** Loads the list and every model. Safe to call many times; resolves with nothing added when there are no files. */
export function loadImportedCars(): Promise<void> {
  loading ??= (async () => {
    let list: ImportedCar[];
    try {
      const r = await fetch(`${base()}cars.json`);
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      list = ((await r.json()) as { cars: ImportedCar[] }).cars;
    } catch {
      return;
    }
    const loader = new GLTFLoader();
    await Promise.all(
      list.map(async (c) => {
        try {
          const g = await loader.loadAsync(`${base()}${c.file}`);
          c.scene = g.scene;
          cars.set(c.id, c);
          registerBody(c.id, { name: c.name, type: c.type, desc: `${c.type}. ${c.triangles.toLocaleString()} triangles.` });
        } catch (e) {
          console.warn('car model failed to load', c.file, e);
        }
      }),
    );
  })();
  return loading;
}
