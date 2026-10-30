import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useUnreadStore } from '../../../stores/unreadStore';
import { useTaskConversation } from './useTaskConversation';

vi.mock('../../../services/api', async (orig) => ({
  ...(await orig<typeof import('../../../services/api')>()),
  fetchTicketComments: vi.fn(async () => [
    { id: 'c1', ticketId: 't1', body: 'a', createdAt: '2026-10-01T10:00:00Z' },
    { id: 'c2', ticketId: 't1', body: 'b', createdAt: '2026-10-02T10:00:00Z' },
  ]),
  fetchTicketActivity: vi.fn(async () => []),
}));

afterEach(cleanup);

// The ticket-detail screen used to mark comments read; it's gone, so opening the
// ticket in the Work view must clear the Kanban card's unread counter instead.
describe('useTaskConversation — read state', () => {
  it('marks the comments read up to the latest one once shown', async () => {
    const markCommentsRead = vi.fn(async () => {});
    useUnreadStore.setState({ markCommentsRead } as never);
    renderHook(() => useTaskConversation('t1'));
    await waitFor(() => expect(markCommentsRead).toHaveBeenCalledWith('t1', '2026-10-02T10:00:00Z'));
  });
});
