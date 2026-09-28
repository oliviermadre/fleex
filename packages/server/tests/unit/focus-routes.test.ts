import { describe, it, expect, vi } from 'vitest';
import { computeFocus } from '../../src/infrastructure/http/focus.routes.js';

const T0 = '2026-09-28T08:00:00.000Z';
const T1 = '2026-09-28T09:00:00.000Z';

const dto = <T>(value: T) => ({ ...value, toDTO: () => value });

const ticket = (id: string, status = 'doing') => dto({
  id, boardId: 'b', displayId: 1, title: id, description: '', status, priority: 'medium', type: null, position: 0,
  tags: [], links: [], blocked: false, favorite: false, dueDate: null, assignee: null, agentClaimedAt: null,
  githubMetadata: null, archivedAt: null, firstDoingAt: T0, statusChangedAt: T0, conversationMode: 'talk',
  modelOverride: null, effortOverride: null, fastMode: false, createdAt: T0, updatedAt: T0,
});

const run = (id: string, ticketId: string, status: string, startedAt = T0) => dto({
  id, ticketId, templateId: 't', status, currentStepId: null, triggeredBy: 'me', triggeredFrom: 'ui',
  startedAt, completedAt: null, createdAt: startedAt, updatedAt: startedAt,
  templateSnapshot: {
    name: 'WF', emoji: '', entryStepId: 'gate', edges: [],
    steps: [{ id: 'gate', name: 'Gate', executorType: 'human_gate', executorRef: '', humanGateOutcomes: ['ok'], position: { x: 0, y: 0 } }],
  },
});

const stepRun = (id: string, runId: string, status: string) => dto({
  id, workflowRunId: runId, stepId: 'gate', attempt: 1, status, result: null, output: null, nextEdgeId: null,
  executionId: null, startedAt: T1, completedAt: null, createdAt: T1,
});

function deps() {
  const failedRun = run('rf', 'T2', 'failed', T0);
  const laterRun = run('rl', 'T2', 'completed', T1);
  const getByWorkflowRun = vi.fn(async (runId: string) => (runId === 'rg' ? [stepRun('sg', 'rg', 'needs_review')] : []));
  const getByTicket = vi.fn(async (tid: string) => (tid === 'T2' ? [laterRun, failedRun] : []));
  return {
    getByWorkflowRun,
    getByTicket,
    deps: {
      ticketStore: { getAllTickets: async () => [ticket('T1'), ticket('T2'), ticket('T3', 'todo')] },
      mentionStore: { getAll: async () => [] },
      agentEventStore: { getAllExecutions: async () => [] },
      personaStore: { getAll: async () => [] },
      commentStore: {
        getByTicketIds: async () => [
          { ...dto({ id: 'c1', ticketId: 'T1', authorType: 'agent', authorName: 'Dev', body: 'visible', createdAt: T1 }), authorType: 'agent', isVisibleTo: () => true },
          { ...dto({ id: 'c2', ticketId: 'T1', authorType: 'agent', authorName: 'Dev', body: 'private', createdAt: '2026-09-28T11:00:00.000Z' }), authorType: 'agent', isVisibleTo: () => false },
        ],
      },
      workflowRunStore: {
        getByStatus: async (s: string) => (s === 'needs_review' ? [run('rg', 'T1', 'needs_review')] : s === 'failed' ? [failedRun] : []),
        getByTicket,
      },
      stepRunStore: { getByWorkflowRun },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

describe('computeFocus', () => {
  it('wires the stores into the derivation', async () => {
    const { deps: d, getByTicket, getByWorkflowRun } = deps();
    const res = await computeFocus(d);

    // T1 has a gate; T2's failure is superseded by a later completed run → idle.
    expect(res.items.map((i) => [i.ticketId, i.kind])).toEqual([['T1', 'gate'], ['T2', 'idle']]);
    // Only the ticket with a failed run needs its full history.
    expect(getByTicket).toHaveBeenCalledTimes(1);
    expect(getByTicket).toHaveBeenCalledWith('T2');
    // Step runs are loaded for the active run, not for the superseded failed one.
    expect(getByWorkflowRun.mock.calls.map((c) => c[0])).toEqual(['rg']);
    // Private comments never reach the Focus list.
    expect(res.items[0]!.lastAgentComment?.body).toBe('visible');
  });

  it('returns an empty list when no ticket is in Doing or Reviewing', async () => {
    const { deps: d } = deps();
    d.ticketStore.getAllTickets = async () => [ticket('T9', 'todo')];
    expect(await computeFocus(d)).toEqual({ items: [], runningTicketIds: [] });
  });
});
