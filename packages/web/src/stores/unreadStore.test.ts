import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TicketUnreadCounts } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchUnreadCounts: vi.fn(),
}));

import * as api from '../services/api';
import { useUnreadStore, __resetUnreadLoaderForTests } from './unreadStore';

describe('unreadStore.loadUnreadCounts', () => {
  beforeEach(() => {
    useUnreadStore.setState({ unreadByTicket: {}, totalUnread: 0 });
    __resetUnreadLoaderForTests();
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

  it('merges the response into the map and recomputes the global total', async () => {
    useUnreadStore.setState({
      unreadByTicket: { z: { ticketId: 'z', totalComments: 1, totalDeliverables: 0, unreadComments: 1, unreadDeliverables: 0 } },
    });
    vi.mocked(api.fetchUnreadCounts).mockResolvedValue([
      { ticketId: 'a', totalComments: 6, totalDeliverables: 2, unreadComments: 3, unreadDeliverables: 1 },
      { ticketId: 'b', totalComments: 1, totalDeliverables: 0, unreadComments: 0, unreadDeliverables: 0 },
    ] satisfies TicketUnreadCounts[]);

    await useUnreadStore.getState().loadUnreadCounts(['a', 'b']);
    const s = useUnreadStore.getState();
    expect(s.unreadByTicket['a']?.totalComments).toBe(6);
    // A ticket from another board stays: switching back needs no refetch.
    expect(s.unreadByTicket['z']?.totalComments).toBe(1);
    expect(s.totalUnread).toBe(5);
  });

  it('only fetches the ids it does not have yet (Kanban: complete, never reload all)', async () => {
    // WHY: the Kanban asked for the whole instance (500+ tickets) on every
    // ticket WS update, which timed out Supabase. Now it passes what is on
    // screen and only the newly visible tickets hit the network.
    vi.mocked(api.fetchUnreadCounts).mockResolvedValue([
      { ticketId: 'a', totalComments: 0, totalDeliverables: 1, unreadComments: 0, unreadDeliverables: 1 },
    ]);
    await useUnreadStore.getState().loadUnreadCounts(['a']);
    vi.mocked(api.fetchUnreadCounts).mockResolvedValue([
      { ticketId: 'b', totalComments: 2, totalDeliverables: 0, unreadComments: 2, unreadDeliverables: 0 },
    ]);
    await useUnreadStore.getState().loadUnreadCounts(['a', 'b']);
    await useUnreadStore.getState().loadUnreadCounts(['a', 'b']);

    expect(api.fetchUnreadCounts).toHaveBeenCalledTimes(2);
    expect(api.fetchUnreadCounts).toHaveBeenLastCalledWith(['b']);
  });

  it('does not refetch ids already in flight', async () => {
    let resolve!: (v: TicketUnreadCounts[]) => void;
    vi.mocked(api.fetchUnreadCounts).mockReturnValue(new Promise((r) => { resolve = r; }));
    const first = useUnreadStore.getState().loadUnreadCounts(['a']);
    await useUnreadStore.getState().loadUnreadCounts(['a']);
    resolve([]);
    await first;
    expect(api.fetchUnreadCounts).toHaveBeenCalledTimes(1);
  });
});

describe('unreadStore.refreshUnreadCounts', () => {
  beforeEach(() => {
    useUnreadStore.setState({ unreadByTicket: {}, totalUnread: 0 });
    __resetUnreadLoaderForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('batches refreshes into one request and overwrites the loaded counts', async () => {
    useUnreadStore.setState({
      unreadByTicket: {
        a: { ticketId: 'a', totalComments: 0, totalDeliverables: 1, unreadComments: 0, unreadDeliverables: 0 },
        b: { ticketId: 'b', totalComments: 0, totalDeliverables: 0, unreadComments: 0, unreadDeliverables: 0 },
      },
    });
    vi.mocked(api.fetchUnreadCounts).mockResolvedValue([
      { ticketId: 'a', totalComments: 0, totalDeliverables: 2, unreadComments: 0, unreadDeliverables: 1 },
      { ticketId: 'b', totalComments: 1, totalDeliverables: 0, unreadComments: 1, unreadDeliverables: 0 },
    ]);

    useUnreadStore.getState().refreshUnreadCounts(['a']);
    useUnreadStore.getState().refreshUnreadCounts(['b', 'a']);
    expect(api.fetchUnreadCounts).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();

    expect(api.fetchUnreadCounts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.fetchUnreadCounts).mock.calls[0]![0]!.sort()).toEqual(['a', 'b']);
    expect(useUnreadStore.getState().unreadByTicket['a']?.totalDeliverables).toBe(2);
    expect(useUnreadStore.getState().totalUnread).toBe(2);
    vi.useRealTimers();
  });
});
