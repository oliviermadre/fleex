import { create } from 'zustand';
import type { AgentExecution, AgentEvent } from '@fleex/shared';

/**
 * Attribution attached by the server to an agent event it relayed from another
 * Fleex instance. Absent for locally-produced events.
 */
interface AgentEventOrigin {
  instanceId: string;
  instanceLabel: string;
  truncated?: boolean;
}
import * as api from '../services/api';
import { appWs } from '../services/websocket';

const subscribedExecutionIds = new Set<string>();
const subscribedTicketIds = new Set<string>();

/**
 * Merge event lists, deduped by id and ordered by sequence.
 *
 * Needed because a cross-instance history fetch and the live relay deliberately
 * overlap: the server asks the owning instance for the recorded log while events
 * keep streaming in.
 */
/** Does this `execution_start` belong to a ticket the user currently has open? */
function isOnSubscribedTicket(event: AgentEvent): boolean {
  const ticketId = (event.data as Record<string, unknown> | undefined)?.['ticketId'];
  return typeof ticketId === 'string' && subscribedTicketIds.has(ticketId);
}

function mergeEvents(existing: AgentEvent[] | undefined, incoming: AgentEvent[]): AgentEvent[] {
  if (!existing?.length) return [...incoming].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

interface AgentEventState {
  executionsByTicket: Record<string, AgentExecution[]>;
  executionsByPersona: Record<string, AgentExecution[]>;
  eventsByExecution: Record<string, AgentEvent[]>;
  streamingExecutionIds: Record<string, boolean>;
  /** Tracks whether events for an execution have been loaded (or failed). */
  eventsLoadStatus: Record<string, 'loading' | 'loaded' | 'error'>;
  /**
   * Per-execution notes about a stream that isn't wholly ours: which machine ran
   * it, and whether part of the log couldn't be transferred. Absent for local runs.
   */
  streamNotices: Record<string, { origin?: string; elided?: boolean; truncated?: boolean }>;

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
  streamNotices: {},

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
    set((state) => ({
      eventsLoadStatus: { ...state.eventsLoadStatus, [executionId]: 'loading' as const },
    }));
    try {
      const history = await api.fetchEventsForExecution(executionId);
      set((state) => ({
        // Merge rather than replace: live events may already have landed while the
        // (possibly cross-instance) history fetch was in flight.
        eventsByExecution: {
          ...state.eventsByExecution,
          [executionId]: mergeEvents(state.eventsByExecution[executionId], history.events),
        },
        eventsLoadStatus: { ...state.eventsLoadStatus, [executionId]: 'loaded' as const },
        streamNotices: {
          ...state.streamNotices,
          [executionId]: {
            ...state.streamNotices[executionId],
            ...(history.origin ? { origin: history.origin } : {}),
            ...(history.elided ? { elided: true } : {}),
          },
        },
      }));
    } catch (err) {
      console.error('Failed to load events for execution:', err);
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
      // Sits alongside `type`/`data` on the envelope, not inside the event DTO —
      // the generic channel handler type doesn't know about it.
      const origin = (msg as { origin?: AgentEventOrigin }).origin;
      set((state) => {
        const next: Partial<AgentEventState> = {
          eventsByExecution: {
            ...state.eventsByExecution,
            [event.executionId]: mergeEvents(state.eventsByExecution[event.executionId], [event]),
          },
          streamingExecutionIds: state.streamingExecutionIds[event.executionId]
            ? state.streamingExecutionIds
            : { ...state.streamingExecutionIds, [event.executionId]: true },
        };

        if (origin) {
          next.streamNotices = {
            ...state.streamNotices,
            [event.executionId]: {
              ...state.streamNotices[event.executionId],
              origin: origin.instanceLabel,
              ...(origin.truncated ? { truncated: true } : {}),
            },
          };
        }

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

      // Auto-subscribe to new executions so the events tab of an OPEN ticket updates
      // live. Scoped to subscribed tickets on purpose: an execution subscription is
      // what makes the server pull a run's full stream from the instance running it,
      // so subscribing to everything we merely hear about would drag every sibling's
      // SDK traffic across the hub while the user looks at an unrelated screen.
      if (
        event.eventType === 'execution_start'
        && !subscribedExecutionIds.has(event.executionId)
        && isOnSubscribedTicket(event)
      ) {
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
