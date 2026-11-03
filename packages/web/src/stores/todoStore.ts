/**
 * The shared todo list of each ticket — what the Todo tool window shows and
 * the ToolStrip badge counts.
 *
 * Live over the `tickets` WS channel (todo:created/updated/deleted): an item an
 * agent checks from its CLI shows up without reload, with a brief flash.
 * Writes are optimistic (the row changes at once, the server answer replaces
 * it, a failure restores the previous row — `request()` already toasts it).
 */
import { create } from 'zustand';
import type { TicketTodoItem, TicketWsMessage } from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';

/** How long a row flashes after a change it did not make itself. */
export const TODO_FLASH_MS = 1600;

interface TodoState {
  byTicket: Record<string, TicketTodoItem[]>;
  /** Tickets whose list failed to load (the panel says so). */
  loadError: Record<string, boolean>;
  /** Item ids changed from elsewhere (agent, CLI, other tab), flashing. */
  flashing: Record<string, true>;

  load: (ticketId: string) => Promise<void>;
  /** Create items in order (several = a pasted multi-line block). */
  add: (ticketId: string, texts: string[]) => Promise<void>;
  update: (ticketId: string, itemId: string, patch: api.TodoPatch) => Promise<TicketTodoItem | null>;
  remove: (ticketId: string, itemId: string) => Promise<boolean>;
  /** Hide an item locally (deferred delete with Undo) — `restore` puts it back. */
  hide: (ticketId: string, itemId: string) => TicketTodoItem | null;
  restore: (ticketId: string, item: TicketTodoItem) => void;
}

const byPosition = (a: TicketTodoItem, b: TicketTodoItem) => a.position - b.position || a.ref - b.ref;

function upsert(list: TicketTodoItem[] | undefined, item: TicketTodoItem): TicketTodoItem[] {
  return [...(list ?? []).filter((x) => x.id !== item.id), item].sort(byPosition);
}

/** Open items: what the ToolStrip badge counts. */
export function openTodoCount(list: readonly TicketTodoItem[] | undefined): number {
  return (list ?? []).filter((i) => i.state === 'open').length;
}

let wsInstalled = false;
/** Ids this tab is writing right now: their WS echo must not flash. */
const ownWrites = new Set<string>();

export const useTodoStore = create<TodoState>((set, get) => {
  const setList = (ticketId: string, fn: (list: TicketTodoItem[] | undefined) => TicketTodoItem[]) =>
    set((s) => ({ byTicket: { ...s.byTicket, [ticketId]: fn(s.byTicket[ticketId]) } }));

  const flash = (id: string) => {
    set((s) => ({ flashing: { ...s.flashing, [id]: true } }));
    setTimeout(() => set((s) => {
      const { [id]: _gone, ...rest } = s.flashing;
      return { flashing: rest };
    }), TODO_FLASH_MS);
  };

  const installWs = () => {
    if (wsInstalled) return;
    wsInstalled = true;
    appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'todo:created' || msg.type === 'todo:updated') {
        const item = msg.data as TicketTodoItem;
        if (!get().byTicket[item.ticketId]) return;
        setList(item.ticketId, (l) => upsert(l, item));
        if (!ownWrites.has(item.id)) flash(item.id);
      } else if (msg.type === 'todo:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (get().byTicket[d.ticketId]) setList(d.ticketId, (l) => (l ?? []).filter((x) => x.id !== d.id));
      }
    });
  };

  /** Mark `id` as ours for the duration of `fn` (plus the WS echo's flight time). */
  const asOwn = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    ownWrites.add(id);
    try {
      return await fn();
    } finally {
      setTimeout(() => ownWrites.delete(id), 1000);
    }
  };

  return {
    byTicket: {},
    loadError: {},
    flashing: {},

    load: async (ticketId) => {
      installWs();
      try {
        const list = await api.fetchTicketTodos(ticketId);
        set((s) => ({
          byTicket: { ...s.byTicket, [ticketId]: [...list].sort(byPosition) },
          loadError: { ...s.loadError, [ticketId]: false },
        }));
      } catch {
        set((s) => ({ loadError: { ...s.loadError, [ticketId]: true } }));
      }
    },

    add: async (ticketId, texts) => {
      for (const text of texts) {
        const result = await api.createTicketTodo(ticketId, { text }).catch(() => null);
        if (!result) return;
        ownWrites.add(result.item.id);
        setTimeout(() => ownWrites.delete(result.item.id), 1000);
        setList(ticketId, (l) => upsert(l, result.item));
      }
    },

    update: async (ticketId, itemId, patch) => {
      const before = get().byTicket[ticketId]?.find((i) => i.id === itemId);
      if (before && patch.state !== undefined) {
        // Optimistic: the checkbox flips at once.
        setList(ticketId, (l) => upsert(l, { ...before, state: patch.state! }));
      }
      const result = await asOwn(itemId, () => api.updateTicketTodo(ticketId, itemId, patch)).catch(() => null);
      if (!result) {
        if (before) setList(ticketId, (l) => upsert(l, before));
        return null;
      }
      setList(ticketId, (l) => upsert(l, result.item));
      return result.item;
    },

    remove: async (ticketId, itemId) => {
      const ok = await asOwn(itemId, () => api.deleteTicketTodo(ticketId, itemId)).then(() => true, () => false);
      if (ok) setList(ticketId, (l) => (l ?? []).filter((x) => x.id !== itemId));
      return ok;
    },

    hide: (ticketId, itemId) => {
      const item = get().byTicket[ticketId]?.find((i) => i.id === itemId) ?? null;
      if (item) setList(ticketId, (l) => (l ?? []).filter((x) => x.id !== itemId));
      return item;
    },

    restore: (ticketId, item) => setList(ticketId, (l) => upsert(l, item)),
  };
});
