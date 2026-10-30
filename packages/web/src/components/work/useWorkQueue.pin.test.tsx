import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { useWorkStore } from '../../stores/workStore';
import { useWorkQueue } from './useWorkQueue';

vi.mock('../../services/api', async (orig) => ({
  ...(await orig<typeof import('../../services/api')>()),
  fetchBulkPRDetails: vi.fn().mockResolvedValue({}),
}));

const ticket = (id: string, boardId: string, status: string): Ticket =>
  ({ id, displayId: 1, title: id, boardId, status, priority: 'medium', type: null, favorite: false, blocked: false, links: [], tags: [] }) as unknown as Ticket;

// The user's queue: board ODYS, doing + reviewing. FLEEX-412 is a todo on another board.
const QUEUED = ticket('ODYS-88', 'odys', 'doing');
const OUTSIDE = ticket('FLEEX-412', 'fleex', 'todo');

/** Tickets "load" when `resolveLoad` is called (or immediately when `loaded`). */
let resolveLoad: () => void = () => {};
function setup({ tickets, loaded = true }: { tickets: Ticket[]; loaded?: boolean }) {
  useTicketStore.setState({
    tickets,
    boards: [],
    fetchBoards: async () => {},
    fetchTickets: () => (loaded ? Promise.resolve() : new Promise<void>((r) => (resolveLoad = r))),
  });
}

beforeEach(() => {
  localStorage.clear();
  useRepositoryStore.setState({ fetchRepositories: async () => {} } as never);
  useTicketActivityStore.setState({ loadActivity: async () => {} } as never);
  useWorkStore.setState({
    boardFilters: ['odys'],
    statusFilters: ['doing', 'reviewing'],
    priorityFilters: [],
    favoriteOnly: false,
    search: '',
    groupBy: 'activity',
    selectedTicketId: null,
    pinnedTicketId: null,
    view: 'task',
  });
});
afterEach(cleanup);

describe('useWorkQueue — the pinned ticket', () => {
  it('shows a pin the filters exclude on top, with why, without counting it', () => {
    setup({ tickets: [QUEUED, OUTSIDE] });
    useWorkStore.setState({ pinnedTicketId: OUTSIDE.id, selectedTicketId: OUTSIDE.id });
    const { result } = renderHook(() => useWorkQueue());

    expect(result.current.pinned?.task.id).toBe(OUTSIDE.id);
    expect(result.current.pinned?.excludedBy).toEqual(['boardFilters', 'statusFilters']);
    expect(result.current.selectedTask?.id).toBe(OUTSIDE.id);
    // ⌘⇧↑/↓ walks through it first; the count is the filtered queue only.
    expect(result.current.orderedIds).toEqual([OUTSIDE.id, QUEUED.id]);
    expect(result.current.counts.total).toBe(1);
    // And the filters are never touched to make it appear.
    expect(useWorkStore.getState().boardFilters).toEqual(['odys']);
    expect(useWorkStore.getState().statusFilters).toEqual(['doing', 'reviewing']);
  });

  it('keeps the pin visible while another queue row is selected', () => {
    setup({ tickets: [QUEUED, OUTSIDE] });
    useWorkStore.setState({ pinnedTicketId: OUTSIDE.id, selectedTicketId: QUEUED.id });
    const { result } = renderHook(() => useWorkQueue());
    expect(result.current.selectedTask?.id).toBe(QUEUED.id);
    expect(result.current.pinned?.task.id).toBe(OUTSIDE.id);
  });

  it('a pin that passes the filters is an ordinary row: no section, no duplicate', () => {
    setup({ tickets: [QUEUED, OUTSIDE] });
    useWorkStore.setState({ pinnedTicketId: QUEUED.id, selectedTicketId: QUEUED.id });
    const { result } = renderHook(() => useWorkQueue());
    expect(result.current.pinned).toBeNull();
    expect(result.current.orderedIds).toEqual([QUEUED.id]);
  });

  it('once unpinned, a filtered-out selection falls back to the first queue row', () => {
    setup({ tickets: [QUEUED, OUTSIDE] });
    useWorkStore.setState({ pinnedTicketId: null, selectedTicketId: OUTSIDE.id });
    const { result } = renderHook(() => useWorkQueue());
    expect(result.current.pinned).toBeNull();
    expect(result.current.selectedTask?.id).toBe(QUEUED.id);
  });

  // A deep link to a filtered ticket must not flash (and adopt) the first row
  // while the tickets load.
  it('shows no fallback row while the pinned selection is still loading', async () => {
    setup({ tickets: [QUEUED], loaded: false });
    useWorkStore.setState({ pinnedTicketId: OUTSIDE.id, selectedTicketId: OUTSIDE.id });
    const { result } = renderHook(() => useWorkQueue());
    expect(result.current.selectedTask).toBeNull();

    useTicketStore.setState({ tickets: [QUEUED, OUTSIDE] });
    resolveLoad();
    await waitFor(() => expect(result.current.selectedTask?.id).toBe(OUTSIDE.id));
    expect(useWorkStore.getState().pinnedTicketId).toBe(OUTSIDE.id);
  });

  it('drops a pin whose ticket no longer exists once tickets are loaded', async () => {
    setup({ tickets: [QUEUED] });
    useWorkStore.setState({ pinnedTicketId: 'GONE', selectedTicketId: 'GONE' });
    renderHook(() => useWorkQueue());
    await waitFor(() => expect(useWorkStore.getState().pinnedTicketId).toBeNull());
  });
});
