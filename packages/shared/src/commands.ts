import { COSMETIC_ITEMS } from './config/cosmetics';
import { WEAPON_IDS, WEAPONS } from './config/weapons';
import { MAX_HP, MAX_INK } from './constants';
import type { Simulation } from './sim/simulation';
import type { SimPlayer } from './sim/player';

/** Admin chat commands, Minecraft style: `/give plodroid coins 500`, `/size plodroid 4.6`. */

export type ArgKind = 'player' | 'number' | 'item' | 'onoff';
export interface CommandDef {
  name: string;
  help: string;
  args: { name: string; kind: ArgKind; optional?: boolean }[];
  /** Only the owner account may use it. */
  owner?: boolean;
}

export const COMMANDS: CommandDef[] = [
  { name: 'help', help: 'List the commands', args: [] },
  { name: 'give', help: 'Give coins, xp, an item or a weapon (or "all")', args: [{ name: 'player', kind: 'player' }, { name: 'item', kind: 'item' }, { name: 'amount', kind: 'number', optional: true }] },
  { name: 'size', help: 'Change a player’s size (0.3 to 6)', args: [{ name: 'player', kind: 'player' }, { name: 'scale', kind: 'number' }] },
  { name: 'speed', help: 'Change a player’s speed (0.2 to 4)', args: [{ name: 'player', kind: 'player' }, { name: 'multiplier', kind: 'number' }] },
  { name: 'heal', help: 'Refill health and ink', args: [{ name: 'player', kind: 'player', optional: true }] },
  { name: 'god', help: 'Take no damage, on or off', args: [{ name: 'player', kind: 'player' }, { name: 'state', kind: 'onoff', optional: true }] },
  { name: 'tp', help: 'Teleport a player to another player', args: [{ name: 'player', kind: 'player' }, { name: 'to', kind: 'player' }] },
  { name: 'kill', help: 'Splat a player', args: [{ name: 'player', kind: 'player' }] },
  { name: 'reset', help: 'Reset size, speed and god mode', args: [{ name: 'player', kind: 'player', optional: true }] },
  { name: 'admin', help: 'Make a player an admin in this room', args: [{ name: 'player', kind: 'player' }], owner: true },
  { name: 'deadmin', help: 'Remove a player’s admin rights', args: [{ name: 'player', kind: 'player' }], owner: true },
];

/** Every key /give accepts besides coins, xp and all. */
export const GIVE_ITEMS: string[] = [
  'coins',
  'xp',
  'all',
  ...WEAPON_IDS.map((w) => `weapon:${w}`),
  ...COSMETIC_ITEMS.filter((i) => i.price > 0).map((i) => i.key),
];

export interface Suggestion {
  /** What is shown. */
  label: string;
  /** What replaces the word being typed. */
  insert: string;
  hint?: string;
}
export interface Completion {
  /** Index in the input where the word being typed starts. */
  from: number;
  options: Suggestion[];
  /** The expected shape of the command, once its name is known. */
  usage?: string;
}

const usageOf = (c: CommandDef) =>
  `/${c.name} ${c.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(' ')}`.trim();

const itemName = (k: string) =>
  k.startsWith('weapon:') ? WEAPONS[k.slice(7) as keyof typeof WEAPONS]?.name : COSMETIC_ITEMS.find((i) => i.key === k)?.name;

