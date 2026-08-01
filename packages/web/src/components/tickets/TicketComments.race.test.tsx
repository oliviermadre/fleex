import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import type { TicketComment } from '@fleex/shared';

/**
 * Regression test for the ticket-switch race.
 *
 * The conversation is the worst-hit surface: its comments live in component
 * state, and nothing ever re-syncs them (the WebSocket only pushes deltas). So a
 * slow response for the ticket the user just LEFT would overwrite the state of
 * the ticket they are now looking at — and stay wrong until the next switch.
 * The user could then reply to a thread that isn't the one on screen.
 *
 * The scenario below is the exact failing sequence: open A, switch to B before A
 * answers, then let A's response land last.
 */

// jsdom ships neither observer; the conversation uses them for stick-to-bottom.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;

vi.mock('../../services/websocket', () => ({
  appWs: { onChannel: () => () => {}, sendChannel: () => {}, send: () => {}, subscribe: () => () => {} },
}));

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../services/api')>('../../services/api');
  return {
    ...actual, // keep isAbortError / ignoreAbort real — they are what we're testing
    fetchTicketComments: vi.fn(),
    fetchTicketMentions: vi.fn().mockResolvedValue([]),
    fetchTicketDeliverables: vi.fn().mockResolvedValue([]),
    fetchModels: vi.fn().mockResolvedValue({ models: [], fallback: true }),
    fetchReadCursors: vi.fn().mockResolvedValue({ ticketId: '', commentLastSeenAt: null }),
    fetchSeenDeliverables: vi.fn().mockResolvedValue([]),
    fetchAgentPersonas: vi.fn().mockResolvedValue([]),
    fetchWorkflowRuns: vi.fn().mockResolvedValue([]),
  };
});

import * as api from '../../services/api';
import { TicketComments } from './TicketComments';

/**
 * A fetcher that behaves like the real one under cancellation: the promise it
 * returns rejects as soon as its AbortSignal fires, so a late `resolve()` is a
 * no-op. Without a signal, the late resolve lands — which is the bug.
 */
function deferredFetcher<T>() {
  const pending: { resolve: (value: T) => void; signal?: AbortSignal }[] = [];
  const fn = (_id: string, opts?: { signal?: AbortSignal }) =>
    new Promise<T>((resolve, reject) => {
      pending.push({ resolve, signal: opts?.signal });
      opts?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
  return { fn, pending };
}

function comment(id: string, body: string): TicketComment {
  return {
    id,
    ticketId: id,
    authorType: 'user',
    authorName: 'nas',
    body,
    visibility: 'public',
    privateRecipients: [],
    mentions: [],
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

afterEach(cleanup);

describe('TicketComments — switching tickets mid-flight', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it("a stale response for the previous ticket must not replace the current ticket's thread", async () => {
    const comments = deferredFetcher<TicketComment[]>();
    vi.mocked(api.fetchTicketComments).mockImplementation(comments.fn);

    const { rerender } = render(<TicketComments ticketId="ticket-A" />);
    // User switches before A has answered.
    await act(async () => {
      rerender(<TicketComments ticketId="ticket-B" />);
    });

    expect(comments.pending).toHaveLength(2);
    const callA = comments.pending[0]!;
    const callB = comments.pending[1]!;

    // Responses land OUT OF ORDER: B first, then the slow A.
    await act(async () => {
      callB.resolve([comment('b1', 'body-from-ticket-B')]);
      callA.resolve([comment('a1', 'body-from-ticket-A')]);
    });

    expect(screen.getByText('body-from-ticket-B')).toBeDefined();
    expect(screen.queryByText('body-from-ticket-A')).toBeNull();

    // …and A was genuinely cancelled, not merely ignored: an in-flight request the
    // user can no longer see is wasted server work (this endpoint fans out to the
    // agent/GitHub layers) and would still be holding a connection.
    expect(callA.signal?.aborted).toBe(true);
  });
});
