import { describe, it, expect } from 'vitest';
import type {
  WorkflowRun,
  StepRun,
  WorkflowStep,
  WorkflowRunStatus,
  StepRunStatus,
  WorkflowExecutorType,
} from '@fleex/shared';
import { selectWaitingInputCards } from './waitingInputCards';

function step(id: string, executorType: WorkflowExecutorType): WorkflowStep {
  return { id, name: `Step ${id}`, executorType, executorRef: '', position: { x: 0, y: 0 } };
}

function run(id: string, status: WorkflowRunStatus, steps: WorkflowStep[]): WorkflowRun {
  return {
    id,
    ticketId: 't1',
    templateId: 'tpl1',
    templateSnapshot: { name: 'WF', emoji: '🚦', steps, edges: [], entryStepId: steps[0]?.id ?? '' },
    status,
    currentStepId: null,
    triggeredBy: 'api',
    triggeredFrom: 'api',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('selectWaitingInputCards', () => {
  it('returns [] when there are no runs', () => {
    expect(selectWaitingInputCards(undefined, {})).toEqual([]);
    expect(selectWaitingInputCards([], {})).toEqual([]);
  });

  // WHY: this is the whole point of the feature — a non-gate step that paused to
  // ask a question must surface a reply card in the thread, because it creates no
  // mention and so the mention-driven "…is waiting for your reply" banner never fires.
  it('surfaces a card for a non-gate step in needs_review', () => {
    const spec = step('spec', 'agent');
    const r = run('r1', 'needs_review', [spec]);
    const cards = selectWaitingInputCards([r], { r1: { stepRuns: [stepRun('r1', 'spec', 1, 'needs_review')] } });
    expect(cards.map((c) => [c.run.id, c.step.id, c.stepRun.id])).toEqual([['r1', 'spec', 'r1-spec-1']]);
  });

  // WHY: parity boundary. Human Gate steps in needs_review already have their own
  // approve/reject card; generating a waiting-input card for them too would double up.
  it('never surfaces a card for a human_gate step (owned by the gate card)', () => {
    const gate = step('check', 'human_gate');
    const r = run('r1', 'needs_review', [gate]);
    const cards = selectWaitingInputCards([r], { r1: { stepRuns: [stepRun('r1', 'check', 1, 'needs_review')] } });
    expect(cards).toEqual([]);
  });

  // WHY: when a gate and a question step are both paused, only the question step
  // gets a waiting-input card — the two card sets partition needs_review cleanly.
  it('picks only the non-gate step when a gate and a question step are both waiting', () => {
    const spec = step('spec', 'agent');
    const gate = step('check', 'human_gate');
    const r = run('r1', 'needs_review', [spec, gate]);
    const cards = selectWaitingInputCards([r], {
      r1: { stepRuns: [stepRun('r1', 'spec', 1, 'needs_review'), stepRun('r1', 'check', 1, 'needs_review')] },
    });
    expect(cards.map((c) => c.step.id)).toEqual(['spec']);
  });

  // WHY: a retry supersedes the paused attempt. Once the user has answered and the
  // step re-runs, its latest attempt is running/completed — the card must vanish so
  // it can't be answered twice. Only the LATEST attempt per step decides.
  it('ignores a superseded needs_review attempt when the latest attempt is live again', () => {
    const spec = step('spec', 'agent');
    const r = run('r1', 'needs_review', [spec]);
    const cards = selectWaitingInputCards([r], {
      r1: { stepRuns: [stepRun('r1', 'spec', 1, 'needs_review'), stepRun('r1', 'spec', 2, 'running')] },
    });
    expect(cards).toEqual([]);
  });

  // WHY: only ACTIVE runs can be awaiting input. A cancelled/completed/failed run
  // must never leave a dangling card even if a stale step-run row still reads needs_review.
  it('ignores non-active runs', () => {
    const spec = step('spec', 'agent');
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const r = run('r1', status, [spec]);
      const cards = selectWaitingInputCards([r], { r1: { stepRuns: [stepRun('r1', 'spec', 1, 'needs_review')] } });
      expect(cards, status).toEqual([]);
    }
  });

  // WHY: detection reads step-run status, which lives in the loaded run detail.
  // Before that detail arrives, we render nothing rather than guess.
  it('returns [] for an active run whose detail is not loaded yet', () => {
    const r = run('r1', 'needs_review', [step('spec', 'agent')]);
    expect(selectWaitingInputCards([r], {})).toEqual([]);
  });

  // WHY: concurrent runs each pause independently — one card per waiting step,
  // each carrying its own run + stepRun so "reply & retry" targets the right one.
  it('produces one card per waiting non-gate step across concurrent runs', () => {
    const a = run('rA', 'needs_review', [step('spec', 'agent')]);
    const b = run('rB', 'blocked', [step('draft', 'panel')]);
    const cards = selectWaitingInputCards([a, b], {
      rA: { stepRuns: [stepRun('rA', 'spec', 1, 'needs_review')] },
      rB: { stepRuns: [stepRun('rB', 'draft', 1, 'needs_review')] },
    });
    expect(cards.map((c) => c.run.id).sort()).toEqual(['rA', 'rB']);
    expect(cards.map((c) => c.stepRun.id).sort()).toEqual(['rA-spec-1', 'rB-draft-1']);
  });

  // WHY: a step that is merely running (not paused) is not awaiting input.
  it('ignores non-gate steps that are not in needs_review', () => {
    const r = run('r1', 'running', [step('spec', 'agent')]);
    const cards = selectWaitingInputCards([r], { r1: { stepRuns: [stepRun('r1', 'spec', 1, 'running')] } });
    expect(cards).toEqual([]);
  });
});
