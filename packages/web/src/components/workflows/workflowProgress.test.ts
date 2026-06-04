import { describe, it, expect } from 'vitest';
import type { StepRun } from '@fleex/shared';
import { countCompletedSteps } from './workflowProgress';

function stepRun(
  stepId: string,
  attempt: number,
  status: StepRun['status'],
): StepRun {
  return {
    id: `${stepId}-${attempt}`,
    workflowRunId: 'run1',
    stepId,
    attempt,
    status,
    result: status === 'completed' ? 'ok' : null,
    output: null,
    nextEdgeId: null,
    executionId: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: status === 'completed' ? '2026-01-01T00:01:00.000Z' : null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('countCompletedSteps', () => {
  it('returns 0 when there are no step runs', () => {
    expect(countCompletedSteps([])).toBe(0);
  });

  // WHY: the header reads "X/total steps completed" where total = distinct template steps.
  // The numerator must therefore also count DISTINCT steps, not step-run rows.
  // Reject loop-back scenario from the ticket: spec → reject → spec → gate waiting.
  // A rejected human gate's step-run is marked 'completed' (resolveGate), and the
  // re-run produces a 2nd completed 'spec' attempt — naively that is 3 completed rows,
  // but only ONE distinct step (spec) is actually done; the gate is back to needs_review.
  it('counts a step re-run after reject once and ignores the superseded rejected gate', () => {
    const stepRuns: StepRun[] = [
      stepRun('spec', 1, 'completed'), // first spec attempt
      stepRun('check-spec', 1, 'completed'), // human gate REJECTED (resolveGate → completed)
      stepRun('spec', 2, 'completed'), // spec re-run after reject
      stepRun('check-spec', 2, 'needs_review'), // gate now waiting for decision
    ];

    expect(countCompletedSteps(stepRuns)).toBe(1);
  });

  it('counts each distinct step whose latest attempt is completed on a forward path', () => {
    const stepRuns: StepRun[] = [
      stepRun('spec', 1, 'completed'),
      stepRun('check-spec', 1, 'completed'), // gate approved
      stepRun('pr-faq', 1, 'completed'),
      stepRun('builder', 1, 'running'), // in progress, not counted
    ];

    expect(countCompletedSteps(stepRuns)).toBe(3);
  });
});
