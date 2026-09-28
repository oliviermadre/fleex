import type { FastifyInstance } from 'fastify';
import type { FocusResponse, StepRun, TicketComment, WorkflowRun } from '@fleex/shared';
import { deriveFocusItems, isFocusCandidate } from '../../domain/services/focus-items.js';
import type { Container } from '../container.js';

type FocusDeps = Pick<
  Container,
  'ticketStore' | 'mentionStore' | 'agentEventStore' | 'commentStore' | 'workflowRunStore' | 'stepRunStore' | 'personaStore'
>;

/**
 * Gathers what `deriveFocusItems` needs for every Doing/Reviewing ticket, in a
 * bounded number of store reads: runs come from the three active statuses plus
 * `failed` (and, only for the few tickets with a failed run, their full history
 * to tell whether that failure is still the latest run); step runs are loaded
 * only for the runs that can carry a pending item.
 */
export async function computeFocus(deps: FocusDeps): Promise<FocusResponse> {
  const tickets = (await deps.ticketStore.getAllTickets()).map((t) => t.toDTO()).filter(isFocusCandidate);
  if (tickets.length === 0) return { items: [], runningTicketIds: [] };
  const ids = new Set(tickets.map((t) => t.id));

  const runStore = deps.workflowRunStore;
  const [mentions, executions, personas, comments, ...runGroups] = await Promise.all([
    deps.mentionStore.getAll(),
    deps.agentEventStore.getAllExecutions(),
    deps.personaStore.getAll(),
    deps.commentStore.getByTicketIds([...ids]),
    runStore?.getByStatus('running') ?? Promise.resolve([]),
    runStore?.getByStatus('blocked') ?? Promise.resolve([]),
    runStore?.getByStatus('needs_review') ?? Promise.resolve([]),
    runStore?.getByStatus('failed') ?? Promise.resolve([]),
  ]);

  const runsByTicket = new Map<string, Map<string, WorkflowRun>>();
  const addRun = (r: WorkflowRun) => {
    if (!r.ticketId || !ids.has(r.ticketId)) return;
    const m = runsByTicket.get(r.ticketId) ?? new Map<string, WorkflowRun>();
    m.set(r.id, r);
    runsByTicket.set(r.ticketId, m);
  };
  for (const group of runGroups) for (const r of group) addRun(r.toDTO());

  // A failed run only matters if it is the ticket's latest run: fetch the history
  // of just those tickets so a later completed run can supersede it.
  const failedTickets = [...new Set(runGroups[3]!.map((r) => r.ticketId).filter((t): t is string => !!t && ids.has(t)))];
  if (runStore) {
    await Promise.all(failedTickets.map(async (tid) => {
      for (const r of await runStore.getByTicket(tid)) addRun(r.toDTO());
    }));
  }

  // Step runs: active runs, and each ticket's latest run when it failed.
  const needDetail: WorkflowRun[] = [];
  for (const m of runsByTicket.values()) {
    const runs = [...m.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    runs.forEach((r, i) => {
      if (r.status === 'running' || r.status === 'blocked' || r.status === 'needs_review' || (i === 0 && r.status === 'failed')) {
        needDetail.push(r);
      }
    });
  }
  const stepRunsByRun = new Map<string, StepRun[]>();
  if (deps.stepRunStore) {
    const store = deps.stepRunStore;
    await Promise.all(needDetail.map(async (r) => {
      stepRunsByRun.set(r.id, (await store.getByWorkflowRun(r.id)).map((s) => s.toDTO()));
    }));
  }

  const lastAgentCommentByTicket = new Map<string, TicketComment>();
  for (const c of comments) {
    // Workflow engine notices ("🚪 Human Gate — …") are authored as `workflow`:
    // system chatter, not what an agent last said.
    if (c.authorType !== 'agent' || c.authorName === 'workflow' || !c.isVisibleTo('user')) continue;
    const dto = c.toDTO();
    const prev = lastAgentCommentByTicket.get(dto.ticketId);
    if (!prev || dto.createdAt > prev.createdAt) lastAgentCommentByTicket.set(dto.ticketId, dto);
  }

  return deriveFocusItems({
    tickets,
    mentions: mentions.filter((m) => ids.has(m.ticketId)).map((m) => m.toDTO()),
    executions: executions.filter((e) => e.ticketId && ids.has(e.ticketId)),
    runsByTicket: new Map([...runsByTicket].map(([k, v]) => [k, [...v.values()]])),
    stepRunsByRun,
    lastAgentCommentByTicket,
    personaDisplayByName: new Map(personas.map((p) => [p.name, p.displayName || p.name])),
  });
}

/** GET /api/focus — the human-attention queue (Focus view + nav badge). */
export function registerFocusRoutes(app: FastifyInstance, deps: FocusDeps): void {
  app.get('/api/focus', () => computeFocus(deps));
}
