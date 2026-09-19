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
   * Ticket ids whose latest WorkflowRun is `failed` with a retryable failed step
   * (a step that died — crash, max turns, server restart — awaiting a manual
   * Retry) and that have NO active run. Classified `waiting` ("needs you"), but
   * AFTER `running`, so a fresh run on the ticket still wins.
   */
  readonly failedWorkflowTicketIds?: Iterable<string>;
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
  /**
   * A precise "what's running" label per ticket (workflow step / panel / skill /
   * agent), from {@link deriveRunningDetails}. When present for a ticket it
   * replaces the generic `DETAIL.running`; absent ⇒ the generic string.
   */
  readonly runningDetailByTicket?: ReadonlyMap<string, string>;
  /**
   * A precise "waiting on you" label per ticket for workflow runs parked at a
   * gate or on a terminated step, from {@link deriveWaitingWorkflowDetails}. When
   * present it replaces the generic `DETAIL.waiting`; absent ⇒ the generic string
   * (e.g. a plain agent question with no workflow).
   */
  readonly waitingDetailByTicket?: ReadonlyMap<string, string>;
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

  // A failed-and-retryable run is "needs you", but only when nothing more urgent
  // (a waiting gate) or more current (a running step) applies — so it is checked
  // last, and never masks a fresh run the ticket kicked off after the failure.
  const failedWaiting = new Set<string>(sources.failedWorkflowTicketIds ?? []);

  return requestedIds.map((ticketId) => {
    const lastActivityAt = sources.lastSdkActivityAtByTicket?.get(ticketId);
    // Cost rides along with every entry (idle included): a `done` ticket is idle
    // yet its cumulative cost is exactly what the board wants to surface (#404).
    const cumulativeCostUsd = sources.costByTicket?.get(ticketId) ?? 0;
    if (waiting.has(ticketId)) {
      const since = sources.waitingSinceByTicket?.get(ticketId);
      const detail = sources.waitingDetailByTicket?.get(ticketId) ?? DETAIL.waiting;
      return { ticketId, activity: 'waiting', detail, lastActivityAt, since, cumulativeCostUsd };
    }
    if (running.has(ticketId)) {
      const since = sources.runningSinceByTicket?.get(ticketId);
      const runningExecutionId = sources.runningExecutionIdByTicket?.get(ticketId);
      const detail = sources.runningDetailByTicket?.get(ticketId) ?? DETAIL.running;
      return { ticketId, activity: 'running', detail, lastActivityAt, since, cumulativeCostUsd, runningExecutionId };
    }
    if (failedWaiting.has(ticketId)) {
      const since = sources.waitingSinceByTicket?.get(ticketId);
      const detail = sources.waitingDetailByTicket?.get(ticketId) ?? DETAIL.waiting;
      return { ticketId, activity: 'waiting', detail, lastActivityAt, since, cumulativeCostUsd };
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

/** A running workflow run, reduced to what the detail label needs. */
export interface RunningWorkflowInput {
  ticketId: string;
  /** Template name, e.g. "Spec Dev PR (HITL)". */
  name: string;
  /** Template emoji, prefixed to the label when present. */
  emoji?: string | null;
  /** Current step name, appended as "› {step}" when known. */
  stepName: string | null;
  /** ISO start — the most recent run wins when several are active. */
  startedAt: string;
}

/** A running agent execution, reduced to what the detail label needs. */
export interface RunningExecutionInput {
  ticketId: string;
  /** The mention that triggered it — resolved against `mentionById`, or a synthetic `panel:<id>:…`. */
  mentionId: string;
  personaId: string;
  /** ISO start — stable tie-break within a precedence group. */
  startedAt: string;
}

export interface RunningDetailInputs {
  workflowRuns: Iterable<RunningWorkflowInput>;
  executions: Iterable<RunningExecutionInput>;
  /** mentionId → its target, for classifying an execution as panel / skill / agent. */
  mentionById: ReadonlyMap<string, { targetType: string; targetAgent: string }>;
  /** personaId → display name (agent label). */
  personaDisplayById: ReadonlyMap<string, string>;
  /** skill slug (mention.targetAgent) → display name. */
  skillDisplayByName: ReadonlyMap<string, string>;
  /** panel slug (mention.targetAgent) → display name. */
  panelDisplayByName: ReadonlyMap<string, string>;
  /** panel id → display name, for synthetic `panel:<id>:…` executions with no real mention. */
  panelDisplayById: ReadonlyMap<string, string>;
}

type Primitive =
  | { kind: 'workflow'; label: string; sort: string }
  | { kind: 'panel'; name: string; count: number; sort: string }
  | { kind: 'skill'; name: string; count: number; sort: string }
  | { kind: 'agent'; name: string; count: number; sort: string };

// Precedence: a workflow step describes the whole run; a panel/skill is a named
// primitive; a lone agent is the least specific. Lower wins.
const PRIMITIVE_ORDER: Record<Primitive['kind'], number> = { workflow: 0, panel: 1, skill: 2, agent: 3 };

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

function formatPrimitive(p: Primitive): string {
  switch (p.kind) {
    case 'workflow':
      return p.label;
    case 'panel':
      return `🏛 ${p.name} · ${plural(p.count, 'panelist')}`;
    case 'skill':
      return `Running skill: ${p.name}`;
    case 'agent':
      return `${p.name} is working`;
  }
}

/**
 * Build the precise "what's running" label per ticket, so the queue row and the
 * Kanban pill say e.g. "🚦 Spec Dev PR › Check Spec", "🏛 Les chapeaux de Bono ·
 * 6 panelists", "Running skill: Press Release - FAQ" or "The Catalyst is working"
 * instead of a generic "An agent is working on this ticket".
 *
 * Rules (matching the product decision):
 *  - If a workflow run is active on the ticket, it wins outright and its member
 *    executions are ignored — the workflow line already describes them. The most
 *    recent run is shown; extra concurrent runs add "+N more".
 *  - Otherwise the running executions are grouped into panel / skill / agent
 *    primitives (panels group by their shared mention; a synthetic `panel:<id>:…`
 *    id is recognised too). The primitive with the highest precedence
 *    (panel > skill > agent), then the largest count, is shown; other distinct
 *    primitives add "+N more".
 *
 * Names resolve to display names; an unresolved one falls back to the slug. Only
 * tickets that produced a label appear in the returned map (callers fall back to
 * the generic string for the rest).
 */
export function deriveRunningDetails(inputs: RunningDetailInputs): Map<string, string> {
  // Group everything per ticket first.
  const wfByTicket = new Map<string, RunningWorkflowInput[]>();
  for (const wf of inputs.workflowRuns) {
    const arr = wfByTicket.get(wf.ticketId);
    if (arr) arr.push(wf); else wfByTicket.set(wf.ticketId, [wf]);
  }
  const execByTicket = new Map<string, RunningExecutionInput[]>();
  for (const e of inputs.executions) {
    const arr = execByTicket.get(e.ticketId);
    if (arr) arr.push(e); else execByTicket.set(e.ticketId, [e]);
  }

  const out = new Map<string, string>();
  const ticketIds = new Set<string>([...wfByTicket.keys(), ...execByTicket.keys()]);

  for (const ticketId of ticketIds) {
    const primitives: Primitive[] = [];

    const wfRuns = wfByTicket.get(ticketId);
    if (wfRuns && wfRuns.length > 0) {
      // Workflow wins: ignore this ticket's executions entirely.
      for (const wf of wfRuns) {
        const emoji = wf.emoji ? `${wf.emoji} ` : '';
        const step = wf.stepName ? ` › ${wf.stepName}` : '';
        primitives.push({ kind: 'workflow', label: `${emoji}${wf.name}${step}`, sort: wf.startedAt });
      }
      // Most recent run first, so the primary is the freshest.
      primitives.sort((a, b) => b.sort.localeCompare(a.sort));
    } else {
      // Group executions into panel / skill / agent primitives.
      const groups = new Map<string, Primitive & { count: number; sort: string }>();
      const bump = (key: string, make: () => Primitive & { count: number; sort: string }, startedAt: string) => {
        const g = groups.get(key);
        if (g) {
          g.count += 1;
          if (startedAt < g.sort) g.sort = startedAt;
        } else {
          groups.set(key, make());
        }
      };
      for (const e of execByTicket.get(ticketId) ?? []) {
        const mention = inputs.mentionById.get(e.mentionId);
        if (mention?.targetType === 'panel') {
          const name = inputs.panelDisplayByName.get(mention.targetAgent) ?? mention.targetAgent;
          bump(`panel:${mention.targetAgent}`, () => ({ kind: 'panel', name, count: 1, sort: e.startedAt }), e.startedAt);
        } else if (mention?.targetType === 'skill') {
          const name = inputs.skillDisplayByName.get(mention.targetAgent) ?? mention.targetAgent;
          bump(`skill:${mention.targetAgent}`, () => ({ kind: 'skill', name, count: 1, sort: e.startedAt }), e.startedAt);
        } else if (!mention && e.mentionId.startsWith('panel:')) {
          // Synthetic panel run (not triggered by an @panel mention): panel:<id>:<rand>.
          const panelId = e.mentionId.split(':')[1] ?? '';
          const name = inputs.panelDisplayById.get(panelId) ?? 'Panel';
          bump(`panel#${panelId}`, () => ({ kind: 'panel', name, count: 1, sort: e.startedAt }), e.startedAt);
        } else {
          // agent / human / unresolved mention → an agent, keyed per persona.
          const name = inputs.personaDisplayById.get(e.personaId) ?? 'Agent';
          bump(`agent:${e.personaId}`, () => ({ kind: 'agent', name, count: 1, sort: e.startedAt }), e.startedAt);
        }
      }
      primitives.push(...groups.values());
      primitives.sort((a, b) => {
        const o = PRIMITIVE_ORDER[a.kind] - PRIMITIVE_ORDER[b.kind];
        if (o !== 0) return o;
        const ca = 'count' in a ? a.count : 0;
        const cb = 'count' in b ? b.count : 0;
        if (ca !== cb) return cb - ca; // larger group first
        return a.sort.localeCompare(b.sort); // then oldest-started, stable
      });
    }

    if (primitives.length === 0) continue; // nothing attributable → caller's generic fallback
    const primary = formatPrimitive(primitives[0]!);
    const extra = primitives.length - 1;
    out.set(ticketId, extra > 0 ? `${primary} +${extra} more` : primary);
  }

  return out;
}

/**
 * The "waiting on you" label per ticket for workflow runs parked at a human gate
 * or on a terminated step — e.g. "📦 Spec Dev PR (HITL) › Build › human required".
 * Rendered in the queue's yellow waiting style, so it reads as an action you owe
 * the run rather than a phantom "running". The most recent run wins per ticket.
 *
 * Only workflow runs produce a label here; a plain agent question (a waiting
 * mention with no workflow) keeps the caller's generic "Waiting for a human
 * response".
 */
export function deriveWaitingWorkflowDetails(runs: Iterable<RunningWorkflowInput>): Map<string, string> {
  const latestByTicket = new Map<string, RunningWorkflowInput>();
  for (const run of runs) {
    const cur = latestByTicket.get(run.ticketId);
    if (!cur || run.startedAt > cur.startedAt) latestByTicket.set(run.ticketId, run);
  }
  const out = new Map<string, string>();
  for (const [ticketId, run] of latestByTicket) {
    const emoji = run.emoji ? `${run.emoji} ` : '';
    const step = run.stepName ? ` › ${run.stepName}` : '';
    out.set(ticketId, `${emoji}${run.name}${step} › human required`);
  }
  return out;
}
