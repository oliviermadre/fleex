import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
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
  fetchTicketThreads: vi.fn().mockResolvedValue([]),
  postAssistantMessage: vi.fn(),
  postTicketComment: vi.fn(),
  postThreadMessage: vi.fn().mockResolvedValue(undefined),
  updateTicketExecutionConfig: vi.fn().mockResolvedValue(undefined),
  markCommentsRead: vi.fn().mockResolvedValue(undefined),
}));

import * as api from '../services/api';
import { MobileConversation } from './MobileConversation';
import { useSettingsStore } from '../stores/settingsStore';
import { useThreadStore } from '../stores/threadStore';
import { useAgentEventStore } from '../stores/agentEventStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import type { AgentThread, TicketMention } from '@fleex/shared';

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

describe('MobileConversation — the phone composer and « Assistant & threads »', () => {
  const setSwitch = (workThreadsEnabled: boolean) => useSettingsStore.setState((st) => ({ settings: { ...st.settings, workThreadsEnabled } }));
  const at = (min: number) => `2026-10-01T10:${String(min).padStart(2, '0')}:00Z`;
  const comment = (over: Partial<TicketComment> & { id: string }) => ({
    ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '', visibility: 'public', privateRecipients: [],
    mentions: [], parentId: null, threadId: null, createdAt: at(1), updatedAt: at(1), ...over,
  }) as TicketComment;
  const posted = comment({ id: 'new', authorType: 'user', authorName: 'Moi', body: 'envoyé', createdAt: at(30) });
  const waitingMention = { id: 'm1', ticketId: 't1', commentId: 'c0', targetAgent: 'builder', targetType: 'agent', status: 'waiting_for_info' } as unknown as TicketMention;
  const send = (text: string) => {
    fireEvent.change(screen.getByPlaceholderText(/Message/), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  };

  beforeEach(() => {
    vi.mocked(api.fetchTicketComments).mockResolvedValue([]);
    vi.mocked(api.fetchTicketMentions).mockResolvedValue([]);
    vi.mocked(api.fetchTicketThreads).mockReset().mockResolvedValue([]);
    vi.mocked(api.postAssistantMessage).mockReset().mockResolvedValue({ comment: posted, assistant: { personaId: 'p-nas', displayName: 'Nas' } } as never);
    vi.mocked(api.postTicketComment).mockReset().mockResolvedValue(posted);
    vi.mocked(api.updateTicketExecutionConfig).mockClear();
    useThreadStore.setState({ threadsByTicket: {} });
    useAgentEventStore.setState({ executionsByTicket: {}, eventsByExecution: {} } as never);
    useAgentPersonaStore.setState({ personas: [{ id: 'p-b', name: 'builder', displayName: 'The Builder' }, { id: 'p-nas', name: 'nas', displayName: 'Nas' }] as never });
  });

  describe('switch on', () => {
    beforeEach(() => setSwitch(true));

    // Acceptance: from mobile, `@agent:x` goes through the assistant route and creates no direct mention.
    it('a message with @agent:x goes to the assistant route — no direct comment, no re-mention prompt even when that agent waits', async () => {
      vi.mocked(api.fetchTicketMentions).mockResolvedValue([waitingMention]);
      render(<MobileConversation ticket={ticket} />);
      await waitFor(() => expect(api.fetchTicketMentions).toHaveBeenCalled());
      send('@agent:builder reprends');
      await waitFor(() => expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', '@agent:builder reprends'));
      await screen.findByText('envoyé');
      expect(api.postTicketComment).not.toHaveBeenCalled();
      expect(screen.queryByText(/attend ta réponse/)).toBeNull();
      expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe('');
    });

    it('no assistant persona configured: the message is posted as a plain comment', async () => {
      vi.mocked(api.postAssistantMessage).mockResolvedValue({ comment: null, assistant: null } as never);
      render(<MobileConversation ticket={ticket} />);
      send('@agent:builder go');
      await waitFor(() => expect(api.postTicketComment).toHaveBeenCalledWith('t1', '@agent:builder go', undefined, undefined));
    });

    it('shows a thread as one delegation card, its turns folded under it until opened', async () => {
      const thread = {
        id: 'th1', ticketId: 't1', initiator: 'assistant', targetType: 'agent', personaId: 'p-b', personaName: 'builder', assistantPersonaId: 'p-nas',
        brief: 'Corriger', forwardedContext: [], status: 'running', currentMentionId: 'm1', exchanges: 1, failures: 0, summary: null,
        createdAt: at(2), updatedAt: at(2), concludedAt: null,
      } as AgentThread;
      vi.mocked(api.fetchTicketThreads).mockResolvedValue([thread]);
      vi.mocked(api.fetchTicketComments).mockResolvedValue([
        comment({ id: 'turn1', threadId: 'th1', body: 'Premier tour du thread', createdAt: at(2) }),
        comment({ id: 'turn2', threadId: 'th1', authorType: 'agent', authorName: 'The Builder', body: 'Second tour du thread', createdAt: at(3) }),
      ]);
      render(<MobileConversation ticket={ticket} />);
      await screen.findByTestId('mobile-thread');
      expect(screen.getAllByTestId('mobile-thread')).toHaveLength(1);
      expect(screen.queryByText('Premier tour du thread')).toBeNull();
      fireEvent.click(screen.getByText('Open thread ›'));
      expect(screen.getByText('Premier tour du thread')).toBeTruthy();
      expect(screen.getAllByText('Second tour du thread').length).toBeGreaterThan(0);
    });

    it('the mode request carries its two buttons: granting patches the ticket mode then tells the assistant', async () => {
      vi.mocked(api.fetchTicketComments).mockResolvedValue([
        comment({ id: 'mr', body: 'Builder doit écrire.\n\n<!-- fleex:mode-request {"mode":"edit","threadId":"th1"} -->' }),
      ]);
      render(<MobileConversation ticket={ticket} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Switch agents to edit and continue' }));
      await waitFor(() => expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', 'Mode edit accordé aux agents — continue.'));
      expect(api.updateTicketExecutionConfig).toHaveBeenCalledWith('t1', { conversationMode: 'edit' });
      expect(api.postTicketComment).not.toHaveBeenCalled();
    });

    it("the assistant's question shows its buttons; the pick is answered to the assistant, once", async () => {
      vi.mocked(api.fetchTicketComments).mockResolvedValue([
        comment({ id: 'q', body: 'On y va ?', questions: [{ prompt: 'On y va ?', options: ['Go', 'Ajuster'] }] }),
      ]);
      render(<MobileConversation ticket={ticket} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Go' }));
      await waitFor(() => expect(api.postAssistantMessage).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.postAssistantMessage).mock.calls[0]![1]).toContain('Go');
      expect((screen.getByRole('button', { name: 'Ajuster' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('a question already answered in the main stream offers no buttons', async () => {
      vi.mocked(api.fetchTicketComments).mockResolvedValue([
        comment({ id: 'q', body: 'On y va ?', questions: [{ prompt: 'On y va ?', options: ['Go', 'Ajuster'] }] }),
        comment({ id: 'u', authorType: 'user', authorName: 'Moi', body: 'Réponse donnée', createdAt: at(5) }),
      ]);
      render(<MobileConversation ticket={ticket} />);
      await screen.findByText('Réponse donnée');
      expect(screen.queryByRole('button', { name: 'Go' })).toBeNull();
    });

    it("streams the assistant's answer under the transcript while its turn runs", async () => {
      useAgentEventStore.setState({
        executionsByTicket: { t1: [{ id: 'x1', personaId: 'p-nas', ticketId: 't1', mentionId: 'assistant:c1', status: 'running', startedAt: at(4) }] },
        eventsByExecution: { x1: [{ id: 'e1', sequence: 1, eventType: 'content_block_delta', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'Je délègue à Builder' }] } } }] },
        loadEventsForExecution: vi.fn(),
      } as never);
      render(<MobileConversation ticket={ticket} />);
      expect(await screen.findByText('Je délègue à Builder')).toBeTruthy();
    });
  });

  describe('switch off — unchanged', () => {
    beforeEach(() => setSwitch(false));

    it('posts a plain comment (its mentions are launched directly by the server) and never calls the assistant route', async () => {
      render(<MobileConversation ticket={ticket} />);
      send('@agent:builder go');
      await waitFor(() => expect(api.postTicketComment).toHaveBeenCalledWith('t1', '@agent:builder go', undefined, undefined));
      expect(api.postAssistantMessage).not.toHaveBeenCalled();
      expect(api.fetchTicketThreads).not.toHaveBeenCalled();
    });

    it('re-mentioning a waiting agent still asks answer vs new subject, and posts with that choice', async () => {
      vi.mocked(api.fetchTicketMentions).mockResolvedValue([waitingMention]);
      render(<MobileConversation ticket={ticket} />);
      await waitFor(() => expect(api.fetchTicketMentions).toHaveBeenCalled());
      await waitFor(() => { send('@agent:builder voilà'); expect(screen.getByText(/attend ta réponse/)).toBeTruthy(); });
      expect(api.postTicketComment).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Répond à sa question' }));
      await waitFor(() => expect(api.postTicketComment).toHaveBeenCalledWith('t1', '@agent:builder voilà', undefined, [{ agent: 'builder', action: 'answer' }]));
      expect(api.postAssistantMessage).not.toHaveBeenCalled();
    });

    it('shows no assistant surface: thread turns stay flat, a mode request has no button', async () => {
      vi.mocked(api.fetchTicketComments).mockResolvedValue([
        comment({ id: 'turn1', threadId: 'th1', body: 'Premier tour du thread', createdAt: at(2) }),
        comment({ id: 'mr', body: 'Builder doit écrire.\n\n<!-- fleex:mode-request {"mode":"edit","threadId":"th1"} -->', createdAt: at(3) }),
      ]);
      render(<MobileConversation ticket={ticket} />);
      expect(await screen.findByText('Premier tour du thread')).toBeTruthy();
      expect(screen.queryByTestId('mobile-thread')).toBeNull();
      expect(screen.queryByRole('button', { name: /Switch agents to edit/ })).toBeNull();
    });
  });
});
