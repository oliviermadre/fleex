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
  /**
   * Last SDK activity timestamp per ticket (cockpit "idle since", #400).
   * Optional: callers that don't render ages can omit it entirely.
   */
  readonly lastSdkActivityAtByTicket?: ReadonlyMap<string, string>;
  /**
   * When the current running state began, per ticket (pass 5 "Running for
   * {{age}}"). Optional; typically built with `deriveActivitySince`.
   */
  readonly runningSinceByTicket?: ReadonlyMap<string, string>;
  /** When the current waiting state began, per ticket ("Waiting for {{age}}"). */
  readonly waitingSinceByTicket?: ReadonlyMap<string, string>;
  /**
   * Cumulative agentic cost per ticket (#404): Σ `costUsd` over the ticket's
   * executions (all origins, `null`→0). Optional: callers that don't render the
   * cost badge can omit it — the entry then reports `cumulativeCostUsd: 0`.
   */
  readonly costByTicket?: ReadonlyMap<string, number>;
  /**
   * The running SDK execution to open from a `running` badge, per ticket.
   * Optional: only attached to the `running` entries it belongs to.
   */
  readonly runningExecutionIdByTicket?: ReadonlyMap<string, string>;
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
 * `since` follows the winning state (pass 5): a Waiting pill carries the waiting
 * start, never the running one — the duration shown must be the duration of the
 * state the badge names. Idle's since IS the last SDK activity ("idle for X").
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
    const lastActivityAt = sources.lastSdkActivityAtByTicket?.get(ticketId);
    // Cost rides along with every entry (idle included): a `done` ticket is idle
    // yet its cumulative cost is exactly what the board wants to surface (#404).
    const cumulativeCostUsd = sources.costByTicket?.get(ticketId) ?? 0;
    if (waiting.has(ticketId)) {
      const since = sources.waitingSinceByTicket?.get(ticketId);
      return { ticketId, activity: 'waiting', detail: DETAIL.waiting, lastActivityAt, since, cumulativeCostUsd };
    }
    if (running.has(ticketId)) {
      const since = sources.runningSinceByTicket?.get(ticketId);
      const runningExecutionId = sources.runningExecutionIdByTicket?.get(ticketId);
      return { ticketId, activity: 'running', detail: DETAIL.running, lastActivityAt, since, cumulativeCostUsd, runningExecutionId };
    }
    return { ticketId, activity: 'idle', lastActivityAt, since: lastActivityAt, cumulativeCostUsd };
  });
}

/**
 * Inputs for `deriveActivitySince` — structural subsets of the store entities so
 * the HTTP layer can pass them as-is, and tests can build minimal literals.
 */
export interface ActivitySinceInputs {
  /** Currently-running agent executions (`status === 'running'`). */
  readonly runningExecutions: Iterable<{ ticketId: string; startedAt: string }>;
  /** Currently-running workflow runs. */
  readonly runningWorkflowRuns: Iterable<{ ticketId: string; startedAt: string }>;
  /** Mentions in `waiting_for_info`. */
  readonly waitingMentions: Iterable<{ ticketId: string; id: string; createdAt: string }>;
  /**
   * completedAt of the execution that carried each mention (mentionId → ISO).
   * That completion is precisely when the agent posed its question — i.e. when
   * the waiting state began.
   */
  readonly executionCompletedAtByMentionId: ReadonlyMap<string, string>;
  /** Workflow runs sitting at a human gate (`needs_review` / `blocked`). */
  readonly gateWorkflowRuns: Iterable<{ ticketId: string; updatedAt: string }>;
}

/** Keep the earliest ISO timestamp per ticket (lexicographic compare is safe on ISO 8601). */
function keepMin(map: Map<string, string>, ticketId: string, ts: string): void {
  const prev = map.get(ticketId);
  if (!prev || ts < prev) map.set(ticketId, ts);
}

/**
 * Pure derivation of the per-ticket state-start maps for `since` (pass 5).
 *
 * - running since = earliest start among still-in-flight executions and workflow
 *   runs (the ongoing burst of work began with the oldest one).
 * - waiting since = earliest of: the linked execution's completedAt (the moment
 *   the agent asked; falls back to the mention's createdAt when nothing carried
 *   it — e.g. flipped via the API) and gate runs' updatedAt (the transition into
 *   `needs_review`/`blocked` is the run's last update while it sits there).
 */
export function deriveActivitySince(inputs: ActivitySinceInputs): {
  runningSinceByTicket: Map<string, string>;
  waitingSinceByTicket: Map<string, string>;
} {
  const runningSinceByTicket = new Map<string, string>();
  for (const e of inputs.runningExecutions) keepMin(runningSinceByTicket, e.ticketId, e.startedAt);
  for (const r of inputs.runningWorkflowRuns) keepMin(runningSinceByTicket, r.ticketId, r.startedAt);

  const waitingSinceByTicket = new Map<string, string>();
  for (const m of inputs.waitingMentions) {
    const ts = inputs.executionCompletedAtByMentionId.get(m.id) ?? m.createdAt;
    keepMin(waitingSinceByTicket, m.ticketId, ts);
  }
  for (const r of inputs.gateWorkflowRuns) keepMin(waitingSinceByTicket, r.ticketId, r.updatedAt);

  return { runningSinceByTicket, waitingSinceByTicket };
}
