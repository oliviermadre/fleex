import { describe, it, expect } from 'vitest';
import type { AgentExecution, StepRun, Ticket, TicketComment, TicketMention, WorkflowRun } from '@fleex/shared';
import { deriveFocusItems, orderSteps, type FocusInputs } from '../../src/domain/services/focus-items.js';

const T0 = '2026-09-28T08:00:00.000Z';
const T1 = '2026-09-28T09:00:00.000Z';
const T2 = '2026-09-28T10:00:00.000Z';

function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id, boardId: 'b1', displayId: 1, title: `Ticket ${id}`, description: '', status: 'doing', priority: 'medium',
    type: null, position: 0, tags: [], links: [], blocked: false, favorite: false, dueDate: null, assignee: null,
    agentClaimedAt: null, githubMetadata: null, archivedAt: null, firstDoingAt: T0, statusChangedAt: T0,
    conversationMode: 'talk' as Ticket['conversationMode'], modelOverride: null, effortOverride: null, fastMode: false,
    createdAt: T0, updatedAt: T0, ...over,
  } as Ticket;
}

function mention(id: string, ticketId: string, status: TicketMention['status'], over: Partial<TicketMention> = {}): TicketMention {
  return {
    id, ticketId, commentId: 'c', targetAgent: 'dev', sourceAgent: 'user', targetType: 'agent', executionMode: 'edit',
    status, resolvedAt: null, resolvedCommentId: null, resolvedDeliverableId: null, createdAt: T0, ...over,
  };
}

function exec(id: string, ticketId: string, over: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id, personaId: 'p-dev', ticketId, mentionId: 'm1', eventCount: 1, status: 'completed',
    startedAt: T0, completedAt: T1, lastEventAt: T1, ...over,
  } as AgentExecution;
}

/** plan → gate → build, the gate routing on its outcome. */
function run(id: string, ticketId: string, status: WorkflowRun['status'], over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id, ticketId, templateId: 'tpl', status, currentStepId: null, triggeredBy: 'me', triggeredFrom: 'ui',
    startedAt: T0, completedAt: null, createdAt: T0, updatedAt: T1,
    templateSnapshot: {
      name: 'Feature', emoji: '🚀', entryStepId: 'plan',
      steps: [
        { id: 'build', name: 'Build', executorType: 'agent', executorRef: 'dev', position: { x: 0, y: 0 } },
        { id: 'plan', name: 'Plan', executorType: 'agent', executorRef: 'archi', position: { x: 0, y: 0 } },
        { id: 'gate', name: 'Validate plan', executorType: 'human_gate', executorRef: '', humanGateOutcomes: ['approve', 'rework'], position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'plan', target: 'gate', isDefault: true },
        { id: 'e2', source: 'gate', target: 'build', isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'outcome', operator: 'eq', value: 'approve' }] } },
        { id: 'e3', source: 'gate', target: 'plan', isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'outcome', operator: 'eq', value: 'rework' }] } },
      ],
    },
    ...over,
  };
}

function stepRun(id: string, runId: string, stepId: string, status: StepRun['status'], over: Partial<StepRun> = {}): StepRun {
  return {
    id, workflowRunId: runId, stepId, attempt: 1, status, result: null, output: null, nextEdgeId: null,
    executionId: null, startedAt: T1, completedAt: null, createdAt: T1, ...over,
  };
}

function inputs(over: Partial<FocusInputs>): FocusInputs {
  return {
    tickets: [], mentions: [], executions: [], runsByTicket: new Map(), stepRunsByRun: new Map(),
    lastAgentCommentByTicket: new Map(), personaDisplayByName: new Map([['dev', 'Dev']]), ...over,
  };
}

