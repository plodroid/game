import { create } from 'zustand';
import { COSMETIC_ITEMS, gate, runCommand, WEAPON_IDS, type CommandContext, type Grant, type Mods, type Simulation } from '@chromashift/shared';
import { env } from '../env';
import { useProfile } from '../state/profile';
import { useAccount } from './account';

/**
 * Admin commands. Nobody else can check an email address, so the owner is a specific account (its
 * Firebase user id). A host verifies another player's claim by checking the signature of their
 * Firebase sign-in token, so it can't be faked. Anyone else is made an admin with /admin and only
 * for that room.
 */
export const OWNER_UID = 'wTN0PHGyT4cdL80qJBGyYJYXZRk1';

/** Is this device signed in as the owner? (On the local test servers any signed-in account counts.) */
export function isOwner() {
  const uid = useAccount.getState().user?.uid;
  return !!uid && (uid === OWNER_UID || env.emulator);
}

gate.check = isOwner;

/** Admin modifiers of every player in the current match, for drawing and prediction. */
export const useMods = create<{ mods: Record<number, Mods> }>()(() => ({ mods: {} }));

const JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keys: { at: number; list: (JsonWebKey & { kid?: string })[] } | null = null;

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s)));

/** Checks a Firebase ID token's signature, audience and expiry; true if it belongs to the owner. */
export async function verifyOwnerToken(token: string): Promise<boolean> {
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return false;
    const claims = json(p) as { sub?: string; aud?: string; iss?: string; exp?: number };
    if (env.emulator) return !!claims.sub; // the emulators sign nothing
    const project = env.firebase.projectId;
    if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}` || (claims.exp ?? 0) * 1000 < Date.now()) return false;
    if (claims.sub !== OWNER_UID) return false;
    if (!keys || Date.now() - keys.at > 3_600_000) keys = { at: Date.now(), list: ((await (await fetch(JWKS)).json()) as { keys: JsonWebKey[] }).keys };
    const jwk = keys.list.find((k) => k.kid === (json(h) as { kid?: string }).kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(sig), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return false;
  }
}

/** What a browser-hosted room asks to decide who may use admin commands. */
export async function authorize(who: { isHost: boolean; token?: string }): Promise<'owner' | null> {
  if (who.isHost) return isOwner() ? 'owner' : null;
  return who.token && (await verifyOwnerToken(who.token)) ? 'owner' : null;
}

/** Applies a grant from an admin to this account. */
export function applyGrant(g: Grant) {
  const p = useProfile.getState();
  const items = g.all ? [...COSMETIC_ITEMS.map((i) => i.key), ...WEAPON_IDS.map((w) => `weapon:${w}`)] : (g.items ?? []);
  useProfile.setState({
    coins: p.coins + Math.max(0, Math.floor(g.coins ?? 0)),
    xp: p.xp + Math.max(0, Math.floor(g.xp ?? 0)),
    owned: [...new Set([...p.owned, ...items])],
    dirty: true,
    updatedAt: Date.now(),
  });
}

/** The offline match being played, if any, so commands can reach its simulation. */
export const offline: { sim: Simulation | null } = { sim: null };
const localMods = new Map<number, Mods>();

/** Runs a command in an offline match (the player is the only human, and the owner). */
export function runLocal(line: string, who: { name: string }) {
  const sim = offline.sim;
  // The human is always player 1 in an offline match.
  const me = { id: 1, name: who.name };
  const ctx: CommandContext = {
    sim,
    sender: { pid: me.id, name: me.name, owner: true },
    players: (sim?.players ?? []).map((p) => ({ pid: p.id, name: p.info.name })),
    grant: (pid, g) => pid === me.id && applyGrant(g),
    setAdmin: () => 'Nobody else is in an offline game.',
    mods: localMods,
    modsChanged: () => useMods.setState({ mods: Object.fromEntries(localMods) }),
  };
  return runCommand(line, ctx);
}

export function resetLocalMods() {
  localMods.clear();
  useMods.setState({ mods: {} });
}
