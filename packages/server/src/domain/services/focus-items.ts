import type {
  AgentExecution,
  FocusError,
  FocusGate,
  FocusGateOption,
  FocusItem,
  FocusItemKind,
  FocusPipelineStep,
  FocusQuestion,
  FocusRunning,
  FocusWorkflowRef,
  StepRun,
  Ticket,
  TicketComment,
  TicketMention,
  WorkflowEdge,
  WorkflowRun,
  WorkflowStep,
} from '@fleex/shared';
import { FOCUS_KIND_ORDER } from '@fleex/shared';

/**
 * Pure derivation of the Focus list: every Doing/Reviewing ticket that waits on
 * a human, with exactly what the human needs to act without opening it.
 *
 * The detection rules mirror the inline HITL cards of the ticket thread
 * (web `gateCards`, `waitingInputCards`, `ambiguousRoutingCards`,
 * `failedStepCards`, `crashedMentionCards`) so Focus and the thread always agree
 * on what is pending:
 *  - only ACTIVE runs can hold a gate, a routing choice or a paused question;
 *  - only the LATEST attempt of a step counts (a re-run supersedes it);
 *  - a failed step is only offered on the MOST RECENT run (retrying an older one
 *    would start a second concurrent run).
 *
 * One item per ticket; when several reasons apply the most actionable wins
 * (`FOCUS_KIND_ORDER`). A ticket with work in flight (running execution or run,
 * queued mention) is not idle and its stale failures are not shown — the fresh
 * run supersedes them — but a gate or a question still wins over "running",
 * like the activity pill.
 */

export interface FocusInputs {
  readonly tickets: readonly Ticket[];
  readonly mentions: readonly TicketMention[];
  readonly executions: readonly AgentExecution[];
  /** Workflow runs per ticket, any order. */
  readonly runsByTicket: ReadonlyMap<string, readonly WorkflowRun[]>;
  /** Step runs per workflow run, for the runs that may carry a pending item. */
  readonly stepRunsByRun: ReadonlyMap<string, readonly StepRun[]>;
  /** Latest agent-authored comment per ticket. */
  readonly lastAgentCommentByTicket: ReadonlyMap<string, TicketComment>;
  /** persona name (mention.targetAgent) → display name. */
  readonly personaDisplayByName: ReadonlyMap<string, string>;
}

export interface FocusDerivation {
  readonly items: FocusItem[];
  readonly running: FocusRunning[];
}

const FOCUS_STATUSES = new Set(['doing', 'reviewing']);
const ACTIVE_RUN = new Set(['running', 'blocked', 'needs_review']);

/** Statuses the Focus list watches. */
export function isFocusCandidate(t: Pick<Ticket, 'status' | 'archivedAt'>): boolean {
  return FOCUS_STATUSES.has(t.status) && !t.archivedAt;
}

function latestPerStep(stepRuns: readonly StepRun[]): StepRun[] {
  const m = new Map<string, StepRun>();
  for (const sr of stepRuns) {
    const cur = m.get(sr.stepId);
    if (!cur || sr.attempt > cur.attempt) m.set(sr.stepId, sr);
  }
  return [...m.values()];
}

const maxIso = (...xs: (string | null | undefined)[]): string | null =>
  xs.reduce<string | null>((acc, x) => (x && (!acc || x > acc) ? x : acc), null);

/** Steps in execution order: BFS from the entry step, then anything unreachable. */
export function orderSteps(run: Pick<WorkflowRun, 'templateSnapshot'>): WorkflowStep[] {
  const { steps, edges, entryStepId } = run.templateSnapshot;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: WorkflowStep[] = [];
  const queue = byId.has(entryStepId) ? [entryStepId] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id);
    if (!s) continue;
    out.push(s);
    for (const e of edges) if (e.source === id && !seen.has(e.target)) queue.push(e.target);
  }
  for (const s of steps) if (!seen.has(s.id)) out.push(s);
  return out;
}

