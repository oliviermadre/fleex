import type { FastifyInstance } from 'fastify';
import type { TicketUnreadCounts, TicketAgentActivity } from '@fleex/shared';
import { deriveTicketAgentActivity, deriveActivitySince } from '../../domain/services/ticket-agent-activity.js';
import type { Container } from '../container.js';

/**
 * Bulk ticket queries (unread counts + agent activity).
 *
 * These two endpoints take a list of ticket IDs whose length is bounded only by
 * how many tickets the instance holds. Serializing that list into the query
 * string blew past Node's `maxHeaderSize` (the request line counts towards it)
 * at ~425 tickets, and llhttp rejected the connection with `431 Request Header
 * Fields Too Large` before any handler ran — killing every activity pill and
 * unread badge in the Cockpit / Kanban / Dashboard (#509).
 *
 * So the payload moved to the request body: POST is the canonical verb. The GET
 * variants are kept as aliases because an already-installed CLI calls
 * `GET /api/tickets/agent-activity?ticketIds=<uuid>` with a single ID
 * (packages/cli/src/commands/ticket/show/index.ts).
 */

type BulkQueryDeps = Pick<
  Container,
  'kvStore' | 'commentStore' | 'deliverableStore' | 'agentEventStore' | 'mentionStore' | 'workflowRunStore'
>;

