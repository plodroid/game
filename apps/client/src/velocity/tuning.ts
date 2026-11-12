import { sanitizeHandling, type Handling } from '@chromashift/shared';

/** The owner's VELOCITY handling (config/velocity), used by every race this device runs or hosts. */
export const tuning: { handling: Partial<Handling> | null } = { handling: null };

export function applyTuningJson(json: string | null) {
  if (!json) return;
  try {
    tuning.handling = sanitizeHandling(JSON.parse(json));
  } catch {
    /* keep the defaults */
  }
}
