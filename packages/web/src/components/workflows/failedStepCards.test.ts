import { describe, it, expect } from 'vitest';

import type {
  WorkflowRun,
  StepRun,
  WorkflowStep,
  WorkflowRunStatus,
  StepRunStatus,
  WorkflowExecutorType,
} from '@fleex/shared';

import { selectFailedStepCards } from './failedStepCards';

function step(id: string, executorType: WorkflowExecutorType = 'agent'): WorkflowStep {
  return { id, name: `Step ${id}`, executorType, executorRef: '', position: { x: 0, y: 0 } };
}

function run(
  id: string,
  status: WorkflowRunStatus,
  steps: WorkflowStep[],
  startedAt = '2026-01-01T00:00:00.000Z',
): WorkflowRun {
  return {
    id,
    ticketId: 't1',
    templateId: 'tpl1',
    templateSnapshot: {
      name: 'WF',
      emoji: '🚦',
      steps,
      edges: [],
      entryStepId: steps[0]?.id ?? '',
    },
    status,
    currentStepId: null,
    triggeredBy: 'api',
    triggeredFrom: 'api',
    startedAt,
    completedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

function stepRun(runId: string, stepId: string, attempt: number, status: StepRunStatus): StepRun {
  return {
    id: `${runId}-${stepId}-${attempt}`,
    workflowRunId: runId,
    stepId,
    attempt,
    status,
    result: null,
    output: null,
    nextEdgeId: null,
    executionId: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('selectFailedStepCards', () => {
  it('returns [] when there are no runs', () => {
    expect(selectFailedStepCards(undefined, {})).toEqual([]);
    expect(selectFailedStepCards([], {})).toEqual([]);
  });

  // WHY: the entire point of the ticket — a step that dies on "Reached maximum
  // number of turns" posts no comment and creates no mention, so the Comments
  // thread has nothing to show. This card IS the missing signal.
  it('surfaces a card for the failed step of the latest run', () => {
    const dev = step('dev');
    const r = run('r1', 'failed', [dev]);
    const cards = selectFailedStepCards([r], {
      r1: { stepRuns: [stepRun('r1', 'dev', 1, 'failed')] },
    });
    expect(cards.map((c) => [c.run.id, c.step.id, c.stepRun.id])).toEqual([
      ['r1', 'dev', 'r1-dev-1'],
    ]);
  });

  // WHY: once the user retries, the step must stop offering a retry — otherwise
  // they can fire a second concurrent execution of a step that is already running.
  it('ignores a superseded failed attempt when a newer attempt is live', () => {
    const dev = step('dev');
    const r = run('r1', 'failed', [dev]);
    const cards = selectFailedStepCards([r], {
      r1: { stepRuns: [stepRun('r1', 'dev', 1, 'failed'), stepRun('r1', 'dev', 2, 'running')] },
    });
    expect(cards).toEqual([]);
  });

  // WHY: retrying calls run.advanceTo(), which resurrects the run into `running`.
  // Offering retry on a superseded run would put two concurrent runs on one
  // ticket. This is a correctness guard, not cosmetics.
  it('never offers retry on an older failed run once a newer run exists', () => {
    const dev = step('dev');
    const old = run('rOld', 'failed', [dev], '2026-01-01T00:00:00.000Z');
    for (const status of ['running', 'completed', 'failed'] as const) {
      const recent = run('rNew', status, [dev], '2026-01-02T00:00:00.000Z');
      const cards = selectFailedStepCards([old, recent], {
        rOld: { stepRuns: [stepRun('rOld', 'dev', 1, 'failed')] },
        rNew: { stepRuns: [stepRun('rNew', 'dev', 1, status === 'failed' ? 'failed' : 'running')] },
      });
      expect(
        cards.map((c) => c.run.id),
        status,
      ).not.toContain('rOld');
    }
  });

  // WHY: "most recent" must mean most recently STARTED, not "wherever the API
  // happened to put it in the array" — otherwise ordering changes silently move
  // the retry button onto the wrong run.
  it('picks the latest run by startedAt, not by array position', () => {
    const dev = step('dev');
    const recent = run('rNew', 'failed', [dev], '2026-06-01T00:00:00.000Z');
    const old = run('rOld', 'failed', [dev], '2026-01-01T00:00:00.000Z');
    const detail = {
      rOld: { stepRuns: [stepRun('rOld', 'dev', 1, 'failed')] },
      rNew: { stepRuns: [stepRun('rNew', 'dev', 1, 'failed')] },
    };
    // Latest run last in the array…
    expect(selectFailedStepCards([old, recent], detail).map((c) => c.run.id)).toEqual(['rNew']);
    // …and first: same answer.
    expect(selectFailedStepCards([recent, old], detail).map((c) => c.run.id)).toEqual(['rNew']);
  });

  // WHY: step-run status lives in the run detail, which loads asynchronously.
  // Rendering before it arrives would flash an empty card on every ticket open.
  it('returns [] when the failed run detail is not loaded yet', () => {
    const r = run('r1', 'failed', [step('dev')]);
    expect(selectFailedStepCards([r], {})).toEqual([]);
  });

  // WHY: cancelling is a deliberate user gesture (Terminate). Nagging them with
  // a retry card for something they chose to stop is wrong.
  it('shows no card when the user cancelled the run', () => {
    const dev = step('dev');
    const r = run('r1', 'cancelled', [dev]);
    const cards = selectFailedStepCards([r], {
      r1: { stepRuns: [stepRun('r1', 'dev', 1, 'failed')] },
    });
    expect(cards).toEqual([]);
  });

  // WHY: a run that reached the end has nothing left to retry, even if an early
  // attempt failed and was recovered along the way.
  it('shows no card for a completed run', () => {
    const dev = step('dev');
    const r = run('r1', 'completed', [dev]);
    const cards = selectFailedStepCards([r], {
      r1: { stepRuns: [stepRun('r1', 'dev', 1, 'failed')] },
    });
    expect(cards).toEqual([]);
  });

  // WHY: deliberate divergence from the gate/waiting cards, which exclude
  // human_gate. A gate that CRASHES (vs. one waiting for a decision) blocks the
  // workflow exactly like an agent step and must be retryable.
  it('surfaces a card for a crashed human_gate step', () => {
    const gate = step('check', 'human_gate');
    const r = run('r1', 'failed', [gate]);
    const cards = selectFailedStepCards([r], {
      r1: { stepRuns: [stepRun('r1', 'check', 1, 'failed')] },
    });
    expect(cards.map((c) => c.step.id)).toEqual(['check']);
  });

  // WHY: only the step that actually died is actionable; the ones that succeeded
  // before it must not each grow a retry button.
  it('ignores completed steps of the failed run', () => {
    const spec = step('spec');
    const dev = step('dev');
    const r = run('r1', 'failed', [spec, dev]);
    const cards = selectFailedStepCards([r], {
      r1: { stepRuns: [stepRun('r1', 'spec', 1, 'completed'), stepRun('r1', 'dev', 1, 'failed')] },
    });
    expect(cards.map((c) => c.step.id)).toEqual(['dev']);
  });
});
