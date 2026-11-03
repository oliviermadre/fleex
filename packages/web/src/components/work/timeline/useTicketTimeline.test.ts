/**
 * The todo history feeds the frieze live, without hammering the server: a
 * `todo done 42 1 2 3 4` sends 4 WS messages but must cost one refetch, and a
 * failing todo endpoint must never break the rest of the timeline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TicketTodoEvent } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchTicketActivity: vi.fn(async () => []),
  fetchTicketComments: vi.fn(async () => []),
  fetchTicketMentions: vi.fn(async () => []),
  fetchTicketTodoEvents: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('../../../services/api', async (orig) => ({ ...(await orig<object>()), ...api }));

const ws = vi.hoisted(() => ({ handlers: [] as ((m: { type: string; data: unknown }) => void)[] }));
vi.mock('../../../services/websocket', () => ({
  appWs: {
    onChannel: (_c: string, h: (m: { type: string; data: unknown }) => void) => { ws.handlers.push(h); return () => {}; },
    subscribe: () => {}, unsubscribe: () => {}, send: () => {}, on: () => () => {},
  },
}));

import { useTicketStore } from '../../../stores/ticketStore';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { useWorkflowRunStore } from '../../../stores/workflowRunStore';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import { usePanelStore } from '../../../stores/panelStore';
import { useSkillStore } from '../../../stores/skillStore';
import { useTicketTimeline } from './useTicketTimeline';
import type { WorkTask } from '../types';

const task = { id: 't1', prs: [] } as unknown as WorkTask;
const event = (id: string): TicketTodoEvent => ({
  id, itemId: 'i1', ticketId: 't1', itemRef: 1, itemText: 'Item 1', action: 'created', changes: {},
  actorType: 'agent', actorName: 'Catalyst', source: 'cli', createdAt: '2026-11-03T10:00:00.000Z',
});
const send = (type: string, data: unknown) => act(() => ws.handlers.forEach((h) => h({ type, data })));

beforeEach(() => {
  ws.handlers = [];
  // Stores that would hit the network: already loaded / no-op loaders.
  useAgentEventStore.setState({ loadExecutionsForTicket: async () => {}, subscribeTicket: () => {} } as never);
  useWorkflowRunStore.setState({ loadForTicket: async () => {}, loadDetail: async () => {} } as never);
  useAgentPersonaStore.setState({ loaded: true } as never);
  usePanelStore.setState({ loaded: true } as never);
  useSkillStore.setState({ loaded: true } as never);
  useTicketStore.setState({ tickets: [{ id: 't1', status: 'doing', createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z', links: [] }] } as never);
});
afterEach(() => vi.useRealTimers());

describe('useTicketTimeline — todo marks', () => {
  it('loads the todo history with the timeline and turns it into marks', async () => {
    api.fetchTicketTodoEvents.mockResolvedValue([event('e1')]);
    const { result } = renderHook(() => useTicketTimeline(task, []));
    await act(async () => {});
    expect(result.current.todoMarks.map((m) => m.kind)).toEqual(['created']);
  });

  it('a failing todo endpoint leaves the timeline intact, without strip', async () => {
    api.fetchTicketTodoEvents.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTicketTimeline(task, []));
    await act(async () => {});
    expect(result.current.model).not.toBeNull();
    expect(result.current.todoMarks).toEqual([]);
  });

  it('refetches once, 500 ms after a burst of todo messages for this ticket — and ignores other tickets', async () => {
    api.fetchTicketTodoEvents.mockResolvedValue([]);
    renderHook(() => useTicketTimeline(task, []));
    await act(async () => {});
    vi.useFakeTimers();
    api.fetchTicketTodoEvents.mockClear();
    send('todo:updated', { id: 'i1', ticketId: 't1' });
    send('todo:updated', { id: 'i2', ticketId: 't1' });
    send('todo:created', { id: 'i3', ticketId: 't1' });
    send('todo:updated', { id: 'x', ticketId: 'other' });
    act(() => { vi.advanceTimersByTime(499); });
    expect(api.fetchTicketTodoEvents).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(api.fetchTicketTodoEvents).toHaveBeenCalledTimes(1);
    expect(api.fetchTicketTodoEvents).toHaveBeenCalledWith('t1');
  });
});