/** Predicts what to type next: command names, then each argument (players in the room, items, on/off). */
export function complete(input: string, players: string[], owner: boolean): Completion | null {
  if (!input.startsWith('/')) return null;
  const parts = input.slice(1).split(' ');
  const word = parts[parts.length - 1];
  const from = input.length - word.length;
  const w = word.toLowerCase();
  if (parts.length === 1) {
    const options = COMMANDS.filter((c) => (owner || !c.owner) && c.name.startsWith(w)).map((c) => ({
      label: `/${c.name}`,
      insert: `${c.name} `,
      hint: c.help,
    }));
    return { from, options };
  }
  const def = COMMANDS.find((c) => c.name === parts[0].toLowerCase());
  if (!def) return { from, options: [] };
  const arg = def.args[parts.length - 2];
  const usage = usageOf(def);
  if (!arg) return { from, usage, options: [] };
  const take = (list: Suggestion[]) => list.filter((s) => s.insert.toLowerCase().startsWith(w)).slice(0, 8);
  if (arg.kind === 'player')
    return {
      from,
      usage,
      options: take([
        ...players.map((n) => ({ label: n, insert: `${n} ` })),
        { label: 'me', insert: 'me ', hint: 'yourself' },
        { label: 'all', insert: 'all ', hint: 'everyone' },
      ]),
    };
  if (arg.kind === 'item')
    return { from, usage, options: take(GIVE_ITEMS.map((k) => ({ label: k, insert: `${k} `, hint: itemName(k) }))) };
  if (arg.kind === 'onoff')
    return { from, usage, options: take([{ label: 'on', insert: 'on ' }, { label: 'off', insert: 'off ' }]) };
  return { from, usage: `${usage}   (${arg.name}: a number)`, options: [] };
}

export interface Mods {
  speed: number;
  size: number;
  god: boolean;
}
export type Grant = { coins?: number; xp?: number; items?: string[]; all?: boolean };

export interface CommandContext {
  /** The running match (null in a lobby). */
  sim: Simulation | null;
  sender: { pid: number; name: string; owner: boolean };
  players: { pid: number; name: string }[];
  /** Applies a grant to a player's account (client-side state). */
  grant(pid: number, g: Grant): void;
  setAdmin(pid: number, on: boolean): string | null;
  mods: Map<number, Mods>;
  modsChanged(): void;
}

export interface CommandResult {
  ok: boolean;
  text: string;
}

const fail = (text: string): CommandResult => ({ ok: false, text });
const done = (text: string): CommandResult => ({ ok: true, text });
const num = (s: string | undefined) => (s !== undefined && s.trim() !== '' && Number.isFinite(+s) ? +s : NaN);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function targets(ctx: CommandContext, who: string | undefined): { pid: number; name: string }[] | string {
  if (!who || who === 'me') return [{ pid: ctx.sender.pid, name: ctx.sender.name }];
  if (who === 'all') return ctx.players;
  const w = who.toLowerCase();
  const exact = ctx.players.find((p) => p.name.toLowerCase() === w);
  if (exact) return [exact];
  const part = ctx.players.filter((p) => p.name.toLowerCase().startsWith(w));
  if (part.length === 1) return part;
  return part.length ? `More than one player matches "${who}"` : `No player called "${who}"`;
}

const modsOf = (ctx: CommandContext, pid: number) => {
  let m = ctx.mods.get(pid);
  if (!m) ctx.mods.set(pid, (m = { speed: 1, size: 1, god: false }));
  return m;
};

function applyToSim(ctx: CommandContext, pid: number) {
  const p = ctx.sim?.byId(pid);
  const m = ctx.mods.get(pid);
  if (p && m) {
    p.speedMult = m.speed === 1 ? undefined : m.speed;
    p.size = m.size === 1 ? undefined : m.size;
    p.god = m.god || undefined;
  }
}

