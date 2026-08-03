import { describe, it, expect, vi } from 'vitest';
import { CancelStepUseCase } from '../../src/application/use-cases/cancel-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { WorkflowRunNotFoundError, StepRunNotFoundError } from '../../src/domain/errors.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '🔧',
    steps: [{ id: 'a', name: 'A', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } }],
    edges: [], entryStepId: 'a',
  },
  triggeredBy: '@john', triggeredFrom: 'x',
});

const failedStep = () => {
  const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'a' });
  sr.start();
  sr.fail({ message: 'boom' });
  return sr;
};

const runningStep = (executionId: string | null) => {
  const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'a' });
  sr.start();
  sr.executionId = executionId;
  return sr;
};

const deps = (run: WorkflowRunEntity | null, stepRun: StepRunEntity | null) => {
  const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
  const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
  const canceller = { cancelExecution: vi.fn().mockResolvedValue(true) };
  const eventBus = { emit: vi.fn() };
  const uc = new CancelStepUseCase(
    runStore as never, stepRunStore as never, canceller as never, eventBus as never,
  );
  return { uc, runStore, stepRunStore, canceller, eventBus };
};

describe('CancelStepUseCase', () => {
  it('throws when the run does not exist', async () => {
    const { uc } = deps(null, null);
    await expect(uc.execute({ workflowRunId: 'missing', stepRunId: 'sr-1' }))
      .rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  it('throws when the step_run does not exist', async () => {
    const { uc } = deps(makeRun(), null);
    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'missing' }))
      .rejects.toBeInstanceOf(StepRunNotFoundError);
  });

  // WHY (AC1/AC4): the failed-step banner is derived from `status === 'failed'`.
  // Dismissing it must be a real state change, otherwise the banner comes back
  // on the next reload and the user is stuck again.
  it('flips a failed step to cancelled and emits step_cancelled', async () => {
    const step = failedStep();
    const { uc, stepRunStore, eventBus } = deps(makeRun(), step);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    expect(step.status).toBe('cancelled');
    expect(stepRunStore.save).toHaveBeenCalledWith(step);
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.step_cancelled', workflowRunId: 'run-1', stepRunId: 'sr-1', ticketId: 't-1',
    }));
  });

  // WHY (AC6): dismissing is a step-level action. Silently closing the run would
  // falsify its history — closing the run out stays an explicit "Cancel run".
  it('leaves the run status untouched', async () => {
    const run = makeRun();
    const { uc, runStore } = deps(run, failedStep());

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    expect(run.status).toBe('running');
    expect(runStore.save).not.toHaveBeenCalled();
  });

  // WHY (AC3): abandoning a live step must kill its agent, otherwise the step
  // reads `cancelled` while the agent keeps writing to the worktree.
  it('aborts the agent execution when the step is still running', async () => {
    const step = runningStep('exec-1');
    const { uc, canceller } = deps(makeRun(), step);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    expect(canceller.cancelExecution).toHaveBeenCalledWith('exec-1');
    expect(step.status).toBe('cancelled');
  });

  it('still cancels the step when the abort throws (best-effort)', async () => {
    const step = runningStep('exec-1');
    const { uc, canceller } = deps(makeRun(), step);
    canceller.cancelExecution.mockRejectedValue(new Error('gone'));

    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' })).resolves.toBeUndefined();

    expect(step.status).toBe('cancelled');
  });

  it('is idempotent on an already-cancelled step', async () => {
    const step = failedStep();
    step.cancel();
    const { uc, stepRunStore, eventBus } = deps(makeRun(), step);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1' });

    expect(stepRunStore.save).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
