import type { TicketAgentActivity, AgentActivityState } from '@fleex/shared';

/**
 * Raw ticket-id groupings the derivation needs, pre-filtered by the caller to the
 * relevant statuses. Kept as plain iterables so the HTTP layer can pass whatever
 * shape it has (arrays, Sets) without an extra copy.
 */
export interface AgentActivitySources {
  /** Ticket ids with at least one `running` AgentExecution. */
  readonly runningExecutionTicketIds: Iterable<string>;
  /** Ticket ids with at least one `running` WorkflowRun. */
  readonly runningWorkflowTicketIds: Iterable<string>;
  /** Ticket ids with a mention in `waiting_for_info` (an agent asked a human). */
  readonly waitingMentionTicketIds: Iterable<string>;
  /** Ticket ids with a WorkflowRun sitting at a human gate (`needs_review` / `blocked`). */
  readonly waitingWorkflowTicketIds: Iterable<string>;
}

/** Human-readable tooltip copy per non-idle state. */
const DETAIL: Record<Exclude<AgentActivityState, 'idle'>, string> = {
  waiting: 'Waiting for a human response',
  running: 'An agent is working on this ticket',
};

/**
 * Pure derivation of the Kanban activity pill state for a set of tickets.
 *
 * Precedence is `waiting` > `running` > `idle`: the "waiting" (human-gate) state
 * is the actionable one, so it must win when a ticket is simultaneously running
 * something and blocked on a human — the two pills must never both show (spec AC3).
 *
 * Only `requestedIds` are returned, one entry each (including `idle`), so the
 * client can treat the response as authoritative and self-clean stale entries.
 * The manual `ticket.blocked` flag is intentionally NOT a source here (spec AC4).
 */
export function deriveTicketAgentActivity(
  requestedIds: readonly string[],
  sources: AgentActivitySources,
): TicketAgentActivity[] {
  const waiting = new Set<string>(sources.waitingMentionTicketIds);
  for (const id of sources.waitingWorkflowTicketIds) waiting.add(id);

  const running = new Set<string>(sources.runningExecutionTicketIds);
  for (const id of sources.runningWorkflowTicketIds) running.add(id);

  return requestedIds.map((ticketId) => {
    if (waiting.has(ticketId)) {
      return { ticketId, activity: 'waiting', detail: DETAIL.waiting };
    }
    if (running.has(ticketId)) {
      return { ticketId, activity: 'running', detail: DETAIL.running };
    }
    return { ticketId, activity: 'idle' };
  });
}
