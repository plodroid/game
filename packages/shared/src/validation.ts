/** Username rules. Change the bounds here; the client form, Firestore rules doc and tests read them. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const DISPLAY_NAME_MAX = 24;
export const PASSWORD_MIN = 10;

const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'system', 'server', 'root', 'owner',
  'chromashift', 'official', 'dev', 'developer', 'null', 'undefined', 'guest', 'bot', 'everyone', 'anonymous',
]);
// Deliberately short: catches the obvious cases without pretending to be a full moderation system.
const BLOCKED_PARTS = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'nazi', 'hitler', 'rape', 'whore', 'slut'];

/** Lower-cased key used for case-insensitive uniqueness. */
export const usernameKey = (name: string) => name.trim().toLowerCase();

export function validateUsername(name: string): string | null {
  const n = name.trim();
  if (n.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (n.length > USERNAME_MAX) return `Use at most ${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(n)) return 'Letters, numbers, and . _ - only — and start and end with a letter or number.';
  if (/[._-]{2}/.test(n)) return 'Avoid repeating . _ or - back to back.';
  const key = usernameKey(n);
  if (RESERVED.has(key)) return 'That name is reserved.';
  const squashed = key.replace(/[._-]/g, '');
  if (BLOCKED_PARTS.some((w) => squashed.includes(w))) return 'Please choose a different name.';
  return null;
}

export function validateDisplayName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Display name can’t be empty.';
  if (n.length > DISPLAY_NAME_MAX) return `Use at most ${DISPLAY_NAME_MAX} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return 'Display name contains invalid characters.';
  return null;
}

/** 0 (weak) to 4 (strong): length plus how many kinds of character it mixes. */
export function passwordStrength(pw: string): number {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < PASSWORD_MIN) return Math.min(1, kinds);
  return Math.min(4, (pw.length >= 14 ? 2 : 1) + Math.max(0, kinds - 2));
}

/** A strong password: long enough, mixing upper case, lower case, numbers and a symbol, and not the username. */
export function validatePassword(pw: string, username = ''): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) return 'Mix upper and lower case letters.';
  if (!/[0-9]/.test(pw)) return 'Add at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Add at least one symbol, like ! ? # or *.';
  const u = username.trim().toLowerCase();
  if (u.length >= 3 && pw.toLowerCase().includes(u)) return 'Don’t put your username in your password.';
  if (/(.)\1\1\1/.test(pw)) return 'Avoid repeating the same character.';
  return null;
}

export const validateEmail = (e: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) ? null : 'Enter a valid email address.');

/** Sanitises a name shown to other players (guests and bots). */
export function cleanPlayerName(name: unknown, fallback = 'Player'): string {
  if (typeof name !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const n = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, DISPLAY_NAME_MAX);
  return n || fallback;
}

// Room codes avoid look-alike characters (0/O, 1/I/L).
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export function generateRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  return s;
}

/** Normalises user-typed codes (case, spaces, dashes). Returns null if it can't be a valid code. */
export function normalizeRoomCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of c) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return c;
}
