import { create } from 'zustand';
import type { TicketUnreadCounts, TicketReadCursors } from '@fleex/shared';
import * as api from '../services/api';

interface UnreadState {
  /** Per-ticket unread counts (from bulk endpoint) */
  unreadByTicket: Record<string, TicketUnreadCounts>;

  /** Per-ticket comment read cursors (loaded on demand) */
  cursorsByTicket: Record<string, TicketReadCursors>;

  /** Per-ticket seen deliverable IDs */
  seenDeliverablesByTicket: Record<string, Set<string>>;

  /** Total unread across all tickets */
  totalUnread: number;

  /**
   * Make sure these tickets have counts: only the ids not loaded yet (nor in
   * flight) are fetched, and merged into the map. Views pass what they DISPLAY,
   * so switching board / widening a filter only completes the missing ones.
   * Omitted → reload every tracked ticket, replacing the map.
   */
  loadUnreadCounts: (ticketIds?: string[]) => Promise<void>;

  /**
   * Re-fetch these tickets even if already loaded (a deliverable / comment came
   * or went). Calls within a short window are batched into one request.
   */
  refreshUnreadCounts: (ticketIds: string[]) => void;

  /** Load comment read cursors for a specific ticket */
  loadCursors: (ticketId: string) => Promise<TicketReadCursors>;

  /** Load seen deliverable IDs for a specific ticket */
  loadSeenDeliverables: (ticketId: string) => Promise<void>;

  /** Mark comments as read up to a given timestamp */
  markCommentsRead: (ticketId: string, lastSeenAt: string) => Promise<void>;

  /** Toggle a single deliverable's seen state */
  toggleDeliverableSeen: (ticketId: string, deliverableId: string, seen: boolean) => Promise<void>;

  /** Check if a specific deliverable is seen */
  isDeliverableSeen: (ticketId: string, deliverableId: string) => boolean;

  /** Optimistically increment unread counts when WS events arrive */
  incrementUnread: (ticketId: string, field: 'unreadComments' | 'unreadDeliverables', delta?: number) => void;

  /** Get unread counts for a specific ticket (0 if not tracked) */
  getUnread: (ticketId: string) => TicketUnreadCounts;
}

const EMPTY_UNREAD: TicketUnreadCounts = { ticketId: '', totalComments: 0, totalDeliverables: 0, unreadComments: 0, unreadDeliverables: 0 };

/** Ids requested and not answered yet — so two renders don't fetch them twice. */
const inFlight = new Set<string>();
/** Ids waiting for the batched refresh. */
const pendingRefresh = new Set<string>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_DEBOUNCE_MS = 300;

function totalOf(map: Record<string, TicketUnreadCounts>): number {
  return Object.values(map).reduce((sum, c) => sum + c.unreadComments + c.unreadDeliverables, 0);
}

/** Fetch counts for these ids and merge them into the map. */
async function fetchAndMerge(
  ids: string[],
  set: (fn: (s: UnreadState) => Partial<UnreadState>) => void,
): Promise<void> {
  for (const id of ids) inFlight.add(id);
  try {
    const counts = await api.fetchUnreadCounts(ids);
    set((state) => {
      const map = { ...state.unreadByTicket };
      for (const c of counts) map[c.ticketId] = c;
      return { unreadByTicket: map, totalUnread: totalOf(map) };
    });
  } catch {
    // Silently fail — the ids stay missing, so the next load retries them.
  } finally {
    for (const id of ids) inFlight.delete(id);
  }
}

