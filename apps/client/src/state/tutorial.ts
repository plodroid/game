import { create } from 'zustand';

/** True while the guided tutorial runs over an offline practice match. */
export const useTutorial = create<{ active: boolean }>()(() => ({ active: false }));
