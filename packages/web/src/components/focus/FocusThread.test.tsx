import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AgentExecution, AgentThread, Ticket, TicketComment } from '@fleex/shared';

const api = vi.hoisted(() => ({
  postAssistantMessage: vi.fn(),
  postTicketComment: vi.fn(async () => ({})),
  postThreadMessage: vi.fn(async () => ({})),
  updateTicketExecutionConfig: vi.fn(async () => ({})),
  relaunchThread: vi.fn(async () => ({})),
}));
vi.mock('../../services/api', () => api);

const convo = vi.hoisted(() => ({ comments: [] as unknown[], postToThread: vi.fn() }));
vi.mock('../work/task/useTaskConversation', () => ({
  useTaskConversation: () => ({ comments: convo.comments, events: [], loading: false, error: null, postToThread: convo.postToThread }),
}));
const threadsHook = vi.hoisted(() => ({ useTicketThreads: vi.fn() }));
vi.mock('../work/panel/useTicketThreads', () => threadsHook);
const mentionsHook = vi.hoisted(() => ({ useTicketMentions: vi.fn(() => []) }));
vi.mock('../work/task/useTicketMentions', () => mentionsHook);
vi.mock('../../hooks/useAgentPersonas', () => ({ useAgentPersonas: () => {} }));
vi.mock('../markdown/useAllMentionOptions', () => ({ useAllMentionOptions: () => [] }));

import { FocusThread } from './FocusThread';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkStore } from '../../stores/workStore';
import { useUIStore } from '../../stores/uiStore';

const at = (min: number) => `2026-10-02T10:${String(min).padStart(2, '0')}:00.000Z`;
const comment = (over: Partial<TicketComment> & { id: string }): TicketComment => ({
  ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '', visibility: 'public', privateRecipients: [],
  mentions: [], parentId: null, threadId: null, createdAt: at(1), updatedAt: at(1), ...over,
});
const thread: AgentThread = {
  id: 'th1', ticketId: 't1', initiator: 'assistant', targetType: 'agent', personaId: 'p-cat', personaName: 'catalyst',
  assistantPersonaId: 'p-nas', brief: 'Spécifier X', forwardedContext: [], status: 'running', currentMentionId: 'm1',
  exchanges: 1, failures: 0, summary: null, createdAt: at(2), updatedAt: at(2), concludedAt: null,
};
const ticket = { id: 't1', displayId: 1, title: 'T', description: '', conversationMode: 'plan' } as unknown as Ticket;
const liveTurn = { id: 'x-live', personaId: 'p-nas', ticketId: 't1', mentionId: 'assistant:c0', status: 'running', startedAt: at(4), eventCount: 1 } as unknown as AgentExecution;

const setSwitch = (workThreadsEnabled: boolean) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, workThreadsEnabled } }));
const show = () => render(<FocusThread ticket={ticket} deliverables={[]} onOpenLogs={vi.fn()} />);

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  api.postAssistantMessage.mockResolvedValue({ comment: { id: 'c' }, assistant: { personaId: 'p-nas', displayName: 'Nas' } });
  threadsHook.useTicketThreads.mockImplementation((id: string | null) => (id ? [thread] : []));
  convo.comments = [
    comment({ id: 'u1', authorType: 'user', authorName: 'Olivier', body: '@agent:catalyst spécifie X', createdAt: at(1) }),
    comment({ id: 'turn1', threadId: 'th1', body: 'Brief du thread', createdAt: at(2) }),
    comment({ id: 'mr', body: 'Catalyst doit écrire.\n\n<!-- fleex:mode-request {"mode":"edit","threadId":"th1"} -->', createdAt: at(3) }),
  ];
  useAgentPersonaStore.setState({ personas: [{ id: 'p-cat', name: 'catalyst', displayName: 'Catalyst' }, { id: 'p-nas', name: 'nas', displayName: 'Nas' }] as never });
  useAgentEventStore.setState({
    executionsByTicket: { t1: [liveTurn] },
    eventsByExecution: { 'x-live': [{ id: 'e1', sequence: 1, eventType: 'content_block_delta', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'Je lance Catalyst' }] } } }] },
    loadExecutionsForTicket: vi.fn(), subscribeTicket: vi.fn(), unsubscribeTicket: vi.fn(), loadEventsForExecution: vi.fn(),
  } as never);
});
afterEach(cleanup);

describe('FocusThread — the Focus popup with « Assistant & threads » on', () => {
  beforeEach(() => setSwitch(true));

  it('shows what the assistant does: a delegation card per thread, and its answer while it streams', () => {
    show();
    expect(threadsHook.useTicketThreads).toHaveBeenCalledWith('t1');
    expect(mentionsHook.useTicketMentions).toHaveBeenCalledWith('t1');
    // The thread is one card, named after its target; its turn is folded in it, not a second bubble.
    expect(screen.getByText('Open thread ›')).toBeTruthy();
    expect(screen.getAllByText(/Catalyst/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Brief du thread')).toBeNull();
    expect(screen.getByText('Je lance Catalyst')).toBeTruthy();
  });

  it('the mode request is answerable here: granting patches the ticket mode then tells the assistant', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Switch agents to edit and continue' }));
    await waitFor(() => expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', 'Mode edit accordé aux agents — continue.'));
    expect(api.updateTicketExecutionConfig).toHaveBeenCalledWith('t1', { conversationMode: 'edit' });
    expect(api.postTicketComment).not.toHaveBeenCalled();
  });

  it('declining keeps the mode and tells the assistant', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Keep plan' }));
    await waitFor(() => expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', expect.stringContaining('restent en mode plan')));
    expect(api.updateTicketExecutionConfig).not.toHaveBeenCalled();
  });

  it('« Open thread » leads to the Threads panel of the Tasks view, on that thread', () => {
    show();
    fireEvent.click(screen.getByText('Open thread ›'));
    expect(useWorkStore.getState().selectedThreadId).toBe('th1');
    expect(useWorkStore.getState().rightPanel).toBe('thread');
    expect(useUIStore.getState().activePanel).toBe('work');
  });
});

describe('FocusThread — switch off', () => {
  beforeEach(() => setSwitch(false));

  it('loads no thread and no mention, and offers no mode buttons: the popup is what it was', () => {
    show();
    expect(threadsHook.useTicketThreads).toHaveBeenCalledWith(null);
    expect(mentionsHook.useTicketMentions).toHaveBeenCalledWith(null);
    expect(screen.queryByText('Open thread ›')).toBeNull();
    expect(screen.queryByRole('button', { name: /Switch agents to edit/ })).toBeNull();
  });
});
