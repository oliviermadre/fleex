import { describe, it, expect } from 'vitest';
import type { StepOutput, StepRunStatus } from '@fleex/shared';
import { buildRunHistory, formatRunHistory } from '../../src/application/utils/run-history.js';

let clock = 0;
function sr(params: {
  stepId: string;
  attempt?: number;
  status?: StepRunStatus;
  output?: Partial<StepOutput> | null;
}) {
  return {
    stepId: params.stepId,
    attempt: params.attempt ?? 1,
    status: params.status ?? ('completed' as StepRunStatus),
    output: params.output === null || params.output === undefined
      ? null
      : ({ schemaFields: {}, result: 'ok', ...params.output } as StepOutput),
    createdAt: new Date(2026, 0, 1, 0, 0, clock++),
  };
}

const stepNames = { s1: 'Collect issues', s2: 'Draft recap', s3: 'Ship' };

describe('buildRunHistory', () => {
  // WHY: this is the whole point of the run history. `previousOutputs` carries
  // only schemaFields, so on a routine run — which has no ticket timeline to
  // fall back on — everything an agent actually SAID or PRODUCED vanished
  // between steps. The next step must be able to read it.
  it('carries the comment and deliverable of an earlier step, not just its schema fields', () => {
    clock = 0;
    const entries = buildRunHistory({
      stepNames,
      stepRuns: [
        sr({
          stepId: 's1',
          output: {
            schemaFields: { count: 3 },
            comment: 'Found 3 stale PRs',
            deliverable: { title: 'PR audit', markdown: '...', type: 'report', status: 'final' },
          },
        }),
      ],
      currentStepId: 's2',
      currentAttempt: 1,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      stepName: 'Collect issues',
      comment: 'Found 3 stale PRs',
      deliverableTitle: 'PR audit',
      fields: { count: 3 },
      isEarlierAttemptOfCurrentStep: false,
    });
  });

  // WHY: the human's answer to a `waiting_for_info` question is recorded on the
  // attempt that ASKED it, and the retry runs as attempt+1. If earlier attempts
  // of the current step were dropped (as `previousOutputs` deliberately does, to
  // keep edge conditions clean) the retried step would re-run on the exact same
  // prompt and ask the same question forever. That is the bug reported on
  // routine runs.
  it('keeps earlier attempts of the current step so a human answer reaches the retry', () => {
    clock = 0;
    const entries = buildRunHistory({
      stepNames,
      stepRuns: [
        sr({ stepId: 's2', attempt: 1, status: 'needs_review', output: { comment: 'Which repo?', humanResponse: 'fleex only' } }),
      ],
      currentStepId: 's2',
      currentAttempt: 2,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      humanResponse: 'fleex only',
      isEarlierAttemptOfCurrentStep: true,
    });
    expect(formatRunHistory(entries)).toContain('fleex only');
  });

  // WHY: a human gate's decision is the only thing that step produces. Its
  // outcome + notes are merged into schemaFields by StepRunEntity.resolveGate;
  // the history must name them so a downstream agent reads a decision rather
  // than guessing at an opaque `{"notes":"..."}` blob.
  it('surfaces a resolved gate outcome and its notes', () => {
    clock = 0;
    const entries = buildRunHistory({
      stepNames,
      stepRuns: [
        sr({ stepId: 's1', output: { schemaFields: { outcome: 'approve', notes: 'ship it, skip the QA step' }, outcome: 'approve' } }),
      ],
      currentStepId: 's2',
      currentAttempt: 1,
    });
    expect(entries[0]).toMatchObject({ outcome: 'approve', humanNotes: 'ship it, skip the QA step' });
    const md = formatRunHistory(entries);
    expect(md).toContain('outcome: approve');
    expect(md).toContain('ship it, skip the QA step');
  });

  // WHY: the in-flight attempt has produced nothing yet — including it would put
  // an empty, confusing line in the agent's own prompt.
  it('excludes the attempt being executed and anything still queued or running', () => {
    clock = 0;
    const entries = buildRunHistory({
      stepNames,
      stepRuns: [
        sr({ stepId: 's2', attempt: 2, status: 'running' }),
        sr({ stepId: 's3', status: 'queued' }),
        sr({ stepId: 's1', output: { comment: 'done' } }),
      ],
      currentStepId: 's2',
      currentAttempt: 2,
    });
    expect(entries.map((e) => e.stepName)).toEqual(['Collect issues']);
  });

  // WHY: the agent reads the history as a story. Out-of-order steps make a
  // multi-step routine unreadable and invite wrong conclusions about causality.
  it('orders entries chronologically', () => {
    clock = 0;
    const first = sr({ stepId: 's1', output: { comment: 'a' } });
    const second = sr({ stepId: 's2', output: { comment: 'b' } });
    const entries = buildRunHistory({
      stepNames,
      stepRuns: [second, first],
      currentStepId: 's3',
      currentAttempt: 1,
    });
    expect(entries.map((e) => e.stepName)).toEqual(['Collect issues', 'Draft recap']);
  });
});

describe('formatRunHistory', () => {
  it('renders nothing for an empty history so the prompt gains no dangling header', () => {
    expect(formatRunHistory([])).toBe('');
  });
});
