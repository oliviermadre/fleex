import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TicketMention } from '@fleex/shared';

type ChannelHandler = (msg: unknown) => void;
const handlers: ChannelHandler[] = [];
const fetchTicketMentions = vi.fn();

vi.mock('../../../services/websocket', () => ({
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
vi.mock('../../../services/api', () => ({ fetchTicketMentions: (id: string) => fetchTicketMentions(id) }));

import { useTicketMentions, countOpenMentions } from './useTicketMentions';

const mention = (id: string, status: TicketMention['status'], ticketId = 't1') =>
  ({ id, ticketId, status, targetAgent: 'builder', targetType: 'agent' }) as unknown as TicketMention;
const emit = (type: string, data: unknown) => act(() => handlers.forEach((h) => h({ type, data })));

beforeEach(() => {
  handlers.length = 0;
  fetchTicketMentions.mockReset();
});

describe('countOpenMentions', () => {
  it('counts every mention still asking for attention — only resolved ones are done', () => {
    const all = (['pending', 'acknowledged', 'waiting_for_info', 'failed', 'resolved'] as const).map((s, i) =>
      mention(`m${i}`, s),
    );
    expect(countOpenMentions(all)).toBe(4);
  });
});

describe('useTicketMentions', () => {
  it('loads the ticket mentions and keeps the open count live from WS frames', async () => {
    fetchTicketMentions.mockResolvedValue([mention('m1', 'pending'), mention('m2', 'resolved')]);
    const { result } = renderHook(() => useTicketMentions('t1'));
    await waitFor(() => expect(result.current.mentions).toHaveLength(2));
    expect(result.current.openCount).toBe(1);

    emit('mention:created', mention('m3', 'pending'));
    expect(result.current.openCount).toBe(2);

    emit('mention:resolved', mention('m1', 'resolved'));
    expect(result.current.openCount).toBe(1);

    emit('mention:deleted', { id: 'm3', ticketId: 't1' });
    expect(result.current.openCount).toBe(0);
  });

  it('ignores frames for other tickets', async () => {
    fetchTicketMentions.mockResolvedValue([]);
    const { result } = renderHook(() => useTicketMentions('t1'));
    await waitFor(() => expect(fetchTicketMentions).toHaveBeenCalledWith('t1'));
    emit('mention:created', mention('x', 'pending', 'other'));
    expect(result.current.openCount).toBe(0);
  });

  it("never leaks the previous ticket's mentions when switching task", async () => {
    fetchTicketMentions.mockResolvedValueOnce([mention('m1', 'pending')]);
    const { result, rerender } = renderHook(({ id }) => useTicketMentions(id), { initialProps: { id: 't1' } });
    await waitFor(() => expect(result.current.openCount).toBe(1));

    let resolveNext: (m: TicketMention[]) => void = () => {};
    fetchTicketMentions.mockReturnValueOnce(new Promise((r) => (resolveNext = r)));
    rerender({ id: 't2' });
    expect(result.current.mentions).toEqual([]);

    await act(async () => resolveNext([mention('n1', 'pending', 't2'), mention('n2', 'pending', 't2')]));
    expect(result.current.openCount).toBe(2);
  });
});
