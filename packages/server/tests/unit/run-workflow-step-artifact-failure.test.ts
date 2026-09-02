import { describe, it, expect, vi } from 'vitest';
import type { StepOutput } from '@fleex/shared';
import { RunWorkflowStepUseCase } from '../../src/application/use-cases/run-workflow-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { buildRunHistory } from '../../src/application/utils/run-history.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'Spec Dev PR', emoji: '🔧',
    steps: [
      { id: 'a', name: 'Spec', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } },
      { id: 'b', name: 'Dev', executorType: 'agent', executorRef: 'p2', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', isDefault: true }],
    entryStepId: 'a',
  },
  triggeredBy: '@nas', triggeredFrom: 'api',
});

const AGENT_OUTPUT: StepOutput = {
  schemaFields: { verdict: 'shipped' },
  result: 'ok',
  comment: 'Spec delivered, handing off to the builder.',
  deliverable: {
    type: 'spec',
    title: 'Spec — deliverables must never fail on an unstorable character',
    markdown: '# Spec\n\nA long body the agent spent a whole run producing.',
    status: 'final',
  },
};

/**
 * Builds the use case with a `submitDeliverable` that rejects — reproducing the
 * exact failure this ticket reports: the store refuses the row, the step fails,
 * and the run stops.
 */
const setup = (storeError: Error) => {
  const run = makeRun();
  const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
  const stepRunStore = {
    save: vi.fn(),
    getLatestForStep: vi.fn().mockResolvedValue(null),
    getByWorkflowRun: vi.fn().mockResolvedValue([]),
  };
  const agentExecutor = {
    execute: vi.fn().mockResolvedValue({ output: AGENT_OUTPUT, executionId: 'exec-1' }),
  };
  const eventBus = { emit: vi.fn() };
  const orchestrator = { runStep: vi.fn() };

  const uc = new RunWorkflowStepUseCase({
    runStore: runStore as never,
    stepRunStore: stepRunStore as never,
    orchestrator: orchestrator as never,
    eventBus: eventBus as never,
    executors: {
      agent: agentExecutor as never,
      skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never,
    },
    submitDeliverable: { execute: vi.fn().mockRejectedValue(storeError) } as never,
    postComment: { execute: vi.fn().mockResolvedValue({ comment: { id: 'c-1' }, createdMentions: [] }) } as never,
    agentEventStore: { setExecutionOutputs: vi.fn() } as never,
  });

  return { uc, run, runStore, stepRunStore, eventBus, orchestrator };
};

/** The last step_run handed to the store — what a human would actually read back. */
const lastSavedStepRun = (stepRunStore: { save: ReturnType<typeof vi.fn> }): StepRunEntity => {
  const calls = stepRunStore.save.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as StepRunEntity;
};

describe('RunWorkflowStepUseCase when persisting artifacts fails', () => {
  it('keeps the agent output on the step run instead of replacing it with the error', async () => {
    // AC 23 / D4. This is the second half of the reported bug: the run failed
    // AND the agent's work vanished, so every relaunch had to regenerate it
    // from scratch — and hit the same wall. `fail()` only merges the error when
    // an output is already present, so the output must be assigned before the
    // artifacts are persisted.
    const { uc, stepRunStore } = setup(new Error(
      'SupabaseDeliverableStore.save failed: unsupported Unicode escape sequence',
    ));

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    const saved = lastSavedStepRun(stepRunStore);
    expect(saved.status).toBe('failed');
    expect(saved.output).not.toBeNull();
    expect(saved.output!.deliverable!.title).toBe(AGENT_OUTPUT.deliverable!.title);
    expect(saved.output!.deliverable!.markdown).toBe(AGENT_OUTPUT.deliverable!.markdown);
    expect(saved.output!.comment).toBe(AGENT_OUTPUT.comment);
    expect(saved.output!.schemaFields['verdict']).toBe('shipped');
  });

  it('still records the store error in the output it preserved', async () => {
    // The work is kept, but the failure must remain diagnosable.
    const { uc, stepRunStore } = setup(new Error('unsupported Unicode escape sequence'));

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(lastSavedStepRun(stepRunStore).output!.schemaFields['error'])
      .toBe('unsupported Unicode escape sequence');
  });

  it('still fails the run and still reports the error on workflow.run_failed', async () => {
    // AC 24 — retaining the output must not soften the failure. Routing
    // behaviour is unchanged: a broken save is still a broken run.
    const { uc, run, eventBus } = setup(new Error('boom'));

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('failed');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workflow.run_failed', error: 'boom' }),
    );
  });

  it('does not kick off the next step', async () => {
    const { uc, run, orchestrator } = setup(new Error('boom'));

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(orchestrator.runStep).not.toHaveBeenCalled();
    // `fail()` clears the pointer — the run stops here, it does not sit on 'b'.
    expect(run.currentStepId).toBeNull();
  });
});

describe('buildRunHistory on a failed step run that kept its output', () => {
  it('surfaces the deliverable title but never the markdown', async () => {
    // AC 25 — D4 makes failed step outputs reachable by the history builder for
    // the first time, so lock the prompt budget: a 28 KB spec body must not
    // start being replayed into every subsequent step's prompt.
    const stepRun = new StepRunEntity(
      's1', 'run-1', 'a', 1, 'failed', 'ko', null, null, null, null, null, new Date(),
    );
    stepRun.output = AGENT_OUTPUT;
    stepRun.fail({ message: 'unsupported Unicode escape sequence' });

    const history = buildRunHistory({
      stepNames: { a: 'Spec' },
      stepRuns: [stepRun],
      currentStepId: 'b',
      currentAttempt: 1,
    });

    expect(history).toHaveLength(1);
    expect(history[0]!.deliverableTitle).toBe(AGENT_OUTPUT.deliverable!.title);
    expect(JSON.stringify(history)).not.toContain('A long body the agent spent');
  });
});
