import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { WorkflowRun, StepRun } from '@fleex/shared';

// Mock the api module with a factory so the real network layer is never loaded.
vi.mock('../services/api', () => ({
  fetchWorkflowRuns: vi.fn(),
  fetchWorkflowRunDetail: vi.fn(),
  startWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  resolveWorkflowGate: vi.fn(),
  retryWorkflowStep: vi.fn(),
}));

import * as api from '../services/api';

import { useWorkflowRunStore } from './workflowRunStore';

function makeRun(id: string, currentStepId: string, status: WorkflowRun['status']): WorkflowRun {
  return {
    id,
    ticketId: 't1',
    templateId: 'tmpl1',
    templateSnapshot: {
      name: 'Spec Dev PR',
      emoji: '⚙️',
      steps: [],
      edges: [],
      entryStepId: 'spec',
    },
    status,
    currentStepId,
    triggeredBy: 'user',
    triggeredFrom: 'ui',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('workflowRunStore — out-of-order responses must not regress the view', () => {
  beforeEach(() => {
    useWorkflowRunStore.setState({ runsByTicket: {}, detail: {}, loading: false, error: null });
    vi.clearAllMocks();
  });

  // WHY: the workflow view renders the "current step" purely from detail[runId].run.
  // A burst of WebSocket events fires several loadDetail() fetches; if a stale earlier-issued
  // response resolves last, it pins the UI on the previous step until a manual refresh.
  // The latest-issued request must always win, regardless of HTTP resolution order.
  it('loadDetail: a stale earlier-issued response must not overwrite a newer one', async () => {
    const runId = 'run1';
    const stale = deferred<{ run: WorkflowRun; stepRuns: StepRun[] }>();
    const fresh = deferred<{ run: WorkflowRun; stepRuns: StepRun[] }>();

    vi.mocked(api.fetchWorkflowRunDetail)
      .mockReturnValueOnce(stale.promise) // 1st issued: agent step still "running"
      .mockReturnValueOnce(fresh.promise); // 2nd issued: advanced to the gate / needs_review

    const store = useWorkflowRunStore.getState();
    const p1 = store.loadDetail(runId);
    const p2 = store.loadDetail(runId);

    // Resolve OUT OF ORDER: the newer request first, then the stale one.
    fresh.resolve({ run: makeRun(runId, 'gate', 'needs_review'), stepRuns: [] });
    stale.resolve({ run: makeRun(runId, 'spec', 'running'), stepRuns: [] });
    await Promise.all([p1, p2]);

    const d = useWorkflowRunStore.getState().detail[runId];
    expect(d).toBeDefined();
    expect(d?.run.currentStepId).toBe('gate');
    expect(d?.run.status).toBe('needs_review');
  });

  // WHY: same race class on the runs list (drives active/history split in the tab header).
  it('loadForTicket: a stale earlier-issued response must not overwrite a newer one', async () => {
    const ticketId = 't1';
    const stale = deferred<WorkflowRun[]>();
    const fresh = deferred<WorkflowRun[]>();

    vi.mocked(api.fetchWorkflowRuns)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);

    const store = useWorkflowRunStore.getState();
    const p1 = store.loadForTicket(ticketId);
    const p2 = store.loadForTicket(ticketId);

    fresh.resolve([makeRun('run1', 'gate', 'needs_review')]);
    stale.resolve([makeRun('run1', 'spec', 'running')]);
    await Promise.all([p1, p2]);

    const runs = useWorkflowRunStore.getState().runsByTicket[ticketId];
    expect(runs?.[0]?.status).toBe('needs_review');
    expect(runs?.[0]?.currentStepId).toBe('gate');
  });
});