/** Runs one command line for an admin. The caller has already checked the sender is allowed. */
export function runCommand(line: string, ctx: CommandContext): CommandResult {
  const [raw, ...args] = line.trim().replace(/^\//, '').split(/\s+/);
  const def = COMMANDS.find((c) => c.name === raw?.toLowerCase());
  if (!def) return fail('Unknown command. Type /help for the list.');
  if (def.owner && !ctx.sender.owner) return fail('Only the owner can do that.');
  if (args.length < def.args.filter((a) => !a.optional).length) return fail(`Usage: ${usageOf(def)}`);
  if (def.name === 'help') return done(COMMANDS.filter((c) => !c.owner || ctx.sender.owner).map(usageOf).join('  ·  '));

  const who = targets(ctx, args[0]);
  if (typeof who === 'string') return fail(who);
  const names = who.length === 1 ? who[0].name : `${who.length} players`;
  const simP = (pid: number): SimPlayer | undefined => ctx.sim?.byId(pid);

  switch (def.name) {
    case 'give': {
      const item = args[1]?.toLowerCase() ?? '';
      const amount = args[2] === undefined ? undefined : num(args[2]);
      if (amount !== undefined && !(amount >= 1 && amount <= 1e7)) return fail('The amount must be a number from 1 to 10,000,000.');
      if (item === 'coins' || item === 'xp') {
        const n = Math.floor(amount ?? 1000);
        for (const t of who) ctx.grant(t.pid, item === 'coins' ? { coins: n } : { xp: n });
        return done(`Gave ${n.toLocaleString()} ${item} to ${names}.`);
      }
      if (item === 'all') {
        for (const t of who) ctx.grant(t.pid, { all: true });
        return done(`Unlocked everything for ${names}.`);
      }
      const key = GIVE_ITEMS.find((k) => k === item || k === `weapon:${item}` || k.endsWith(`:${item}`));
      if (!key) return fail(`Unknown item "${item}". Try coins, xp, all, a weapon or a locker item (slot:name).`);
      for (const t of who) ctx.grant(t.pid, { items: [key] });
      return done(`Gave ${key} to ${names}.`);
    }
    case 'size':
    case 'speed': {
      const v = num(args[1]);
      if (!Number.isFinite(v)) return fail(`Usage: ${usageOf(def)}`);
      const x = def.name === 'size' ? clamp(v, 0.3, 6) : clamp(v, 0.2, 4);
      for (const t of who) {
        modsOf(ctx, t.pid)[def.name] = x;
        applyToSim(ctx, t.pid);
      }
      ctx.modsChanged();
      return done(`${def.name === 'size' ? 'Size' : 'Speed'} of ${names} is now ${x}.`);
    }
    case 'god': {
      const on = args[1]?.toLowerCase();
      if (on !== undefined && on !== 'on' && on !== 'off') return fail('Use on or off.');
      for (const t of who) {
        const m = modsOf(ctx, t.pid);
        m.god = on === undefined ? !m.god : on === 'on';
        applyToSim(ctx, t.pid);
      }
      ctx.modsChanged();
      return done(`God mode ${on ?? 'toggled'} for ${names}.`);
    }
    case 'reset': {
      for (const t of who) {
        ctx.mods.delete(t.pid);
        const p = simP(t.pid);
        if (p) p.speedMult = p.size = p.god = undefined;
      }
      ctx.modsChanged();
      return done(`Reset ${names}.`);
    }
    case 'heal': {
      if (!ctx.sim) return fail('Only works during a match.');
      for (const t of who) {
        const p = simP(t.pid);
        if (p?.alive) {
          p.hp = MAX_HP;
          p.ink = MAX_INK;
          p.charge = 1;
        }
      }
      return done(`Healed ${names}.`);
    }
    case 'kill': {
      if (!ctx.sim) return fail('Only works during a match.');
      for (const t of who) {
        const p = simP(t.pid);
        if (p?.alive) ctx.sim.kill(p, ctx.sender.pid, 'special');
      }
      return done(`Splatted ${names}.`);
    }
    case 'tp': {
      if (!ctx.sim) return fail('Only works during a match.');
      const to = targets(ctx, args[1]);
      if (typeof to === 'string') return fail(to);
      const dest = simP(to[0].pid);
      if (!dest?.alive) return fail(`${to[0].name} isn't in the arena right now.`);
      for (const t of who) {
        const p = simP(t.pid);
        if (!p?.alive || p === dest) continue;
        p.pos.x = dest.pos.x + 1.2;
        p.pos.y = dest.pos.y + 0.3;
        p.pos.z = dest.pos.z;
        p.vel.x = p.vel.y = p.vel.z = 0;
        p.collider.setTranslation(p.pos);
      }
      return done(`Teleported ${names} to ${to[0].name}.`);
    }
    case 'admin':
    case 'deadmin': {
      const on = def.name === 'admin';
      const bad = who.map((t) => ctx.setAdmin(t.pid, on)).find((e) => e);
      return bad ? fail(bad) : done(`${names} ${on ? 'is now an admin' : 'is no longer an admin'}.`);
    }
  }
  return fail('Unhandled command.');
}
