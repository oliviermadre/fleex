import { create } from 'zustand';
import type { AgentExecution, AgentEvent } from '@fleex/shared';
import * as api from '../services/api';
import { agentEventWs } from '../services/websocket';

const subscribedExecutionIds = new Set<string>();

interface AgentEventState {
  executionsByTicket: Record<string, AgentExecution[]>;
  executionsByPersona: Record<string, AgentExecution[]>;
  eventsByExecution: Record<string, AgentEvent[]>;
  streamingExecutionIds: Record<string, boolean>;

  loadExecutionsForTicket: (ticketId: string) => Promise<void>;
  loadExecutionsForPersona: (personaId: string) => Promise<void>;
  loadEventsForExecution: (executionId: string) => Promise<void>;
  subscribeExecution: (executionId: string) => void;
  unsubscribeExecution: (executionId: string) => void;
  resubscribeAll: () => void;
  handleWsEvent: (msg: { type: string; data: unknown }) => void;
}

export const useAgentEventStore = create<AgentEventState>((set) => ({
  executionsByTicket: {},
  executionsByPersona: {},
  eventsByExecution: {},
  streamingExecutionIds: {},

  loadExecutionsForTicket: async (ticketId) => {
    try {
      const executions = await api.fetchExecutionsForTicket(ticketId);
      set((state) => ({
        executionsByTicket: { ...state.executionsByTicket, [ticketId]: executions },
      }));
    } catch (err) {
      console.error('Failed to load executions for ticket:', err);
    }
  },

  loadExecutionsForPersona: async (personaId) => {
    try {
      const executions = await api.fetchExecutionsForPersona(personaId);
      set((state) => ({
        executionsByPersona: { ...state.executionsByPersona, [personaId]: executions },
      }));
    } catch (err) {
      console.error('Failed to load executions for persona:', err);
    }
  },

  loadEventsForExecution: async (executionId) => {
    try {
      const events = await api.fetchEventsForExecution(executionId);
      set((state) => ({
        eventsByExecution: { ...state.eventsByExecution, [executionId]: events },
      }));
    } catch (err) {
      console.error('Failed to load events for execution:', err);
    }
  },

  subscribeExecution: (executionId) => {
    if (subscribedExecutionIds.has(executionId)) return;
    subscribedExecutionIds.add(executionId);
    agentEventWs.sendJson({ action: 'subscribe', executionId });
  },

  unsubscribeExecution: (executionId) => {
    if (!subscribedExecutionIds.has(executionId)) return;
    subscribedExecutionIds.delete(executionId);
    agentEventWs.sendJson({ action: 'unsubscribe', executionId });
  },

  resubscribeAll: () => {
    for (const executionId of subscribedExecutionIds) {
      agentEventWs.sendJson({ action: 'subscribe', executionId });
    }
  },

  handleWsEvent: (msg) => {
    if (msg.type === 'agent_event:delta') {
      const event = msg.data as AgentEvent;
      set((state) => {
        const next: Partial<AgentEventState> = {
          eventsByExecution: {
            ...state.eventsByExecution,
            [event.executionId]: [...(state.eventsByExecution[event.executionId] ?? []), event],
          },
          streamingExecutionIds: state.streamingExecutionIds[event.executionId]
            ? state.streamingExecutionIds
            : { ...state.streamingExecutionIds, [event.executionId]: true },
        };

        // When execution ends, update the execution record in-place so the UI
        // reflects the final status (badge, timer, cancel button) without reload.
        if (event.eventType === 'execution_end') {
          const eventData = event.data as { status?: string } | undefined;
          const finalStatus = (eventData?.status === 'completed' || eventData?.status === 'failed' || eventData?.status === 'interrupted')
            ? eventData.status
            : 'completed';
          const completedAt = event.createdAt;

          const patchExecution = (exec: AgentExecution): AgentExecution =>
            exec.id === event.executionId
              ? { ...exec, status: finalStatus, completedAt, eventCount: (state.eventsByExecution[event.executionId]?.length ?? exec.eventCount) + 1 }
              : exec;

          next.executionsByPersona = Object.fromEntries(
            Object.entries(state.executionsByPersona).map(([k, v]) => [k, v.map(patchExecution)]),
          );
          next.executionsByTicket = Object.fromEntries(
            Object.entries(state.executionsByTicket).map(([k, v]) => [k, v.map(patchExecution)]),
          );
        }

        return next as AgentEventState;
      });

      // Auto-subscribe to new executions so the events tab updates live
      if (event.eventType === 'execution_start' && !subscribedExecutionIds.has(event.executionId)) {
        subscribedExecutionIds.add(event.executionId);
        agentEventWs.sendJson({ action: 'subscribe', executionId: event.executionId });
      }
    }
  },
}));
