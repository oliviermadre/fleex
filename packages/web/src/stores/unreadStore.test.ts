import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TicketUnreadCounts } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchUnreadCounts: vi.fn(),
}));

import * as api from '../services/api';
import { useUnreadStore } from './unreadStore';

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
});
