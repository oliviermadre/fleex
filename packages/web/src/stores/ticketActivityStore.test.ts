import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TicketAgentActivity } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchTicketAgentActivity: vi.fn(),
}));

import * as api from '../services/api';
import { useTicketActivityStore } from './ticketActivityStore';

describe('ticketActivityStore', () => {
  beforeEach(() => {
    useTicketActivityStore.setState({
      activityByTicket: {},
      detailByTicket: {},
      lastActivityAtByTicket: {},
      sinceByTicket: {},
      trackedIds: [],
    });
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

  it('loadActivity records lastActivityAt for ALL entries, including idle ones (#400, pass 4)', async () => {
    // WHY: the cockpit's activity column shows "idle since {{age}}" — the last
    // SDK activity timestamp matters precisely for tickets with NO current
    // activity, so it must survive even though idle entries are dropped from
    // activityByTicket.
    vi.mocked(api.fetchTicketAgentActivity).mockResolvedValue([
      { ticketId: 'a', activity: 'running', detail: 'working', lastActivityAt: '2026-07-17T10:00:00.000Z' },
      { ticketId: 'b', activity: 'idle', lastActivityAt: '2026-07-16T08:00:00.000Z' },
      { ticketId: 'c', activity: 'idle' }, // never had an SDK session
    ] satisfies TicketAgentActivity[]);

    await useTicketActivityStore.getState().loadActivity(['a', 'b', 'c']);
    const s = useTicketActivityStore.getState();
    expect(s.lastActivityAtByTicket.a).toBe('2026-07-17T10:00:00.000Z');
    expect(s.lastActivityAtByTicket.b).toBe('2026-07-16T08:00:00.000Z');
    expect(s.lastActivityAtByTicket.c).toBeUndefined();
    expect(s.getActivity('b')).toBe('idle'); // idle still reads idle
  });

  it('loadActivity records since for non-idle entries and clears stale ones (pass 5)', async () => {
    // WHY: the badge shows "Running for 5m" / "Waiting for 2h" — the start of
    // the CURRENT non-idle state must ride along, and a ticket that dropped
    // back to idle must lose its stale since on the authoritative rebuild
    // (idle durations come from lastActivityAt instead).
    vi.mocked(api.fetchTicketAgentActivity)
      .mockResolvedValueOnce([
        { ticketId: 'a', activity: 'running', since: '2026-07-17T11:00:00.000Z' },
        { ticketId: 'b', activity: 'idle', lastActivityAt: '2026-07-16T08:00:00.000Z', since: '2026-07-16T08:00:00.000Z' },
      ] satisfies TicketAgentActivity[])
      .mockResolvedValueOnce([{ ticketId: 'a', activity: 'idle' }]);

    await useTicketActivityStore.getState().loadActivity(['a', 'b']);
    let s = useTicketActivityStore.getState();
    expect(s.sinceByTicket.a).toBe('2026-07-17T11:00:00.000Z');
    expect(s.sinceByTicket.b).toBeUndefined(); // idle rows read lastActivityAt

    await useTicketActivityStore.getState().loadActivity(['a', 'b']);
    s = useTicketActivityStore.getState();
    expect(s.sinceByTicket.a).toBeUndefined(); // finished → stale since cleared
  });

  it('noteActivity stamps an optimistic since=now until the reconcile corrects it (pass 5)', () => {
    // WHY: the optimistic WS instant-on knows the state flipped "just now" —
    // stamping the current time keeps the pill's duration honest for the
    // ~250ms until the authoritative reconcile lands.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    try {
      useTicketActivityStore.setState({ trackedIds: ['a'] });
      useTicketActivityStore.getState().noteActivity('a', 'running');
      expect(useTicketActivityStore.getState().sinceByTicket.a).toBe('2026-07-17T12:00:00.000Z');

      // Upgrade-only invariant applies to since too: a late downgrade event
      // must not restamp the clock.
      vi.setSystemTime(new Date('2026-07-17T12:05:00.000Z'));
      useTicketActivityStore.getState().noteActivity('a', 'running');
      expect(useTicketActivityStore.getState().sinceByTicket.a).toBe('2026-07-17T12:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('noteActivity ignores tickets not in view (board-scoped)', () => {
    // WHY: only the visible board is tracked; an event for an off-board ticket must
    // not create a phantom pill that will never be reconciled away.
    useTicketActivityStore.setState({ trackedIds: ['a'] });
    useTicketActivityStore.getState().noteActivity('offboard', 'waiting');
    expect(useTicketActivityStore.getState().getActivity('offboard')).toBe('idle');
  });
});
