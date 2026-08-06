import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

type ChannelHandler = (msg: { type: string; data: unknown }) => void;
const handlers: ChannelHandler[] = [];

vi.mock('../services/websocket', () => ({
  appWs: {
    onChannel: (_channel: string, handler: ChannelHandler) => {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
  },
}));

vi.mock('../services/api', () => ({
  fetchTicketAgentActivity: vi.fn().mockResolvedValue([]),
}));

import { useTicketActivity } from './useTicketActivity';
import { useTicketActivityStore, RECONCILE_DEBOUNCE_MS } from '../stores/ticketActivityStore';
import * as api from '../services/api';

/** Push a `tickets`-channel frame through every registered handler. */
function emit(type: string, data: unknown): void {
  for (const h of [...handlers]) h({ type, data });
}

describe('useTicketActivity', () => {
  beforeEach(() => {
    handlers.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
    useTicketActivityStore.setState({
      activityByTicket: {},
      detailByTicket: {},
      lastActivityAtByTicket: {},
      sinceByTicket: {},
      runningExecutionIdByTicket: {},
      costByTicket: {},
      trackedIds: ['t1'],
    });
  });

  it('flips a ticket to running on execution:started', () => {
    // WHY: a skill / panel / direct launch produces NO mention:* or workflow:*
    // event, so this lifecycle frame is the cockpit's only signal. Without it
    // the ACTIVITY column stayed "idle for 17h" until a manual refresh.
    renderHook(() => useTicketActivity());

    emit('execution:started', { executionId: 'e1', ticketId: 't1' });

    expect(useTicketActivityStore.getState().getActivity('t1')).toBe('running');
    expect(useTicketActivityStore.getState().sinceByTicket.t1).toBeTruthy();
  });

  it('reconciles authoritatively on execution:ended', async () => {
    renderHook(() => useTicketActivity());

    emit('execution:ended', { executionId: 'e1', ticketId: 't1' });

    // The end frame never downgrades optimistically — only the bulk refetch does.
    expect(api.fetchTicketAgentActivity).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RECONCILE_DEBOUNCE_MS);
    expect(api.fetchTicketAgentActivity).toHaveBeenCalledWith(['t1']);
  });

  it('ignores unrelated frames', async () => {
    renderHook(() => useTicketActivity());

    emit('ticket:updated', { ticketId: 't1' });

    await vi.advanceTimersByTimeAsync(RECONCILE_DEBOUNCE_MS);
    expect(api.fetchTicketAgentActivity).not.toHaveBeenCalled();
    expect(useTicketActivityStore.getState().getActivity('t1')).toBe('idle');
  });
});
