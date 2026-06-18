import { describe, it, expect } from 'vitest';
import { getDashboardLaunchpad, type LaunchpadDeps } from '../../src/application/use-cases/get-dashboard-launchpad.js';
import type { SessionStorePort } from '../../src/application/ports/session-store.port.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { WorkflowRunStorePort } from '../../src/application/ports/workflow-run-store.port.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');

// ── DTO stub builders (helper only calls .toDTO() / reads plain fields) ──

function session(over: Record<string, unknown>) {
  const dto = {
    id: 'sess-1', tmuxName: 'fleex_claude_x', type: 'claude', status: 'running',
    cwd: '/x', createdAt: NOW.toISOString(), lastAttachedAt: null,
    repositoryOrg: null, repositoryName: null, worktreeBranch: null, gitRemote: null,
    displayName: 'sess', hookStatus: 'working', ...over,
  };
  return { toDTO: () => dto };
}

function execution(over: Record<string, unknown>) {
  return {
    id: 'exec-1', personaId: 'p1', ticketId: 't1', mentionId: 'm1', eventCount: 1,
    status: 'running', startedAt: NOW.toISOString(), completedAt: null, lastEventAt: null,
    ...over,
  };
}

function mention(over: Record<string, unknown>) {
  const dto = {
    id: 'm1', ticketId: 't1', commentId: 'c1', targetAgent: 'agent', sourceAgent: 'nas',
    targetType: 'agent', executionMode: 'plan', status: 'pending', resolvedAt: null,
    resolvedCommentId: null, resolvedDeliverableId: null, createdAt: NOW.toISOString(), ...over,
  };
  return { toDTO: () => dto };
}

function deliverable(over: Record<string, unknown>) {
  const dto = {
    id: 'd1', ticketId: 't1', agentName: 'Jeff', type: 'report', title: 'Report',
    content: '...', version: 1, status: 'final', mentionId: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  };
  return { toDTO: () => dto };
}

function workflowRun(over: Record<string, unknown>) {
  const dto = {
    id: 'wf1', ticketId: 't1', templateId: 'tpl', status: 'running', currentStepId: 's2',
    triggeredBy: 'nas', triggeredFrom: 'web', startedAt: NOW.toISOString(),
    completedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    templateSnapshot: {
      name: 'Feature Delivery', emoji: '🚀', entryStepId: 's1',
      steps: [{ id: 's1', name: 'Plan' }, { id: 's2', name: 'Build' }, { id: 's3', name: 'Review' }],
      edges: [],
    },
    ...over,
  };
  return { toDTO: () => dto };
}

function deps(over: Partial<LaunchpadDeps>): LaunchpadDeps {
  return {
    sessionStore: { getAll: async () => [] } as unknown as SessionStorePort,
    agentEventStore: { getAllExecutions: async () => [] } as unknown as AgentEventStorePort,
    deliverableStore: { getAll: async () => [] } as unknown as DeliverableStorePort,
    mentionStore: { getAll: async () => [] } as unknown as MentionStorePort,
    personaStore: { getAll: async () => [] } as unknown as PersonaStorePort,
    workflowRunStore: null,
    tickets: [],
    now: NOW,
    ...over,
  };
}

describe('getDashboardLaunchpad', () => {
  it('aggregates live runs, spend, mentions, plans, stale tickets and in-flight runs', async () => {
    const result = await getDashboardLaunchpad(deps({
      sessionStore: {
        getAll: async () => [
          session({ id: 's-run', status: 'running', hookStatus: 'working' }),
          session({ id: 's-wait', status: 'running', hookStatus: 'waiting' }),
          session({ id: 's-shell', type: 'shell', status: 'running' }),
        ],
      } as unknown as SessionStorePort,
      agentEventStore: {
        getAllExecutions: async () => [
          execution({ id: 'e-run', mentionId: 'm-run', status: 'running', costUsd: 1.5 }),
          execution({ id: 'e-done', mentionId: 'm-old', status: 'completed', costUsd: 3.32 }),
        ],
      } as unknown as AgentEventStorePort,
      mentionStore: {
        getAll: async () => [
          mention({ id: 'm-wait', ticketId: 't1', status: 'waiting_for_info', targetAgent: 'Agent-Delta' }),
          mention({ id: 'm-run', ticketId: 't1', targetType: 'agent' }),
        ],
      } as unknown as MentionStorePort,
      personaStore: {
        getAll: async () => [{ id: 'p1', displayName: 'Jeff Bezos', name: 'jeff' }],
      } as unknown as PersonaStorePort,
      deliverableStore: {
        getAll: async () => [
          deliverable({ id: 'd-plan', type: 'plan', title: 'OAuth2 plan', agentName: 'Jeff Bezos' }),
        ],
      } as unknown as DeliverableStorePort,
      tickets: [
        { id: 't1', displayId: 1, title: 'OAuth2', status: 'doing', updatedAt: NOW.toISOString() },
        { id: 't2', displayId: 2, title: 'Stale bug', status: 'doing', updatedAt: '2026-05-30T10:00:00.000Z' },
      ],
    }));

    expect(result.liveRuns).toBe(2);
    expect(result.liveRunsNeedReview).toBe(1);
    expect(result.spendTodayUsd).toBe(4.82);
    expect(result.deliverablesToday).toBe(1);

    const kinds = result.needsYou.map((n) => n.kind);
    expect(kinds).toContain('mention_waiting');
    expect(kinds).toContain('plan_ready');
    expect(kinds).toContain('stale');

    // running execution m-run → an agent in-flight item titled by persona display name
    const agentItem = result.inFlight.find((i) => i.kind === 'agent');
    expect(agentItem?.title).toBe('Jeff Bezos');

    expect(result.recentOutputs).toHaveLength(1);
  });

  it('surfaces workflow flows and failed runs when the store is present', async () => {
    const result = await getDashboardLaunchpad(deps({
      workflowRunStore: {
        getByStatus: async (status: string) =>
          status === 'running' ? [workflowRun({})] :
          status === 'failed' ? [workflowRun({ id: 'wf-fail', status: 'failed', completedAt: NOW.toISOString() })] :
          [],
      } as unknown as WorkflowRunStorePort,
      tickets: [{ id: 't1', displayId: 1, title: 'Feature', status: 'doing', updatedAt: NOW.toISOString() }],
    }));

    const flow = result.inFlight.find((i) => i.kind === 'flow');
    expect(flow?.title).toBe('Feature Delivery');
    expect(flow?.stepIndex).toBe(2);   // currentStepId s2 → 2nd of 3
    expect(flow?.stepTotal).toBe(3);
    expect(flow?.detail).toBe('Build');

    expect(result.needsReviewFailed).toBe(1);
    expect(result.needsYou.some((n) => n.kind === 'failed_run')).toBe(true);
  });

  it('degrades gracefully when workflowRunStore is null', async () => {
    const result = await getDashboardLaunchpad(deps({ workflowRunStore: null }));
    expect(result.inFlight.some((i) => i.kind === 'flow')).toBe(false);
    expect(result.needsReviewFailed).toBe(0);
    expect(result.needsYou).toEqual([]);
  });
});
