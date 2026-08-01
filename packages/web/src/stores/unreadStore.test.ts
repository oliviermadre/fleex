import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TicketUnreadCounts } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchUnreadCounts: vi.fn(),
}));

import * as api from '../services/api';
import { useUnreadStore } from './unreadStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('unreadStore.loadUnreadCounts', () => {
  beforeEach(() => {
    useUnreadStore.setState({ unreadByTicket: {}, totalUnread: 0 });
    vi.clearAllMocks();
  });

  it('skips the network entirely when called with an explicitly-empty id list', async () => {
    // WHY: views (cockpit, kanban, dashboard) fire loadUnreadCounts(ids) before
    // the ticket store has loaded, i.e. with []. Passing that through degrades
    // to the no-param request whose server scope is "tracked tickets only" — a
    // smaller response that can resolve AFTER the full-ids one and replace the
    // map, zeroing badges for every never-read ticket (cockpit bug, #400).
    await useUnreadStore.getState().loadUnreadCounts([]);
    expect(api.fetchUnreadCounts).not.toHaveBeenCalled();
  });

  it('still supports the explicit no-argument "all tracked" call', async () => {
    vi.mocked(api.fetchUnreadCounts).mockResolvedValue([]);
    await useUnreadStore.getState().loadUnreadCounts();
    expect(api.fetchUnreadCounts).toHaveBeenCalledWith(undefined);
  });

  it('replaces the map and recomputes the global total from the response', async () => {
    vi.mocked(api.fetchUnreadCounts).mockResolvedValue([
      { ticketId: 'a', totalComments: 6, totalDeliverables: 2, unreadComments: 3, unreadDeliverables: 1 },
      { ticketId: 'b', totalComments: 1, totalDeliverables: 0, unreadComments: 0, unreadDeliverables: 0 },
    ] satisfies TicketUnreadCounts[]);

    await useUnreadStore.getState().loadUnreadCounts(['a', 'b']);
    const s = useUnreadStore.getState();
    expect(s.unreadByTicket['a']?.totalComments).toBe(6);
    expect(s.totalUnread).toBe(4);
  });

  // WHY: unlike the other slices of this store, loadUnreadCounts writes the WHOLE
  // map (`set({ unreadByTicket })`) rather than a single `[ticketId]` key. Cockpit,
  // kanban and dashboard each call it with a different id set, concurrently — so a
  // slow earlier request resolving last replaces the map built by the fresher one
  // and badges vanish. Same failure mode as #400, which was only patched for `[]`.
  it('a stale earlier-issued response must not replace the map built by a newer one', async () => {
    const stale = deferred<TicketUnreadCounts[]>();
    const fresh = deferred<TicketUnreadCounts[]>();

    vi.mocked(api.fetchUnreadCounts)
      .mockReturnValueOnce(stale.promise) // 1st issued: wide id set, slow
      .mockReturnValueOnce(fresh.promise); // 2nd issued: narrow id set, fast

    const store = useUnreadStore.getState();
    const p1 = store.loadUnreadCounts(['a', 'b']);
    const p2 = store.loadUnreadCounts(['c']);

    // Resolve OUT OF ORDER: the newer request first, then the stale one.
    fresh.resolve([
      { ticketId: 'c', totalComments: 2, totalDeliverables: 0, unreadComments: 2, unreadDeliverables: 0 },
    ]);
    stale.resolve([
      { ticketId: 'a', totalComments: 9, totalDeliverables: 0, unreadComments: 9, unreadDeliverables: 0 },
      { ticketId: 'b', totalComments: 1, totalDeliverables: 0, unreadComments: 1, unreadDeliverables: 0 },
    ]);
    await Promise.all([p1, p2]);

    const s = useUnreadStore.getState();
    expect(Object.keys(s.unreadByTicket)).toEqual(['c']);
    expect(s.totalUnread).toBe(2);
  });
});
