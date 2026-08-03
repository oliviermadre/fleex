import type { TicketDeliverable, TicketMention } from '@fleex/shared';

import type { NotificationRendererRegistry } from './registry';
import type { NotificationDraft, NotificationRenderer, RendererContext } from './types';

/**
 * Default Fleex Pulse renderers (V1).
 *
 * Scope decision: we deliberately do NOT notify on raw `comment:created`. The
 * orchestration layer posts many agent comments ("🚦 Starting workflow",
 * "Running skill: X", …) that would spam the bell. Instead we notify on the
 * specific moments where the human is expected to act or wants closure:
 *
 *   • deliverable:created          → a deliverable was posted (draft = wants input)
 *   • deliverable:updated (final)  → a deliverable was finalised
 *   • workflow:needs_review        → a step is waiting for human review
 *   • workflow:run_completed       → a workflow finished
 *   • workflow:run_failed          → a workflow errored
 *   • mention:waiting_for_info     → an agent is waiting for the human's answer
 *
 * Adding `comment:created` (or any other type) later is a one-liner in
 * `registerDefaultRenderers` — see registry.ts (open–closed).
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Trim a string field to a single short line for a notification body. */
function oneLine(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The quoted, one-line title of a deliverable, or `null` when it carries none.
 *
 * Deliverables created before the notification system shipped (and a few edge
 * cases) have no title; surfacing a literal `“Untitled”` reads worse than
 * staying generic, so callers fall back to a plain noun ("a document") instead.
 */
function quotedTitle(value: unknown): string | null {
  const title = str(value);
  return title ? `“${oneLine(title, 60)}”` : null;
}

// ── renderers ──────────────────────────────────────────────────────────────

/**
 * `deliverable:created` — payload is a full `TicketDeliverable` DTO.
 * Draft → the agent wants the human's input. Final → ready to consume.
 */
const renderDeliverableCreated: NotificationRenderer = (data, ctx) => {
  const d = asRecord(data) as Partial<TicketDeliverable> | null;
  if (!d) return null;
  const ticketId = str(d.ticketId);
  const id = str(d.id);
  if (!ticketId || !id) return null;

  const what = quotedTitle(d.title);
  const agent = str(d.agentName) ?? 'An agent';
  const link = ctx.ticketLink(ticketId, 'deliverables');

  if (d.status === 'final') {
    // Created directly as final — share the "finalised" identity so the
    // matching `deliverable:updated` (if any) is deduped against it.
    return {
      dedupKey: `deliverable-final:${id}`,
      emoji: '✅',
      title: 'Deliverable ready',
      body: what ? `${agent} shared ${what}` : `${agent} shared a document`,
      level: 'success',
      link,
      ticketId,
    };
  }

  return {
    dedupKey: `deliverable-draft:${id}`,
    emoji: '📝',
    title: 'Draft deliverable posted',
    body: what ? `${agent} shared a draft: ${what}` : `${agent} shared a draft`,
    level: 'action',
    link,
    ticketId,
  };
};

/**
 * `deliverable:updated` — payload is the current `TicketDeliverable` DTO (no
 * transition info). We only surface the final state, and share the dedup key
 * with `deliverable:created` so a deliverable is announced "final" exactly once
 * regardless of how many update broadcasts arrive.
 */
const renderDeliverableUpdated: NotificationRenderer = (data, ctx) => {
  const d = asRecord(data) as Partial<TicketDeliverable> | null;
  if (!d) return null;
  if (d.status !== 'final') return null; // draft edits are not noteworthy
  const ticketId = str(d.ticketId);
  const id = str(d.id);
  if (!ticketId || !id) return null;

  const what = quotedTitle(d.title);
  return {
    dedupKey: `deliverable-final:${id}`,
    emoji: '✅',
    title: 'Deliverable finalised',
    body: what ? `${what} is ready` : 'The deliverable is ready',
    level: 'success',
    link: ctx.ticketLink(ticketId, 'deliverables'),
    ticketId,
  };
};

/**
 * `workflow:needs_review` — `{ workflowRunId, stepRunId, stepId, ticketId }`.
 * A step finished and is awaiting human review (human gate / review step).
 */
const renderWorkflowNeedsReview: NotificationRenderer = (data, ctx) => {
  const e = asRecord(data);
  if (!e) return null;
  const ticketId = str(e.ticketId);
  if (!ticketId) return null;
  const stepRunId = str(e.stepRunId) ?? str(e.workflowRunId) ?? ticketId;
  return {
    dedupKey: `workflow-needs-review:${stepRunId}`,
    emoji: '⏳',
    title: 'Workflow needs your review',
    body: 'A step is waiting for your input',
    level: 'action',
    link: ctx.ticketLink(ticketId, 'workflow'),
    ticketId,
  };
};

/** `workflow:run_completed` — `{ workflowRunId, ticketId }`. */
const renderWorkflowCompleted: NotificationRenderer = (data, ctx) => {
  const e = asRecord(data);
  if (!e) return null;
  const ticketId = str(e.ticketId);
  const runId = str(e.workflowRunId);
  if (!ticketId || !runId) return null;
  return {
    dedupKey: `workflow-completed:${runId}`,
    emoji: '🏁',
    title: 'Workflow completed',
    body: 'The workflow finished',
    level: 'success',
    link: ctx.ticketLink(ticketId, 'workflow'),
    ticketId,
  };
};

/** `workflow:run_failed` — `{ workflowRunId, stepRunId, stepId, ticketId, error }`. */
const renderWorkflowFailed: NotificationRenderer = (data, ctx) => {
  const e = asRecord(data);
  if (!e) return null;
  const ticketId = str(e.ticketId);
  const runId = str(e.workflowRunId);
  if (!ticketId || !runId) return null;
  const error = str(e.error);
  return {
    dedupKey: `workflow-failed:${runId}`,
    emoji: '❌',
    title: 'Workflow failed',
    body: error ? oneLine(error) : 'The workflow errored',
    level: 'error',
    link: ctx.ticketLink(ticketId, 'workflow'),
    ticketId,
  };
};

/**
 * `mention:waiting_for_info` — payload is a `TicketMention` DTO. The mentioned
 * agent set itself to `waiting_for_info`: it needs the human's answer to
 * continue.
 */
const renderMentionWaiting: NotificationRenderer = (data, ctx) => {
  const m = asRecord(data) as Partial<TicketMention> | null;
  if (!m) return null;
  const ticketId = str(m.ticketId);
  const id = str(m.id);
  if (!ticketId || !id) return null;
  const agent = str(m.targetAgent) ?? 'An agent';
  return {
    dedupKey: `mention-waiting:${id}`,
    emoji: '❓',
    title: 'An agent is waiting for you',
    body: `${agent} needs your input`,
    level: 'action',
    link: ctx.ticketLink(ticketId, 'comments'),
    ticketId,
  };
};

/** Register the V1 renderers on a registry. Idempotent. */
export function registerDefaultRenderers(registry: NotificationRendererRegistry): void {
  registry
    .register('deliverable:created', renderDeliverableCreated)
    .register('deliverable:updated', renderDeliverableUpdated)
    .register('workflow:needs_review', renderWorkflowNeedsReview)
    .register('workflow:run_completed', renderWorkflowCompleted)
    .register('workflow:run_failed', renderWorkflowFailed)
    .register('mention:waiting_for_info', renderMentionWaiting);
}

/** Exposed for unit tests. */
export const __renderers = {
  renderDeliverableCreated,
  renderDeliverableUpdated,
  renderWorkflowNeedsReview,
  renderWorkflowCompleted,
  renderWorkflowFailed,
  renderMentionWaiting,
} satisfies Record<string, NotificationRenderer>;

export type { NotificationDraft };
