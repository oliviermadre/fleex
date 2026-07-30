import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentEvent } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchEventsForExecution: vi.fn(),
  fetchExecutionsForTicket: vi.fn(),
  fetchExecutionsForPersona: vi.fn(),
}));

const sendChannel = vi.fn();
vi.mock('../services/websocket', () => ({
  appWs: { sendChannel: (...args: unknown[]) => sendChannel(...args) },
}));

import * as api from '../services/api';
import { useAgentEventStore } from './agentEventStore';

function event(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'ev-1',
    executionId: 'exec-1',
    eventType: 'content_block_delta',
    data: {},
    sequence: 0,
    createdAt: '2025-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function reset() {
  useAgentEventStore.setState({
    executionsByTicket: {},
    executionsByPersona: {},
    eventsByExecution: {},
    streamingExecutionIds: {},
    eventsLoadStatus: {},
    streamNotices: {},
  });
  sendChannel.mockClear();
  vi.clearAllMocks();
}

describe('agentEventStore — auto-subscribe scope', () => {
  beforeEach(reset);

  it('does NOT subscribe to an execution on a ticket the user has not open', () => {
    // An execution subscription is what makes the server pull a run's full SDK
    // stream from the instance running it. Subscribing to everything we merely
    // hear about would drag every sibling's stream across the hub while the user
    // sits on an unrelated screen.
    useAgentEventStore.getState().handleWsEvent({
      type: 'agent_event:delta',
      data: event({ eventType: 'execution_start', data: { ticketId: 't-unopened', personaId: 'p' } }),
    });

    expect(sendChannel).not.toHaveBeenCalled();
  });

  it('subscribes to an execution on a ticket the user has open', () => {
    useAgentEventStore.getState().subscribeTicket('t-open');
    sendChannel.mockClear();

    useAgentEventStore.getState().handleWsEvent({
      type: 'agent_event:delta',
      data: event({ eventType: 'execution_start', data: { ticketId: 't-open', personaId: 'p' } }),
    });

    expect(sendChannel).toHaveBeenCalledWith('agent-events', {
      action: 'subscribe',
      executionId: 'exec-1',
    });

    useAgentEventStore.getState().unsubscribeTicket('t-open');
    useAgentEventStore.getState().unsubscribeExecution('exec-1');
  });
});

describe('agentEventStore — event dedup', () => {
  beforeEach(reset);

  it('keeps a single copy when history and the live stream overlap', async () => {
    // A cross-instance history fetch and the live relay deliberately overlap: the
    // server asks the owning instance for the recorded log while events keep
    // arriving. Both write to the same list.
    useAgentEventStore.getState().handleWsEvent({
      type: 'agent_event:delta',
      data: event({ id: 'ev-2', sequence: 2 }),
    });

    vi.mocked(api.fetchEventsForExecution).mockResolvedValue({
      events: [event({ id: 'ev-1', sequence: 1 }), event({ id: 'ev-2', sequence: 2 })],
      elided: false,
    });
    await useAgentEventStore.getState().loadEventsForExecution('exec-1');

    const events = useAgentEventStore.getState().eventsByExecution['exec-1'] ?? [];
    expect(events.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
  });

  it('orders merged events by sequence regardless of arrival order', async () => {
    useAgentEventStore.getState().handleWsEvent({
      type: 'agent_event:delta',
      data: event({ id: 'ev-9', sequence: 9 }),
    });
    vi.mocked(api.fetchEventsForExecution).mockResolvedValue({
      events: [event({ id: 'ev-3', sequence: 3 }), event({ id: 'ev-1', sequence: 1 })],
      elided: false,
    });
    await useAgentEventStore.getState().loadEventsForExecution('exec-1');

    expect((useAgentEventStore.getState().eventsByExecution['exec-1'] ?? []).map((e) => e.sequence))
      .toEqual([1, 3, 9]);
  });
});

describe('agentEventStore — cross-instance notices', () => {
  beforeEach(reset);

  it('records the originating machine from a relayed event', () => {
    useAgentEventStore.getState().handleWsEvent({
      type: 'agent_event:delta',
      data: event(),
      origin: { instanceId: 'host-b:3000', instanceLabel: 'host-b', truncated: true },
    } as { type: string; data: unknown });

    expect(useAgentEventStore.getState().streamNotices['exec-1']).toEqual({
      origin: 'host-b',
      truncated: true,
    });
  });

  it('leaves no notice for a locally-produced event', () => {
    useAgentEventStore.getState().handleWsEvent({ type: 'agent_event:delta', data: event() });
    expect(useAgentEventStore.getState().streamNotices['exec-1']).toBeUndefined();
  });

  it('records an elided history so the UI can stop implying a complete log', async () => {
    vi.mocked(api.fetchEventsForExecution).mockResolvedValue({
      events: [event()],
      origin: 'host-b',
      elided: true,
    });
    await useAgentEventStore.getState().loadEventsForExecution('exec-1');

    expect(useAgentEventStore.getState().streamNotices['exec-1']).toEqual({
      origin: 'host-b',
      elided: true,
    });
  });
});
