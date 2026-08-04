import { describe, it, expect } from 'vitest';
import type {
  WorkflowRun,
  StepRun,
  WorkflowStep,
  WorkflowEdge,
  WorkflowRunStatus,
  StepRunStatus,
} from '@fleex/shared';
import { selectAmbiguousRoutingCards } from './ambiguousRoutingCards';

/**
 * The card is the only way a cockpit/mobile user can unblock a run parked on an
 * ambiguity, so these tests pin what it may offer: exactly the edges the engine
 * saw match, on the attempt that is actually live.
 */

function step(id: string): WorkflowStep {
  return { id, name: id.toUpperCase(), executorType: 'agent', executorRef: '', position: { x: 0, y: 0 } };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target, isDefault: false };
}

function run(
  id: string,
  status: WorkflowRunStatus,
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
): WorkflowRun {
  return {
    id,
    ticketId: 't1',
    templateId: 'tpl1',
    templateSnapshot: { name: 'WF', emoji: '🚦', steps, edges, entryStepId: steps[0]?.id ?? '' },
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
  candidateEdgeIds?: string[],
): StepRun {
  return {
    id: `${runId}-${stepId}-${attempt}`,
    workflowRunId: runId,
    stepId,
    attempt,
    status,
    result: 'ok',
    output: candidateEdgeIds
      ? { schemaFields: {}, result: 'ok', routing: { candidateEdgeIds } }
      : null,
    nextEdgeId: null,
    executionId: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const steps = [step('a'), step('fix'), step('spec')];
const edges = [edge('e1', 'a', 'fix'), edge('e2', 'a', 'spec'), edge('e3', 'a', 'spec')];

describe('selectAmbiguousRoutingCards', () => {
  it('returns [] when there are no runs', () => {
    expect(selectAmbiguousRoutingCards(undefined, {})).toEqual([]);
    expect(selectAmbiguousRoutingCards([], {})).toEqual([]);
  });

  it('surfaces a card with the edges the engine offered', () => {
    const r = run('r1', 'needs_review', steps, edges);
    const cards = selectAmbiguousRoutingCards([r], {
      r1: { stepRuns: [stepRun('r1', 'a', 1, 'awaiting_routing', ['e1', 'e2'])] },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.step.id).toBe('a');
    expect(cards[0]?.candidates.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('offers only the persisted candidates, never every outgoing edge', () => {
    // WHY: `e3` also leaves `a`, but it did not match when the run paused. Widening
    // the choice would let a reviewer take a branch the engine never validated.
    const r = run('r1', 'needs_review', steps, edges);
    const cards = selectAmbiguousRoutingCards([r], {
      r1: { stepRuns: [stepRun('r1', 'a', 1, 'awaiting_routing', ['e1', 'e2'])] },
    });
    expect(cards[0]?.candidates.map((e) => e.id)).not.toContain('e3');
  });

  it('ignores a parked attempt superseded by a re-run', () => {
    // WHY: same rule as the gate / waiting-input cards — otherwise the thread
    // would show a decision for a step that is already running again.
    const r = run('r1', 'needs_review', steps, edges);
    const cards = selectAmbiguousRoutingCards([r], {
      r1: {
        stepRuns: [
          stepRun('r1', 'a', 1, 'awaiting_routing', ['e1', 'e2']),
          stepRun('r1', 'a', 2, 'running'),
        ],
      },
    });
    expect(cards).toEqual([]);
  });

  it('ignores runs that are no longer active', () => {
    const r = run('r1', 'cancelled', steps, edges);
    const cards = selectAmbiguousRoutingCards([r], {
      r1: { stepRuns: [stepRun('r1', 'a', 1, 'awaiting_routing', ['e1', 'e2'])] },
    });
    expect(cards).toEqual([]);
  });

  it('drops a card whose candidate edges no longer exist in the snapshot', () => {
    // WHY: an empty card has no action on it — better to send the user to the
    // Workflow tab than to render a dead-end.
    const r = run('r1', 'needs_review', steps, edges);
    const cards = selectAmbiguousRoutingCards([r], {
      r1: { stepRuns: [stepRun('r1', 'a', 1, 'awaiting_routing', ['gone-1', 'gone-2'])] },
    });
    expect(cards).toEqual([]);
  });

  it('ignores steps in other statuses', () => {
    const r = run('r1', 'needs_review', steps, edges);
    const cards = selectAmbiguousRoutingCards([r], {
      r1: { stepRuns: [stepRun('r1', 'a', 1, 'needs_review', ['e1', 'e2'])] },
    });
    expect(cards).toEqual([]);
  });
});
