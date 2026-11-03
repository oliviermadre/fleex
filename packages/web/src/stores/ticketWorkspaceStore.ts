import { useEffect } from 'react';
import { create } from 'zustand';
import type { Ticket } from '@fleex/shared';
import * as api from '../services/api';

/**
 * Each ticket's workspace folder name, as resolved by the server.
 *
 * The folder is named after the title the ticket had when its workspace was
 * created and never moves, so after a rename the client can't derive it from
 * the title any more — it asks the server (`GET /api/tickets/:id/workspace`).
 * `title` is the title at fetch time: a rename triggers a re-fetch, because a
 * ticket with no workspace yet gets one named after its *current* title.
 */
interface Entry {
  title: string;
  workspaceId: string;
}

interface TicketWorkspaceState {
  byTicket: Record<string, Entry>;
  load: (ticket: Pick<Ticket, 'id' | 'title'>) => Promise<void>;
  set: (ticketId: string, entry: Entry) => void;
}

const inflight = new Set<string>();

export const useTicketWorkspaceStore = create<TicketWorkspaceState>((set) => ({
  byTicket: {},
  load: async ({ id, title }) => {
    const key = `${id}\u0000${title}`;
    if (inflight.has(key)) return;
    inflight.add(key);
    try {
      const res = await api.fetchTicketWorkspace(id);
      if (res) set((s) => ({ byTicket: { ...s.byTicket, [id]: { title, workspaceId: res.workspaceId } } }));
    } finally {
      inflight.delete(key);
    }
  },
  set: (ticketId, entry) => set((s) => ({ byTicket: { ...s.byTicket, [ticketId]: entry } })),
}));

/** The ticket's workspace folder name; null until the server has answered. */
export function useTicketWorkspaceId(ticket: Pick<Ticket, 'id' | 'title'> | null | undefined): string | null {
  const id = ticket?.id;
  const title = ticket?.title;
  const entry = useTicketWorkspaceStore((s) => (id ? s.byTicket[id] : undefined));
  const load = useTicketWorkspaceStore((s) => s.load);
  const fetchedTitle = entry?.title;

  useEffect(() => {
    if (id && title !== undefined && fetchedTitle !== title) void load({ id, title });
  }, [id, title, fetchedTitle, load]);

  return entry?.workspaceId ?? null;
}
