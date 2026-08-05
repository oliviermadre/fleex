import { describe, it, expect } from 'vitest';
import type { StepRun, WorkflowExecutorType } from '@fleex/shared';
import { stepSessionState } from './stepSession';

function stepRun(status: StepRun['status'], executionId: string | null): StepRun {
  return {
    id: 'sr-1',
    workflowRunId: 'run-1',
    stepId: 'step-1',
    attempt: 1,
    status,
    result: null,
    output: null,
    nextEdgeId: null,
    executionId,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const step = (executorType: WorkflowExecutorType) => ({ executorType });

describe('stepSessionState', () => {
  // WHY: human gates, native actions and pure routing steps never spawn an agent.
  // Offering a "SDK session" button on them would be a link to nothing, so they
  // must be excluded on executor type — regardless of what the step-run carries.
  it.each(['human_gate', 'native', 'route'] as const)(
    'reports no session for %s steps even if a run exists',
    (executorType) => {
      expect(stepSessionState(step(executorType), stepRun('completed', 'exec-1'))).toEqual({
        kind: 'none',
      });
    },
  );

  it.each(['agent', 'panel', 'skill'] as const)(
    'exposes the session of a finished %s step',
    (executorType) => {
      expect(stepSessionState(step(executorType), stepRun('completed', 'exec-1'))).toEqual({
        kind: 'available',
        executionId: 'exec-1',
        live: false,
      });
    },
  );

  // WHY: the server stamps executionId when the agent STARTS (run-workflow-step.ts),
  // not when it finishes. Watching the turns of a step that is still running is the
  // whole point of the feature, so `running` must be openable — and flagged live so
  // the UI can say so.
  it('exposes a still-running step as a live session', () => {
    expect(stepSessionState(step('agent'), stepRun('running', 'exec-1'))).toEqual({
      kind: 'available',
      executionId: 'exec-1',
      live: true,
    });
  });

  // WHY: an agentic step that hasn't started has no session yet, but WILL have one.
  // That is a different message to the user than "this step never has a session".
  it('reports pending for an agentic step with no run yet', () => {
    expect(stepSessionState(step('agent'), undefined)).toEqual({ kind: 'pending' });
  });

  it('reports pending for an agentic step queued without an executionId', () => {
    expect(stepSessionState(step('agent'), stepRun('queued', null))).toEqual({ kind: 'pending' });
  });
});
