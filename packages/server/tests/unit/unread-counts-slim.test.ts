import { describe, it, expect, vi } from 'vitest';
import { computeUnreadCounts } from '../../src/infrastructure/http/ticket-bulk-queries.routes.js';

// Unread counts only count: they must read the slim summaries / refs, never the
// full rows (select * pulled every deliverable markdown and timed out the
// Kanban on Supabase).
describe('computeUnreadCounts', () => {
  function makeDeps() {
    return {
      kvStore: {
        listByPrefix: vi.fn(async (prefix: string) =>
          prefix === 'read_cursor:comment:'
            ? [{ key: 'read_cursor:comment:t-1', value: '2026-06-01T10:00:00.000Z' }]
            : [{ key: 'seen_deliverables:t-1', value: JSON.stringify(['d-1']) }],
        ),
      },
      commentStore: {
        getByTicketIds: vi.fn(),
        getSummariesByTicketIds: vi.fn(async () => [
          { ticketId: 't-1', createdAt: '2026-06-01T09:00:00.000Z', authorType: 'user' },
          { ticketId: 't-1', createdAt: '2026-06-01T11:00:00.000Z', authorType: 'agent' },
          { ticketId: 't-2', createdAt: '2026-06-01T11:00:00.000Z', authorType: 'agent' },
        ]),
      },
      deliverableStore: {
        getByTicketIds: vi.fn(),
        getRefsByTicketIds: vi.fn(async () => [
          { id: 'd-1', ticketId: 't-1' },
          { id: 'd-2', ticketId: 't-1' },
          { id: 'd-3', ticketId: 't-2' },
        ]),
      },
    };
  }

  it('counts totals and unread from slim reads only', async () => {
    const deps = makeDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await computeUnreadCounts(deps as any, ['t-1', 't-2', 't-3']);

    expect(result).toEqual([
      { ticketId: 't-1', totalComments: 2, totalDeliverables: 2, unreadComments: 1, unreadDeliverables: 1 },
      { ticketId: 't-2', totalComments: 1, totalDeliverables: 1, unreadComments: 1, unreadDeliverables: 1 },
      { ticketId: 't-3', totalComments: 0, totalDeliverables: 0, unreadComments: 0, unreadDeliverables: 0 },
    ]);
    expect(deps.commentStore.getByTicketIds).not.toHaveBeenCalled();
    expect(deps.deliverableStore.getByTicketIds).not.toHaveBeenCalled();
  });
});