function pipeline(run: WorkflowRun, stepRuns: readonly StepRun[], currentStepId: string | null): FocusWorkflowRef {
  const latest = new Map(latestPerStep(stepRuns).map((sr) => [sr.stepId, sr]));
  const steps: FocusPipelineStep[] = orderSteps(run).map((s) => {
    const sr = latest.get(s.id);
    const state = s.id === currentStepId
      ? 'current'
      : sr && (sr.status === 'completed' || sr.status === 'skipped') ? 'done' : 'todo';
    return { id: s.id, name: s.name, state, isGate: s.executorType === 'human_gate' };
  });
  return { runId: run.id, name: run.templateSnapshot.name, emoji: run.templateSnapshot.emoji, steps };
}

/** Does this edge fire for the given gate outcome? (source-step `outcome` clause, or legacy condition) */
function edgeMatchesOutcome(edge: WorkflowEdge, outcome: string): boolean {
  const test = (field: string, operator: string, value: unknown, stepId?: string, ci?: boolean) => {
    if (field !== 'outcome' || (stepId && stepId !== edge.source)) return false;
    const norm = (v: string) => (ci ? v.toLowerCase() : v);
    if (operator === 'eq') return typeof value === 'string' && norm(value) === norm(outcome);
    if (operator === 'in') return Array.isArray(value) && value.map(String).map(norm).includes(norm(outcome));
    return false;
  };
  if (edge.conditionGroup) {
    return edge.conditionGroup.clauses.some((c) => test(c.field, c.operator, c.value, c.stepId, c.caseInsensitive));
  }
  if (edge.condition) return test(edge.condition.field, edge.condition.operator, edge.condition.value);
  return false;
}

export function gateOptions(run: WorkflowRun, step: WorkflowStep, outcomes: readonly string[]): FocusGateOption[] {
  const stepName = new Map(run.templateSnapshot.steps.map((s) => [s.id, s.name]));
  const out = run.templateSnapshot.edges.filter((e) => e.source === step.id);
  const fallback = out.find((e) => e.isDefault) ?? (out.length === 1 ? out[0] : undefined);
  return outcomes.map((o) => {
    const edge = out.find((e) => edgeMatchesOutcome(e, o)) ?? fallback;
    return { value: o, label: o, targetStepName: edge ? stepName.get(edge.target) ?? null : null };
  });
}

/**
 * What is in flight on a busy ticket, most concrete first: a workflow step, then
 * a live SDK session, then a mention waiting for its turn.
 */
function describeRunning(
  ticketId: string,
  runs: readonly WorkflowRun[],
  execs: readonly AgentExecution[],
  mentions: readonly TicketMention[],
  stepRunsByRun: ReadonlyMap<string, readonly StepRun[]>,
  mentionById: ReadonlyMap<string, TicketMention>,
  display: (name: string) => string,
  costUsd: number,
): FocusRunning {
  const liveExec = execs
    .filter((e) => e.status === 'running')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const run = runs.find((r) => r.status === 'running');
  if (run) {
    const stepRuns = stepRunsByRun.get(run.id) ?? [];
    const current = latestPerStep(stepRuns)
      .filter((sr) => sr.status === 'running' || sr.status === 'queued')
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
    const step = current ? run.templateSnapshot.steps.find((s) => s.id === current.stepId) : undefined;
    return {
      ticketId, source: 'workflow', label: step?.name ?? run.templateSnapshot.name,
      since: current?.startedAt ?? run.startedAt, executionId: current?.executionId ?? liveExec?.id ?? null,
      workflow: pipeline(run, stepRuns, current?.stepId ?? null), costUsd,
    };
  }
  if (liveExec) {
    const m = mentionById.get(liveExec.mentionId);
    return {
      ticketId, source: 'agent', label: m?.targetType === 'agent' ? display(m.targetAgent) : 'Agent',
      since: liveExec.startedAt, executionId: liveExec.id, workflow: null, costUsd,
    };
  }
  const queued = mentions.find((m) => m.targetType === 'agent' && (m.status === 'pending' || m.status === 'acknowledged'));
  return {
    ticketId, source: 'queued', label: queued ? display(queued.targetAgent) : 'Agent',
    since: queued?.createdAt ?? null, executionId: null, workflow: null, costUsd,
  };
}

interface Candidate {
  kind: FocusItemKind;
  key: string;
  since: string | null;
  workflow: FocusWorkflowRef | null;
  gate?: FocusGate;
  question?: FocusQuestion;
  error?: FocusError;
}

