import { describe, it, expect } from 'vitest';
import type {
  WorkflowRun,
  StepRun,
  WorkflowStep,
  WorkflowRunStatus,
  StepRunStatus,
  WorkflowExecutorType,
  TicketDeliverable,
} from '@fleex/shared';
import { selectGateCards, type GateExecutionInput } from './gateCards';

function step(id: string, executorType: WorkflowExecutorType, humanGateOutcomes?: string[]): WorkflowStep {
  return { id, name: `Step ${id}`, executorType, executorRef: '', position: { x: 0, y: 0 }, humanGateOutcomes };
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

function stepRun(
  runId: string,
  stepId: string,
  attempt: number,
  status: StepRunStatus,
  extra: Partial<StepRun> = {},
): StepRun {
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
    ...extra,
  };
}

function deliverable(id: string, createdAt = '2026-01-01T00:00:00.000Z'): TicketDeliverable {
  return {
    id,
    ticketId: 't1',
    agentName: 'builder',
    type: 'document',
    title: `Deliverable ${id}`,
    content: 'body',
    version: 1,
    status: 'draft',
    mentionId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('selectGateCards', () => {
  it('returns [] when there are no runs', () => {
    expect(selectGateCards(undefined, {}, [], [])).toEqual([]);
    expect(selectGateCards([], {}, [], [])).toEqual([]);
  });

  // WHY: the core of the HITL feature — a human_gate step in needs_review must
  // surface an approve/reject card, carrying the configured outcomes.
  it('surfaces a card for a human_gate step in needs_review, with the step outcomes', () => {
    const gate = step('check', 'human_gate', ['approve', 'reject']);
    const r = run('r1', 'needs_review', [gate]);
    const cards = selectGateCards([r], { r1: { stepRuns: [stepRun('r1', 'check', 1, 'needs_review')] } }, [], []);
    expect(cards.map((c) => [c.run.id, c.step.id, c.stepRun.id, c.outcomes])).toEqual([
      ['r1', 'check', 'r1-check-1', ['approve', 'reject']],
    ]);
  });

  // WHY: the step run's own output can override the template outcomes (a gate can
  // compute its choices at runtime); that live value wins over humanGateOutcomes.
  it('prefers outcomes from the step-run output over the template outcomes', () => {
    const gate = step('check', 'human_gate', ['approve', 'reject']);
    const r = run('r1', 'needs_review', [gate]);
    const sr = stepRun('r1', 'check', 1, 'needs_review', {
      output: { result: 'needs_review', schemaFields: { outcomes: ['ship', 'hold'] } },
    });
    const cards = selectGateCards([r], { r1: { stepRuns: [sr] } }, [], []);
    expect(cards[0]!.outcomes).toEqual(['ship', 'hold']);
  });

  // WHY: non-gate steps are owned by selectWaitingInputCards; a gate card for them
  // would double up.
  it('never surfaces a card for a non-gate step', () => {
    const spec = step('spec', 'agent');
    const r = run('r1', 'needs_review', [spec]);
    expect(selectGateCards([r], { r1: { stepRuns: [stepRun('r1', 'spec', 1, 'needs_review')] } }, [], [])).toEqual([]);
  });

  // WHY: only ACTIVE runs can be awaiting a decision — a finished run must not
  // leave a dangling gate card even if a stale step-run row reads needs_review.
  it('ignores non-active runs', () => {
    const gate = step('check', 'human_gate', ['approve']);
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const r = run('r1', status, [gate]);
      expect(
        selectGateCards([r], { r1: { stepRuns: [stepRun('r1', 'check', 1, 'needs_review')] } }, [], []),
        status,
      ).toEqual([]);
    }
  });

  // WHY: a retry supersedes the paused attempt; once the latest attempt is live
  // again the gate card must vanish so it can't be resolved twice.
  it('considers only the latest attempt of a step', () => {
    const gate = step('check', 'human_gate', ['approve']);
    const r = run('r1', 'needs_review', [gate]);
    const cards = selectGateCards([r], {
      r1: { stepRuns: [stepRun('r1', 'check', 1, 'needs_review'), stepRun('r1', 'check', 2, 'running')] },
    }, [], []);
    expect(cards).toEqual([]);
  });

  // WHY: detection reads step-run status from the loaded detail; before it
  // arrives we render nothing rather than guess.
  it('returns [] for an active run whose detail is not loaded yet', () => {
    const r = run('r1', 'needs_review', [step('check', 'human_gate', ['approve'])]);
    expect(selectGateCards([r], {}, [], [])).toEqual([]);
  });

  // WHY: the "to review" chips are the deliverables produced in the run, resolved
  // via the execution→deliverable FK (never agentName matching), most recent
  // first and deduplicated.
  it('collects review deliverables via the execution FK, newest first, deduped', () => {
    const gate = step('check', 'human_gate', ['approve']);
    const spec = step('spec', 'agent');
    const r = run('r1', 'needs_review', [spec, gate]);
    // Two producing step runs (older + newer) plus the gate awaiting review.
    const older = stepRun('r1', 'spec', 1, 'completed', { executionId: 'e-old', completedAt: '2026-01-01T01:00:00.000Z' });
    const newer = stepRun('r1', 'spec', 2, 'completed', { executionId: 'e-new', completedAt: '2026-01-01T02:00:00.000Z' });
    const gateSr = stepRun('r1', 'check', 1, 'needs_review');
    const executions: GateExecutionInput[] = [
      { id: 'e-old', deliverableId: 'd-old' },
      { id: 'e-new', deliverableId: 'd-new' },
    ];
    const deliverables = [deliverable('d-old'), deliverable('d-new')];
    const cards = selectGateCards([r], { r1: { stepRuns: [older, newer, gateSr] } }, executions, deliverables);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.reviewDeliverables.map((d) => d.id)).toEqual(['d-new', 'd-old']);
  });

  // WHY: concurrent runs each pause independently — one gate card per run.
  it('produces one card per gate across concurrent runs', () => {
    const a = run('rA', 'needs_review', [step('check', 'human_gate', ['approve'])]);
    const b = run('rB', 'blocked', [step('review', 'human_gate', ['ok'])]);
    const cards = selectGateCards([a, b], {
      rA: { stepRuns: [stepRun('rA', 'check', 1, 'needs_review')] },
      rB: { stepRuns: [stepRun('rB', 'review', 1, 'needs_review')] },
    }, [], []);
    expect(cards.map((c) => c.run.id).sort()).toEqual(['rA', 'rB']);
  });
});
