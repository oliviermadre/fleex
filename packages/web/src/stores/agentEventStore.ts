import { create } from 'zustand';
import type { AgentExecution, AgentEvent } from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';
import { createLogger } from '../lib/logger';

const log = createLogger('stores/agentEventStore');

const subscribedExecutionIds = new Set<string>();
const subscribedTicketIds = new Set<string>();

interface AgentEventState {
  executionsByTicket: Record<string, AgentExecution[]>;
  executionsByPersona: Record<string, AgentExecution[]>;
  eventsByExecution: Record<string, AgentEvent[]>;
  streamingExecutionIds: Record<string, boolean>;
  /** Tracks whether events for an execution have been loaded (or failed). */
  eventsLoadStatus: Record<string, 'loading' | 'loaded' | 'error'>;

  loadExecutionsForTicket: (ticketId: string) => Promise<void>;
  loadExecutionsForPersona: (personaId: string) => Promise<void>;
  loadEventsForExecution: (executionId: string) => Promise<void>;
  subscribeExecution: (executionId: string) => void;
  unsubscribeExecution: (executionId: string) => void;
  subscribeTicket: (ticketId: string) => void;
  unsubscribeTicket: (ticketId: string) => void;
  resubscribeAll: () => void;
  handleWsEvent: (msg: { type: string; data: unknown }) => void;
  /** Fallback reconciliation: if execution_end was missed, force-complete executions tied to a resolved mention. */
  reconcileOnMentionResolved: (ticketId: string, mentionId: string) => void;
}

export const useAgentEventStore = create<AgentEventState>((set) => ({
  executionsByTicket: {},
  executionsByPersona: {},
  eventsByExecution: {},
  streamingExecutionIds: {},
  eventsLoadStatus: {},

  loadExecutionsForTicket: async (ticketId) => {
    try {
      const executions = await api.fetchExecutionsForTicket(ticketId);
      set((state) => ({
        executionsByTicket: { ...state.executionsByTicket, [ticketId]: executions },
      }));
    } catch (err) {
      log.error('Failed to load executions for ticket', { err });
    }
  },

  loadExecutionsForPersona: async (personaId) => {
    try {
      const executions = await api.fetchExecutionsForPersona(personaId);
      set((state) => ({
        executionsByPersona: { ...state.executionsByPersona, [personaId]: executions },
      }));
    } catch (err) {
      log.error('Failed to load executions for persona', { err });
    }
  },

  loadEventsForExecution: async (executionId) => {
    set((state) => ({
      eventsLoadStatus: { ...state.eventsLoadStatus, [executionId]: 'loading' as const },
    }));
    try {
      const events = await api.fetchEventsForExecution(executionId);
      set((state) => ({
        eventsByExecution: { ...state.eventsByExecution, [executionId]: events },
        eventsLoadStatus: { ...state.eventsLoadStatus, [executionId]: 'loaded' as const },
      }));
    } catch (err) {
      log.error('Failed to load events for execution', { err });
      set((state) => ({
        eventsLoadStatus: { ...state.eventsLoadStatus, [executionId]: 'error' as const },
      }));
    }
  },

  subscribeExecution: (executionId) => {
    if (subscribedExecutionIds.has(executionId)) return;
    subscribedExecutionIds.add(executionId);
    appWs.sendChannel('agent-events',{ action: 'subscribe', executionId });
  },

  unsubscribeExecution: (executionId) => {
    if (!subscribedExecutionIds.has(executionId)) return;
    subscribedExecutionIds.delete(executionId);
    appWs.sendChannel('agent-events',{ action: 'unsubscribe', executionId });
  },

  subscribeTicket: (ticketId) => {
    if (subscribedTicketIds.has(ticketId)) return;
    subscribedTicketIds.add(ticketId);
    appWs.sendChannel('agent-events',{ action: 'subscribe', ticketId });
  },

  unsubscribeTicket: (ticketId) => {
    if (!subscribedTicketIds.has(ticketId)) return;
    subscribedTicketIds.delete(ticketId);
    appWs.sendChannel('agent-events',{ action: 'unsubscribe', ticketId });
  },

  resubscribeAll: () => {
    for (const executionId of subscribedExecutionIds) {
      appWs.sendChannel('agent-events',{ action: 'subscribe', executionId });
    }
    for (const ticketId of subscribedTicketIds) {
      appWs.sendChannel('agent-events',{ action: 'subscribe', ticketId });
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

        // When execution starts, add a new execution entry to executionsByTicket
        if (event.eventType === 'execution_start') {
          const eventData = event.data as Record<string, unknown> | undefined;
          const ticketId = eventData?.['ticketId'] as string | undefined;
          const personaId = eventData?.['personaId'] as string | undefined;
          const mentionId = eventData?.['mentionId'] as string | undefined;
          if (ticketId && personaId) {
            const existing = state.executionsByTicket[ticketId] ?? [];
            if (!existing.some((e) => e.id === event.executionId)) {
              const newExec: AgentExecution = {
                id: event.executionId,
                personaId,
                ticketId,
                mentionId: mentionId ?? '',
                eventCount: 1,
                status: 'running',
                startedAt: event.createdAt,
                completedAt: null,
                lastEventAt: event.createdAt,
              };
              next.executionsByTicket = {
                ...state.executionsByTicket,
                ...next.executionsByTicket,
                [ticketId]: [...existing, newExec],
              };
            }
          }
        }

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

          // Clean up streamingExecutionIds so Terminate button and "is working" indicators update
          if (state.streamingExecutionIds[event.executionId]) {
            const cleaned = { ...state.streamingExecutionIds };
            delete cleaned[event.executionId];
            next.streamingExecutionIds = cleaned;
          }
        }

        return next as AgentEventState;
      });

      // Auto-subscribe to new executions so the events tab updates live
      if (event.eventType === 'execution_start' && !subscribedExecutionIds.has(event.executionId)) {
        subscribedExecutionIds.add(event.executionId);
        appWs.sendChannel('agent-events',{ action: 'subscribe', executionId: event.executionId });
      }
    }
  },

  reconcileOnMentionResolved: (ticketId, mentionId) => {
    set((state) => {
      const execs = state.executionsByTicket[ticketId] ?? [];
      const staleRunning = execs.find(
        (e) => e.mentionId === mentionId && e.status === 'running',
      );
      if (!staleRunning) return state;

      // Force-complete the stale execution and clean up streaming state
      const cleaned = { ...state.streamingExecutionIds };
      delete cleaned[staleRunning.id];

      return {
        executionsByTicket: {
          ...state.executionsByTicket,
          [ticketId]: execs.map((e) =>
            e.id === staleRunning.id
              ? { ...e, status: 'completed' as const, completedAt: new Date().toISOString() }
              : e,
          ),
        },
        streamingExecutionIds: cleaned,
      };
    });
  },
}));
