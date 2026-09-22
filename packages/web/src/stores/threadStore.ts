import { create } from 'zustand';
import type { AgentThread, TicketWsMessage } from '@fleex/shared';
import * as api from '../services/api';

/**
 * Assistant ⇄ agent threads, keyed by ticket, newest first. Fed by the REST
 * reads and kept live through the `tickets` WS channel (`thread:*` messages).
 * Not persisted: threads are server state, reloaded on demand.
 */
export interface ThreadState {
  threadsByTicket: Record<string, AgentThread[]>;
  loadForTicket: (ticketId: string) => Promise<void>;
  /** Open threads across tickets — for the queue labels and the tool-strip dot. */
  loadOpen: () => Promise<void>;
  upsert: (thread: AgentThread) => void;
  applyWsMessage: (msg: TicketWsMessage) => void;
}

function sortNewestFirst(list: AgentThread[]): AgentThread[] {
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
}

/** Insert or replace by id inside one ticket's list. Exported for tests. */
export function upsertThread(list: readonly AgentThread[], thread: AgentThread): AgentThread[] {
  const without = list.filter((t) => t.id !== thread.id);
  return sortNewestFirst([...without, thread]);
}

export function isOpenThread(t: AgentThread): boolean {
  return t.status === 'running' || t.status === 'waiting';
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threadsByTicket: {},

  loadForTicket: async (ticketId) => {
    const threads = await api.fetchTicketThreads(ticketId);
    set((s) => ({ threadsByTicket: { ...s.threadsByTicket, [ticketId]: sortNewestFirst(threads) } }));
  },

  loadOpen: async () => {
    const open = await api.fetchOpenThreads();
    set((s) => {
      const next = { ...s.threadsByTicket };
      for (const t of open) next[t.ticketId] = upsertThread(next[t.ticketId] ?? [], t);
      return { threadsByTicket: next };
    });
  },

  upsert: (thread) => {
    set((s) => ({
      threadsByTicket: { ...s.threadsByTicket, [thread.ticketId]: upsertThread(s.threadsByTicket[thread.ticketId] ?? [], thread) },
    }));
  },

  applyWsMessage: (msg) => {
    if (msg.type === 'thread:created' || msg.type === 'thread:updated' || msg.type === 'thread:concluded') {
      get().upsert(msg.data as AgentThread);
    }
  },
}));

/** Open threads of one ticket (running or waiting). */
export function selectOpenByTicket(state: ThreadState, ticketId: string): AgentThread[] {
  return (state.threadsByTicket[ticketId] ?? []).filter(isOpenThread);
}