/** Accepts both `?ticketIds=a,b,c` (GET) and `{ ticketIds: [...] }` (POST). */
export function parseTicketIds(source: { query?: unknown; body?: unknown }): string[] {
  const body = source.body as { ticketIds?: unknown } | undefined;
  if (body && Array.isArray(body.ticketIds)) {
    return body.ticketIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  const raw = (source.query as Record<string, string> | undefined)?.ticketIds ?? '';
  return raw ? raw.split(',').filter(Boolean) : [];
}

export async function computeUnreadCounts(
  deps: BulkQueryDeps,
  requestedIds: string[],
): Promise<TicketUnreadCounts[]> {
  if (!deps.kvStore) return [];

  const [commentCursors, seenDeliverableEntries] = await Promise.all([
    deps.kvStore.listByPrefix('read_cursor:comment:'),
    deps.kvStore.listByPrefix('seen_deliverables:'),
  ]);

  // Build maps
  const commentMap = new Map<string, string>();
  for (const { key, value } of commentCursors) {
    const ticketId = key.replace('read_cursor:comment:', '');
    commentMap.set(ticketId, value);
  }
  const seenDeliverableMap = new Map<string, Set<string>>();
  for (const { key, value } of seenDeliverableEntries) {
    const ticketId = key.replace('seen_deliverables:', '');
    try {
      seenDeliverableMap.set(ticketId, new Set(JSON.parse(value) as string[]));
    } catch {
      seenDeliverableMap.set(ticketId, new Set());
    }
  }

  // Scope: when the frontend requests specific tickets, compute totals for ALL
  // of them (a ticket with no read cursor / seen entry yet is still untracked but
  // must report its real comment/deliverable totals). Only fall back to the set of
  // tracked tickets when no explicit IDs were requested.
  const trackedIds = new Set([...commentMap.keys(), ...seenDeliverableMap.keys()]);
  const ticketIds = requestedIds.length > 0
    ? requestedIds
    : [...trackedIds];

  if (ticketIds.length === 0) return [];

  // Batch fetch: 2 queries instead of N×2
  const [allComments, allDeliverables] = await Promise.all([
    deps.commentStore.getByTicketIds(ticketIds),
    deps.deliverableStore.getByTicketIds(ticketIds),
  ]);

  // Group by ticketId
  const commentsByTicket = new Map<string, typeof allComments>();
  for (const c of allComments) {
    let arr = commentsByTicket.get(c.ticketId);
    if (!arr) { arr = []; commentsByTicket.set(c.ticketId, arr); }
    arr.push(c);
  }
  const deliverablesByTicket = new Map<string, typeof allDeliverables>();
  for (const d of allDeliverables) {
    if (!d.ticketId) continue;
    let arr = deliverablesByTicket.get(d.ticketId);
    if (!arr) { arr = []; deliverablesByTicket.set(d.ticketId, arr); }
    arr.push(d);
  }

  const results: TicketUnreadCounts[] = [];
  for (const ticketId of ticketIds) {
    const commentCursor = commentMap.get(ticketId) ?? null;
    const seenSet = seenDeliverableMap.get(ticketId) ?? new Set<string>();
    const comments = commentsByTicket.get(ticketId) ?? [];
    const deliverables = deliverablesByTicket.get(ticketId) ?? [];

    const unreadComments = commentCursor
      ? comments.filter((c) => c.createdAt > new Date(commentCursor)).length
      : comments.length;
    const unreadDeliverables = deliverables.filter((d) => !seenSet.has(d.id)).length;

    results.push({ ticketId, totalComments: comments.length, totalDeliverables: deliverables.length, unreadComments, unreadDeliverables });
  }

  return results;
}

export async function computeAgentActivity(
  deps: BulkQueryDeps,
  requestedIds: string[],
): Promise<TicketAgentActivity[]> {
  if (requestedIds.length === 0) return [];

  const requested = new Set(requestedIds);

  // Workflow stores are optional (only wired when workflow templates exist).
  const [executions, mentions, runningRuns, needsReviewRuns, blockedRuns] = await Promise.all([
    deps.agentEventStore.getAllExecutions(),
    deps.mentionStore.getAll(),
    deps.workflowRunStore?.getByStatus('running') ?? Promise.resolve([]),
    deps.workflowRunStore?.getByStatus('needs_review') ?? Promise.resolve([]),
    deps.workflowRunStore?.getByStatus('blocked') ?? Promise.resolve([]),
  ]);

  // Routine-anchored executions and runs have a null ticketId — they belong to
  // no ticket, so they can never contribute to a ticket's activity. Narrowing
  // here keeps every downstream map keyed by a real ticket id.
  const withTicket = <T extends { ticketId: string | null }>(x: T): x is T & { ticketId: string } =>
    x.ticketId !== null;

  const runningExecutions = executions.filter(withTicket).filter(
    (e) => e.status === 'running' && requested.has(e.ticketId),
  );
  const waitingMentions = mentions.filter(
    (m) => m.status === 'waiting_for_info' && requested.has(m.ticketId),
  );
  const scopedRunningRuns = runningRuns.filter(withTicket).filter((r) => requested.has(r.ticketId));
  const gateRuns = [...needsReviewRuns, ...blockedRuns].filter(withTicket).filter((r) =>
    requested.has(r.ticketId),
  );

  // When each waiting mention's question was posed = the completion of the
  // execution that carried it (pass 5 "Waiting for {{age}}"). Latest wins
  // if a mention somehow ran twice.
  const executionCompletedAtByMentionId = new Map<string, string>();
  for (const e of executions) {
    if (!e.mentionId || !e.completedAt) continue;
    const prev = executionCompletedAtByMentionId.get(e.mentionId);
    if (!prev || e.completedAt > prev) {
      executionCompletedAtByMentionId.set(e.mentionId, e.completedAt);
    }
  }
  // Workflow-run / mention entities carry Date fields; the derivation
  // compares ISO strings (like executions do), so normalize here.
  const { runningSinceByTicket, waitingSinceByTicket } = deriveActivitySince({
    runningExecutions,
    runningWorkflowRuns: scopedRunningRuns.map((r) => ({
      ticketId: r.ticketId,
      startedAt: r.startedAt.toISOString(),
    })),
    waitingMentions: waitingMentions.map((m) => ({
      ticketId: m.ticketId,
      id: m.id,
      createdAt: m.createdAt.toISOString(),
    })),
    executionCompletedAtByMentionId,
    gateWorkflowRuns: gateRuns.map((r) => ({
      ticketId: r.ticketId,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });

  // The execution a `running` badge opens: freshest still-running one, so a
  // ticket that fired several agents lands on the latest thing that started.
  const runningExecutionIdByTicket = new Map<string, string>();
  const runningStartedAtByTicket = new Map<string, string>();
  for (const e of runningExecutions) {
    const prev = runningStartedAtByTicket.get(e.ticketId);
    if (prev && e.startedAt <= prev) continue;
    runningStartedAtByTicket.set(e.ticketId, e.startedAt);
    runningExecutionIdByTicket.set(e.ticketId, e.id);
  }

  // Last SDK activity per ticket → the cockpit's "idle since {{age}}" (#400).
  // CLI sessions are excluded (NaS spec'd "dernière exécution du sdk"); a
  // NULL source reads as sdk. Freshest signal wins: completedAt, else the
  // last streamed event, else the start.
  const lastSdkActivityAtByTicket = new Map<string, string>();
  for (const e of executions.filter(withTicket)) {
    if (e.source === 'cli' || !requested.has(e.ticketId)) continue;
    const ts = e.completedAt ?? e.lastEventAt ?? e.startedAt;
    const prev = lastSdkActivityAtByTicket.get(e.ticketId);
    if (!prev || ts > prev) lastSdkActivityAtByTicket.set(e.ticketId, ts);
  }

  // Cumulative agentic cost per ticket (#404): sum every execution's costUsd,
  // ALL origins (sdk + cli) and ALL statuses, treating null as 0 — same
  // accumulation get-statistics uses for totalCostUsd. "Cumulé" = every
  // dollar an agent spent on the ticket.
  const costByTicket = new Map<string, number>();
  for (const e of executions.filter(withTicket)) {
    if (!requested.has(e.ticketId)) continue;
    costByTicket.set(e.ticketId, (costByTicket.get(e.ticketId) ?? 0) + (e.costUsd ?? 0));
  }

  return deriveTicketAgentActivity(requestedIds, {
    runningExecutionTicketIds: runningExecutions.map((e) => e.ticketId),
    runningWorkflowTicketIds: scopedRunningRuns.map((r) => r.ticketId),
    waitingMentionTicketIds: waitingMentions.map((m) => m.ticketId),
    waitingWorkflowTicketIds: gateRuns.map((r) => r.ticketId),
    lastSdkActivityAtByTicket,
    runningSinceByTicket,
    waitingSinceByTicket,
    costByTicket,
    runningExecutionIdByTicket,
  });
}

/**
 * Registers both verbs for both endpoints. POST carries the IDs in the body
 * (no size ceiling); GET keeps the legacy query-string form for the CLI.
 */
export function registerTicketBulkQueryRoutes(app: FastifyInstance, deps: BulkQueryDeps): void {
  const unreadCounts = (request: { query?: unknown; body?: unknown }) =>
    computeUnreadCounts(deps, parseTicketIds(request));
  const agentActivity = (request: { query?: unknown; body?: unknown }) =>
    computeAgentActivity(deps, parseTicketIds(request));

  app.get('/api/tickets/unread-counts', unreadCounts);
  app.post('/api/tickets/unread-counts', unreadCounts);

  app.get('/api/tickets/agent-activity', agentActivity);
  app.post('/api/tickets/agent-activity', agentActivity);
}
