import { describe, it, expect, vi } from 'vitest';

import { HumanGateStepExecutor } from '../../src/application/services/step-executors/human-gate-step-executor.js';

const makeInput = (overrides: Partial<{ outcomes: string[] }> = {}) => ({
  ticketId: 't-1',
  workflowRunId: 'run-1',
  stepRunId: 'sr-1',
  step: {
    id: 'gate',
    name: 'Human Review',
    executorType: 'human_gate' as const,
    executorRef: '',
    position: { x: 0, y: 0 },
    humanGateOutcomes: overrides.outcomes ?? ['approve', 'reject'],
  },
  workflowContext: {
    workflowName: 'W',
    stepName: 'Human Review',
    outgoingEdges: [],
    previousOutputs: {},
  },
});

describe('HumanGateStepExecutor', () => {
  it('posts a comment and returns needs_review', async () => {
    const postComment = {
      execute: vi.fn().mockResolvedValue({ comment: { id: 'c-1' }, createdMentions: [] }),
    };
    const exec = new HumanGateStepExecutor(postComment as never);
    const r = await exec.execute(makeInput());
    expect(r.output.result).toBe('needs_review');
    expect((r.output.schemaFields as Record<string, unknown>).outcomes).toEqual([
      'approve',
      'reject',
    ]);
    expect(postComment.execute).toHaveBeenCalledOnce();
  });

  it('throws if humanGateOutcomes is empty', async () => {
    const postComment = { execute: vi.fn() };
    const exec = new HumanGateStepExecutor(postComment as never);
    await expect(exec.execute(makeInput({ outcomes: [] }))).rejects.toThrow(/at least one outcome/);
  });
});
