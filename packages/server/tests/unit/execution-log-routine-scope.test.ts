import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { agentEventsRoutes } from '../../src/infrastructure/http/agent-events.routes.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import type { ExecutionLogResponse } from '@fleex/shared';

// ---------------------------------------------------------------------------
// A routine run has NO ticket. The Execution Log used to render it exactly like
// a ticket run — same chip, same "open ticket / comments / deliverables" CTAs —
// and every one of those buttons navigated nowhere. The row can only render the
// right affordances if the API tells it what the run is anchored to, so these
// tests pin the anchor down at the payload level:
//   - `routineId` is present (the UI keys the chip + the CTA set off it),
//   - the ticket-shaped fields are empty rather than stale,
//   - `scope` lets the user cut the log by anchor.
// ---------------------------------------------------------------------------

const snapshot = {
  name: 'fleex-based',
  emoji: '',
  entryStepId: 'triage',
  edges: [],
  steps: [{ id: 'triage', name: 'Triage', executorType: 'agent' as const, executorRef: 'p', position: { x: 0, y: 0 } }],
};

const routine = RoutineEntity.create({
  id: 'r-1',
  name: 'Daily recap',
  emoji: '🔁',
  templateId: 'tmpl-1',
  subject: { brief: 'Summarise yesterday' },
});

const routineRun = WorkflowRunEntity.create({
  id: 'run-routine',
  routineId: 'r-1',
  templateId: 'tmpl-1',
  templateSnapshot: snapshot,
  triggeredBy: '@nas',
  triggeredFrom: 'api',
});

const ticketRun = WorkflowRunEntity.create({
  id: 'run-ticket',
  ticketId: 't-1',
  templateId: 'tmpl-1',
  templateSnapshot: snapshot,
  triggeredBy: '@nas',
  triggeredFrom: 'api',
});

function makeContainer() {
  return {
    agentEventStore: { getAllExecutions: async () => [] },
    workflowRunStore: { getAll: async () => [routineRun, ticketRun] },
    ticketStore: {
      getAllTickets: async () => [
        { id: 't-1', displayId: 42, title: 'A real ticket', priority: 'high', type: 'feature' },
      ],
    },
    personaStore: { getAll: async () => [] },
    mentionStore: { getByIds: async () => [] },
    commentStore: { getByTicketIds: async () => [{ ticketId: 't-1' }, { ticketId: 't-1' }] },
    deliverableStore: { getByTicketIds: async () => [{ ticketId: 't-1' }] },
    panelStore: { getAll: async () => [] },
    skillStore: { getAll: async () => [] },
    stepRunStore: { getAll: async () => [] },
    routineStore: { getAll: async () => [routine] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('execution log — routine-anchored runs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(agentEventsRoutes(makeContainer()));
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  async function fetchLog(query = ''): Promise<ExecutionLogResponse> {
    const res = await app.inject({ method: 'GET', url: `/api/executions${query}` });
    expect(res.statusCode).toBe(200);
    return res.json() as ExecutionLogResponse;
  }

  it('exposes the routine anchor and leaves the ticket fields empty', async () => {
    const body = await fetchLog();
    const entry = body.entries.find((e) => e.workflowRunId === 'run-routine');
    expect(entry).toBeDefined();

    // Without `routineId` the row cannot tell a routine run from a ticket run,
    // which is exactly how the dead ticket CTAs shipped.
    expect(entry!.routineId).toBe('r-1');
    expect(entry!.ticketId).toBeNull();

    // The chip the row renders in place of the ticket chip.
    expect(entry!.routineName).toBe('Daily recap');
    expect(entry!.routineEmoji).toBe('🔁');

    // No ticket ⇒ nothing to count. A non-zero count here would put a "2
    // comments" badge on a button that opens no ticket.
    expect(entry!.ticketTitle).toBeNull();
    expect(entry!.commentCount).toBe(0);
    expect(entry!.deliverableCount).toBe(0);
  });

  it('still enriches ticket-anchored runs (no regression)', async () => {
    const body = await fetchLog();
    const entry = body.entries.find((e) => e.workflowRunId === 'run-ticket')!;
    expect(entry.routineId).toBeNull();
    expect(entry.ticketTitle).toBe('A real ticket');
    expect(entry.commentCount).toBe(2);
    expect(entry.deliverableCount).toBe(1);
  });

  it('cuts the log by anchor via ?scope', async () => {
    const all = await fetchLog();
    expect(all.scopeCounts).toEqual({ all: 2, tickets: 1, routines: 1 });

    const routines = await fetchLog('?scope=routines');
    expect(routines.entries.map((e) => e.workflowRunId)).toEqual(['run-routine']);

    const tickets = await fetchLog('?scope=tickets');
    expect(tickets.entries.map((e) => e.workflowRunId)).toEqual(['run-ticket']);
  });

  it('matches a routine by name in the search box', async () => {
    // The routine name is the row title, so searching for what you see must work.
    const body = await fetchLog('?q=daily%20recap');
    expect(body.entries.map((e) => e.workflowRunId)).toEqual(['run-routine']);
  });
});
