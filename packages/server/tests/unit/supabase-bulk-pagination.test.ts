import { describe, it, expect } from 'vitest';

import { SupabaseCommentStore } from '../../src/infrastructure/adapters/supabase/supabase-comment-store.adapter.js';
import { SupabaseDeliverableStore } from '../../src/infrastructure/adapters/supabase/supabase-deliverable-store.adapter.js';

import type { SupabaseConnection } from '../../src/infrastructure/adapters/supabase/connection.js';

/**
 * PostgREST silently caps every response at `max-rows` (Supabase default: 1000).
 * The cockpit view (#400) requests unread counts for ALL tickets at once, so
 * `getByTicketIds` can match far more than 1000 rows — without explicit
 * pagination the result is truncated and tickets past the cap report
 * totalComments/totalDeliverables = 0. These tests fail if pagination is
 * removed: the fake client enforces the same 1000-row cap as production.
 */

const CAP = 1000;

/** Thenable query builder that mimics PostgREST's row cap + .range() slicing. */
function makeFakeClient(rowsByTable: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const all = rowsByTable[table] ?? [];
      let from = 0;
      let to = Infinity;
      const builder = {
        select: () => builder,
        in: () => builder,
        order: () => builder,
        range: (f: number, t: number) => {
          from = f;
          to = t;
          return builder;
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
          // PostgREST returns at most CAP rows regardless of the requested range.
          const slice = all.slice(from, Math.min(to + 1, from + CAP));
          resolve({ data: slice.slice(0, CAP), error: null });
        },
      };
      return builder;
    },
  };
}

function commentRow(i: number, ticketId: string) {
  return {
    id: `comment-${i}`,
    ticket_id: ticketId,
    author_type: 'agent',
    author_name: 'builder',
    body: `comment ${i}`,
    visibility: 'public',
    private_recipients: [],
    mentions: [],
    parent_id: null,
    created_at: new Date(1700000000000 + i * 1000).toISOString(),
    updated_at: new Date(1700000000000 + i * 1000).toISOString(),
  };
}

function deliverableRow(i: number, ticketId: string) {
  return {
    id: `deliverable-${i}`,
    ticket_id: ticketId,
    agent_name: 'builder',
    type: 'report',
    title: `deliverable ${i}`,
    content: 'x',
    version: 1,
    status: 'final',
    mention_id: null,
    created_at: new Date(1700000000000 + i * 1000).toISOString(),
    updated_at: new Date(1700000000000 + i * 1000).toISOString(),
  };
}

describe('SupabaseCommentStore.getByTicketIds pagination', () => {
  it('returns every matching comment even past the 1000-row PostgREST cap', async () => {
    // 1500 comments spread over 3 tickets — ticket-c's rows all sit past the cap.
    const tickets = ['ticket-a', 'ticket-b', 'ticket-c'];
    const rows = Array.from({ length: 1500 }, (_, i) =>
      commentRow(i, tickets[Math.floor(i / 500)]!),
    );
    const store = new SupabaseCommentStore({
      client: makeFakeClient({ comments: rows }),
    } as unknown as SupabaseConnection);

    const result = await store.getByTicketIds(tickets);

    expect(result).toHaveLength(1500);
    // The badge count for the last ticket must be exact, not 0/truncated.
    expect(result.filter((c) => c.ticketId === 'ticket-c')).toHaveLength(500);
  });

  it('still works for small result sets (single page)', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => commentRow(i, 'ticket-a'));
    const store = new SupabaseCommentStore({
      client: makeFakeClient({ comments: rows }),
    } as unknown as SupabaseConnection);
    expect(await store.getByTicketIds(['ticket-a'])).toHaveLength(3);
  });
});

describe('SupabaseDeliverableStore.getByTicketIds pagination', () => {
  it('returns every matching deliverable even past the 1000-row PostgREST cap', async () => {
    const tickets = ['ticket-a', 'ticket-b', 'ticket-c'];
    const rows = Array.from({ length: 1500 }, (_, i) =>
      deliverableRow(i, tickets[Math.floor(i / 500)]!),
    );
    const store = new SupabaseDeliverableStore({
      client: makeFakeClient({ deliverables: rows }),
    } as unknown as SupabaseConnection);

    const result = await store.getByTicketIds(tickets);

    expect(result).toHaveLength(1500);
    expect(result.filter((d) => d.ticketId === 'ticket-c')).toHaveLength(500);
  });
});
