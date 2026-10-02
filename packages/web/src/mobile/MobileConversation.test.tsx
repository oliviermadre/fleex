import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Ticket, TicketComment } from '@fleex/shared';

const renders = vi.fn();
vi.mock('../components/scratchpad/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => {
    renders(content);
    return <p>{content}</p>;
  },
}));

vi.mock('../services/api', async (orig) => ({
  ...(await orig<typeof import('../services/api')>()),
  fetchTicketComments: vi.fn(),
  fetchTicketMentions: vi.fn().mockResolvedValue([]),
  fetchTicketDeliverables: vi.fn().mockResolvedValue([]),
  fetchSeenDeliverables: vi.fn().mockResolvedValue([]),
  fetchPersonas: vi.fn().mockResolvedValue([]),
  fetchPanels: vi.fn().mockResolvedValue([]),
  fetchSkills: vi.fn().mockResolvedValue([]),
}));

import * as api from '../services/api';
import { MobileConversation } from './MobileConversation';

beforeAll(() => {
  class Obs { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', Obs);
  vi.stubGlobal('IntersectionObserver', Obs);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ticket = {
  id: 't1', boardId: 'b1', displayId: 1, title: 'T', description: '', status: 'doing', priority: 'none', type: null,
  tags: [], links: [], conversationMode: 'talk', modelOverride: null, effortOverride: null, fastMode: false,
} as unknown as Ticket;

describe('MobileConversation', () => {
  it('does not re-render the transcript while typing in the composer', async () => {
    const comment = {
      id: 'c1', ticketId: 't1', authorType: 'human', authorName: 'Moi', body: 'Hello transcript',
      createdAt: '2026-10-01T10:00:00Z',
    } as unknown as TicketComment;
    vi.mocked(api.fetchTicketComments).mockResolvedValue([comment]);
    render(<MobileConversation ticket={ticket} />);
    await screen.findByText('Hello transcript');
    await waitFor(() => expect(renders).toHaveBeenCalled());
    const before = renders.mock.calls.length;

    const input = screen.getByPlaceholderText(/Message/);
    for (const v of ['a', 'ab', 'abc', 'abcd']) fireEvent.change(input, { target: { value: v } });

    // Typing is a composer concern: the (potentially long) transcript must not
    // be rebuilt on every keystroke — that was the ~300 ms input latency.
    expect(renders.mock.calls.length).toBe(before);
  });

  it('keeps the comment draft per ticket, across a remount', async () => {
    vi.mocked(api.fetchTicketComments).mockResolvedValue([]);
    const first = render(<MobileConversation ticket={ticket} />);
    fireEvent.change(screen.getByPlaceholderText(/Message/), { target: { value: 'brouillon en cours' } });
    first.unmount();

    // Same ticket, fresh mount (tab switch / reload): the draft is back.
    const second = render(<MobileConversation ticket={ticket} />);
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe('brouillon en cours');
    second.unmount();

    // Another ticket must not inherit it.
    render(<MobileConversation ticket={{ ...ticket, id: 't2' }} />);
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe('');
  });
});
