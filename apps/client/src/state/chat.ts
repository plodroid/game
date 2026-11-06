import { create } from 'zustand';
import { isOwner, runLocal } from '../auth/admin';
import { useUi } from './ui';
import { cleanChat, MSG, type ChatLine } from '@chromashift/shared';

export interface Line extends ChatLine {
  key: number;
  at: number;
}

interface ChatStore {
  lines: Line[];
  open: boolean;
  /** The next message goes to your team only. */
  team: boolean;
  push(l: ChatLine): void;
  setOpen(open: boolean): void;
  setTeam(team: boolean): void;
  clear(): void;
}

let key = 1;

export const useChat = create<ChatStore>()((set) => ({
  lines: [],
  open: false,
  team: false,
  push: (l) => set((s) => ({ lines: [...s.lines, { ...l, key: key++, at: Date.now() }].slice(-60) })),
  setOpen: (open) => set({ open }),
  setTeam: (team) => set({ team }),
  clear: () => set({ lines: [], open: false }),
}));

/**
 * Sends a line: to the room when online (the host relays and rate-limits it), or straight into
 * the log in an offline match, where only bots would hear it anyway.
 */
export function say(text: string, room: { send(type: string, payload: unknown): void } | null, me: { id: number; name: string; team: number }) {
  const clean = cleanChat(text);
  if (!clean) return;
  const team = useChat.getState().team;
  // The owner's slash commands go to the host (online) or run right here (offline).
  if (clean.startsWith('/') && isOwner()) return void command(clean, room, me);
  if (room) room.send(MSG.CHAT, { text: clean, team });
  else useChat.getState().push({ id: me.id, name: me.name, team: me.team, text: clean, toTeam: team });
}

async function command(line: string, room: { send(type: string, payload: unknown): void } | null, me: { id: number; name: string }) {
  if (room) return room.send(MSG.CMD, { line, token: (await (await import('../auth/firebase')).idToken()) ?? undefined });
  const r = runLocal(line, me);
  useUi.getState().toast({ text: r.text, kind: r.ok ? 'info' : 'error', ttl: 7000 });
}