export function deriveFocusItems(inputs: FocusInputs): FocusDerivation {
  const candidates = inputs.tickets.filter(isFocusCandidate);
  const ids = new Set(candidates.map((t) => t.id));

  const mentionsByTicket = new Map<string, TicketMention[]>();
  for (const m of inputs.mentions) {
    if (!ids.has(m.ticketId)) continue;
    const arr = mentionsByTicket.get(m.ticketId) ?? [];
    arr.push(m);
    mentionsByTicket.set(m.ticketId, arr);
  }
  const execsByTicket = new Map<string, AgentExecution[]>();
  for (const e of inputs.executions) {
    if (!e.ticketId || !ids.has(e.ticketId)) continue;
    const arr = execsByTicket.get(e.ticketId) ?? [];
    arr.push(e);
    execsByTicket.set(e.ticketId, arr);
  }
  const mentionById = new Map(inputs.mentions.map((m) => [m.id, m]));
  const display = (name: string) => inputs.personaDisplayByName.get(name) ?? name;

  const items: FocusItem[] = [];
  const running: FocusRunning[] = [];

  for (const ticket of candidates) {
    const mentions = mentionsByTicket.get(ticket.id) ?? [];
    const execs = execsByTicket.get(ticket.id) ?? [];
    const runs = [...(inputs.runsByTicket.get(ticket.id) ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const found: Candidate[] = [];

    // ── Workflow runs: gates, routing choices, paused questions ──
    for (const run of runs) {
      if (!ACTIVE_RUN.has(run.status)) continue;
      const stepRuns = inputs.stepRunsByRun.get(run.id) ?? [];
      const stepById = new Map(run.templateSnapshot.steps.map((s) => [s.id, s]));
      const edgeById = new Map(run.templateSnapshot.edges.map((e) => [e.id, e]));
      for (const sr of latestPerStep(stepRuns)) {
        const step = stepById.get(sr.stepId);
        if (!step) continue;
        const since = maxIso(sr.completedAt, sr.startedAt) ?? run.updatedAt;
        if (sr.status === 'needs_review' && step.executorType === 'human_gate') {
          const outcomes = step.humanGateOutcomes?.length
            ? step.humanGateOutcomes
            : ((sr.output?.schemaFields?.outcomes as string[] | undefined) ?? []);
          found.push({
            kind: 'gate', key: `gate:${sr.id}`, since, workflow: pipeline(run, stepRuns, step.id),
            gate: {
              runId: run.id, stepRunId: sr.id, stepName: step.name, mode: 'outcome',
              options: gateOptions(run, step, outcomes), context: sr.output?.comment ?? null,
            },
          });
        } else if (sr.status === 'awaiting_routing') {
          const options = (sr.output?.routing?.candidateEdgeIds ?? [])
            .map((id) => edgeById.get(id))
            .filter((e): e is WorkflowEdge => Boolean(e))
            .map((e) => {
              const target = stepById.get(e.target)?.name ?? null;
              return { value: e.id, label: e.label || target || e.target, targetStepName: target };
            });
          if (options.length === 0) continue;
          found.push({
            kind: 'gate', key: `gate:${sr.id}`, since, workflow: pipeline(run, stepRuns, step.id),
            gate: { runId: run.id, stepRunId: sr.id, stepName: step.name, mode: 'route', options, context: sr.output?.comment ?? null },
          });
        } else if (sr.status === 'needs_review') {
          found.push({
            kind: 'question', key: `question:${sr.id}`, since, workflow: pipeline(run, stepRuns, step.id),
            question: {
              source: 'step', mentionId: null, runId: run.id, stepRunId: sr.id,
              askedBy: step.name, text: sr.output?.comment ?? null,
              questions: sr.output?.questions ?? null,
            },
          });
        }
      }
    }

    // ── Mentions: agent questions ──
    for (const m of mentions) {
      if (m.status !== 'waiting_for_info' || m.targetType !== 'agent') continue;
      const asked = execs
        .filter((e) => e.mentionId === m.id && e.completedAt)
        .reduce<string | null>((acc, e) => maxIso(acc, e.completedAt), null);
      const comment = inputs.lastAgentCommentByTicket.get(ticket.id);
      found.push({
        kind: 'question', key: `question:${m.id}`, since: asked ?? m.createdAt, workflow: null,
        question: {
          source: 'mention', mentionId: m.id, runId: null, stepRunId: null,
          askedBy: display(m.targetAgent), text: comment?.body ?? null,
          questions: comment?.questions ?? null,
        },
      });
    }

    // ── In flight? ──
    const busy =
      execs.some((e) => e.status === 'running') ||
      runs.some((r) => r.status === 'running') ||
      mentions.some((m) => m.targetType === 'agent' && (m.status === 'pending' || m.status === 'acknowledged'));

    // ── Errors (only when nothing fresher is in flight) ──
    if (!busy) {
      const latestRun = runs[0];
      if (latestRun && (latestRun.status === 'failed' || latestRun.status === 'needs_review')) {
        const stepRuns = inputs.stepRunsByRun.get(latestRun.id) ?? [];
        const stepById = new Map(latestRun.templateSnapshot.steps.map((s) => [s.id, s]));
        for (const sr of latestPerStep(stepRuns)) {
          if (sr.status !== 'failed') continue;
          const step = stepById.get(sr.stepId);
          if (!step) continue;
          found.push({
            kind: 'error', key: `error:${sr.id}`, since: maxIso(sr.completedAt, sr.startedAt) ?? latestRun.updatedAt,
            workflow: pipeline(latestRun, stepRuns, step.id),
            error: {
              source: 'step', runId: latestRun.id, stepRunId: sr.id, mentionId: null,
              label: step.name, message: sr.output?.comment ?? null, executionId: sr.executionId,
            },
          });
        }
      }
      for (const m of mentions) {
        if (m.status !== 'failed' || m.targetType !== 'agent') continue;
        const exec = execs
          .filter((e) => e.mentionId === m.id)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        found.push({
          kind: 'error', key: `error:${m.id}`, since: exec?.completedAt ?? exec?.startedAt ?? m.createdAt, workflow: null,
          error: {
            source: 'mention', runId: null, stepRunId: null, mentionId: m.id,
            label: display(m.targetAgent), message: null, executionId: exec?.id ?? null,
          },
        });
      }
    }

    const lastSdk = execs
      .filter((e) => e.source !== 'cli')
      .reduce<string | null>((acc, e) => maxIso(acc, e.completedAt ?? e.lastEventAt ?? e.startedAt), null);
    const costUsd = execs.reduce((n, e) => n + (e.costUsd ?? 0), 0);
    const comment = inputs.lastAgentCommentByTicket.get(ticket.id);
    const lastAgentComment = comment ? { authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt } : null;

    found.sort((a, b) => FOCUS_KIND_ORDER[a.kind] - FOCUS_KIND_ORDER[b.kind] || (a.since ?? '').localeCompare(b.since ?? ''));
    const top = found[0];

    if (!top) {
      if (busy) {
        running.push(describeRunning(ticket.id, runs, execs, mentions, inputs.stepRunsByRun, mentionById, display, costUsd));
        continue;
      }
      const lastAgentExec = [...execs]
        .filter((e) => mentionById.get(e.mentionId)?.targetType === 'agent')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      const lastAgentName = lastAgentExec ? mentionById.get(lastAgentExec.mentionId)!.targetAgent : null;
      items.push({
        key: `idle:${ticket.id}:${ticket.status}`, kind: 'idle', ticketId: ticket.id,
        since: maxIso(lastSdk, ticket.statusChangedAt, runs[0]?.completedAt),
        workflow: null, gate: null, question: null, error: null,
        idle: {
          lastActivityAt: lastSdk,
          lastAgentName,
          lastAgentDisplayName: lastAgentName ? display(lastAgentName) : null,
        },
        lastAgentComment, costUsd,
      });
      continue;
    }

    items.push({
      key: top.key, kind: top.kind, ticketId: ticket.id, since: top.since, workflow: top.workflow,
      gate: top.gate ?? null, question: top.question ?? null, error: top.error ?? null, idle: null,
      lastAgentComment, costUsd,
    });
  }

  return { items, running };
}