/** Test hook: forget in-flight / pending ids between tests. */
export function __resetUnreadLoaderForTests(): void {
  inFlight.clear();
  pendingRefresh.clear();
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  unreadByTicket: {},
  cursorsByTicket: {},
  seenDeliverablesByTicket: {},
  totalUnread: 0,

  loadUnreadCounts: async (ticketIds?: string[]) => {
    // An explicitly-empty list means "nothing visible yet" (views fire before
    // the ticket store loads): skip entirely. Falling through would degrade to
    // the no-param request, whose server-side scope is "tracked tickets only".
    if (ticketIds && ticketIds.length === 0) return;
    if (!ticketIds) {
      try {
        const counts = await api.fetchUnreadCounts(undefined);
        const map: Record<string, TicketUnreadCounts> = {};
        for (const c of counts) map[c.ticketId] = c;
        set({ unreadByTicket: map, totalUnread: totalOf(map) });
      } catch {
        // Silently fail
      }
      return;
    }
    const loaded = get().unreadByTicket;
    const missing = [...new Set(ticketIds)].filter((id) => !(id in loaded) && !inFlight.has(id));
    if (missing.length === 0) return;
    await fetchAndMerge(missing, set);
  },

  refreshUnreadCounts: (ticketIds: string[]) => {
    for (const id of ticketIds) pendingRefresh.add(id);
    if (refreshTimer || pendingRefresh.size === 0) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const ids = [...pendingRefresh];
      pendingRefresh.clear();
      void fetchAndMerge(ids, set);
    }, REFRESH_DEBOUNCE_MS);
  },

  loadCursors: async (ticketId: string) => {
    const cursors = await api.fetchReadCursors(ticketId);
    set((state) => ({
      cursorsByTicket: { ...state.cursorsByTicket, [ticketId]: cursors },
    }));
    return cursors;
  },

  loadSeenDeliverables: async (ticketId: string) => {
    try {
      const ids = await api.fetchSeenDeliverables(ticketId);
      set((state) => ({
        seenDeliverablesByTicket: { ...state.seenDeliverablesByTicket, [ticketId]: new Set(ids) },
      }));
    } catch {
      // Silently fail
    }
  },

  markCommentsRead: async (ticketId: string, lastSeenAt: string) => {
    await api.updateReadCursors(ticketId, { commentLastSeenAt: lastSeenAt });
    set((state) => {
      const existing = state.cursorsByTicket[ticketId];
      const updated: TicketReadCursors = {
        ticketId,
        commentLastSeenAt: lastSeenAt,
      };
      const unread = { ...state.unreadByTicket };
      if (unread[ticketId]) {
        unread[ticketId] = { ...unread[ticketId], unreadComments: 0 };
      }
      const total = Object.values(unread).reduce(
        (sum, c) => sum + c.unreadComments + c.unreadDeliverables, 0
      );
      return {
        cursorsByTicket: { ...state.cursorsByTicket, [ticketId]: updated },
        unreadByTicket: unread,
        totalUnread: total,
      };
    });
  },

  toggleDeliverableSeen: async (ticketId: string, deliverableId: string, seen: boolean) => {
    await api.toggleDeliverableSeen(ticketId, deliverableId, seen);
    set((state) => {
      const current = new Set(state.seenDeliverablesByTicket[ticketId] ?? []);
      if (seen) {
        current.add(deliverableId);
      } else {
        current.delete(deliverableId);
      }
      // Update unread counts optimistically
      const unread = { ...state.unreadByTicket };
      if (unread[ticketId]) {
        const delta = seen ? -1 : 1;
        unread[ticketId] = {
          ...unread[ticketId],
          unreadDeliverables: Math.max(0, unread[ticketId].unreadDeliverables + delta),
        };
      }
      const total = Object.values(unread).reduce(
        (sum, c) => sum + c.unreadComments + c.unreadDeliverables, 0
      );
      return {
        seenDeliverablesByTicket: { ...state.seenDeliverablesByTicket, [ticketId]: current },
        unreadByTicket: unread,
        totalUnread: total,
      };
    });
  },

  isDeliverableSeen: (ticketId: string, deliverableId: string) => {
    const seen = get().seenDeliverablesByTicket[ticketId];
    return seen ? seen.has(deliverableId) : false;
  },

  incrementUnread: (ticketId: string, field: 'unreadComments' | 'unreadDeliverables', delta = 1) => {
    set((state) => {
      const unread = { ...state.unreadByTicket };
      const existing = unread[ticketId] ?? { ticketId, totalComments: 0, totalDeliverables: 0, unreadComments: 0, unreadDeliverables: 0 };
      unread[ticketId] = { ...existing, [field]: Math.max(0, existing[field] + delta) };
      const total = Object.values(unread).reduce(
        (sum, c) => sum + c.unreadComments + c.unreadDeliverables, 0,
      );
      return { unreadByTicket: unread, totalUnread: total };
    });
  },

  getUnread: (ticketId: string) => {
    return get().unreadByTicket[ticketId] ?? EMPTY_UNREAD;
  },
}));
