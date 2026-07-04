import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TicketAgentActivity } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchTicketAgentActivity: vi.fn(),
}));

import * as api from '../services/api';
import { useTicketActivityStore } from './ticketActivityStore';

describe('ticketActivityStore', () => {
  beforeEach(() => {
    useTicketActivityStore.setState({ activityByTicket: {}, detailByTicket: {}, trackedIds: [] });
    vi.clearAllMocks();
  });

  it('loadActivity keeps only non-idle tickets so absence reads as idle (no pill)', async () => {
    vi.mocked(api.fetchTicketAgentActivity).mockResolvedValue([
      { ticketId: 'a', activity: 'running', detail: 'working' },
      { ticketId: 'b', activity: 'idle' },
      { ticketId: 'c', activity: 'waiting', detail: 'ask' },
    ] satisfies TicketAgentActivity[]);

    await useTicketActivityStore.getState().loadActivity(['a', 'b', 'c']);
    const s = useTicketActivityStore.getState();
    expect(s.getActivity('a')).toBe('running');
    expect(s.getActivity('b')).toBe('idle'); // idle entries are dropped, not stored
    expect(s.getActivity('c')).toBe('waiting');
    expect(s.detailByTicket.c).toBe('ask');
  });

  it('loadActivity is authoritative: a ticket that dropped to idle has its pill cleared', async () => {
    // WHY: the pill must vanish the moment work finishes. Since the response omits idle
    // tickets, a rebuild-from-scratch is what clears a previously-active ticket.
    vi.mocked(api.fetchTicketAgentActivity)
      .mockResolvedValueOnce([{ ticketId: 'a', activity: 'running' }])
      .mockResolvedValueOnce([]); // reconcile: 'a' finished, nothing active

    await useTicketActivityStore.getState().loadActivity(['a']);
    expect(useTicketActivityStore.getState().getActivity('a')).toBe('running');

    await useTicketActivityStore.getState().loadActivity(['a']);
    expect(useTicketActivityStore.getState().getActivity('a')).toBe('idle');
  });

  it('noteActivity upgrades state instantly but NEVER downgrades (anti-flicker invariant)', () => {
    // WHY: a burst of WS events arrives out of order. A late "running" event must not
    // knock a ticket out of the more-urgent "waiting" pill before the reconcile.
    const store = useTicketActivityStore.getState();
    useTicketActivityStore.setState({ trackedIds: ['a'] });

    store.noteActivity('a', 'running');
    expect(useTicketActivityStore.getState().getActivity('a')).toBe('running');

    store.noteActivity('a', 'waiting', 'needs review');
    expect(useTicketActivityStore.getState().getActivity('a')).toBe('waiting');

    // Downgrade attempt: ignored.
    store.noteActivity('a', 'running');
    expect(useTicketActivityStore.getState().getActivity('a')).toBe('waiting');
    expect(useTicketActivityStore.getState().detailByTicket.a).toBe('needs review');
  });

  it('noteActivity ignores tickets not in view (board-scoped)', () => {
    // WHY: only the visible board is tracked; an event for an off-board ticket must
    // not create a phantom pill that will never be reconciled away.
    useTicketActivityStore.setState({ trackedIds: ['a'] });
    useTicketActivityStore.getState().noteActivity('offboard', 'waiting');
    expect(useTicketActivityStore.getState().getActivity('offboard')).toBe('idle');
  });
});