describe('deriveFocusItems', () => {
  it('only watches Doing and Reviewing tickets that are not archived', () => {
    const { items } = deriveFocusItems(inputs({
      tickets: [
        ticket('todo', { status: 'todo' }), ticket('done', { status: 'done' }),
        ticket('arch', { archivedAt: T1 }), ticket('rev', { status: 'reviewing' }),
      ],
    }));
    expect(items.map((i) => i.ticketId)).toEqual(['rev']);
  });

  it('surfaces a human gate with its outcomes and where each one leads', () => {
    const r = run('r1', 'T1', 'needs_review');
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      runsByTicket: new Map([['T1', [r]]]),
      stepRunsByRun: new Map([['r1', [
        stepRun('s-plan', 'r1', 'plan', 'completed'),
        stepRun('s-gate', 'r1', 'gate', 'needs_review', { startedAt: T2 }),
      ]]]),
    }));
    expect(items).toHaveLength(1);
    const it0 = items[0]!;
    expect(it0.kind).toBe('gate');
    expect(it0.key).toBe('gate:s-gate');
    expect(it0.since).toBe(T2);
    expect(it0.gate).toMatchObject({ runId: 'r1', stepRunId: 's-gate', mode: 'outcome', stepName: 'Validate plan' });
    expect(it0.gate!.options).toEqual([
      { value: 'approve', label: 'approve', targetStepName: 'Build' },
      { value: 'rework', label: 'rework', targetStepName: 'Plan' },
    ]);
    // Pipeline in execution order, not template order.
    expect(it0.workflow!.steps.map((s) => [s.name, s.state])).toEqual([
      ['Plan', 'done'], ['Validate plan', 'current'], ['Build', 'todo'],
    ]);
  });

  it('ignores a superseded attempt of a gate step', () => {
    const r = run('r1', 'T1', 'running');
    const { items, runningTicketIds } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      runsByTicket: new Map([['T1', [r]]]),
      stepRunsByRun: new Map([['r1', [
        stepRun('a1', 'r1', 'gate', 'needs_review', { attempt: 1 }),
        stepRun('a2', 'r1', 'gate', 'running', { attempt: 2 }),
      ]]]),
    }));
    expect(items).toEqual([]);
    expect(runningTicketIds).toEqual(['T1']);
  });

  it('offers the candidate edges of an ambiguous route', () => {
    const r = run('r1', 'T1', 'needs_review');
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      runsByTicket: new Map([['T1', [r]]]),
      stepRunsByRun: new Map([['r1', [stepRun('s', 'r1', 'gate', 'awaiting_routing', {
        output: { schemaFields: {}, result: 'ok', routing: { candidateEdgeIds: ['e2', 'e3', 'gone'] } },
      })]]]),
    }));
    expect(items[0]!.gate!.mode).toBe('route');
    expect(items[0]!.gate!.options.map((o) => [o.value, o.targetStepName])).toEqual([['e2', 'Build'], ['e3', 'Plan']]);
  });

  it('turns an agent waiting_for_info mention into a question carrying its last comment', () => {
    const comment = { id: 'c9', ticketId: 'T1', authorType: 'agent', authorName: 'Dev', body: 'Global or per board?', createdAt: T2 } as TicketComment;
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      mentions: [mention('m1', 'T1', 'waiting_for_info')],
      executions: [exec('x1', 'T1', { mentionId: 'm1', completedAt: T2 })],
      lastAgentCommentByTicket: new Map([['T1', comment]]),
    }));
    expect(items[0]).toMatchObject({
      kind: 'question', key: 'question:m1', since: T2,
      question: { source: 'mention', mentionId: 'm1', askedBy: 'Dev', text: 'Global or per board?' },
      lastAgentComment: { authorName: 'Dev', body: 'Global or per board?' },
    });
  });

  it('turns a paused non-gate step into a step question', () => {
    const r = run('r1', 'T1', 'needs_review');
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      runsByTicket: new Map([['T1', [r]]]),
      stepRunsByRun: new Map([['r1', [stepRun('s', 'r1', 'plan', 'needs_review', {
        output: { schemaFields: {}, result: 'needs_review', comment: 'Which repo?' },
      })]]]),
    }));
    expect(items[0]!.question).toMatchObject({ source: 'step', runId: 'r1', stepRunId: 's', askedBy: 'Plan', text: 'Which repo?' });
  });

  it('reports a failed step of the latest run, not of an older one', () => {
    const old = run('old', 'T1', 'failed', { startedAt: T0 });
    const latest = run('new', 'T1', 'completed', { startedAt: T1 });
    const stale = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      runsByTicket: new Map([['T1', [old, latest]]]),
      stepRunsByRun: new Map([['old', [stepRun('s', 'old', 'plan', 'failed')]]]),
    }));
    expect(stale.items[0]!.kind).toBe('idle');

    const fresh = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      runsByTicket: new Map([['T1', [run('r', 'T1', 'failed')]]]),
      stepRunsByRun: new Map([['r', [stepRun('s', 'r', 'build', 'failed', { executionId: 'x7' })]]]),
    }));
    expect(fresh.items[0]).toMatchObject({ kind: 'error', key: 'error:s', error: { source: 'step', label: 'Build', executionId: 'x7' } });
  });

  it('reports a crashed agent session with its execution', () => {
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      mentions: [mention('m1', 'T1', 'failed')],
      executions: [exec('x1', 'T1', { mentionId: 'm1', status: 'failed' })],
    }));
    expect(items[0]).toMatchObject({ kind: 'error', error: { source: 'mention', mentionId: 'm1', label: 'Dev', executionId: 'x1' } });
  });

  it('hides errors and idleness while something is running or queued', () => {
    const { items, runningTicketIds } = deriveFocusItems(inputs({
      tickets: [ticket('T1'), ticket('T2')],
      mentions: [mention('m1', 'T1', 'failed'), mention('m2', 'T2', 'pending')],
      executions: [exec('x1', 'T1', { mentionId: 'm3', status: 'running' })],
    }));
    expect(items).toEqual([]);
    expect(runningTicketIds.sort()).toEqual(['T1', 'T2']);
  });

  it('keeps a gate visible even while an agent is running on the ticket', () => {
    const r = run('r1', 'T1', 'needs_review');
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      executions: [exec('x1', 'T1', { status: 'running' })],
      runsByTicket: new Map([['T1', [r]]]),
      stepRunsByRun: new Map([['r1', [stepRun('s', 'r1', 'gate', 'needs_review')]]]),
    }));
    expect(items[0]!.kind).toBe('gate');
  });

  it('ranks gate over question over error for a single row per ticket', () => {
    const r = run('r1', 'T1', 'needs_review');
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1')],
      mentions: [mention('m1', 'T1', 'waiting_for_info'), mention('m2', 'T1', 'failed')],
      runsByTicket: new Map([['T1', [r]]]),
      stepRunsByRun: new Map([['r1', [stepRun('s', 'r1', 'gate', 'needs_review')]]]),
    }));
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('gate');
  });

  it('lists an idle ticket with the agent to relaunch, and skips manually blocked ones', () => {
    const { items } = deriveFocusItems(inputs({
      tickets: [ticket('T1', { statusChangedAt: T0 }), ticket('T2', { blocked: true })],
      mentions: [mention('m1', 'T1', 'resolved')],
      executions: [exec('x1', 'T1', { mentionId: 'm1', completedAt: T2, costUsd: 1.5 })],
    }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'idle', key: 'idle:T1', since: T2, costUsd: 1.5,
      idle: { lastActivityAt: T2, lastAgentName: 'dev', lastAgentDisplayName: 'Dev' },
    });
  });
});

describe('orderSteps', () => {
  it('walks the graph from the entry step and appends unreachable steps', () => {
    const r = run('r', 'T', 'running');
    const withOrphan = {
      templateSnapshot: {
        ...r.templateSnapshot,
        steps: [...r.templateSnapshot.steps, { id: 'lonely', name: 'Lonely', executorType: 'agent' as const, executorRef: 'x', position: { x: 0, y: 0 } }],
      },
    };
    expect(orderSteps(withOrphan).map((s) => s.id)).toEqual(['plan', 'gate', 'build', 'lonely']);
  });
});
